import { editStoryDraft, listDraftHistory, sameDraftOriginal, StoryDraftsError, validateDraftEditInput,
  type DraftHistoryOptions, type EditStoryDraftOptions, type StoryDraft,
  type StoryEdit, type StorySourceMemory } from '../src/api/story-drafts';

const baseUrl = 'http://192.168.20.40:8000', projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001', memoryId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001', editId = '50000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature', date = '2026-10-23T10:00:00.123456Z';
const original = 'Jag växte upp i Malmö.', changed = 'Min egen påhittade formulering.';
function draft(overrides: Partial<StoryDraft> = {}): StoryDraft {
  return { draft_id: draftId, project_id: projectId, status: 'ready_for_review', language: 'sv', style: 'warm',
    version: 1, revision: 1, content: original, original_content: original, mode: 'mock',
    source_memories: [{ memory_id: memoryId, memory_version: 2, source_message_id: sourceId, fact_type: 'location',
      value: 'Malmö', evidence: original, corrected_value: null, year: null, slot: 'grew_up_location', sentence: original }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
      checked_at: date, sources_current: true, reason: null }, created_at: date, updated_at: date, ...overrides };
}
function edited(content = changed, revision = 2): StoryDraft {
  return draft({ content, revision, status: 'edited', verification: { status: 'needs_review', unsupported_claims: [],
    method: 'manual_unverified', checked_revision: revision, checked_at: date, sources_current: true,
    reason: 'Manual edits require review.' } });
}
function history(overrides: Partial<StoryEdit> = {}): StoryEdit {
  return { id: editId, draft_id: draftId, revision: 2, previous_content: original, content: changed, created_at: date, ...overrides };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, init) =>
    response(init?.method === 'PATCH' ? edited() : [history()]));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, projectId, expectedLanguage: 'sv' as const, request, getAccessToken };
  return { request, getAccessToken,
    edit: (extra: Partial<EditStoryDraftOptions> = {}) => editStoryDraft({ ...options, baseline: draft(),
      input: { content: changed, expected_revision: 1 }, ...extra }),
    history: (extra: Partial<DraftHistoryOptions> = {}) => listDraftHistory({ ...options, draftId, ...extra }) };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => jest.useRealTimers());

describe('normalized explicit edit input', () => {
  it.each(['', ' ', '\t\n', '\u0085', '\u00a0\u2003\u202f', '\u200b\u200d\ufeff', '\u2060', '\u2800', '\u0301'])
  ('rejects whitespace/invisible-only content %j', content => {
    expect(() => validateDraftEditInput({ content, expected_revision: 1 })).toThrow(StoryDraftsError);
  });
  it.each(['private\0text', 'private\ud800text', '\udc00', 'x'.repeat(20_001)])('rejects unsafe or overlong content %#', content => {
    expect(() => validateDraftEditInput({ content, expected_revision: 1 })).toThrow(StoryDraftsError);
  });
  it.each([
    null, [], {}, { content: changed }, { content: changed, expected_revision: 0 },
    { content: changed, expected_revision: 1.1 }, { content: changed, expected_revision: Number.NaN },
    { content: changed, expected_revision: 2_147_483_648 }, { content: changed, expected_revision: true },
    { content: 42, expected_revision: 1 }, { content: changed, expected_revision: 1, owner: projectId },
    { content: changed, expected_revision: 1, status: 'passed' },
  ].map(value => [value] as const))('rejects fields outside exact content/revision contract %#', value => {
    expect(() => validateDraftEditInput(value)).toThrow(StoryDraftsError);
  });
  it.each([
    [' \t\nEnglish  internal spacing.\n\nSecond paragraph.\r\n', 'English  internal spacing.\n\nSecond paragraph.'],
    ['\u0085År 1975 flyttade jag till Malmö.\u0085', 'År 1975 flyttade jag till Malmö.'],
    ['\u001cMy fictional story.\u001f', 'My fictional story.'],
    ['  My emoji 👩‍👩‍👧‍👧 memory.  ', 'My emoji 👩‍👩‍👧‍👧 memory.'],
    [' \ufeffMeaningful wording.\ufeff ', '\ufeffMeaningful wording.\ufeff'],
  ])('normalizes only boundary whitespace and preserves meaningful prose %#', (content, expected) => {
    expect(validateDraftEditInput({ content, expected_revision: 1 })).toEqual({ content: expected, expected_revision: 1 });
  });
  it('counts 20,000 Unicode code points rather than UTF-16 units', () => {
    expect(validateDraftEditInput({ content: '😀'.repeat(20_000), expected_revision: 1 }).content).toHaveLength(40_000);
    expect(() => validateDraftEditInput({ content: '😀'.repeat(20_001), expected_revision: 1 })).toThrow(StoryDraftsError);
  });
});

