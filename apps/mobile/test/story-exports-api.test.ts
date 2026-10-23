
import { downloadStoryPdf, exportStoryPdf, listStoryExports, StoryExportsError,
  type DownloadStoryPdfOptions, type ExportStoryPdfOptions, type ListStoryExportsOptions,
  type StoryExport } from '../src/api/story-exports';
import type { StoryDraft } from '../src/api/story-drafts';

const baseUrl = 'http://192.168.20.40:8000', projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001', exportId = '30000000-0000-4000-8000-000000000001';
const memoryId = '40000000-0000-4000-8000-000000000001', sourceId = '50000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature', date = '2026-10-23T10:00:00.123456Z';
const title = 'Minnen från Malmö', filename = 'memy-minnen-fran-malmo-v1-r1.pdf';
const pdfText = '%PDF-1.7\nfictional synthetic document\n%%EOF\n';
const pdfBytes = Uint8Array.from([...pdfText].map(character => character.charCodeAt(0)));
function baseline(): StoryDraft {
  const sentence = 'Jag växte upp i Malmö.';
  return { draft_id: draftId, project_id: projectId, status: 'ready_for_review', language: 'sv', style: 'warm',
    version: 1, revision: 1, content: sentence, original_content: sentence, mode: 'mock',
    source_memories: [{ memory_id: memoryId, memory_version: 1, source_message_id: sourceId,
      fact_type: 'location', value: 'Malmö', evidence: sentence, corrected_value: null, year: null,
      slot: 'grew_up_location', sentence }], verification: { status: 'passed', unsupported_claims: [],
      method: 'deterministic_mock_v1', checked_revision: 1, checked_at: date, sources_current: true, reason: null },
    created_at: date, updated_at: date };
}
function audit(patch: Partial<StoryExport> = {}): StoryExport {
  return { export_id: exportId, project_id: projectId, draft_id: draftId, draft_version: 1, draft_revision: 1,
    language: 'sv', title, format: 'pdf', include_title_page: true, include_page_numbers: true,
    renderer_version: 'memy_pdf_v1', filename, content_sha256: 'a'.repeat(64), byte_size: pdfBytes.length,
    page_count: 2, created_at: date, ...patch };
}
function binary(patch: Partial<Record<string, string | null>> = {}, status = 201, text = pdfText) {
  const headers: Record<string, string> = { 'Content-Type': 'application/pdf', 'Content-Length': String(text.length),
    'Content-Disposition': 'attachment; filename="' + filename + '"', 'Cache-Control': 'private, no-store',
    Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff', 'X-Memy-Export-Id': exportId,
    'X-Memy-Draft-Version': '1', 'X-Memy-Draft-Revision': '1', 'X-Memy-Page-Count': '2' };
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete headers[key]; else if (value !== undefined) headers[key] = value; }
  return new Response(text, { status, headers });
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, init) =>
    init?.method === 'POST' ? binary() : String(_url).includes('/download') ? binary({}, 200) : json([audit()]));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, projectId, expectedLanguage: 'sv' as const, request, getAccessToken };
  return { request, getAccessToken,
    create: (extra: Partial<ExportStoryPdfOptions> = {}) => exportStoryPdf({ ...options, baseline: baseline(), title, ...extra }),
    download: (extra: Partial<DownloadStoryPdfOptions> = {}) => downloadStoryPdf({ ...options, metadata: audit(), ...extra }),
    list: (extra: Partial<ListStoryExportsOptions> = {}) => listStoryExports({ ...options, ...extra }) };
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
afterEach(() => jest.useRealTimers());

