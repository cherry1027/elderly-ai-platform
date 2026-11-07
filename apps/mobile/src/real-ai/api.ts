import { fetch as nativeFetch } from 'expo/fetch';
import { CryptoDigestAlgorithm, digest, digestStringAsync } from 'expo-crypto';
import { apiBackoff, BackoffWaitError, parseRetryAdvice } from '../api/backoff';
import type { AudioRecording } from '../api/audio-transcripts';
import { createRecordingUpload } from '../audio/recording-upload';
import type { MemoryFact } from '../api/memory-review';
import type { StoryEdit, StorySourceMemory } from '../api/story-drafts';
import type { StoryExport } from '../api/story-exports';
import { normalizeMobileApiBaseUrl, StoryProjectsError, validDate, validateStoryProjectId,
  type ListStoryProjectsOptions } from '../api/story-projects';

export interface Provenance { mode: 'real'; provider: 'openai'; model: string; version: 1 }
export interface OriginalTextProvenance { mode: 'original'; provider: 'user'; model: null; version: 1 }
export interface RealCapabilities {
  contract: 'real-v2'; mode: 'real'; enabled: boolean; transcription: boolean;
  conversation: boolean; writing: boolean; speech: boolean; reason: string;
}
export interface RealTranscript {
  transcript_id: string; project_id: string; session_id: string; language: 'en' | 'sv'; text: string;
  status: 'completed'; created_at: string; provenance: Provenance;
}
export interface RealMessage {
  id: string; project_id: string; session_id: string; role: 'user' | 'assistant'; language: 'en' | 'sv';
  text: string; sequence: number; source_transcript_id: string | null; source_text_input_id?: string | null;
  created_at: string; provenance: Provenance | OriginalTextProvenance;
}
export interface RealMemory extends MemoryFact { clarification_question: string | null }
export interface RealTurn { user_message: RealMessage; message: RealMessage; memories: RealMemory[]; mode: 'real' }
export interface RealVerification {
  status: 'needs_review' | 'stale_sources'; unsupported_claims: string[];
  method: 'model_review_v1' | 'manual_unverified'; checked_revision: number | null;
  checked_at: string | null; sources_current: boolean; reason: string | null;
}
export interface RealDraft {
  draft_id: string; project_id: string; status: 'needs_review' | 'edited'; language: 'en' | 'sv';
  style: 'warm'; version: number; revision: number; content: string; original_content: string;
  mode: 'real'; source_memories: StorySourceMemory[]; verification: RealVerification; provenance: Provenance;
  created_at: string; updated_at: string;
}
export interface SpeechMetadata {
  speech_id: string; assistant_message_id: string; language: 'en' | 'sv'; media_type: 'audio/wav';
  audio_sha256: string; audio_size: number; expires_at: string; status: 'ready';
}
export type RealExport = Omit<StoryExport, 'renderer_version'> & { renderer_version: 'memy_real_pdf_v1' };
export interface RealScope extends ListStoryProjectsOptions { projectId: string; sessionId: string; language: 'en' | 'sv' }
export type RealRecovery = 'contact-operator' | 'sign-in' | 'wait' | 'check-saved';
export class RealAiError extends StoryProjectsError {
  constructor(kind: ConstructorParameters<typeof StoryProjectsError>[0], status?: number, uncertain = false,
    readonly code?: string, retry?: ConstructorParameters<typeof StoryProjectsError>[3], readonly operationId?: string, readonly recovery?: RealRecovery) {
    super(kind, status, uncertain, retry); this.name = 'RealAiError';
  }
}
const invalid = (): never => { throw new RealAiError('invalid-response'); };
function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, blank = false): value is string {
  return typeof value === 'string' && [...value].length <= maximum && (blank || !!value.trim()) && !/[\0\uD800-\uDFFF]/u.test(value);
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
function positive(value: unknown, maximum = 2_147_483_647): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}
function provenance(value: unknown): Provenance {
  const v = row(value, ['mode', 'provider', 'model', 'version']);
  if (v.mode !== 'real' || v.provider !== 'openai' || typeof v.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(v.model) || v.version !== 1) invalid();
  return v as unknown as Provenance;
}
function owned(v: Record<string, unknown>, scope: RealScope) {
  if (!uuid(v.project_id) || v.project_id.toLowerCase() !== scope.projectId.toLowerCase() ||
    !uuid(v.session_id) || v.session_id.toLowerCase() !== scope.sessionId.toLowerCase()) invalid();
}
export function decodeCapabilities(value: unknown): RealCapabilities {
  const v = row(value, ['contract', 'mode', 'enabled', 'transcription', 'conversation', 'writing', 'speech', 'reason']);
  if (v.contract !== 'real-v2' || v.mode !== 'real' ||
    !['enabled', 'transcription', 'conversation', 'writing', 'speech'].every(key => typeof v[key] === 'boolean') ||
    !text(v.reason, 100) || (!v.enabled && [v.transcription, v.conversation, v.writing, v.speech].some(Boolean))) invalid();
  return v as unknown as RealCapabilities;
}
export function decodeTranscript(value: unknown, scope: RealScope): RealTranscript {
  const v = row(value, ['transcript_id', 'project_id', 'session_id', 'language', 'text', 'status', 'created_at', 'provenance']);
  owned(v, scope);
  if (!uuid(v.transcript_id) || v.language !== scope.language || v.status !== 'completed' ||
    !text(v.text, 32_000) || /SIMULATED TRANSCRIPT|SIMULERAD TRANSKRIPTION/.test(v.text) || !validDate(v.created_at)) invalid();
  return { ...v, provenance: provenance(v.provenance) } as unknown as RealTranscript;
}
export function decodeMessage(value: unknown, scope: RealScope): RealMessage {
  const typedField = !!value && typeof value === 'object' && Object.hasOwn(value, 'source_text_input_id');
  const v = row(value, ['id', 'project_id', 'session_id', 'role', 'language', 'text', 'sequence', 'source_transcript_id',
    ...(typedField ? ['source_text_input_id'] : []), 'created_at', 'provenance']);
  owned(v, scope);
  const typedId = typedField ? v.source_text_input_id : null;
  const typed = uuid(typedId);
  if (!uuid(v.id) || !['user', 'assistant'].includes(v.role as string) || v.language !== scope.language ||
    !text(v.text, 32_000) || !positive(v.sequence) ||
    (typed ? v.source_transcript_id !== null : typedId !== null || !uuid(v.source_transcript_id)) ||
    (v.role === 'user' && v.id !== (typed ? typedId : v.source_transcript_id)) ||
    !validDate(v.created_at)) invalid();
  let source: Provenance | OriginalTextProvenance;
  if (typed && v.role === 'user') {
    if (!text(v.text, 4000)) invalid();
    const original = row(v.provenance, ['mode', 'provider', 'model', 'version']);
    if (original.mode !== 'original' || original.provider !== 'user' || original.model !== null || original.version !== 1) invalid();
    source = original as unknown as OriginalTextProvenance;
  } else source = provenance(v.provenance);
  return { ...v, source_text_input_id: typedId, provenance: source } as unknown as RealMessage;
}
export function decodeMemory(value: unknown, scope: RealScope): RealMemory {
  const v = row(value, ['id', 'project_id', 'session_id', 'source_message_id', 'fact_type', 'value', 'evidence',
    'year', 'slot', 'uncertain', 'status', 'corrected_value', 'version', 'created_at', 'updated_at', 'clarification_question']);
  owned(v, scope);
  if (!uuid(v.id) || !uuid(v.source_message_id) || !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(v.fact_type as string) ||
    !text(v.value, 1000) || !text(v.evidence, 1000) || !(v.year === null || positive(v.year, 2100)) ||
    !(v.slot === null || text(v.slot, 80, true)) || typeof v.uncertain !== 'boolean' ||
    !['pending', 'confirmed', 'rejected'].includes(v.status as string) ||
    !(v.corrected_value === null || (v.status === 'confirmed' && text(v.corrected_value, 1000))) ||
    !positive(v.version) || !validDate(v.created_at) || !validDate(v.updated_at) ||
    !(v.clarification_question === null || text(v.clarification_question, 1000))) invalid();
  return v as unknown as RealMemory;
}
export function decodeDraft(value: unknown, scope: Pick<RealScope, 'projectId' | 'language'>): RealDraft {
  const v = row(value, ['draft_id', 'project_id', 'status', 'language', 'style', 'version', 'revision', 'content',
    'original_content', 'mode', 'source_memories', 'verification', 'provenance', 'created_at', 'updated_at']);
  if (!uuid(v.draft_id) || !uuid(v.project_id) || v.project_id.toLowerCase() !== scope.projectId.toLowerCase() ||
    !['needs_review', 'edited'].includes(v.status as string) || v.language !== scope.language || v.style !== 'warm' ||
    !positive(v.version) || !positive(v.revision) || !text(v.content, 20_000) || !text(v.original_content, 20_000) ||
    v.mode !== 'real' || !validDate(v.created_at) || !validDate(v.updated_at) ||
    !Array.isArray(v.source_memories) || v.source_memories.length < 1 || v.source_memories.length > 200) invalid();
  const sources = (v.source_memories as unknown[]).map(item => {
    const s = row(item, ['memory_id', 'memory_version', 'source_message_id', 'fact_type', 'value', 'evidence', 'corrected_value', 'year', 'slot', 'sentence']);
    if (!uuid(s.memory_id) || !uuid(s.source_message_id) || !positive(s.memory_version) ||
      !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(s.fact_type as string) ||
      !text(s.value, 1000) || !text(s.evidence, 1000) || !(s.corrected_value === null || text(s.corrected_value, 1000)) ||
      !(s.year === null || positive(s.year, 2100)) || !(s.slot === null || text(s.slot, 80, true)) || !text(s.sentence, 2000, true)) invalid();
    return s as unknown as StorySourceMemory;
  });
  if (new Set(sources.map(s => s.memory_id)).size !== sources.length) invalid();
  const report = row(v.verification, ['status', 'unsupported_claims', 'method', 'checked_revision', 'checked_at', 'sources_current', 'reason']);
  if (!['needs_review', 'stale_sources'].includes(report.status as string) ||
    !['model_review_v1', 'manual_unverified'].includes(report.method as string) ||
    report.checked_revision !== v.revision || !validDate(report.checked_at) || typeof report.sources_current !== 'boolean' ||
    !(report.reason === null || text(report.reason, 1000, true)) || !Array.isArray(report.unsupported_claims) ||
    report.unsupported_claims.length > 20 || !report.unsupported_claims.every(item => text(item, 1000)) ||
    (v.status === 'edited' && (report.method !== 'manual_unverified' || (v.revision as number) < 2)) ||
    (v.revision === 1 && (v.status !== 'needs_review' || v.content !== v.original_content)) ||
    (report.status === 'stale_sources' && report.sources_current)) invalid();
  return { ...v, source_memories: sources, provenance: provenance(v.provenance) } as unknown as RealDraft;
}
function list<T>(value: unknown, decode: (value: unknown) => T, identity: (item: T) => string): T[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  const items = (value as unknown[]).map(decode);
  if (new Set(items.map(identity)).size !== items.length) invalid();
  return items;
}
const SAFE_CODES = new Set(['LIVE_AI_DISABLED', 'RATE_LIMITED', 'API_BUSY', 'OPERATION_IN_PROGRESS', 'OPERATION_UNCERTAIN',
  'IDEMPOTENCY_CONFLICT', 'CONVERSATION_CHANGED', 'STORY_CONTEXT_CHANGED', 'NO_CONFIRMED_MEMORIES', 'CLARIFICATION_REQUIRED',
  'SPEECH_EXPIRED', 'SUPABASE_UNAVAILABLE', 'REAL_AI_NOT_CONFIGURED', 'REAL_AI_UNCERTAIN', 'REAL_AI_IN_PROGRESS',
  'TEXT_CHAT_NOT_READY', 'AI_SPENDING_NOT_APPROVED']);
