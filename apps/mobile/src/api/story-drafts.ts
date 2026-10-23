import { executeStoryDraftRequest, StoryProjectsError, validDate, validateStoryProjectId,
  type ListStoryProjectsOptions, type StoryProjectsErrorKind } from './story-projects';

export interface StorySourceMemory {
  memory_id: string; memory_version: number; source_message_id: string;
  fact_type: 'person' | 'relationship' | 'date' | 'location' | 'event' | 'emotion';
  value: string; evidence: string; corrected_value: string | null; year: number | null;
  slot: string | null; sentence: string;
}
export interface StoryVerification {
  status: 'passed' | 'needs_review' | 'stale_sources' | 'not_generated';
  unsupported_claims: string[]; method: 'deterministic_mock_v1' | 'manual_unverified' | 'none';
  checked_revision: number | null; checked_at: string | null; sources_current: boolean; reason: string | null;
}
export interface StoryDraft {
  draft_id: string; project_id: string; status: 'ready_for_review' | 'edited'; language: 'en' | 'sv';
  style: 'warm'; version: number; revision: number; content: string; original_content: string;
  mode: 'mock'; source_memories: StorySourceMemory[]; verification: StoryVerification;
  created_at: string; updated_at: string;
}
export interface StoryProjectVerification {
  project_id: string; draft_id: string | null; version: number | null; revision: number | null;
  verification: StoryVerification;
}
export interface StoryDraftOptions extends ListStoryProjectsOptions { projectId: string; expectedLanguage: 'en' | 'sv' }
export interface GetStoryDraftOptions extends StoryDraftOptions { draftId: string }
export interface StoryGenerationInput { language: 'en' | 'sv'; style: 'warm'; confirm_generation: true }
export interface GenerateStoryDraftOptions extends StoryDraftOptions { idempotencyKey: string; input: StoryGenerationInput }
export interface DraftEditInput { content: string; expected_revision: number }
export interface EditStoryDraftOptions extends StoryDraftOptions { baseline: StoryDraft; input: DraftEditInput }
export interface StoryEdit {
  id: string; draft_id: string; revision: number; previous_content: string; content: string; created_at: string;
}
export interface DraftHistoryOptions extends GetStoryDraftOptions { limit?: number; offset?: number }
export interface DraftHistoryPage { items: StoryEdit[]; hasMore: boolean }