describe('private PDF shared transport', () => {
  it('POSTs only fixed approved options and returns validated actual binary', async () => {
    const f = fixture(), result = await f.create();
    expect(result).toEqual({ exportId, draftVersion: 1, draftRevision: 1, pageCount: 2, filename, bytes: pdfBytes });
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-drafts/' + draftId + '/export', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/pdf', 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', include_title_page: true, include_page_numbers: true }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(f.request).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('captures selected version/revision before delayed token retrieval', async () => {
    const f = fixture(), draft = baseline(); let allow!: (token: string | null) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
    const pending = f.create({ baseline: draft }); draft.revision = 9; draft.version = 8;
    allow(token); await expect(pending).resolves.toMatchObject({ draftVersion: 1, draftRevision: 1 });
  });
  it('GETs historical export privately without creating another audit or draft', async () => {
    const f = fixture(); await expect(f.download()).resolves.toMatchObject({ exportId, filename });
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-exports/' + exportId + '/download', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/pdf' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    }); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('does not falsely equate historical audit byte/page measurements with re-rendered bytes', async () => {
    const f = fixture();
    await expect(f.download({ metadata: audit({ byte_size: 99_999, page_count: 9 }) })).resolves.toMatchObject({ pageCount: 2 });
  });
  it('captures historical metadata before delayed authentication', async () => {
    const f = fixture(), metadata = audit(); let allow!: (token: string | null) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
    const pending = f.download({ metadata }); metadata.export_id = sourceId; metadata.filename = 'memy-other-v3-r2.pdf';
    allow(token); await expect(pending).resolves.toMatchObject({ exportId, filename });
  });
  it('accepts case-insensitive private cache tokens and harmless PDF trailing whitespace', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({ 'Cache-Control': 'no-store, PRIVATE' }, 201, pdfText + '\r\n \t'));
    await expect(f.create()).resolves.toMatchObject({ exportId });
  });
  it.each([
    { 'Content-Type': 'text/html' }, { 'Content-Type': 'application/json' }, { 'Content-Type': null },
    { 'Content-Length': null }, { 'Content-Length': '0' }, { 'Content-Length': '19' }, { 'Content-Length': '2000001' },
    { 'Content-Length': '-1' }, { 'Content-Length': '1e3' }, { 'Content-Length': '42.5' },
    { 'Content-Length': '00042' }, { 'Content-Length': '999' },
    { 'Content-Disposition': null }, { 'Content-Disposition': 'inline; filename="' + filename + '"' },
    { 'Content-Disposition': 'attachment; filename="../private.pdf"' },
    { 'Content-Disposition': 'attachment; filename="memy-person-v1-r2.pdf"' },
    { 'Content-Disposition': 'attachment; filename="memy-å-v1-r1.pdf"' },
    { 'Content-Disposition': 'attachment; filename="memy-person-v1-r1.pdf"; filename*=UTF-8\'\'other.pdf' },
    { 'Cache-Control': null }, { 'Cache-Control': 'public, no-store' }, { 'Cache-Control': 'private' },
    { 'Cache-Control': 'private, no-store, public' }, { Pragma: null }, { Pragma: 'cache' },
    { Expires: null }, { Expires: '100' }, { 'X-Content-Type-Options': null }, { 'X-Content-Type-Options': 'sniff' },
    { 'X-Memy-Export-Id': null }, { 'X-Memy-Export-Id': 'bad' }, { 'X-Memy-Draft-Version': '2' },
    { 'X-Memy-Draft-Version': '01' }, { 'X-Memy-Draft-Revision': '2' }, { 'X-Memy-Page-Count': '0' },
    { 'X-Memy-Page-Count': '101' }, { 'X-Memy-Page-Count': '1.5' },
  ])('rejects unsafe or revision-mismatched PDF headers %#', async patch => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary(patch));
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['Not-PDF-1.7\nfictional synthetic document\n%%EOF\n', '%PDF-1.7\nfictional synthetic document\nunfinished',
    '%PDF-1.7\nfictional synthetic document\n%%EOF private trailing bytes'])('rejects invalid PDF signatures %#', async text => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({}, 201, text));
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('rejects an actually oversized body even if the length header is small', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({ 'Content-Length': '42' }, 201,
      '%PDF-' + 'a'.repeat(2_000_000) + '%%EOF'));
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('rejects the wrong historical export identity', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({ 'X-Memy-Export-Id': sourceId }, 200));
    await expect(f.download()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it('rejects a wrong historical filename even when its version/revision suffix matches', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({ 'Content-Disposition': 'attachment; filename="memy-other-v1-r1.pdf"' }, 200));
    await expect(f.download()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it.each([200, 202, 204])('requires POST status 201 rather than claiming success from %s', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce(status === 204 ? new Response(null, { status }) : binary({}, status));
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('requires GET download status 200', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(binary({}, 201));
    await expect(f.download()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
});

describe('actual export audit schema and bounded history', () => {
  it('GETs only the owned project audit with default bounded pagination', async () => {
    const f = fixture(); await expect(f.list()).resolves.toEqual({ items: [audit()], hasMore: false });
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-projects/' + projectId + '/exports?limit=50&offset=0', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
  });
  it('preserves the TEXT checksum without interpreting it as PDF-byte integrity', async () => {
    const f = fixture(); const page = await f.list(); expect(page.items[0].content_sha256).toBe('a'.repeat(64));
    await expect(f.download({ metadata: page.items[0] })).resolves.toMatchObject({ exportId });
  });
  it('returns empty audit history without inventing an export', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(json([]));
    await expect(f.list()).resolves.toEqual({ items: [], hasMore: false });
  });
  it('supports strict descending creation time then UUID and marks full pages incomplete', async () => {
    const f = fixture(), newerId = 'f0000000-0000-4000-8000-000000000001';
    const rows = [audit({ export_id: newerId }), audit()];
    f.request.mockResolvedValueOnce(json(rows));
    await expect(f.list({ limit: 2, offset: 4 })).resolves.toEqual({ items: rows, hasMore: true });
    expect(f.request.mock.calls[0][0]).toContain('limit=2&offset=4');
  });
  it('preserves database microsecond order instead of collapsing to millisecond UUID order', async () => {
    const f = fixture(), rows = [audit({ created_at: '2026-10-23T10:00:00.123456Z' }),
      audit({ export_id: sourceId, created_at: '2026-10-23T10:00:00.123455Z' })];
    f.request.mockResolvedValueOnce(json(rows));
    await expect(f.list()).resolves.toEqual({ items: rows, hasMore: false });
  });
  it('supports older metadata options without silently rewriting them', async () => {
    const f = fixture(), saved = audit({ include_title_page: false, include_page_numbers: false });
    f.request.mockResolvedValueOnce(json([saved]));
    await expect(f.list()).resolves.toEqual({ items: [saved], hasMore: false });
  });
  it.each([
    { export_id: 'bad' }, { project_id: sourceId }, { draft_id: 'bad' }, { language: 'en' },
    { title: '' }, { title: 'x'.repeat(121) }, { title: '\u0085' }, { title: 'private\0title' },
    { format: 'html' }, { include_title_page: 1 }, { include_page_numbers: 'true' }, { renderer_version: 'other' },
    { filename: '../private.pdf' }, { filename: 'memy-other-v1-r2.pdf' }, { filename: 'memy-å-v1-r1.pdf' },
    { draft_version: 0 }, { draft_version: 1.2 }, { draft_revision: 0 }, { content_sha256: 'A'.repeat(64) },
    { content_sha256: 'b'.repeat(63) }, { byte_size: 0 }, { byte_size: 2_000_001 }, { page_count: 0 },
    { page_count: 101 }, { created_at: '2026-02-30T10:00:00Z' }, { private_field: token },
  ])('rejects malformed or foreign metadata without exposing private data %#', async patch => {
    const f = fixture(); f.request.mockResolvedValueOnce(json([{ ...audit(), ...patch }]));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it.each([
    [audit(), audit()],
    [audit({ created_at: '2026-10-22T09:00:00Z' }), audit({ export_id: sourceId })],
    [audit(), audit({ export_id: sourceId })],
  ].map(value => [value] as const))('rejects duplicate or misordered pages %#', async rows => {
    const f = fixture(); f.request.mockResolvedValueOnce(json(rows));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('rejects more rows than requested', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(json([audit(), audit({ export_id: sourceId })]));
    await expect(f.list({ limit: 1 })).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 100_001 },
    { limit: null }, { offset: null }, { projectId: '../other' }, { expectedLanguage: 'de' }])
  ('rejects malformed scopes and pagination before credentials %#', async extra => {
    const f = fixture(); await expect(f.list(extra as Partial<ListStoryExportsOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
});

describe('PDF authorization, safe errors and uncertain responses', () => {
  it.each(['create', 'download', 'list'] as const)('does not use an unconfigured backend on %s', async action => {
    const f = fixture(); await expect(f[action]({ baseUrl: '' })).rejects.toMatchObject({ kind: 'configuration', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([null, '', 'sb_publishable_not-a-user-token', 'sb_secret_private'])('rejects credential substitutes %j', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.create()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    { baseline: null }, { baseline: { ...baseline(), project_id: sourceId } }, { baseline: { ...baseline(), language: 'en' } },
    { baseline: { ...baseline(), revision: 2 } }, { title: '' }, { title: 'private\0title' }, { expectedLanguage: 'de' },
  ])('rejects malformed captured draft inputs before credentials %#', async extra => {
    const f = fixture(); await expect(f.create(extra as Partial<ExportStoryPdfOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('rejects foreign historical metadata before credentials', async () => {
    const f = fixture(); await expect(f.download({ metadata: audit({ project_id: sourceId }) })).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'RESOURCE_NOT_FOUND', 'not-found'], [409, 'EXPORT_SOURCE_CHANGED', 'conflict'],
    [422, 'PDF_UNSUPPORTED_CHARACTER', 'validation'], [503, 'PDF_BUSY', 'unavailable'],
    [503, 'PDF_GENERATION_FAILED', 'unavailable'], [503, 'SUPABASE_UNAVAILABLE', 'unavailable'],
    [504, 'PDF_GENERATION_TIMEOUT', 'timeout'],
  ] as const)('maps HTTP %s %s without logging upstream wording', async (status, code, kind) => {
    const f = fixture(); f.request.mockResolvedValueOnce(json({ error: { code, message: 'PRIVATE ' + token } }, status));
    const error = await f.create().catch(value => value);
    expect(error).toMatchObject({ kind, status, code, mayHaveWritten: status >= 500 });
    expect(String(error)).not.toContain(token); expect(JSON.stringify(error)).not.toContain(token);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('does not preserve unknown codes or incorrect code/status combinations', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(json({ error: { code: 'PRIVATE_' + token } }, 503));
    const error = await f.create().catch(value => value);
    expect(error).toBeInstanceOf(StoryExportsError); expect(error.code).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(token);
    f.request.mockResolvedValueOnce(json({ error: { code: 'PDF_BUSY' } }, 401));
    expect((await f.create().catch(value => value)).code).toBeUndefined();
  });
  it('sanitizes native exceptions and never automatically repeats an uncertain POST', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('PRIVATE ' + token));
    const error = await f.create().catch(value => value);
    expect(error).toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(String(error)).not.toContain(token); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('treats body-read failure after accepted export as uncertain', async () => {
    const f = fixture(), response = binary();
    jest.spyOn(response, 'arrayBuffer').mockRejectedValueOnce(new Error('PRIVATE path'));
    f.request.mockResolvedValueOnce(response);
    await expect(f.create()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('cancels before authentication without dispatching a PDF action', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.create({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('bounds token acquisition without dispatching a POST', async () => {
    jest.useFakeTimers(); const f = fixture(); f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.create({ timeoutMs: 50 }), rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: false });
    await flush(); jest.advanceTimersByTime(50); await rejected; expect(f.request).not.toHaveBeenCalled();
  });
  it('bounds binary body reading and marks a dispatched POST uncertain', async () => {
    jest.useFakeTimers(); const f = fixture(), response = binary();
    jest.spyOn(response, 'arrayBuffer').mockImplementationOnce(() => new Promise(() => {}));
    f.request.mockResolvedValueOnce(response);
    const pending = f.create({ timeoutMs: 50 }), rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
    await flush(); jest.advanceTimersByTime(50); await rejected; expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('ignores a late response after cancellation and never retries it', async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.create({ signal: controller.signal }), rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await rejected; finish(binary()); await flush(); expect(f.request).toHaveBeenCalledTimes(1);
  });
});
