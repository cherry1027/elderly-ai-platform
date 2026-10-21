import { File } from 'expo-file-system';
import {
  executeSessionAudioRequest, StoryProjectsError, validDate, validateStoryProjectId,
  type ListStoryProjectsOptions, type StoryProjectsErrorKind,
} from './story-projects';

export interface AudioRecording {
  uri: string;
  name: 'recording.m4a';
  type: 'audio/mp4';
  size: number;
  durationMs: number;
}

export interface AudioTranscript {
  transcript_id: string;
  session_id: string;
  language: 'en' | 'sv';
  text: string;
  status: 'completed';
  created_at: string;
}

/** Validate the server notice; never synthesize a successful transcript locally. */
export const SIMULATED_TRANSCRIPT_NOTICE = '[SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — FICTIONAL / FIKTIVT. ' +
  'Not derived from uploaded audio / Inte baserat på uppladdat ljud.]\n';

const errorStatuses = {
  AUTHORIZATION_REQUIRED: 401, INVALID_ACCESS_TOKEN: 401, ACCESS_DENIED: 403,
  SESSION_NOT_FOUND: 404, PROJECT_NOT_FOUND: 404, UPLOAD_TIMEOUT: 408,
  SESSION_COMPLETED: 409, TRANSCRIPTION_IN_PROGRESS: 409, TRANSCRIPTION_CONFLICT: 409,
  RECORDING_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, UNSUPPORTED_AUDIO_FORMAT: 415,
  INVALID_RECORDING: 422, RECORDING_TOO_LONG: 422, AUDIO_PROCESSING_LIMIT: 422,
  CONSENT_REQUIRED: 422, LANGUAGE_MISMATCH: 422, VALIDATION_ERROR: 422,
  AUDIO_BUSY: 429, TRANSCRIPTION_DISABLED: 503, TRANSCRIPTION_UNAVAILABLE: 503,
  TRANSCRIPTION_INVALID_RESPONSE: 503, AUDIO_PROCESSING_UNAVAILABLE: 503,
  SUPABASE_UNAVAILABLE: 503, TRANSCRIPTION_TIMEOUT: 504,
} as const;
export type AudioTranscriptErrorCode = keyof typeof errorStatuses;

/** Only known status/code pairs survive. Never retain server messages or bodies. */
export class AudioTranscriptError extends StoryProjectsError {
  readonly code?: AudioTranscriptErrorCode;
  constructor(kind: StoryProjectsErrorKind, status?: number, mayHaveWritten = false, code?: string) {
    super(kind, status, mayHaveWritten);
    this.name = 'AudioTranscriptError';
    if (typeof code === 'string' && Object.hasOwn(errorStatuses, code) &&
      errorStatuses[code as AudioTranscriptErrorCode] === status) this.code = code as AudioTranscriptErrorCode;
  }
}

function httpError(status: number, rawCode: string | undefined, writing: boolean): AudioTranscriptError {
  const kind: StoryProjectsErrorKind = status === 401 ? 'authentication' : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 408 || status === 504 ? 'timeout'
    : [400, 413, 415, 422].includes(status) ? 'validation' : status >= 400 ? 'unavailable' : 'invalid-response';
  const safeCode = typeof rawCode === 'string' && Object.hasOwn(errorStatuses, rawCode) &&
    errorStatuses[rawCode as AudioTranscriptErrorCode] === status ? rawCode : undefined;
  // A disabled provider is rejected before the server takes a transcription claim.
  const uncertain = writing && status >= 500 && safeCode !== 'TRANSCRIPTION_DISABLED';
  return new AudioTranscriptError(kind, status, uncertain, safeCode);
}

interface SessionTranscriptOptions extends ListStoryProjectsOptions {
  sessionId: string;
  expectedLanguage: 'en' | 'sv';
}

export interface AudioUploadDiagnostic {
  stage: 'authentication' | 'fetch-invoked' | 'file-read' | 'http-response' | 'response-body' | 'completed';
  outcome: 'progress' | 'failed' | 'completed';
  kind?: StoryProjectsErrorKind;
  status?: number;
  code?: AudioTranscriptErrorCode;
}

export interface UploadSessionRecordingOptions extends SessionTranscriptOptions {
  onDiagnostic?: (event: AudioUploadDiagnostic) => void;
  recording: AudioRecording;
  idempotencyKey: string;
  consent: boolean;
}

function identity(sessionId: unknown, language: unknown): { sessionId: string; language: 'en' | 'sv' } {
  const id = validateStoryProjectId(sessionId);
  if (language !== 'en' && language !== 'sv') throw new AudioTranscriptError('validation');
  return { sessionId: id, language };
}

