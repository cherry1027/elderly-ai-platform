import { SIMULATED_TRANSCRIPT_NOTICE, type AudioTranscript } from './audio-transcripts';
import type { RetryAdvice } from './backoff';
import {
  executeSessionConversationRequest, StoryProjectsError, validDate, validateStoryProjectId,
  type ListStoryProjectsOptions, type StoryProjectsErrorKind,
} from './story-projects';

export interface ConversationMessage {
  id: string;
  session_id: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  language: 'en' | 'sv';
  created_at: string;
}
export interface ConversationMemory {
  id: string;
  project_id: string;
  session_id: string;
  source_message_id: string;
  fact_type: 'person' | 'relationship' | 'date' | 'location' | 'event' | 'emotion';
  value: string;
  evidence: string;
  year: number | null;
  slot: string | null;
  uncertain: boolean;
  status: 'pending';
  corrected_value: null;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface ConversationClarification {
  id: string;
  fact_id: string;
  session_id: string;
  conflicts_with_fact_id: string | null;
  question: string;
  status: 'open';
  resolution: null;
  created_at: string;
  resolved_at: null;
}
export interface ConversationTurn {
  user_message: ConversationMessage;
  message: ConversationMessage;
  memories: ConversationMemory[];
  clarifications: ConversationClarification[];
  requires_clarification: boolean;
  mode: 'mock';
}
export interface ConversationHistory { messages: ConversationMessage[]; complete: boolean }
export interface ConversationMessagesOptions extends ListStoryProjectsOptions {
  sessionId: string;
  expectedLanguage: 'en' | 'sv';
}
export interface ProcessTranscriptOptions extends ConversationMessagesOptions {
  projectId: string;
  sourceTranscript: AudioTranscript;
  idempotencyKey: string;
}
const errorStatuses = {
  RATE_LIMITED: 429, API_BUSY: 503,
  AUTHORIZATION_REQUIRED: 401, INVALID_ACCESS_TOKEN: 401, ACCESS_DENIED: 403,
  SESSION_NOT_FOUND: 404, PROJECT_NOT_FOUND: 404, SOURCE_NOT_FOUND: 404, RESOURCE_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409, CONVERSATION_CHANGED: 409, SESSION_COMPLETED: 409, CONTEXT_LIMIT: 409,
  LANGUAGE_MISMATCH: 422, VALIDATION_ERROR: 422, CONVERSATION_DISABLED: 503,
  CONVERSATION_INVALID_RESPONSE: 503, SUPABASE_UNAVAILABLE: 503, SUPABASE_NOT_CONFIGURED: 503,
  CONVERSATION_TIMEOUT: 504,
} as const;
export type ConversationMessagesErrorCode = keyof typeof errorStatuses;
export class ConversationMessagesError extends StoryProjectsError {
  readonly code?: ConversationMessagesErrorCode;
  constructor(kind: StoryProjectsErrorKind, status?: number, mayHaveWritten = false, code?: string, retry?: RetryAdvice) {
    super(kind, status, mayHaveWritten, retry);
    this.name = 'ConversationMessagesError';
    if (code && Object.hasOwn(errorStatuses, code) && errorStatuses[code as ConversationMessagesErrorCode] === status) {
      this.code = code as ConversationMessagesErrorCode;
    }
  }
}
function httpError(status: number, code: string | undefined, writing: boolean, retry?: RetryAdvice): ConversationMessagesError {
  const kind: StoryProjectsErrorKind = status === 401 ? 'authentication' : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 504 || status === 408 ? 'timeout'
    : status === 400 || status === 422 ? 'validation' : status >= 400 ? 'unavailable' : 'invalid-response';
  const safeCode = code && Object.hasOwn(errorStatuses, code) &&
    errorStatuses[code as ConversationMessagesErrorCode] === status ? code : undefined;
  return new ConversationMessagesError(kind, status,
    writing && status >= 500 && safeCode !== 'CONVERSATION_DISABLED' && !retry, safeCode, retry);
}
function invalid(): never { throw new ConversationMessagesError('invalid-response'); }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields.slice().sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function text(value: unknown, maximum: number, blank = false): value is string {
  return typeof value === 'string' && value.length <= maximum * 2 && [...value].length <= maximum &&
    (blank || !!value.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/gu, '')) &&
    !/\0|\p{Cs}/u.test(value);
}
function selection(sessionId: unknown, expectedLanguage: unknown): { id: string; language: 'en' | 'sv' } {
  const id = validateStoryProjectId(sessionId);
  if (expectedLanguage !== 'en' && expectedLanguage !== 'sv') throw new ConversationMessagesError('validation');
  return { id, language: expectedLanguage };
}
function message(value: unknown, sessionId: string, language: 'en' | 'sv'): ConversationMessage {
  const row = object(value, ['id', 'session_id', 'sequence', 'role', 'text', 'language', 'created_at']);
  if (!uuid(row.id) || !uuid(row.session_id) || row.session_id.toLowerCase() !== sessionId ||
    !Number.isSafeInteger(row.sequence) || (row.sequence as number) < 1 ||
    (row.role !== 'user' && row.role !== 'assistant') || row.language !== language ||
    !text(row.text, 32_000) || !validDate(row.created_at)) invalid();
  return { id: row.id.toLowerCase(), session_id: sessionId, sequence: row.sequence as number,
    role: row.role, text: row.text, language, created_at: row.created_at };
}
function memory(value: unknown, projectId: string, source: ConversationMessage): ConversationMemory {
  const row = object(value, ['id', 'project_id', 'session_id', 'source_message_id', 'fact_type', 'value', 'evidence',
    'year', 'slot', 'uncertain', 'status', 'corrected_value', 'version', 'created_at', 'updated_at']);
  if (!uuid(row.id) || !uuid(row.project_id) || row.project_id.toLowerCase() !== projectId ||
    !uuid(row.session_id) || row.session_id.toLowerCase() !== source.session_id ||
    !uuid(row.source_message_id) || row.source_message_id.toLowerCase() !== source.id ||
    !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(row.fact_type as string) ||
    !text(row.value, 1000) || !text(row.evidence, 1000) ||
    !source.text.includes(row.value) || !source.text.includes(row.evidence) ||
    !(row.year === null || (Number.isSafeInteger(row.year) && (row.year as number) >= 1 && (row.year as number) <= 2100)) ||
    !(row.slot === null || text(row.slot, 80, true)) || typeof row.uncertain !== 'boolean' ||
    row.status !== 'pending' || row.corrected_value !== null ||
    !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
    !validDate(row.created_at) || !validDate(row.updated_at)) invalid();
  return { id: row.id.toLowerCase(), project_id: projectId, session_id: source.session_id, source_message_id: source.id,
    fact_type: row.fact_type as ConversationMemory['fact_type'], value: row.value, evidence: row.evidence,
    year: row.year as number | null, slot: row.slot as string | null, uncertain: row.uncertain,
    status: 'pending', corrected_value: null, version: row.version as number,
    created_at: row.created_at, updated_at: row.updated_at };
}
function clarification(value: unknown, sessionId: string, facts: Set<string>): ConversationClarification {
  const row = object(value, ['id', 'fact_id', 'session_id', 'conflicts_with_fact_id', 'question',
    'status', 'resolution', 'created_at', 'resolved_at']);
  if (!uuid(row.id) || !uuid(row.fact_id) || !facts.has(row.fact_id.toLowerCase()) ||
    !uuid(row.session_id) || row.session_id.toLowerCase() !== sessionId ||
    !(row.conflicts_with_fact_id === null || uuid(row.conflicts_with_fact_id)) ||
    !text(row.question, 1000) || row.status !== 'open' || row.resolution !== null || row.resolved_at !== null ||
    !validDate(row.created_at)) invalid();
  return { id: row.id.toLowerCase(), fact_id: row.fact_id.toLowerCase(), session_id: sessionId,
    conflicts_with_fact_id: row.conflicts_with_fact_id === null ? null : row.conflicts_with_fact_id.toLowerCase(),
    question: row.question, status: 'open', resolution: null, created_at: row.created_at, resolved_at: null };
}
function sourceTranscript(value: AudioTranscript, sessionId: string, language: 'en' | 'sv'): AudioTranscript {
  try {
    const row = object(value, ['transcript_id', 'session_id', 'language', 'text', 'status', 'created_at']);
    if (!uuid(row.transcript_id) || !uuid(row.session_id) || row.session_id.toLowerCase() !== sessionId ||
      row.language !== language || row.status !== 'completed' || !validDate(row.created_at) ||
      !text(row.text, 32_000) || !row.text.startsWith(SIMULATED_TRANSCRIPT_NOTICE) ||
      row.text.length <= SIMULATED_TRANSCRIPT_NOTICE.length) throw new Error();
    return { transcript_id: row.transcript_id.toLowerCase(), session_id: sessionId, language,
      text: row.text, status: 'completed', created_at: row.created_at };
  } catch { throw new ConversationMessagesError('validation'); }
}

