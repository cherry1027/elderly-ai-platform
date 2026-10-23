import { listStoryDrafts, listStoryDraftsPage, type StoryDraft, type StoryDraftPageOptions } from '../src/api/story-drafts';
import { executeStoryDraftRequest, StoryProjectsError, type StoryDraftRequest } from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000', projectId = '10000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000001', memoryId = '30000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature', date = '2026-10-23T10:00:00.123456Z';
const id = (version: number) => `40000000-0000-4000-8000-${String(version).padStart(12, '0')}`;
function draft(version: number, overrides: Partial<StoryDraft> = {}): StoryDraft {
  return { draft_id: id(version), project_id: projectId, status: 'ready_for_review', language: 'en',
    style: 'warm', version, revision: 1, content: 'I grew up in Malmö.', original_content: 'I grew up in Malmö.',
    mode: 'mock', source_memories: [{ memory_id: memoryId, memory_version: 2, source_message_id: sourceId,
      fact_type: 'location', value: 'Malmö', evidence: 'I grew up in Malmö.', corrected_value: null,
      year: null, slot: 'grew_up_location', sentence: 'I grew up in Malmö.' }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
      checked_revision: 1, checked_at: date, sources_current: true, reason: null },
    created_at: date, updated_at: date, ...overrides };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function fixture(value: unknown = [draft(3), draft(2)]) {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response(value));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options: StoryDraftPageOptions = { baseUrl, projectId, expectedLanguage: 'en', getAccessToken, request };
  return { request, getAccessToken, options,
    page: (extra: Partial<StoryDraftPageOptions> = {}) => listStoryDraftsPage({ ...options, ...extra }) };
}
afterEach(() => jest.useRealTimers());

