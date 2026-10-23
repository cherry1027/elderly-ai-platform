
import type { RetryAdvice } from './backoff';
import { sameDraftOriginal, type StoryDraft, type StoryDraftOptions } from './story-drafts';
import { executeStoryExportRequest, StoryProjectsError, validDate, validateCreateStoryInput,
  validateStoryProjectId, type StoryPdfResponse, type StoryProjectsErrorKind } from './story-projects';

export interface StoryExport {
  export_id: string; project_id: string; draft_id: string; draft_version: number; draft_revision: number;
  language: 'en' | 'sv'; title: string; format: 'pdf'; include_title_page: boolean; include_page_numbers: boolean;
  renderer_version: 'memy_pdf_v1'; filename: string; content_sha256: string; byte_size: number; page_count: number;
  created_at: string;
}
export interface StoryPdf {
  exportId: string; draftVersion: number; draftRevision: number; pageCount: number; filename: string; bytes: Uint8Array;
}
export interface ExportStoryPdfOptions extends StoryDraftOptions { baseline: StoryDraft; title: string }
export interface DownloadStoryPdfOptions extends StoryDraftOptions { metadata: StoryExport }
export interface ListStoryExportsOptions extends StoryDraftOptions { limit?: number; offset?: number }
export interface StoryExportsPage { items: StoryExport[]; hasMore: boolean }

const errorStatuses = {
  RATE_LIMITED: 429, API_BUSY: 503,
  AUTHORIZATION_REQUIRED: 401, INVALID_ACCESS_TOKEN: 401, ACCESS_DENIED: 403,
  PROJECT_NOT_FOUND: 404, RESOURCE_NOT_FOUND: 404, EXPORT_SOURCE_CHANGED: 409,
  VALIDATION_ERROR: 422, PDF_INVALID_REQUEST: 422, PDF_EMPTY_DRAFT: 422, PDF_UNSUPPORTED_CHARACTER: 422,
  PDF_BUSY: 503, PDF_GENERATION_FAILED: 503, SUPABASE_UNAVAILABLE: 503, SUPABASE_NOT_CONFIGURED: 503,
  PDF_GENERATION_TIMEOUT: 504,
} as const;
export type StoryExportsErrorCode = keyof typeof errorStatuses;
export class StoryExportsError extends StoryProjectsError {
  readonly code?: StoryExportsErrorCode;
  constructor(kind: StoryProjectsErrorKind, status?: number, mayHaveWritten = false, code?: string, retry?: RetryAdvice) {
    super(kind, status, mayHaveWritten, retry); this.name = 'StoryExportsError';
    if (code && Object.hasOwn(errorStatuses, code) && errorStatuses[code as StoryExportsErrorCode] === status) {
      this.code = code as StoryExportsErrorCode;
    }
  }
}
function httpError(status: number, code: string | undefined, writing: boolean, retry?: RetryAdvice) {
  const kind: StoryProjectsErrorKind = status === 401 ? 'authentication' : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 408 || status === 504 ? 'timeout'
    : status === 400 || status === 422 ? 'validation' : status >= 400 ? 'unavailable' : 'invalid-response';
  return new StoryExportsError(kind, status, writing && status >= 500 && !retry, code, retry);
}
function invalid(): never { throw new StoryExportsError('invalid-response'); }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields.slice().sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function positive(value: unknown, max = 2_147_483_647): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;
}
function filename(value: unknown, version: number, revision: number): value is string {
  return typeof value === 'string' && value.length <= 100 && /^memy-[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/.test(value) &&
    value.endsWith('-v' + version + '-r' + revision + '.pdf');
}
function timestamp(value: string): bigint {
  // Preserve database microseconds: Date.parse alone truncates within a millisecond.
  const matched = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
  return BigInt(Date.parse(matched[1] + matched[3])) * 1_000_000n +
    BigInt((matched[2] ?? '').padEnd(9, '0'));
}
function selection(options: StoryDraftOptions) {
  const projectId = validateStoryProjectId(options.projectId);
  if (options.expectedLanguage !== 'en' && options.expectedLanguage !== 'sv') throw new StoryExportsError('validation');
  return { projectId, language: options.expectedLanguage };
}
function validTitle(value: unknown): value is string {
  try {
    return typeof value === 'string' && !/\0|\p{Cs}/u.test(value) &&
      validateCreateStoryInput({ title: value, language: 'en' }).title === value;
  } catch { return false; }
}
function metadata(value: unknown, selected: ReturnType<typeof selection>): StoryExport {
  const row = object(value, ['export_id', 'project_id', 'draft_id', 'draft_version', 'draft_revision', 'language',
    'title', 'format', 'include_title_page', 'include_page_numbers', 'renderer_version', 'filename', 'content_sha256',
    'byte_size', 'page_count', 'created_at']);
  if (!uuid(row.export_id) || !uuid(row.project_id) || row.project_id.toLowerCase() !== selected.projectId ||
    !uuid(row.draft_id) || row.language !== selected.language || !positive(row.draft_version) || !positive(row.draft_revision) ||
    !validTitle(row.title) || row.format !== 'pdf' || typeof row.include_title_page !== 'boolean' ||
    typeof row.include_page_numbers !== 'boolean' || row.renderer_version !== 'memy_pdf_v1' ||
    !filename(row.filename, row.draft_version, row.draft_revision) ||
    typeof row.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.content_sha256) ||
    !positive(row.byte_size, 2_000_000) || !positive(row.page_count, 100) || !validDate(row.created_at)) invalid();
  return { export_id: row.export_id.toLowerCase(), project_id: selected.projectId, draft_id: row.draft_id.toLowerCase(),
    draft_version: row.draft_version, draft_revision: row.draft_revision, language: selected.language, title: row.title,
    format: 'pdf', include_title_page: row.include_title_page, include_page_numbers: row.include_page_numbers,
    renderer_version: 'memy_pdf_v1', filename: row.filename, content_sha256: row.content_sha256, byte_size: row.byte_size,
    page_count: row.page_count, created_at: row.created_at };
}
function pdf(value: unknown, expected: { version: number; revision: number; exportId?: string; filename?: string }): StoryPdf {
  const row = object(value, ['bytes', 'headers']);
  if (!(row.bytes instanceof Uint8Array) || row.bytes.length < 20 || row.bytes.length > 2_000_000) invalid();
  const bytes = row.bytes, headers = row.headers as StoryPdfResponse['headers'];
  if (!headers || typeof headers !== 'object') invalid();
  const numberHeader = (name: string, max = 2_147_483_647) => {
    const value = headers[name];
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !positive(Number(value), max)) invalid();
    return Number(value);
  };
  const disposition = headers['content-disposition'];
  const matched = typeof disposition === 'string' ? /^attachment; filename="([^"]+)"$/.exec(disposition) : null;
  const version = numberHeader('x-memy-draft-version'), revision = numberHeader('x-memy-draft-revision');
  const pageCount = numberHeader('x-memy-page-count', 100), exportId = headers['x-memy-export-id'];
  if (version !== expected.version || revision !== expected.revision || !uuid(exportId) ||
    (expected.exportId && exportId.toLowerCase() !== expected.exportId) || !matched ||
    !filename(matched[1], version, revision) || (expected.filename && matched[1] !== expected.filename) ||
    headers['cache-control']?.toLowerCase().split(',').map(item => item.trim()).sort().join(',') !== 'no-store,private' ||
    headers.pragma?.toLowerCase() !== 'no-cache' || headers.expires !== '0' ||
    headers['x-content-type-options']?.toLowerCase() !== 'nosniff') invalid();
  const start = String.fromCharCode(...bytes.subarray(0, 5));
  const end = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 64))).replace(/[\t\n\v\f\r ]+$/g, '');
  if (start !== '%PDF-' || !end.endsWith('%%EOF')) invalid();
  return { exportId: exportId.toLowerCase(), draftVersion: version, draftRevision: revision, pageCount,
    filename: matched[1], bytes };
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof StoryExportsError) throw error;
    if (error instanceof StoryProjectsError) throw new StoryExportsError(error.kind, error.status, error.mayHaveWritten, undefined, error.retry);
    throw new StoryExportsError('invalid-response');
  }
}