/** Explicit same-key retry only; never resend an audio original as typed text. */
export async function processTranscript({ sessionId, expectedLanguage, projectId, sourceTranscript: source,
  idempotencyKey, ...options }: ProcessTranscriptOptions): Promise<ConversationTurn> {
  const selected = selection(sessionId, expectedLanguage);
  const project = validateStoryProjectId(projectId);
  const original = sourceTranscript(source, selected.id, selected.language);
  if (!uuid(idempotencyKey)) throw new ConversationMessagesError('validation');
  return executeSessionConversationRequest({ ...options, timeoutMs: options.timeoutMs ?? 30_000 }, {
    sessionId: selected.id, method: 'POST', idempotencyKey,
    input: { source_message_id: original.transcript_id, language: selected.language },
    onHttpError: (status, code, retry) => httpError(status, code, true, retry),
  }, value => {
    const row = object(value, ['user_message', 'message', 'memories', 'clarifications', 'requires_clarification', 'mode']);
    const user = message(row.user_message, selected.id, selected.language);
    const assistant = message(row.message, selected.id, selected.language);
    if (row.mode !== 'mock' || user.role !== 'user' || assistant.role !== 'assistant' ||
      user.id !== original.transcript_id || user.text !== original.text || user.id === assistant.id ||
      user.sequence >= assistant.sequence || !Array.isArray(row.memories) || row.memories.length > 8 ||
      !Array.isArray(row.clarifications) || row.clarifications.length > 8 ||
      typeof row.requires_clarification !== 'boolean') invalid();
    const memories = row.memories.map(value => memory(value, project, user));
    const facts = new Set(memories.map(fact => fact.id));
    const clarifications = row.clarifications.map(value => clarification(value, selected.id, facts));
    if (facts.size !== memories.length || new Set(clarifications.map(question => question.id)).size !== clarifications.length ||
      row.requires_clarification !== (clarifications.length > 0)) invalid();
    return { user_message: user, message: assistant, memories, clarifications,
      requires_clarification: row.requires_clarification, mode: 'mock' };
  });
}