for (const code of ['AI_OPERATION_IN_PROGRESS', 'AI_OPERATION_UNCERTAIN', 'AI_OPERATION_FAILED', 'AI_RATE_LIMIT', 'AI_USAGE_LIMIT',
  'AI_BUSY', 'AUDIO_BUSY', 'REAL_AI_CONFLICT', 'AI_NOT_APPROVED', 'AI_CONTROLS_UNAVAILABLE', 'AI_INPUT_LIMIT']) SAFE_CODES.add(code);
const RECOVERY_CODES: Record<RealRecovery, readonly string[]> = {
  'contact-operator': ['AI_USAGE_LIMIT', 'AI_GLOBAL_BUDGET_EXHAUSTED', 'AI_USER_BUDGET_EXHAUSTED',
    'AI_SPENDING_NOT_APPROVED', 'AI_USAGE_UNAVAILABLE', 'LIVE_AI_DISABLED', 'AI_PROVIDER_QUOTA_EXHAUSTED',
    'AI_PROVIDER_AUTHENTICATION_FAILED', 'AI_PROVIDER_ACCESS_DENIED', 'REAL_AI_NOT_CONFIGURED', 'AI_PILOT_ACCESS_DENIED', 'AI_PILOT_CONFIG_UNAVAILABLE'],
  'sign-in': ['INVALID_ACCESS_TOKEN', 'MISSING_ACCESS_TOKEN', 'AI_USER_LIMIT_UNAVAILABLE'],
  wait: ['AI_RATE_LIMIT', 'RATE_LIMITED', 'AI_BUSY', 'AUDIO_BUSY', 'API_BUSY'],
  'check-saved': ['AI_PROVIDER_RATE_LIMIT', 'AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'REAL_AI_UNCERTAIN'],
};
for (const codes of Object.values(RECOVERY_CODES)) for (const code of codes) SAFE_CODES.add(code);
const RECOVERY_STATUSES: Record<string, number> = {
  AI_USAGE_LIMIT: 429, AI_GLOBAL_BUDGET_EXHAUSTED: 429, AI_USER_BUDGET_EXHAUSTED: 429,
  AI_SPENDING_NOT_APPROVED: 503, AI_USAGE_UNAVAILABLE: 503, LIVE_AI_DISABLED: 503,
  AI_PROVIDER_QUOTA_EXHAUSTED: 503, AI_PROVIDER_AUTHENTICATION_FAILED: 503,
  AI_PROVIDER_ACCESS_DENIED: 503, REAL_AI_NOT_CONFIGURED: 503,
  AI_PILOT_ACCESS_DENIED: 403,
  AI_PILOT_CONFIG_UNAVAILABLE: 503,
  INVALID_ACCESS_TOKEN: 401, MISSING_ACCESS_TOKEN: 401, AI_USER_LIMIT_UNAVAILABLE: 503,
  AI_RATE_LIMIT: 429, RATE_LIMITED: 429, AI_BUSY: 429, AUDIO_BUSY: 429, API_BUSY: 503,
  AI_PROVIDER_RATE_LIMIT: 503, AI_PROVIDER_TIMEOUT: 504, AI_PROVIDER_UNAVAILABLE: 503, REAL_AI_UNCERTAIN: 503,
};
// A provider error can follow a paid dispatch even when an intermediary omits
// its operation header. Only these validated pre-dispatch codes prove otherwise.
const NO_DISPATCH_CODES = new Set(['LIVE_AI_DISABLED', 'REAL_AI_NOT_CONFIGURED',
  'INVALID_ACCESS_TOKEN', 'MISSING_ACCESS_TOKEN', 'AI_USER_LIMIT_UNAVAILABLE', 'AI_PILOT_ACCESS_DENIED', 'AI_PILOT_CONFIG_UNAVAILABLE']);
// Attempt-level controls can fail after an earlier paid stage. Their HTTP status
// and missing operation header must never be treated as proof of an unsent turn.
const MAY_DISPATCH_CODES = new Set(['AI_USAGE_LIMIT', 'AI_GLOBAL_BUDGET_EXHAUSTED', 'AI_USER_BUDGET_EXHAUSTED',
  'AI_SPENDING_NOT_APPROVED', 'AI_USAGE_UNAVAILABLE', 'AI_RATE_LIMIT']);
function recoveryFor(code: string | undefined, header: string | null, status: number): RealRecovery | undefined {
  // Stable code semantics take precedence over contradictory advice. Unknown
  // codes/headers never become actionable text or authorize a paid retry.
  const known = (Object.keys(RECOVERY_CODES) as RealRecovery[]).find(kind => RECOVERY_CODES[kind].includes(code ?? ''));
  if (known) return RECOVERY_STATUSES[code!] === status ? known : undefined;
  return code && ['contact-operator', 'sign-in', 'check-saved'].includes(header ?? '') ? header as RealRecovery : undefined;
}
export type RealConversationProgress =
  | { type: 'operation'; operation_id: string; project_id: string; session_id: string }
  | { type: 'reply'; text: string }
  | { type: 'saving' };
interface ConversationStream {
  scope: RealScope;
  onProgress(event: RealConversationProgress): void;
}
/** Only a validated stream error may preserve backend recovery advice. */
class StreamTerminalFailure extends Error {
  constructor(readonly failure: RealAiError) { super('Conversation requires recovery.'); }
}
const MAX_CONVERSATION_STREAM_BYTES = 2_000_000, MAX_CONVERSATION_EVENT_BYTES = 1_000_000;

async function readConversationStream<T>(response: Response, stream: ConversationStream,
  decode: (value: unknown, operationId?: string) => T, operationId: string | undefined, check: () => void,
  register: (reader: ReadableStreamDefaultReader<Uint8Array>) => void, cancel: () => Promise<void>, release: () => void, interrupt: Promise<never>, settled: () => void,
  failure: (status: number, code: string | undefined, recovery: string | null, retry: string | null) => RealAiError): Promise<T> {
  if (!operationId || operationId !== operationId.toLowerCase() || !response.body?.getReader ||
    !response.headers.get('cache-control')?.toLowerCase().includes('no-store')) invalid();
  const reader = response.body!.getReader(); register(reader);
  const expectedOperationId = operationId!;
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let totalBytes = 0, frameBytes = 0, lineParts: string[] = [], lineBytes = 0, data: string | null = null, frames = 0;
  let haveOperation = false, preview: string | undefined, saving = false;
  let terminal: { result: T } | { error: RealAiError } | null = null;
  const notify = async (event: RealConversationProgress) => {
    check(); await Promise.race([Promise.resolve(stream.onProgress(event)), interrupt]); check();
  };
  const frame = async (raw: string) => {
    check();
    if (++frames > 16 || terminal) invalid();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const kind = (value as Record<string, unknown>).type;
    if (kind === 'operation') {
      const v = row(value, ['type', 'operation_id', 'project_id', 'session_id']);
      if (haveOperation || v.operation_id !== expectedOperationId) invalid();
      owned(v, stream.scope); haveOperation = true;
      await notify({ type: 'operation', operation_id: expectedOperationId, project_id: v.project_id as string, session_id: v.session_id as string });
      return;
    }
    if (!haveOperation) invalid();
    if (kind === 'reply') {
      const v = row(value, ['type', 'text']);
      if (preview !== undefined || saving || !text(v.text, 1000) || (v.text.match(/\?/g)?.length ?? 0) > 1) invalid();
      preview = v.text as string; await notify({ type: 'reply', text: preview }); return;
    }
    if (kind === 'saving') {
      row(value, ['type']); if (saving) invalid();
      saving = true; await notify({ type: 'saving' }); return;
    }
    if (kind === 'completed') {
      const v = row(value, ['type', 'result']), result = decode(v.result, operationId);
      const reply = (result as unknown as RealTurn).message?.text;
      if (!text(reply, 32_000) || (preview !== undefined && reply !== preview)) invalid();
      terminal = { result }; settled(); return;
    }
    if (kind === 'error') {
      const v = row(value, ['type', 'status', 'error', 'operation_id', 'recovery', 'retry_after']);
      const body = row(v.error, ['code', 'message']);
      if (v.operation_id !== operationId || !Number.isInteger(v.status) || (v.status as number) < 400 || (v.status as number) > 599 ||
        typeof body.code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(body.code) || !text(body.message, 1000) ||
        !(v.recovery === null || ['contact-operator', 'sign-in', 'wait', 'check-saved'].includes(v.recovery as string)) ||
        !(v.retry_after === null || (typeof v.retry_after === 'string' && v.retry_after.length <= 64))) invalid();
      terminal = { error: failure(v.status as number, SAFE_CODES.has(body.code as string) ? body.code as string : undefined,
        v.recovery as string | null, v.retry_after as string | null) }; settled(); return;
    }
    invalid();
  };
  const line = async () => {
    let value = lineParts.join(''); lineParts = []; lineBytes = 0;
    if (value.endsWith('\r')) value = value.slice(0, -1);
    if (value.includes('\r')) invalid();
    if (!value) {
      if (data === null) invalid();
      const value = data!; data = null; frameBytes = 0;
      await frame(value); return;
    }
    if (data !== null || !value.startsWith('data:')) invalid();
    data = value.slice(5); if (data.startsWith(' ')) data = data.slice(1);
    if (!data || encoder.encode(data).byteLength > MAX_CONVERSATION_EVENT_BYTES) invalid();
  };
  const accept = async (chunk: string) => {
    const pieces = chunk.split('\n');
    for (let index = 0; index < pieces.length; index++) {
      check(); const part = pieces[index];
      if (part) { lineParts.push(part); const bytes = encoder.encode(part).byteLength; lineBytes += bytes; frameBytes += bytes; }
      if (lineBytes > MAX_CONVERSATION_EVENT_BYTES + 6 || frameBytes > MAX_CONVERSATION_EVENT_BYTES + 10) invalid();
      if (index < pieces.length - 1) { frameBytes++; await line(); check(); if (terminal) return; }
    }
  };
  try {
    while (true) {
      check(); const next = await Promise.race([reader.read(), interrupt]); check();
      if (next.done) { await accept(decoder.decode()); check(); break; }
      if (!(next.value instanceof Uint8Array)) invalid();
      // Decode only through each raw newline. Once a verified terminal frame
      // arrives, later bytes in this same native chunk are outside the protocol.
      for (let offset = 0; offset < next.value.byteLength;) {
        const newline = next.value.indexOf(10, offset), end = newline < 0 ? next.value.byteLength : newline + 1;
        const bytes = next.value.subarray(offset, end); offset = end;
        totalBytes += bytes.byteLength; if (totalBytes > MAX_CONVERSATION_STREAM_BYTES) invalid();
        await accept(decoder.decode(bytes, { stream: true })); check(); if (terminal) break;
      }
      if (terminal) break;
    }
    if (!terminal) invalid();
    // TypeScript cannot see the terminal assignment inside the frame closure.
    const result = terminal as unknown as { result: T } | { error: RealAiError };
    if ('error' in result) throw new StreamTerminalFailure(result.error);
    return result.result;
  } finally {
    await cancel(); release();
  }
}

/** Separate v2 transport: fixed relative paths only, owner-fenced tokens, no redirect or automatic retry. */
async function execute<T>(options: ListStoryProjectsOptions, path: string, method: 'GET' | 'POST' | 'PATCH',
  decode: (value: unknown, operationId?: string) => T, body?: string | FormData, key?: string, binary?: 'pdf' | 'wav', stream?: ConversationStream): Promise<T> {
  const origin = normalizeMobileApiBaseUrl(options.baseUrl), lease = apiBackoff.capture();
  if (key !== undefined) validateStoryProjectId(key);
  const timeout = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000) throw new RealAiError('configuration');
  const controller = new AbortController(); let dispatched = false, done = false;
  let interruption: 'cancelled' | 'timeout' | null = null;
  let operationId: string | undefined, streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined, streamCancellation: Promise<void> | undefined;
  let readerReleased = false;
  const releaseStream = () => {
    if (!streamReader || readerReleased) return;
    readerReleased = true;
    try { streamReader.releaseLock(); } catch { /* Native cleanup is best effort after abort; the write stays uncertain. */ }
  };
  const cancelStream = () => {
    if (!streamReader) return Promise.resolve();
    if (!streamCancellation) {
      const reader = streamReader;
      // Publish the bounded cleanup promise before invoking native code. A
      // broken native cancellation promise must not hold recovery open forever.
      let resolveCleanup: () => void = () => {};
      streamCancellation = new Promise<void>(resolve => { resolveCleanup = resolve; });
      let finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(deadline); resolveCleanup(); } };
      const deadline = setTimeout(finish, 1000);
      controller.abort();
      try { void Promise.resolve(reader.cancel()).then(finish, finish); } catch { finish(); }
    }
    return streamCancellation;
  };
  let reject: (error: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, fail) => { reject = fail; });
  const stop = (kind: 'cancelled' | 'timeout') => { if (done || interruption) return; interruption = kind; controller.abort(); void cancelStream(); reject(new RealAiError(kind, undefined, dispatched && method !== 'GET', undefined, undefined, operationId)); };
  const check = () => { if (interruption || !lease.isCurrent()) throw new RealAiError(interruption ?? 'cancelled', undefined, dispatched && method !== 'GET', undefined, undefined, operationId); };
  const admission = () => { try { lease.assertReady(origin); } catch (error) {
    if (error instanceof BackoffWaitError) throw new RealAiError('unavailable', error.advice.code === 'RATE_LIMITED' ? 429 : 503, false, error.advice.code, error.advice);
    throw new RealAiError('cancelled');
  } };
  const abort = () => stop('cancelled'); options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => stop('timeout'), timeout);
  const responseError = (status: number, code: string | undefined, recoveryHeader: string | null, retryHeader: string | null) => {
      const recovery = recoveryFor(code, recoveryHeader, status);
      const admissionCode = code === 'API_BUSY' ? 'API_BUSY' : 'RATE_LIMITED';
      const retry = recovery === 'wait' ? parseRetryAdvice(status,
        admissionCode, retryHeader) : undefined;
      if (retry) lease.record(origin, retry);
      const kind = recovery === 'sign-in' || status === 401 ? 'authentication' : status === 403 ? 'forbidden' : status === 404 || status === 410 ? 'not-found'
        : status === 409 ? 'conflict' : status === 422 || status === 400 || status === 413 || status === 415 ? 'validation'
        : status === 408 || status === 504 ? 'timeout' : 'unavailable';
      const provenNotDispatched = !!code && RECOVERY_STATUSES[code] === status &&
        (NO_DISPATCH_CODES.has(code) || (recovery === 'wait' && !MAY_DISPATCH_CODES.has(code)));
      const inconsistentRecoveryStatus = !!code && Object.hasOwn(RECOVERY_STATUSES, code) && RECOVERY_STATUSES[code] !== status;
      return new RealAiError(kind, status, method !== 'GET' && (!!operationId || inconsistentRecoveryStatus ||
        MAY_DISPATCH_CODES.has(code ?? '') || recovery === 'check-saved' ||
        ['AI_OPERATION_IN_PROGRESS', 'AI_OPERATION_UNCERTAIN', 'AI_OPERATION_FAILED'].includes(code ?? '') ||
        (status >= 500 && !provenNotDispatched && !(status === 503 && code === 'TEXT_CHAT_NOT_READY'))), code, retry, operationId, recovery);
  };
  const operation = (async () => {
    check(); admission();
    const token = await options.getAccessToken().catch(() => null); check(); admission();
    if (!token || token.length > 16384 || !/^[A-Za-z0-9._~-]+$/.test(token) || /^sb_(publishable|secret)_/.test(token)) throw new RealAiError('authentication');
    const request = options.request ?? (body instanceof FormData || stream ? nativeFetch as typeof fetch : globalThis.fetch);
    dispatched = true;
    let response: Response;
    try { response = await request(`${origin}/api/v2/${path}`, { method, headers: {
      Authorization: `Bearer ${token}`, Accept: binary === 'pdf' ? 'application/pdf' : binary === 'wav' ? 'audio/wav' : stream ? 'text/event-stream' : 'application/json',
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
    }, ...(body !== undefined ? { body } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal }); }
    catch { check(); throw new RealAiError('network', undefined, method !== 'GET'); }
    check();
    const rawOperationId = response.headers.get('x-memy-operation-id');
    operationId = uuid(rawOperationId) ? rawOperationId : undefined;
    if (!response.ok) {
      let code: string | undefined;
      try { const error = await response.json(); const raw = error?.error?.code;
        if (SAFE_CODES.has(raw)) code = raw;
      } catch { /* Never expose an upstream body. */ }
      check();
      throw responseError(response.status, code, response.headers.get('x-memy-recovery'), response.headers.get('retry-after'));
    }
    let value: unknown, privateBytes: Uint8Array | undefined;
    try {
      const maximum = binary === 'wav' ? 10_000_000 : binary === 'pdf' ? 2_000_000 : 2_000_000;
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) invalid();
      if (stream && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream') {
        const result = await readConversationStream(response, stream, decode, operationId, check,
          reader => { streamReader = reader; }, cancelStream, releaseStream, interrupted, () => clearTimeout(timer), responseError);
        check(); return result;
      }
      if (binary) {
        const bytes = new Uint8Array(await response.arrayBuffer()); privateBytes = bytes; check();
        if (!bytes.length || bytes.length > maximum || response.headers.get('content-type')?.split(';')[0].trim() !== (binary === 'pdf' ? 'application/pdf' : 'audio/wav') ||
          !response.headers.get('cache-control')?.toLowerCase().includes('no-store')) invalid();
        value = { bytes, headers: response.headers };
      } else { const raw = await response.text(); check(); if (raw.length > maximum) invalid(); value = JSON.parse(raw); }
      const result = decode(value, operationId); check(); return result;
    } catch (error) { privateBytes?.fill(0); if (stream) controller.abort(); check(); if (error instanceof StreamTerminalFailure) throw error.failure;
      if (error instanceof RealAiError && method === 'GET') throw error;
      throw new RealAiError('invalid-response', undefined, method !== 'GET', undefined, undefined, operationId); }
  })();
  try { return await Promise.race([operation, interrupted]); }
  finally {
    done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    if (streamReader && interruption) { await cancelStream(); releaseStream(); await operation.catch(() => {}); }
  }
}
function scopePath(scope: RealScope, leaf: string) {
  validateStoryProjectId(scope.projectId); const id = validateStoryProjectId(scope.sessionId);
  if (!['en', 'sv'].includes(scope.language)) throw new RealAiError('validation');
  return `story-sessions/${id}/${leaf}`;
}
export const getRealCapabilities = (options: ListStoryProjectsOptions) => execute(options, 'capabilities', 'GET', decodeCapabilities);
function page(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new RealAiError('validation');
  return `limit=100&offset=${offset}`;
}
export function getRealTranscripts(scope: RealScope, offset = 0) {
  return execute(scope, scopePath(scope, `transcripts?${page(offset)}`), 'GET', value => list(value, v => decodeTranscript(v, scope), v => v.transcript_id));
}
export function transcribeRealRecording(scope: RealScope, recording: AudioRecording, consent: boolean, key: string) {
  if (!consent) throw new RealAiError('validation'); validateStoryProjectId(key);
  const body = createRecordingUpload(recording, scope.language, () => { throw new RealAiError('validation'); });
  return execute(scope, scopePath(scope, 'transcribe'), 'POST', value => decodeTranscript(value, scope), body, key);
}
export function getRealMessages(scope: RealScope, offset = 0) {
  return execute(scope, scopePath(scope, `messages?${page(offset)}`), 'GET', value => {
    const items = list(value, v => decodeMessage(v, scope), v => v.id);
    if (new Set(items.map(v => v.sequence)).size !== items.length) invalid(); return items.sort((a, b) => a.sequence - b.sequence);
  });
}
export function sendRealMessage(scope: RealScope, input: { source_transcript_id: string }, key: string, onProgress?: (event: RealConversationProgress) => void) {
  const sourceId = validateStoryProjectId(input.source_transcript_id), expectedScope = onProgress ? { ...scope } : scope;
  return execute(expectedScope, scopePath(expectedScope, 'messages'), 'POST', value => {
    const v = row(value, ['user_message', 'message', 'memories', 'mode']);
    if (v.mode !== 'real') invalid();
    const user = decodeMessage(v.user_message, expectedScope), assistant = decodeMessage(v.message, expectedScope);
    const memories = list(v.memories, item => decodeMemory(item, expectedScope), item => item.id);
    if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.sequence !== user.sequence + 1 ||
      assistant.id === user.id || assistant.source_transcript_id !== user.source_transcript_id ||
      memories.some(item => item.status !== 'pending' || item.source_message_id !== user.id) ||
      user.source_transcript_id !== sourceId) invalid();
    if (user.source_text_input_id !== null || assistant.source_text_input_id !== null) invalid();
    return { user_message: user, message: assistant, memories, mode: 'real' as const };
  }, JSON.stringify({ ...input, language: expectedScope.language }), key, undefined, onProgress ? { scope: expectedScope, onProgress } : undefined);
}
/** Native SHA-256 of exact UTF-8 wording; only its digest belongs in pending metadata. */
export async function hashRealText(original: string): Promise<string> {
  if (!text(original, 4000)) throw new RealAiError('validation');
  try {
    const result = await digestStringAsync(CryptoDigestAlgorithm.SHA256, original);
    if (!/^[0-9a-f]{64}$/.test(result)) throw new RealAiError('configuration');
    return result;
  } catch { throw new RealAiError('configuration'); }
}
export function decodeRealTextTurn(value: unknown, scope: RealScope, original?: string, operationId?: string): RealTurn {
  const v = row(value, ['user_message', 'message', 'memories', 'mode']);
  if (v.mode !== 'real') invalid();
  const user = decodeMessage(v.user_message, scope), assistant = decodeMessage(v.message, scope);
  const memories = list(v.memories, item => decodeMemory(item, scope), item => item.id);
  if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.id === user.id ||
    (original !== undefined && user.text !== original) ||
    !uuid(user.source_text_input_id) || user.source_transcript_id !== null ||
    (operationId !== undefined && user.source_text_input_id !== operationId) ||
    assistant.source_transcript_id !== null || assistant.source_text_input_id !== user.source_text_input_id ||
    assistant.sequence !== user.sequence + 1 || memories.length > 8 ||
    memories.some(item => item.status !== 'pending' || item.source_message_id !== user.id ||
      !user.text.includes(item.value) || !user.text.includes(item.evidence) ||
      (item.year !== null && !item.evidence.includes(String(item.year))))) invalid();
  return { user_message: user, message: assistant, memories, mode: 'real' };
}
export function sendRealTextMessage(scope: RealScope, original: string, key: string, onProgress?: (event: RealConversationProgress) => void) {
  if (!text(original, 4000)) throw new RealAiError('validation');
  validateStoryProjectId(key);
  const expectedScope = onProgress ? { ...scope } : scope;
  return execute(expectedScope, scopePath(expectedScope, 'text-messages'), 'POST',
    (value, operationId) => decodeRealTextTurn(value, expectedScope, original, operationId),
    JSON.stringify({ text: original, language: expectedScope.language }), key, undefined, onProgress ? { scope: expectedScope, onProgress } : undefined);
}
export function getRealMemories(scope: RealScope, offset = 0) {
  return execute(scope, scopePath(scope, `memories?${page(offset)}`), 'GET', value => list(value, v => decodeMemory(v, scope), v => v.id));
}
export function reviewRealMemory(scope: RealScope, memory: RealMemory, status: 'confirmed' | 'rejected', correction?: string) {
  if (memory.project_id !== scope.projectId || memory.session_id !== scope.sessionId || !['confirmed', 'rejected'].includes(status) ||
    (correction !== undefined && (!text(correction, 1000) || status !== 'confirmed'))) throw new RealAiError('validation');
  return execute(scope, `memories/${validateStoryProjectId(memory.id)}`, 'PATCH', value => {
    const result = decodeMemory(value, scope);
    if (result.id !== memory.id || result.version !== memory.version + 1 || result.status !== status ||
      result.source_message_id !== memory.source_message_id || result.evidence !== memory.evidence || result.value !== memory.value ||
      result.corrected_value !== (correction ?? null)) invalid(); return result;
  }, JSON.stringify({ expected_version: memory.version, status, ...(correction !== undefined ? { corrected_value: correction } : {}) }));
}
export function getRealDrafts(scope: RealScope, offset = 0) {
  return execute(scope, `story-projects/${validateStoryProjectId(scope.projectId)}/drafts?${page(offset)}`, 'GET',
    value => list(value, v => decodeDraft(v, scope), v => v.draft_id).sort((a, b) => b.version - a.version));
}
export function getRealDraft(scope: RealScope, draftId: string) {
  return execute(scope, `story-drafts/${validateStoryProjectId(draftId)}`, 'GET', value => {
    const draft = decodeDraft(value, scope); if (draft.draft_id !== draftId) invalid(); return draft;
  });
}
export function generateRealDraft(scope: RealScope, key: string) {
  return execute(scope, `story-projects/${validateStoryProjectId(scope.projectId)}/generate`, 'POST', value => decodeDraft(value, scope),
    JSON.stringify({ language: scope.language, style: 'warm', confirm_generation: true }), key);
}
export function editRealDraft(scope: RealScope, baseline: RealDraft, content: string) {
  if (!text(content, 20_000) || baseline.project_id !== scope.projectId || baseline.language !== scope.language) throw new RealAiError('validation');
  return execute(scope, `story-drafts/${validateStoryProjectId(baseline.draft_id)}`, 'PATCH', value => {
    const after = decodeDraft(value, scope);
    if (after.draft_id !== baseline.draft_id || after.revision !== baseline.revision + 1 || after.version !== baseline.version ||
      after.original_content !== baseline.original_content || after.content !== content || after.status !== 'edited' ||
      JSON.stringify(after.source_memories) !== JSON.stringify(baseline.source_memories)) invalid(); return after;
  }, JSON.stringify({ expected_revision: baseline.revision, content }));
}
export function getRealDraftHistory(scope: RealScope, draftId: string, offset = 0) {
  return execute(scope, `story-drafts/${validateStoryProjectId(draftId)}/history?${page(offset)}`, 'GET', value => list(value, item => {
    const v = row(item, ['id', 'draft_id', 'revision', 'previous_content', 'content', 'created_at']);
    if (!uuid(v.id) || v.draft_id !== draftId || !positive(v.revision) || !text(v.previous_content, 20_000) || !text(v.content, 20_000) || !validDate(v.created_at)) invalid();
    return v as unknown as StoryEdit;
  }, v => v.id));
}
export function exportRealDraft(scope: RealScope, draft: RealDraft) {
  return execute(scope, `story-drafts/${validateStoryProjectId(draft.draft_id)}/export`, 'POST', value => {
    const { bytes, headers } = value as { bytes: Uint8Array; headers: Headers };
    const start = String.fromCharCode(...bytes.subarray(0, 5)), end = String.fromCharCode(...bytes.subarray(-64)).trimEnd();
    if (start !== '%PDF-' || !end.endsWith('%%EOF') || headers.get('x-memy-draft-version') !== String(draft.version) ||
      headers.get('x-memy-draft-revision') !== String(draft.revision)) invalid(); return bytes;
  }, JSON.stringify({ expected_revision: draft.revision, include_title_page: true, include_page_numbers: true }), undefined, 'pdf');
}
export function getRealExports(scope: RealScope, offset = 0) {
  return execute(scope, `story-projects/${validateStoryProjectId(scope.projectId)}/exports?${page(offset)}`, 'GET', value => list(value, item => {
    const v = row(item, ['export_id', 'project_id', 'draft_id', 'draft_version', 'draft_revision', 'language', 'title', 'format',
      'include_title_page', 'include_page_numbers', 'renderer_version', 'filename', 'content_sha256', 'byte_size', 'page_count', 'created_at']);
    if (!uuid(v.export_id) || v.project_id !== scope.projectId || !uuid(v.draft_id) || !positive(v.draft_version) || !positive(v.draft_revision) ||
      v.language !== scope.language || !text(v.title, 200) || v.format !== 'pdf' || typeof v.include_title_page !== 'boolean' ||
      typeof v.include_page_numbers !== 'boolean' || v.renderer_version !== 'memy_real_pdf_v1' ||
      typeof v.filename !== 'string' || !/^memy-[a-z0-9-]+\.pdf$/.test(v.filename) ||
      !v.filename.endsWith(`-v${v.draft_version}-r${v.draft_revision}.pdf`) ||
      typeof v.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.content_sha256) || !positive(v.byte_size, 2_000_000) ||
      !positive(v.page_count, 100) || !validDate(v.created_at)) invalid();
    return v as unknown as RealExport;
  }, v => v.export_id));
}
export function downloadRealExport(scope: RealScope, metadata: RealExport) {
  if (metadata.project_id !== scope.projectId || metadata.language !== scope.language) throw new RealAiError('validation');
  return execute(scope, `story-exports/${validateStoryProjectId(metadata.export_id)}/download`, 'GET', value => {
    const { bytes, headers } = value as { bytes: Uint8Array; headers: Headers };
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-' || !String.fromCharCode(...bytes.subarray(-64)).trimEnd().endsWith('%%EOF') ||
      headers.get('x-memy-draft-version') !== String(metadata.draft_version) || headers.get('x-memy-draft-revision') !== String(metadata.draft_revision) ||
      headers.get('x-memy-export-id') !== metadata.export_id || headers.get('content-disposition') !== `attachment; filename="${metadata.filename}"`) invalid();
    return bytes;
  }, undefined, undefined, 'pdf');
}
export interface RealOperation {
  operation_id: string; kind: 'transcription' | 'conversation' | 'generation' | 'speech'; status: 'in_progress' | 'completed' | 'failed' | 'uncertain';
  project_id: string; session_id: string | null; created_at: string; updated_at: string;
  error_code: string | null; result: SpeechMetadata | null; typedTurn?: RealTurn;
}
function decodeOperation(value: unknown, scope: RealScope, id?: string, kind?: RealOperation['kind'], expectedTyped = false): RealOperation {
  const v = row(value, ['operation_id', 'kind', 'status', 'project_id', 'session_id', 'created_at', 'updated_at', 'error_code', 'result']);
  if (!uuid(v.operation_id) || (id && v.operation_id !== id) || v.project_id !== scope.projectId ||
    (v.kind === 'generation' ? v.session_id !== null : v.session_id !== scope.sessionId) ||
    !['transcription', 'conversation', 'generation', 'speech'].includes(v.kind as string) || (kind && v.kind !== kind) ||
    !['in_progress', 'completed', 'failed', 'uncertain'].includes(v.status as string) ||
    !validDate(v.created_at) || !validDate(v.updated_at) || !(v.error_code === null || text(v.error_code, 100)) ||
    !(v.result === null || (typeof v.result === 'object' && !Array.isArray(v.result)))) invalid();
  // Only the fixed speech metadata is reusable after a lost POST response. All
  // transcript/turn/draft contents are reloaded through their owned strict decoders.
  let typedTurn: RealTurn | undefined;
  if (expectedTyped) {
    if (v.kind !== 'conversation' ||
      (v.status === 'completed' ? v.error_code !== null || v.result === null :
        v.result !== null || (v.status === 'in_progress' ? v.error_code !== null :
          typeof v.error_code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(v.error_code)))) invalid();
    if (v.status === 'completed') typedTurn = decodeRealTextTurn(v.result, scope, undefined, v.operation_id as string);
  }
  const result = v.kind === 'speech' && v.status === 'completed' ? decodeSpeech(v.result, scope, undefined, false) : null;
  return { ...v, result, ...(typedTurn ? { typedTurn } : {}) } as unknown as RealOperation;
}
export function getRealOperation(scope: RealScope, id: string, expectedTyped = false) {
  return execute(scope, `operations/${validateStoryProjectId(id)}`, 'GET', value => decodeOperation(value, scope, id, undefined, expectedTyped));
}
export function findRealOperation(scope: RealScope, kind: RealOperation['kind'], actionKey: string, expectedTyped = false) {
  if (!['transcription', 'conversation', 'generation', 'speech'].includes(kind)) throw new RealAiError('validation');
  return execute(scope, `operations/by-key/${kind}/${validateStoryProjectId(actionKey)}`, 'GET', value => decodeOperation(value, scope, undefined, kind, expectedTyped));
}
function decodeSpeech(value: unknown, scope: RealScope, assistantId?: string, requireFresh = true): SpeechMetadata {
  const v = row(value, ['speech_id', 'assistant_message_id', 'language', 'media_type', 'audio_sha256', 'audio_size', 'expires_at', 'status']);
  if (!uuid(v.speech_id) || !uuid(v.assistant_message_id) || (assistantId && v.assistant_message_id !== assistantId) || v.language !== scope.language || v.media_type !== 'audio/wav' ||
      typeof v.audio_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.audio_sha256) || !positive(v.audio_size, 10_000_000) ||
      !validDate(v.expires_at) || (requireFresh && Date.parse(v.expires_at) <= Date.now()) || v.status !== 'ready') invalid();
  return v as unknown as SpeechMetadata;
}
/** Owned metadata lookup is free and does not claim a synthesis operation. */
export function getPreparedRealSpeech(scope: RealScope, assistantId: string) {
  return execute(scope, `conversation-messages/${validateStoryProjectId(assistantId)}/speech`, 'GET',
    value => decodeSpeech(value, scope, assistantId));
}
export function createRealSpeech(scope: RealScope, assistantId: string, key: string) {
  return execute(scope, `conversation-messages/${validateStoryProjectId(assistantId)}/speech`, 'POST',
    value => decodeSpeech(value, scope, assistantId), JSON.stringify({ language: scope.language }), key);
}
export async function getRealSpeechAudio(scope: RealScope, metadata: SpeechMetadata) {
  if (Date.parse(metadata.expires_at) <= Date.now()) throw new RealAiError('not-found', 410, false, 'SPEECH_EXPIRED');
  const bytes = await execute(scope, `spoken-replies/${validateStoryProjectId(metadata.speech_id)}/audio`, 'GET', value => {
    const { bytes } = value as { bytes: Uint8Array };
    if (bytes.length !== metadata.audio_size || bytes.length < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') invalid(); return bytes;
  }, undefined, undefined, 'wav');
  const digestInput = Uint8Array.from(bytes); let verified = false;
  try {
    const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, digestInput.buffer));
    if (scope.signal?.aborted) throw new RealAiError('cancelled');
    if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== metadata.audio_sha256) invalid();
    verified = true; return bytes;
  } catch (error) { if (error instanceof RealAiError) throw error; throw new RealAiError('invalid-response'); }
  finally { digestInput.fill(0); if (!verified) bytes.fill(0); }
}