function validateRecording(recording: AudioRecording): void {
  if (!recording || typeof recording !== 'object' || Array.isArray(recording) ||
    recording.name !== 'recording.m4a' || recording.type !== 'audio/mp4' ||
    !Number.isSafeInteger(recording.size) || recording.size < 1 || recording.size > 25_000_000 ||
    !Number.isFinite(recording.durationMs) || recording.durationMs <= 0 || recording.durationMs > 90_000 ||
    typeof recording.uri !== 'string' || recording.uri.length > 4096) throw new AudioTranscriptError('validation');
  let decoded: string;
  try { decoded = decodeURIComponent(recording.uri); } catch { throw new AudioTranscriptError('validation'); }
  if (!/^file:\/\/\/[^\0\r\n?#\\]+\.m4a$/i.test(decoded) ||
    decoded.split('/').some(part => part === '.' || part === '..')) throw new AudioTranscriptError('validation');
}

function transcript(value: unknown, sessionId: string, language: 'en' | 'sv'): AudioTranscript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AudioTranscriptError('invalid-response');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'created_at,language,session_id,status,text,transcript_id' ||
    typeof row.transcript_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.transcript_id) ||
    typeof row.session_id !== 'string' || row.session_id.toLowerCase() !== sessionId ||
    row.language !== language || row.status !== 'completed' || !validDate(row.created_at) ||
    typeof row.text !== 'string' || !row.text.startsWith(SIMULATED_TRANSCRIPT_NOTICE) ||
    row.text.length <= SIMULATED_TRANSCRIPT_NOTICE.length || row.text.length > 64_000 ||
    [...row.text].length > 32_000 || /\0|\p{Cs}/u.test(row.text)) throw new AudioTranscriptError('invalid-response');
  return { transcript_id: row.transcript_id.toLowerCase(), session_id: sessionId,
    language, text: row.text, status: 'completed', created_at: row.created_at };
}

/** One logical recording: explicit consent, original bytes and original UUID on retry. */
export async function uploadSessionRecording({ sessionId, expectedLanguage, recording, idempotencyKey, consent,
  onDiagnostic, ...options }: UploadSessionRecordingOptions): Promise<AudioTranscript> {
  const selected = identity(sessionId, expectedLanguage);
  validateRecording(recording);
  if (consent !== true || typeof idempotencyKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new AudioTranscriptError('validation');
  }
  let stage: AudioUploadDiagnostic['stage'] = 'authentication';
  let httpStatus: number | undefined;
  let finished = false;
  const report = (event: AudioUploadDiagnostic) => {
    if (finished) return;
    try { onDiagnostic?.(event); } catch { /* optional diagnostics never control an upload */ }
  };
  const progress = (next: AudioUploadDiagnostic['stage'], status?: number) => {
    stage = next;
    if (Number.isInteger(status) && status! >= 100 && status! <= 599) httpStatus = status;
    report({ stage, outcome: 'progress', ...(httpStatus ? { status: httpStatus } : {}) });
  };
  const body = new FormData();
  // SDK 57 installs Expo fetch globally. Its serializer rejects RN's URI-only
  // descriptor; the supported File-like bytes() part sends the actual M4A bytes.
  // A narrow wrapper keeps a fixed filename/MIME without mutating File getters.
  body.append('file', { name: recording.name, type: recording.type, bytes: async () => {
    progress('file-read');
    try {
      const file = new File(recording.uri);
      if (!file.exists || file.size !== recording.size) throw new Error();
      const bytes = await file.bytes();
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== recording.size) throw new Error();
      progress('fetch-invoked');
      return bytes;
    } catch {
      // No HTTP request can start when Expo's local body conversion fails.
      throw new AudioTranscriptError('validation');
    }
  } } as unknown as Blob);
  body.append('language', selected.language);
  body.append('consent', 'true');
  try {
    const result = await executeSessionAudioRequest({ ...options, timeoutMs: options.timeoutMs ?? 60_000 }, {
      sessionId: selected.sessionId, action: 'transcribe', body, idempotencyKey,
      onProgress: progress, onHttpError: (status, code) => httpError(status, code, true),
    }, value => transcript(value, selected.sessionId, selected.language));
    report({ stage: 'completed', outcome: 'completed', status: httpStatus });
    finished = true;
    return result;
  } catch (error) {
    const safe = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
    report({ stage, outcome: 'failed', kind: safe.kind,
      ...(httpStatus ? { status: httpStatus } : {}),
      ...(safe instanceof AudioTranscriptError && safe.code ? { code: safe.code } : {}) });
    finished = true;
    throw safe;
  }
}

/** Read-only persistence check; history cannot identify an uncertain upload by key. */
export async function listSessionTranscripts({ sessionId, expectedLanguage,
  ...options }: SessionTranscriptOptions): Promise<AudioTranscript[]> {
  const selected = identity(sessionId, expectedLanguage);
  return executeSessionAudioRequest(options, { sessionId: selected.sessionId, action: 'transcripts',
    onHttpError: (status, code) => httpError(status, code, false),
  }, value => {
    if (!Array.isArray(value) || value.length > 50) throw new AudioTranscriptError('invalid-response');
    const rows = value.map(item => transcript(item, selected.sessionId, selected.language));
    if (new Set(rows.map(row => row.transcript_id)).size !== rows.length) throw new AudioTranscriptError('invalid-response');
    return rows;
  });
}