/** Bounded ordered history. Neither adjacency nor absence proves a source's processing status. */
export async function listConversationMessages({ sessionId, expectedLanguage,
  ...options }: ConversationMessagesOptions): Promise<ConversationHistory> {
  const selected = selection(sessionId, expectedLanguage);
  const messages: ConversationMessage[] = [];
  const ids = new Set<string>();
  let lastSequence = 0;
  for (let offset = 0; offset < 1000; offset += 100) {
    if (options.signal?.aborted) throw new ConversationMessagesError('cancelled');
    const page = await executeSessionConversationRequest(options, { sessionId: selected.id, method: 'GET',
      limit: 100, offset, onHttpError: (status, code, retry) => httpError(status, code, false, retry),
    }, value => {
      if (!Array.isArray(value) || value.length > 100) invalid();
      return value.map(item => message(item, selected.id, selected.language));
    });
    if (options.signal?.aborted) throw new ConversationMessagesError('cancelled');
    for (const item of page) {
      if (ids.has(item.id) || item.sequence <= lastSequence) invalid();
      ids.add(item.id); lastSequence = item.sequence; messages.push(item);
    }
    if (page.length < 100) return { messages, complete: true };
  }
  // A full bounded result is deliberately incomplete, including exactly 1,000 rows.
  return { messages, complete: false };
}