describe('authenticated optimistic PATCH', () => {
  it('sends only normalized content and expected revision, without generation UUID or ownership fields', async () => {
    const f = fixture(); await expect(f.edit({ input: { content: '\u0085 ' + changed + ' \n', expected_revision: 1 } })).resolves.toEqual(edited());
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-drafts/' + draftId, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: changed, expected_revision: 1 }), credentials: 'omit', cache: 'no-store',
      redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('accepts unchanged current content without inventing a new revision', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(draft()));
    await expect(f.edit({ input: { content: '  ' + original + '\n', expected_revision: 1 } })).resolves.toEqual(draft());
  });
  it('accepts an exact immediately completed retry at expected_revision+1', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('PRIVATE lost response'));
    await expect(f.edit()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.edit()).resolves.toEqual(edited());
    expect(f.request.mock.calls[0][1]?.body).toEqual(f.request.mock.calls[1][1]?.body);
  });
  it('captures normalized input and immutable baseline before awaiting token acquisition', async () => {
    const f = fixture(), baseline = draft(), input = { content: changed, expected_revision: 1 };
    let allow!: (token: string | null) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
    const pending = f.edit({ baseline, input });
    input.content = 'Different text after the tap'; input.expected_revision = 12;
    baseline.source_memories[0].value = 'Changed after the tap';
    allow(token); await expect(pending).resolves.toEqual(edited());
    expect(f.request.mock.calls[0][1]?.body).toBe(JSON.stringify({ content: changed, expected_revision: 1 }));
  });
  it('rejects much later matching wording as proof of the original edit', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(edited(changed, 4)));
    await expect(f.edit()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('preserves manual-unverified status even when the user writes source-like wording', async () => {
    const before = edited('A different fictional version.', 2), after = edited(original, 3);
    const f = fixture(); f.request.mockResolvedValueOnce(response(after));
    await expect(f.edit({ baseline: before, input: { content: original, expected_revision: 2 } })).resolves.toEqual(after);
    expect(after.verification.status).not.toBe('passed');
  });
  it('accepts an existing edited unchanged revision when source freshness changes', async () => {
    const before = edited(), after = edited(); after.verification.sources_current = false;
    const f = fixture(); f.request.mockResolvedValueOnce(response(after));
    await expect(f.edit({ baseline: before, input: { content: changed, expected_revision: 2 } })).resolves.toEqual(after);
  });
  it.each(['en', 'sv'] as const)('preserves language and generation identity for %s', async language => {
    const first = language === 'en' ? 'I grew up in Malmö.' : original;
    const before = draft({ language, content: first, original_content: first,
      source_memories: [{ ...draft().source_memories[0], sentence: first }] });
    const after = { ...before, ...edited(), language, original_content: first, source_memories: before.source_memories };
    const f = fixture(); f.request.mockResolvedValueOnce(response(after));
    await expect(f.edit({ baseline: before, expectedLanguage: language })).resolves.toEqual(after);
  });
  it.each([
    { baseline: draft({ project_id: memoryId }) }, { baseline: draft({ language: 'en' }) },
    { baseline: { ...draft(), private_field: token } }, { projectId: 'bad' }, { expectedLanguage: 'de' },
    { input: { content: changed, expected_revision: 2 } }, { input: { content: '\u0085', expected_revision: 1 } },
  ])('rejects stale or malformed inputs before token acquisition %#', async extra => {
    const f = fixture(); await expect(f.edit(extra as Partial<EditStoryDraftOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    edited('Different from requested'), draft(), edited(changed, 3),
    { ...edited(), version: 2 }, { ...edited(), draft_id: memoryId }, { ...edited(), project_id: memoryId },
    { ...edited(), mode: 'live' }, { ...edited(), created_at: '2026-10-23T11:00:00Z' },
    { ...edited(), verification: { ...edited().verification, status: 'passed', method: 'deterministic_mock_v1' } },
    { ...edited(), verification: { ...edited().verification, checked_revision: 1 } },
  ].map(value => [value] as const))('rejects inconsistent saved response without claiming success %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.edit()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it.each([
    { memory_version: 3 }, { source_message_id: editId }, { memory_id: editId }, { fact_type: 'event' },
    { evidence: 'Changed original evidence.' }, { value: 'Stockholm' }, { corrected_value: 'Stockholm' },
    { year: 1975 }, { slot: 'birth_location' },
  ])('rejects any changed immutable source snapshot %#', async patch => {
    const value = edited(); value.source_memories = [{ ...value.source_memories[0], ...patch } as StorySourceMemory];
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.edit()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('rejects a coherent but replaced original and sentence snapshot', async () => {
    const value = edited(); value.original_content = 'Jag växte upp i Stockholm.';
    value.source_memories = [{ ...value.source_memories[0], sentence: value.original_content }];
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.edit()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('compares immutable originals separately from editable wording, revision and freshness', () => {
    expect(sameDraftOriginal(draft(), edited())).toBe(true);
    const different = edited(); different.verification.sources_current = false;
    expect(sameDraftOriginal(draft(), different)).toBe(true);
    expect(sameDraftOriginal(draft(), edited(changed, 7))).toBe(true);
    expect(sameDraftOriginal(draft(), { ...edited(), version: 2 })).toBe(false);
    expect(sameDraftOriginal(draft(), { ...edited(), created_at: '2026-10-23T11:00:00Z' })).toBe(false);
    expect(sameDraftOriginal(draft(), null as unknown as StoryDraft)).toBe(false);
  });
});

describe('bounded ordered actual-history pages', () => {
  it('requests the owned draft history with default pagination and no writes', async () => {
    const f = fixture(); await expect(f.history()).resolves.toEqual({ items: [history()], hasMore: false });
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-drafts/' + draftId + '/history?limit=50&offset=0', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
  });
  it('returns empty history without fabricating an original-revision row', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([]));
    await expect(f.history()).resolves.toEqual({ items: [], hasMore: false });
  });
  it('retains descending actual revisions and marks full pages possibly incomplete', async () => {
    const rows = [history({ id: sourceId, revision: 3, previous_content: changed, content: 'A third fictional version.' }), history()];
    const f = fixture(); f.request.mockResolvedValueOnce(response(rows));
    await expect(f.history({ limit: 2, offset: 3 })).resolves.toEqual({ items: rows, hasMore: true });
    expect(f.request.mock.calls[0][0]).toBe(baseUrl + '/api/v1/story-drafts/' + draftId + '/history?limit=2&offset=3');
  });
  it('does not call the result complete when the final allowed offset has a full page', async () => {
    const f = fixture(); await expect(f.history({ limit: 1, offset: 100_000 })).resolves.toEqual({ items: [history()], hasMore: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('supports the bounded two-row UI page even with maximally escaped long text', async () => {
    const first = 'A' + '\u0001'.repeat(19_999), second = 'B' + '\u0002'.repeat(19_999);
    const f = fixture(); f.request.mockResolvedValueOnce(response([
      history({ id: sourceId, revision: 3, previous_content: first, content: second }),
      history({ previous_content: second, content: first }),
    ]));
    const page = await f.history({ limit: 2 });
    expect(page.items).toHaveLength(2); expect(page.hasMore).toBe(true);
    expect(page.items[0].content.length).toBe(20_000);
  });
  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 100_001 },
    { offset: Number.NaN }, { limit: null }, { offset: null },
    { draftId: '../history' }, { projectId: 'bad' }, { expectedLanguage: 'de' },
  ])('rejects unsafe request pagination/scope before authentication %#', async extra => {
    const f = fixture(); await expect(f.history(extra as Partial<DraftHistoryOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    {}, [null], [history({ draft_id: memoryId })], [history({ id: 'invalid' })], [history({ revision: 1 })],
    [history({ revision: 2.5 })], [history({ content: '' })], [history({ previous_content: '' })],
    [history({ content: original })], [history({ created_at: '2026-02-30T10:00:00Z' })],
    [history({ content: 'x'.repeat(20_001) })], [history({ previous_content: '\ud800' })],
    [{ ...history(), private_field: token }], [history(), history()],
    [history(), history({ id: sourceId, revision: 3 })],
    [history({ revision: 3 }), history({ revision: 2 })],
  ].map(value => [value] as const))('rejects foreign, duplicate, misordered or malformed history %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.history()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it('rejects more rows than the requested page limit', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([history(), history({ id: sourceId, revision: 3 })]));
    await expect(f.history({ limit: 1 })).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('safe errors, uncertainty, cancellation and configuration', () => {
  it.each(['edit', 'history'] as const)('never contacts an absent or unapproved backend on %s', async action => {
    const f = fixture(); await expect(f[action]({ baseUrl: '' })).rejects.toMatchObject({ kind: 'configuration', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([null, '', 'sb_publishable_not-a-user-token', 'sb_secret_private'])('rejects missing or alternative credential %j', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.edit()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false }); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'RESOURCE_NOT_FOUND', 'not-found'], [409, 'STORY_CONTEXT_CHANGED', 'conflict'],
    [422, 'VALIDATION_ERROR', 'validation'], [503, 'SUPABASE_UNAVAILABLE', 'unavailable'],
  ] as const)('maps HTTP %s %s without private upstream wording', async (status, code, kind) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: 'PRIVATE ' + token } }, status));
    const error = await f.edit().catch(value => value);
    expect(error).toMatchObject({ kind, status, code, mayHaveWritten: status >= 500 });
    expect(JSON.stringify(error)).not.toContain(token); expect(String(error)).not.toContain(token);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('does not preserve unknown codes, raw native exceptions or private text in failures', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('PRIVATE ' + token));
    const error = await f.edit().catch(value => value);
    expect(error).toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(String(error)).not.toContain(token); expect(JSON.stringify(error)).not.toContain(token);
  });
  it.each([
    new Response('<html>private server</html>', { status: 200 }),
    new Response('{bad', { status: 200, headers: { 'Content-Type': 'application/json' } }), response(edited(), 201),
  ])('treats wrong/malformed successful PATCH as uncertain without retry %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(value);
    await expect(f.edit()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('cancels before authentication without a PATCH', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.edit({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('cancels an in-flight save, ignores its late response and never automatically resends', async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.edit({ signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await rejected; finish(response(edited())); await flush();
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('bounds token retrieval by the same timeout without dispatching a save', async () => {
    jest.useFakeTimers(); const f = fixture(); f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.edit({ timeoutMs: 50 }); const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: false });
    await flush(); jest.advanceTimersByTime(50); await rejected; expect(f.request).not.toHaveBeenCalled();
  });
  it('bounds dispatched PATCH duration and leaves the outcome uncertain', async () => {
    jest.useFakeTimers(); const f = fixture(); f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.edit({ timeoutMs: 50 }); const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
    await flush(); jest.advanceTimersByTime(50); await rejected; expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('ignores a late cancelled history page without exposing its content', async () => {
    const f = fixture(), controller = new AbortController();
    f.request.mockImplementationOnce(async () => { controller.abort(); return response([history()]); });
    await expect(f.history({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
  });
});
