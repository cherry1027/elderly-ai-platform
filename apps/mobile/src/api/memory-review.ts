import { executeMemoryReviewRequest, StoryProjectsError, validDate, validateStoryProjectId,
  type ListStoryProjectsOptions, type StoryProjectsErrorKind } from './story-projects';

export interface MemoryFact {
  id: string; project_id: string; session_id: string; source_message_id: string;
  fact_type: 'person' | 'relationship' | 'date' | 'location' | 'event' | 'emotion';
  value: string; evidence: string; year: number | null; slot: string | null; uncertain: boolean;
  status: 'pending' | 'confirmed' | 'rejected'; corrected_value: string | null; version: number;
  created_at: string; updated_at: string;
}
export interface MemoryClarification {
  id: string; fact_id: string; session_id: string; conflicts_with_fact_id: string | null;
  question: string; status: 'open'; resolution: null; created_at: string; resolved_at: null;
}
export interface MemoryPatchInput {
  status: 'confirmed' | 'rejected'; expected_version: number; corrected_value?: string;
}
export interface MemoryReviewOptions extends ListStoryProjectsOptions {
  projectId: string; sessionId: string; expectedLanguage: 'en' | 'sv';
}
export interface PatchMemoryOptions extends MemoryReviewOptions { memory: MemoryFact; input: MemoryPatchInput }
export interface MemoryReview { memories: MemoryFact[]; clarifications: MemoryClarification[]; complete: boolean }

const errorStatuses = {
  AUTHORIZATION_REQUIRED: 401, INVALID_ACCESS_TOKEN: 401, ACCESS_DENIED: 403,
  SESSION_NOT_FOUND: 404, PROJECT_NOT_FOUND: 404, MEMORY_NOT_FOUND: 404, RESOURCE_NOT_FOUND: 404,
  CONVERSATION_CHANGED: 409, IDEMPOTENCY_CONFLICT: 409, VALIDATION_ERROR: 422,
  SUPABASE_UNAVAILABLE: 503, SUPABASE_NOT_CONFIGURED: 503,
} as const;
export type MemoryReviewErrorCode = keyof typeof errorStatuses;
export class MemoryReviewError extends StoryProjectsError {
  readonly code?: MemoryReviewErrorCode;
  constructor(kind: StoryProjectsErrorKind, status?: number, mayHaveWritten = false, code?: string) {
    super(kind, status, mayHaveWritten);
    this.name = 'MemoryReviewError';
    if (code && Object.hasOwn(errorStatuses, code) && errorStatuses[code as MemoryReviewErrorCode] === status) {
      this.code = code as MemoryReviewErrorCode;
    }
  }
}
function httpError(status: number, code: string | undefined, writing: boolean) {
  const kind: StoryProjectsErrorKind = status === 401 ? 'authentication' : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 408 || status === 504 ? 'timeout'
    : status === 400 || status === 422 ? 'validation' : status >= 400 ? 'unavailable' : 'invalid-response';
  return new MemoryReviewError(kind, status, writing && status >= 500, code);
}
function invalid(): never { throw new MemoryReviewError('invalid-response'); }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields.slice().sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function trim(value: string): string {
  return value.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/gu, '');
}
function text(value: unknown, maximum: number, allowBlank = false): value is string {
  return typeof value === 'string' && value.length <= maximum * 2 && [...value].length <= maximum &&
    (allowBlank || !!trim(value)) && !/\0|\p{Cs}/u.test(value);
}
function selection(options: Pick<MemoryReviewOptions, 'sessionId' | 'projectId' | 'expectedLanguage'>) {
  const projectId = validateStoryProjectId(options.projectId);
  const sessionId = validateStoryProjectId(options.sessionId);
  if (options.expectedLanguage !== 'en' && options.expectedLanguage !== 'sv') throw new MemoryReviewError('validation');
  return { projectId, sessionId };
}
function fact(value: unknown, projectId: string, sessionId: string): MemoryFact {
  const row = object(value, ['id', 'project_id', 'session_id', 'source_message_id', 'fact_type', 'value', 'evidence',
    'year', 'slot', 'uncertain', 'status', 'corrected_value', 'version', 'created_at', 'updated_at']);
  if (!uuid(row.id) || !uuid(row.project_id) || row.project_id.toLowerCase() !== projectId ||
    !uuid(row.session_id) || row.session_id.toLowerCase() !== sessionId || !uuid(row.source_message_id) ||
    !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(row.fact_type as string) ||
    !text(row.value, 1000) || !text(row.evidence, 1000) ||
    !(row.year === null || (Number.isSafeInteger(row.year) && (row.year as number) >= 1 && (row.year as number) <= 2100)) ||
    !(row.slot === null || text(row.slot, 80, true)) || typeof row.uncertain !== 'boolean' ||
    !['pending', 'confirmed', 'rejected'].includes(row.status as string) ||
    !(row.corrected_value === null || (row.status === 'confirmed' && text(row.corrected_value, 1000))) ||
    !Number.isSafeInteger(row.version) || (row.version as number) < 1 || (row.version as number) > 2_147_483_647 ||
    !validDate(row.created_at) || !validDate(row.updated_at)) invalid();
  return { id: row.id.toLowerCase(), project_id: projectId, session_id: sessionId,
    source_message_id: row.source_message_id.toLowerCase(), fact_type: row.fact_type as MemoryFact['fact_type'],
    value: row.value, evidence: row.evidence, year: row.year as number | null, slot: row.slot as string | null,
    uncertain: row.uncertain, status: row.status as MemoryFact['status'], corrected_value: row.corrected_value as string | null,
    version: row.version as number, created_at: row.created_at, updated_at: row.updated_at };
}
function clarification(value: unknown, sessionId: string): MemoryClarification {
  const row = object(value, ['id', 'fact_id', 'session_id', 'conflicts_with_fact_id', 'question',
    'status', 'resolution', 'created_at', 'resolved_at']);
  if (!uuid(row.id) || !uuid(row.fact_id) || !uuid(row.session_id) || row.session_id.toLowerCase() !== sessionId ||
    !(row.conflicts_with_fact_id === null || uuid(row.conflicts_with_fact_id)) || !text(row.question, 1000) ||
    row.status !== 'open' || row.resolution !== null || row.resolved_at !== null || !validDate(row.created_at)) invalid();
  return { id: row.id.toLowerCase(), fact_id: row.fact_id.toLowerCase(), session_id: sessionId,
    conflicts_with_fact_id: row.conflicts_with_fact_id === null ? null : row.conflicts_with_fact_id.toLowerCase(),
    question: row.question, status: 'open', resolution: null, created_at: row.created_at, resolved_at: null };
}
function time(value: string): [number, string] {
  const fraction = /T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?/.exec(value)?.[1] ?? '';
  return [Date.parse(value), fraction.padEnd(9, '0').slice(3)];
}
function compareTime(a: string, b: string): number {
  const first = time(a), second = time(b);
  return first[0] - second[0] || (first[1] < second[1] ? -1 : first[1] > second[1] ? 1 : 0);
}
async function list<T extends { id: string; created_at: string }>(options: MemoryReviewOptions,
  action: 'memories' | 'clarifications', decode: (value: unknown) => T): Promise<{ rows: T[]; complete: boolean }> {
  const { sessionId } = selection(options);
  const rows: T[] = [], ids = new Set<string>();
  let previous: T | undefined;
  for (let offset = 0; offset < 1000; offset += 100) {
    if (options.signal?.aborted) throw new MemoryReviewError('cancelled');
    const page = await executeMemoryReviewRequest(options, { method: 'GET', sessionId, action, limit: 100, offset,
      onHttpError: (status, code) => httpError(status, code, false) }, value => {
      if (!Array.isArray(value) || value.length > 100) invalid();
      return value.map(decode);
    });
    if (options.signal?.aborted) throw new MemoryReviewError('cancelled');
    for (const item of page) {
      const order = previous ? compareTime(item.created_at, previous.created_at) : 1;
      if (ids.has(item.id) || order < 0 || (previous && order === 0 && item.id <= previous.id)) invalid();
      rows.push(item); ids.add(item.id); previous = item;
    }
    if (page.length < 100) return { rows, complete: true };
  }
  return { rows, complete: false };
}