const errorStatuses = {
  AUTHORIZATION_REQUIRED: 401, INVALID_ACCESS_TOKEN: 401, ACCESS_DENIED: 403,
  PROJECT_NOT_FOUND: 404, RESOURCE_NOT_FOUND: 404,
  NO_CONFIRMED_MEMORIES: 409, NO_SUPPORTED_MEMORIES: 409, CLARIFICATION_REQUIRED: 409,
  STORY_CONTEXT_CHANGED: 409, IDEMPOTENCY_CONFLICT: 409, CONTEXT_LIMIT: 409, STORY_CONTEXT_LIMIT: 409,
  VALIDATION_ERROR: 422, LANGUAGE_MISMATCH: 422, DRAFT_VERIFICATION_FAILED: 422,
  STORY_GENERATION_DISABLED: 503, STORY_WRITER_INVALID_RESPONSE: 503, SUPABASE_UNAVAILABLE: 503,
  SUPABASE_NOT_CONFIGURED: 503, STORY_CONTEXT_INVALID: 503, STORY_WRITER_TIMEOUT: 504,
} as const;
export type StoryDraftsErrorCode = keyof typeof errorStatuses;
export class StoryDraftsError extends StoryProjectsError {
  readonly code?: StoryDraftsErrorCode;
  constructor(kind: StoryProjectsErrorKind, status?: number, mayHaveWritten = false, code?: string) {
    super(kind, status, mayHaveWritten); this.name = 'StoryDraftsError';
    if (code && Object.hasOwn(errorStatuses, code) && errorStatuses[code as StoryDraftsErrorCode] === status) {
      this.code = code as StoryDraftsErrorCode;
    }
  }
}
function httpError(status: number, code: string | undefined, writing: boolean): StoryDraftsError {
  const kind: StoryProjectsErrorKind = status === 401 ? 'authentication' : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 408 || status === 504 ? 'timeout'
    : status === 400 || status === 422 ? 'validation' : status >= 400 ? 'unavailable' : 'invalid-response';
  return new StoryDraftsError(kind, status, writing && status >= 500, code);
}
function invalid(): never { throw new StoryDraftsError('invalid-response'); }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields.slice().sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 2_147_483_647;
}
function text(value: unknown, maximum: number, allowBlank = false): value is string {
  return typeof value === 'string' && value.length <= maximum * 2 && [...value].length <= maximum &&
    (allowBlank || !!value.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/gu, '')) && !/\0|\p{Cs}/u.test(value);
}
function selection(options: StoryDraftOptions) {
  const projectId = validateStoryProjectId(options.projectId);
  if (options.expectedLanguage !== 'en' && options.expectedLanguage !== 'sv') throw new StoryDraftsError('validation');
  return { projectId, language: options.expectedLanguage };
}
function source(value: unknown, language: 'en' | 'sv'): StorySourceMemory {
  const row = object(value, ['memory_id', 'memory_version', 'source_message_id', 'fact_type', 'value', 'evidence',
    'corrected_value', 'year', 'slot', 'sentence']);
  if (!uuid(row.memory_id) || !positive(row.memory_version) || !uuid(row.source_message_id) ||
    !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(row.fact_type as string) ||
    !text(row.value, 1000) || !text(row.evidence, 1000) ||
    !(row.corrected_value === null || text(row.corrected_value, 1000)) ||
    !(row.year === null || (positive(row.year) && row.year <= 2100)) ||
    !(row.slot === null || text(row.slot, 80, true)) || !text(row.sentence, 2000) ||
    /[\r\n]/.test(row.sentence) || !(language === 'en' ? /^(I |My )/ : /^(Jag |Min )/).test(row.sentence)) invalid();
  return { memory_id: row.memory_id.toLowerCase(), memory_version: row.memory_version,
    source_message_id: row.source_message_id.toLowerCase(), fact_type: row.fact_type as StorySourceMemory['fact_type'],
    value: row.value, evidence: row.evidence, corrected_value: row.corrected_value as string | null,
    year: row.year as number | null, slot: row.slot as string | null, sentence: row.sentence };
}
function verification(value: unknown): StoryVerification {
  const row = object(value, ['status', 'unsupported_claims', 'method', 'checked_revision', 'checked_at', 'sources_current', 'reason']);
  if (!['passed', 'needs_review', 'stale_sources', 'not_generated'].includes(row.status as string) ||
    !Array.isArray(row.unsupported_claims) || row.unsupported_claims.length > 20 ||
    !row.unsupported_claims.every(claim => text(claim, 1000)) ||
    !['deterministic_mock_v1', 'manual_unverified', 'none'].includes(row.method as string) ||
    !(row.checked_revision === null || positive(row.checked_revision)) ||
    !(row.checked_at === null || validDate(row.checked_at)) || typeof row.sources_current !== 'boolean' ||
    !(row.reason === null || text(row.reason, 1_048_576, true))) invalid();
  if (row.status === 'not_generated') {
    if (row.method !== 'none' || row.checked_revision !== null || row.checked_at !== null || row.sources_current ||
      row.unsupported_claims.length) invalid();
  } else {
    if (!positive(row.checked_revision) || !validDate(row.checked_at)) invalid();
    if (row.status === 'passed' && (row.method !== 'deterministic_mock_v1' || !row.sources_current || row.unsupported_claims.length)) invalid();
    if (row.status === 'stale_sources' && (row.method !== 'deterministic_mock_v1' || row.sources_current)) invalid();
    if (row.status === 'needs_review' && row.method !== 'manual_unverified') invalid();
  }
  return { status: row.status as StoryVerification['status'], unsupported_claims: row.unsupported_claims as string[],
    method: row.method as StoryVerification['method'], checked_revision: row.checked_revision as number | null,
    checked_at: row.checked_at as string | null, sources_current: row.sources_current, reason: row.reason as string | null };
}
function draft(value: unknown, selected: ReturnType<typeof selection>, draftId?: string): StoryDraft {
  const row = object(value, ['draft_id', 'project_id', 'status', 'language', 'style', 'version', 'revision', 'content',
    'original_content', 'mode', 'source_memories', 'verification', 'created_at', 'updated_at']);
  if (!uuid(row.draft_id) || (draftId && row.draft_id.toLowerCase() !== draftId) || !uuid(row.project_id) ||
    row.project_id.toLowerCase() !== selected.projectId || row.language !== selected.language || row.style !== 'warm' ||
    row.mode !== 'mock' || !['ready_for_review', 'edited'].includes(row.status as string) ||
    !positive(row.version) || !positive(row.revision) || !text(row.content, 20_000) || !text(row.original_content, 20_000) ||
    !Array.isArray(row.source_memories) || !row.source_memories.length || row.source_memories.length > 200 ||
    !validDate(row.created_at) || !validDate(row.updated_at)) invalid();
  const sources = row.source_memories.map(item => source(item, selected.language));
  if (new Set(sources.map(item => item.memory_id)).size !== sources.length ||
    row.original_content !== [...new Set(sources.map(item => item.sentence))].join('\n\n')) invalid();
  const report = verification(row.verification);
  if (report.status === 'not_generated' || report.checked_revision !== row.revision ||
    (row.status === 'edited' && (row.revision < 2 || report.status !== 'needs_review' || report.method !== 'manual_unverified')) ||
    (row.status === 'ready_for_review' && (row.revision !== 1 || row.content !== row.original_content ||
      report.status === 'needs_review'))) invalid();
  return { draft_id: row.draft_id.toLowerCase(), project_id: selected.projectId, status: row.status as StoryDraft['status'],
    language: selected.language, style: 'warm', version: row.version, revision: row.revision, content: row.content,
    original_content: row.original_content, mode: 'mock', source_memories: sources, verification: report,
    created_at: row.created_at, updated_at: row.updated_at };
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof StoryDraftsError) throw error;
    if (error instanceof StoryProjectsError) throw new StoryDraftsError(error.kind, error.status, error.mayHaveWritten);
    throw new StoryDraftsError('invalid-response');
  }
}