/** Export only the captured persisted revision; callers reconcile the returned audit before sharing. */
export function exportStoryPdf(options: ExportStoryPdfOptions): Promise<StoryPdf> {
  return safe(async () => {
    const selected = selection(options), before = options.baseline;
    if (!sameDraftOriginal(before, before) || before.project_id.toLowerCase() !== selected.projectId ||
      before.language !== selected.language || !validTitle(options.title)) throw new StoryExportsError('validation');
    const draftId = validateStoryProjectId(before.draft_id), version = before.version, revision = before.revision;
    return executeStoryExportRequest({ ...options, timeoutMs: options.timeoutMs ?? 30_000 }, {
      action: 'create', projectId: selected.projectId, draftId,
      onHttpError: (status, code, retry) => httpError(status, code, true, retry),
    }, value => pdf(value, { version, revision }));
  });
}

/** Historical audit selects its own immutable title/revision, not the newest draft. */
export function downloadStoryPdf(options: DownloadStoryPdfOptions): Promise<StoryPdf> {
  return safe(async () => {
    const selected = selection(options);
    let audit: StoryExport;
    try { audit = metadata(options.metadata, selected); } catch { throw new StoryExportsError('validation'); }
    return executeStoryExportRequest({ ...options, timeoutMs: options.timeoutMs ?? 30_000 }, {
      action: 'download', projectId: selected.projectId, exportId: audit.export_id,
      onHttpError: (status, code, retry) => httpError(status, code, false, retry),
    }, value => pdf(value, { version: audit.draft_version, revision: audit.draft_revision,
      exportId: audit.export_id, filename: audit.filename }));
  });
}

/** Audit hash describes saved UTF-8 TEXT, not downloadable PDF bytes. */
export function listStoryExports(options: ListStoryExportsOptions): Promise<StoryExportsPage> {
  return safe(async () => {
    const selected = selection(options), limit = options.limit ?? 50, offset = options.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000 ||
      options.limit === null || options.offset === null) throw new StoryExportsError('validation');
    return executeStoryExportRequest(options, { action: 'list', projectId: selected.projectId, limit, offset,
      onHttpError: (status, code, retry) => httpError(status, code, false, retry) }, value => {
      if (!Array.isArray(value) || value.length > limit) invalid();
      const ids = new Set<string>(); let previous: StoryExport | null = null;
      const items = value.map(item => {
        const audit = metadata(item, selected);
        if (ids.has(audit.export_id) || (previous && (timestamp(audit.created_at) > timestamp(previous.created_at) ||
          (timestamp(audit.created_at) === timestamp(previous.created_at) && audit.export_id >= previous.export_id)))) invalid();
        ids.add(audit.export_id); previous = audit; return audit;
      });
      return { items, hasMore: items.length === limit };
    });
  });
}