/** Current review state only; source provenance is checked against owned history by the controller. */
export async function listMemoryReview(options: MemoryReviewOptions): Promise<MemoryReview> {
  const selected = selection(options);
  const memories = await list(options, 'memories', value => fact(value, selected.projectId, selected.sessionId));
  const clarifications = await list(options, 'clarifications', value => clarification(value, selected.sessionId));
  const ids = new Set(memories.rows.map(row => row.id));
  if (memories.complete && clarifications.rows.some(row => !ids.has(row.fact_id))) invalid();
  return { memories: memories.rows, clarifications: clarifications.rows, complete: memories.complete && clarifications.complete };
}

/** Preserve original/evidence/year; normalize only the separately editable correction. */
export function validateMemoryPatchInput(value: unknown): MemoryPatchInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).sort().join(',');
    if (keys !== 'expected_version,status' && keys !== 'corrected_value,expected_version,status') throw new Error();
    if ((row.status !== 'confirmed' && row.status !== 'rejected') || !Number.isSafeInteger(row.expected_version) ||
      (row.expected_version as number) < 1 || (row.expected_version as number) > 2_147_483_647) throw new Error();
    const input: MemoryPatchInput = { status: row.status, expected_version: row.expected_version as number };
    if (Object.hasOwn(row, 'corrected_value')) {
      if (row.status !== 'confirmed' || typeof row.corrected_value !== 'string') throw new Error();
      const correction = trim(row.corrected_value);
      if (!text(correction, 1000) ||
        !/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{M}\u2800]/u.test(correction)) throw new Error();
      input.corrected_value = correction;
    }
    return input;
  } catch { throw new MemoryReviewError('validation'); }
}

/** No automatic retry. A lost PATCH response requires read-only reconciliation first. */
export async function patchMemory({ memory, input: rawInput, ...options }: PatchMemoryOptions): Promise<MemoryFact> {
  const selected = selection(options);
  const input = validateMemoryPatchInput(rawInput);
  let before: MemoryFact;
  try { before = fact(memory, selected.projectId, selected.sessionId); }
  catch { throw new MemoryReviewError('validation'); }
  if (input.expected_version !== before.version) throw new MemoryReviewError('validation');
  const correction = input.status === 'rejected' ? null : input.corrected_value ?? before.corrected_value;
  const unchanged = input.status === before.status && correction === before.corrected_value;
  return executeMemoryReviewRequest(options, { method: 'PATCH', memoryId: before.id, input,
    onHttpError: (status, code) => httpError(status, code, true) }, value => {
    const after = fact(value, selected.projectId, selected.sessionId);
    if (after.id !== before.id || after.source_message_id !== before.source_message_id ||
      after.fact_type !== before.fact_type || after.value !== before.value || after.evidence !== before.evidence ||
      after.year !== before.year || after.slot !== before.slot || after.uncertain !== before.uncertain ||
      compareTime(after.created_at, before.created_at) !== 0 ||
      after.status !== input.status || after.corrected_value !== correction ||
      (after.version !== before.version + 1 && !(unchanged && after.version === before.version))) invalid();
    return after;
  });
}