/** Latest saved generation only, never a generation request. */
export function listStoryDrafts(options: StoryDraftOptions): Promise<StoryDraft[]> {
  return safe(async () => {
    const selected = selection(options);
    return executeStoryDraftRequest(options, { action: 'list', projectId: selected.projectId,
      onHttpError: (status, code) => httpError(status, code, false) }, value => {
      if (!Array.isArray(value) || value.length > 1) invalid();
      return value.map(item => draft(item, selected));
    });
  });
}
export function getStoryDraft(options: GetStoryDraftOptions): Promise<StoryDraft> {
  return safe(async () => {
    const selected = selection(options), draftId = validateStoryProjectId(options.draftId);
    return executeStoryDraftRequest(options, { action: 'read', projectId: selected.projectId, draftId,
      onHttpError: (status, code) => httpError(status, code, false) }, value => draft(value, selected, draftId));
  });
}
export function getStoryVerification(options: StoryDraftOptions): Promise<StoryProjectVerification> {
  return safe(async () => {
    const selected = selection(options);
    return executeStoryDraftRequest(options, { action: 'verification', projectId: selected.projectId,
      onHttpError: (status, code) => httpError(status, code, false) }, value => {
      const row = object(value, ['project_id', 'draft_id', 'version', 'revision', 'verification']);
      if (!uuid(row.project_id) || row.project_id.toLowerCase() !== selected.projectId) invalid();
      const report = verification(row.verification);
      if (row.draft_id === null) {
        if (row.version !== null || row.revision !== null || report.status !== 'not_generated') invalid();
      } else if (!uuid(row.draft_id) || !positive(row.version) || !positive(row.revision) ||
        report.status === 'not_generated' || report.checked_revision !== row.revision) invalid();
      return { project_id: selected.projectId, draft_id: row.draft_id === null ? null : (row.draft_id as string).toLowerCase(),
        version: row.version as number | null, revision: row.revision as number | null, verification: report };
    });
  });
}
/** Explicit confirmed action only. Caller reconciles before any same-key retry. */
export function generateStoryDraft(options: GenerateStoryDraftOptions): Promise<StoryDraft> {
  return safe(async () => {
    const selected = selection(options), idempotencyKey = validateStoryProjectId(options.idempotencyKey);
    const input = options.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'confirm_generation,language,style' ||
      input.language !== selected.language || input.style !== 'warm' || input.confirm_generation !== true) {
      throw new StoryDraftsError('validation');
    }
    return executeStoryDraftRequest({ ...options, timeoutMs: options.timeoutMs ?? 30_000 }, {
      action: 'generate', projectId: selected.projectId, idempotencyKey,
      input: { language: selected.language, style: 'warm', confirm_generation: true },
      onHttpError: (status, code) => httpError(status, code, true),
    }, value => draft(value, selected));
  });
}