describe('bounded authenticated generation pagination through the existing transport', () => {
  it('defaults to twenty real saved generations with an authenticated GET only', async () => {
    const f = fixture();
    await expect(f.page()).resolves.toEqual({ items: [draft(3), draft(2)], hasMore: false });
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects/${projectId}/drafts?limit=20&offset=0`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves the existing latest-only client and exact query', async () => {
    const f = fixture([draft(7)]);
    await expect(listStoryDrafts(f.options)).resolves.toEqual([draft(7)]);
    expect(String(f.request.mock.calls[0][0])).toBe(`${baseUrl}/api/v1/story-projects/${projectId}/drafts?limit=1&offset=0`);
  });
  it('does not duplicate the API prefix and transmits explicit page bounds', async () => {
    const f = fixture(); await f.page({ baseUrl: `${baseUrl}/api/v1/`, limit: 2, offset: 40 });
    expect(String(f.request.mock.calls[0][0])).toBe(`${baseUrl}/api/v1/story-projects/${projectId}/drafts?limit=2&offset=40`);
  });
  it.each([{ limit: 1, offset: 0 }, { limit: 100, offset: 100_000 }])('accepts supported boundary %j', async page => {
    const f = fixture([]); await expect(f.page(page)).resolves.toEqual({ items: [], hasMore: false });
  });
  it('treats a full page as potentially incomplete, without inventing a total or fetching another page', async () => {
    const f = fixture(); await expect(f.page({ limit: 2 })).resolves.toEqual({ items: [draft(3), draft(2)], hasMore: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('accepts a terminal empty page with no fabricated records', async () => {
    const f = fixture([]); await expect(f.page({ offset: 40 })).resolves.toEqual({ items: [], hasMore: false });
  });
  it.each([
    { limit: 0 }, { limit: 101 }, { limit: -1 }, { limit: 1.5 }, { limit: Number.NaN }, { limit: Number.POSITIVE_INFINITY },
    { limit: null }, { limit: '20' }, { offset: -1 }, { offset: 100_001 }, { offset: 0.5 }, { offset: Number.NaN },
    { offset: Number.POSITIVE_INFINITY }, { offset: null }, { offset: '0' },
  ])('rejects unsafe query bounds before token lookup or dispatch %#', async value => {
    const f = fixture(); await expect(f.page(value as Partial<StoryDraftPageOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([{ limit: 20 }, { offset: 0 }, { limit: 101, offset: 0 }, { limit: 20, offset: '0&unsafe=1' }])(
    'the shared transport independently rejects incomplete or unsafe list pagination %#', async query => {
      const f = fixture(); const endpoint = { action: 'list', projectId, ...query,
        onHttpError: () => new StoryProjectsError('unavailable') } as StoryDraftRequest;
      await expect(Promise.resolve().then(() => executeStoryDraftRequest(f.options, endpoint, value => value)))
        .rejects.toMatchObject({ kind: 'validation' });
      expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    });
  it.each([null, {}, [draft(3), draft(2), draft(1)], [draft(2), draft(3)], [draft(3), draft(3)],
    [draft(3), draft(2, { draft_id: id(3) })], [draft(3), draft(3, { draft_id: id(2) })],
  ].map(value => [value] as const))('rejects wrong shape, overflow, duplicates or generation-order changes %#', async value => {
    const f = fixture(value); await expect(f.page({ limit: 2 })).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { project_id: sourceId }, { language: 'sv' }, { source_memories: [] }, { private_url: token },
    { revision: 2 }, { content: 'Unsupported invented prose.' },
    { verification: { ...draft(2).verification, checked_revision: 3 } },
  ])('applies the existing full-draft ownership, source and verification decoder to every row %#', async malformed => {
    const f = fixture([draft(3), { ...draft(2), ...malformed }]);
    await expect(f.page()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('normalizes UUID casing before comparing duplicates', async () => {
    const duplicate = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const f = fixture([draft(3, { draft_id: duplicate }), draft(2, { draft_id: duplicate.toUpperCase() })]);
    await expect(f.page()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('preserves each generation’s manual wording, immutable sources and own verification report', async () => {
    const older = draft(2, { revision: 3, status: 'edited', content: 'My own saved wording.',
      verification: { ...draft(2).verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 3,
        sources_current: false, reason: 'Manual edits require review.' } });
    const f = fixture([draft(3), older]);
    await expect(f.page()).resolves.toEqual({ items: [draft(3), older], hasMore: false });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('orders by generation rather than revision or date, allowing a later edit on an older generation', async () => {
    const older = draft(2, { status: 'edited', revision: 2, content: 'My saved edit.', updated_at: '2026-10-24T10:00:00Z',
      verification: { ...draft(2).verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 2 } });
    const f = fixture([draft(3), older]); await expect(f.page()).resolves.toMatchObject({ items: [draft(3), older] });
  });
  it('preserves Swedish evidence and Unicode text without changing the selected language', async () => {
    const first = draft(3), sentence = 'Jag växte upp i Malmö.';
    const row: StoryDraft = { ...first, language: 'sv', content: sentence, original_content: sentence,
      source_memories: first.source_memories.map(source => ({ ...source, evidence: sentence, sentence })) };
    const f = fixture([row]); await expect(f.page({ expectedLanguage: 'sv' })).resolves.toEqual({ items: [row], hasMore: false });
  });
  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic'])('does not dispatch without a current user token %j', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.page()).rejects.toMatchObject({ kind: 'authentication' }); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 503, 504])('handles HTTP %i as a safe read failure without retry', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code: 'PRIVATE', message: token } }, status));
    const pending = f.page(); await expect(pending).rejects.toMatchObject({ status, mayHaveWritten: false });
    await expect(pending).rejects.not.toThrow(token); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('cancels before token retrieval when already aborted', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.page({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('ignores a late successful page when the owner-scoped caller has cancelled', async () => {
    const f = fixture(), controller = new AbortController(); let settle: (response: Response) => void = () => {};
    f.request.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const pending = f.page({ signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    controller.abort(); settle(response([draft(3)])); await rejected; expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('times out a stalled read without retrying or treating it as a write', async () => {
    jest.useFakeTimers(); const f = fixture(); f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.page({ timeoutMs: 15 }); const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: false });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    jest.advanceTimersByTime(15); await rejected; expect(f.request).toHaveBeenCalledTimes(1);
  });
});