/** Normalize outer Python whitespace once; preserve all meaningful internal prose. */
export function validateDraftEditInput(value: unknown): DraftEditInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'content,expected_revision') throw new Error();
    const row = value as Record<string, unknown>;
    if (typeof row.content !== 'string' || !positive(row.expected_revision)) throw new Error();
    const content = row.content.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
    if (!text(content, 20_000) ||
      !/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{M}\u2800]/u.test(content)) throw new Error();
    return { content, expected_revision: row.expected_revision };
  } catch { throw new StoryDraftsError('validation'); }
}

/** Original generation identity and evidence never change when wording is edited. */
export function sameDraftOriginal(a: StoryDraft, b: StoryDraft): boolean {
  try {
    if (a.language !== 'en' && a.language !== 'sv') return false;
    const selected = { projectId: validateStoryProjectId(a.project_id), language: a.language };
    const first = draft(a, selected), second = draft(b, selected, first.draft_id);
    return first.version === second.version && first.language === second.language && first.style === second.style &&
      first.mode === second.mode && first.original_content === second.original_content &&
      first.created_at === second.created_at && JSON.stringify(first.source_memories) === JSON.stringify(second.source_memories);
  } catch { return false; }
}

/** Optimistic revision only: never generate a UUID or automatically retry a PATCH. */
export function editStoryDraft(options: EditStoryDraftOptions): Promise<StoryDraft> {
  return safe(async () => {
    const selected = selection(options), input = validateDraftEditInput(options.input);
    let before: StoryDraft;
    try { before = draft(options.baseline, selected); }
    catch { throw new StoryDraftsError('validation'); }
    if (input.expected_revision !== before.revision) throw new StoryDraftsError('validation');
    const unchanged = input.content === before.content;
    return executeStoryDraftRequest(options, { action: 'edit', projectId: selected.projectId,
      draftId: before.draft_id, input, onHttpError: (status, code) => httpError(status, code, true) }, value => {
      const after = draft(value, selected, before.draft_id);
      if (!sameDraftOriginal(before, after) || after.content !== input.content ||
        (unchanged ? after.revision !== before.revision : after.revision !== before.revision + 1) ||
        (!unchanged && (after.status !== 'edited' || after.verification.status !== 'needs_review' ||
          after.verification.method !== 'manual_unverified'))) invalid();
      return after;
    });
  });
}

/** Read one bounded actual-history page; a full page does not prove completion. */
export function listDraftHistory(options: DraftHistoryOptions): Promise<DraftHistoryPage> {
  return safe(async () => {
    const selected = selection(options), draftId = validateStoryProjectId(options.draftId);
    const limit = options.limit === undefined ? 50 : options.limit, offset = options.offset === undefined ? 0 : options.offset;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new StoryDraftsError('validation');
    return executeStoryDraftRequest(options, { action: 'history', projectId: selected.projectId,
      draftId, limit, offset, onHttpError: (status, code) => httpError(status, code, false) }, value => {
      if (!Array.isArray(value) || value.length > limit) invalid();
      const ids = new Set<string>(); let previousRevision = Number.POSITIVE_INFINITY;
      const items = value.map(item => {
        const row = object(item, ['id', 'draft_id', 'revision', 'previous_content', 'content', 'created_at']);
        if (!uuid(row.id) || !uuid(row.draft_id) || row.draft_id.toLowerCase() !== draftId ||
          !positive(row.revision) || row.revision < 2 || row.revision >= previousRevision ||
          ids.has(row.id.toLowerCase()) || !text(row.previous_content, 20_000) || !text(row.content, 20_000) ||
          row.previous_content === row.content || !validDate(row.created_at)) invalid();
        ids.add(row.id.toLowerCase()); previousRevision = row.revision;
        return { id: row.id.toLowerCase(), draft_id: draftId, revision: row.revision,
          previous_content: row.previous_content, content: row.content, created_at: row.created_at };
      });
      return { items, hasMore: items.length === limit };
    });
  });
}
