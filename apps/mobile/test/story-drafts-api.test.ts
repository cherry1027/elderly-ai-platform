import { generateStoryDraft, getStoryDraft, getStoryVerification, listStoryDrafts, StoryDraftsError,
  type GenerateStoryDraftOptions, type StoryDraft, type StoryDraftOptions, type StoryProjectVerification,
  type StorySourceMemory, type StoryVerification } from '../src/api/story-drafts';

const baseUrl = 'http://192.168.20.40:8000', projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001', memoryId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001', actionId = '50000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature', date = '2026-10-23T10:00:00.123456Z';
function source(overrides: Partial<StorySourceMemory> = {}): StorySourceMemory {
  return { memory_id: memoryId, memory_version: 2, source_message_id: sourceId, fact_type: 'location',
    value: 'Malmö', evidence: 'Jag växte upp i Malmö.', corrected_value: null, year: null,
    slot: 'grew_up_location', sentence: 'Jag växte upp i Malmö.', ...overrides };
}
function report(overrides: Partial<StoryVerification> = {}): StoryVerification {
  return { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
    checked_at: date, sources_current: true, reason: null, ...overrides };
}
function draft(overrides: Partial<StoryDraft> = {}): StoryDraft {
  return { draft_id: draftId, project_id: projectId, language: 'sv', status: 'ready_for_review', style: 'warm',
    version: 1, revision: 1, content: source().sentence, original_content: source().sentence, mode: 'mock',
    source_memories: [source()], verification: report(), created_at: date, updated_at: date, ...overrides };
}
function edited(): StoryDraft {
  return draft({ status: 'edited', revision: 2, content: 'Detta är min egen formulering.',
    verification: report({ status: 'needs_review', method: 'manual_unverified', checked_revision: 2,
      reason: 'Manual edits require review.' }) });
}
function projectReport(overrides: Partial<StoryProjectVerification> = {}): StoryProjectVerification {
  return { project_id: projectId, draft_id: draftId, version: 1, revision: 1, verification: report(), ...overrides };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (url, init) =>
    response(String(url).includes('/verification') ? projectReport() : String(url).includes('/drafts?') ? [draft()] : draft(),
      init?.method === 'POST' ? 201 : 200));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, projectId, expectedLanguage: 'sv' as const, request, getAccessToken };
  return { request, getAccessToken, options,
    list: (extra: Partial<StoryDraftOptions> = {}) => listStoryDrafts({ ...options, ...extra }),
    read: (extra: Partial<StoryDraftOptions & { draftId: string }> = {}) => getStoryDraft({ ...options, draftId, ...extra }),
    verify: (extra: Partial<StoryDraftOptions> = {}) => getStoryVerification({ ...options, ...extra }),
    generate: (extra: Partial<GenerateStoryDraftOptions> = {}) => generateStoryDraft({ ...options, idempotencyKey: actionId,
      input: { language: 'sv', style: 'warm', confirm_generation: true }, ...extra }) };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => jest.useRealTimers());

describe('owned latest story reads and current verification', () => {
  it('lists only the latest persisted generation, without automatically generating', async () => {
    const f = fixture(); await expect(f.list()).resolves.toEqual([draft()]);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-projects/' + projectId + '/drafts?limit=1&offset=0', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('normalizes an approved base URL containing /api/v1 without duplicating its prefix', async () => {
    const f = fixture(); await f.list({ baseUrl: baseUrl + '/api/v1/' });
    expect(String(f.request.mock.calls[0][0])).toBe(baseUrl + '/api/v1/story-projects/' + projectId + '/drafts?limit=1&offset=0');
  });
  it('accepts no saved draft without creating a fake story', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([])); await expect(f.list()).resolves.toEqual([]);
  });
  it('reads the exact saved draft using the authenticated transport', async () => {
    const f = fixture(); await expect(f.read()).resolves.toEqual(draft());
    expect(f.request.mock.calls[0][0]).toBe(baseUrl + '/api/v1/story-drafts/' + draftId);
  });
  it('reads the project verification report without treating it as generation eligibility', async () => {
    const f = fixture(); await expect(f.verify()).resolves.toEqual(projectReport());
    expect(f.request.mock.calls[0][0]).toBe(baseUrl + '/api/v1/story-projects/' + projectId + '/verification');
  });
  it('accepts the explicit not-generated report', async () => {
    const absent = projectReport({ draft_id: null, version: null, revision: null, verification: report({
      status: 'not_generated', method: 'none', checked_revision: null, checked_at: null,
      sources_current: false, reason: 'No story has been generated.' }) });
    const f = fixture(); f.request.mockResolvedValueOnce(response(absent)); await expect(f.verify()).resolves.toEqual(absent);
  });
  it.each(['read', 'list', 'generate'] as const)('preserves edited/unverified drafts on %s, including a replayed POST', async action => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(action === 'list' ? [edited()] : edited(), action === 'generate' ? 201 : 200));
    await expect(f[action]()).resolves.toEqual(action === 'list' ? [edited()] : edited());
  });
  it.each([true, false])('preserves manual review with sources_current=%s', async sources_current => {
    const value = edited(); value.verification.sources_current = sources_current;
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.read()).resolves.toEqual(value);
  });
  it('accepts stale original sources without claiming verification passed', async () => {
    const value = draft({ verification: report({ status: 'stale_sources', sources_current: false,
      reason: 'Source memories changed.' }) });
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.read()).resolves.toEqual(value);
  });
  it('preserves distinct original memory, correction and source sentences', async () => {
    const snapshot = source({ value: '1974', evidence: 'Jag flyttade 1974.', corrected_value: '1975', year: 1974,
      sentence: 'Jag flyttade 1975.' });
    const value = draft({ source_memories: [snapshot], content: snapshot.sentence, original_content: snapshot.sentence });
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.read()).resolves.toEqual(value);
  });
  it('deduplicates equal source sentences only for canonical story text, preserving both source references', async () => {
    const value = draft({ source_memories: [source(), source({ memory_id: actionId })] });
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.read()).resolves.toEqual(value);
  });
  it.each(['en', 'sv'] as const)('preserves %s language and ordered paragraph boundaries', async language => {
    const first = source({ sentence: language === 'en' ? 'I grew up in Malmö.' : 'Jag växte upp i Malmö.' });
    const second = source({ memory_id: actionId, sentence: language === 'en' ? 'My name is Fictional.' : 'Min berättelse är påhittad.' });
    const content = first.sentence + '\n\n' + second.sentence;
    const value = draft({ language, source_memories: [first, second], content, original_content: content });
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.read({ expectedLanguage: language })).resolves.toEqual(value);
  });
});

describe('explicit confirmed generation only', () => {
  it('sends exact confirmed language/style and a separate stable UUID action key', async () => {
    const f = fixture(); await expect(f.generate()).resolves.toEqual(draft());
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-projects/' + projectId + '/generate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        'Content-Type': 'application/json', 'Idempotency-Key': actionId },
      body: JSON.stringify({ language: 'sv', style: 'warm', confirm_generation: true }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
  });
  it('never automatically retries a lost response; an explicit same-key call retains the exact payload', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('PRIVATE transport content'));
    await expect(f.generate()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.generate()).resolves.toEqual(draft());
    expect(f.request.mock.calls[0][1]?.body).toEqual(f.request.mock.calls[1][1]?.body);
    expect(f.request.mock.calls[0][1]?.headers).toEqual(f.request.mock.calls[1][1]?.headers);
  });
  it.each([
    { input: {} }, { input: { language: 'sv', style: 'warm' } },
    { input: { language: 'sv', style: 'warm', confirm_generation: false } },
    { input: { language: 'sv', style: 'warm', confirm_generation: 1 } },
    { input: { language: 'sv', style: 'warm', confirm_generation: 'true' } },
    { input: { language: 'en', style: 'warm', confirm_generation: true } },
    { input: { language: 'sv', style: 'creative', confirm_generation: true } },
    { input: { language: 'sv', style: 'warm', confirm_generation: true, owner: projectId } },
    { idempotencyKey: '' }, { idempotencyKey: '../generate' }, { projectId: 'invalid' }, { expectedLanguage: 'de' },
  ])('rejects invalid explicit action before token retrieval or network %#', async extra => {
    const f = fixture(); await expect(f.generate(extra as Partial<GenerateStoryDraftOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('waits up to the dedicated 30-second default without shortening it to the standard read timeout', async () => {
    jest.useFakeTimers(); const f = fixture(); f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.generate(); const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
    await flush(); jest.advanceTimersByTime(29_999); await flush();
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1); await rejected;
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([0, 60_001, Number.NaN])('rejects unsafe timeout %s before authentication', async timeoutMs => {
    const f = fixture(); await expect(f.generate({ timeoutMs })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
});

describe('strict draft/source/verification boundaries', () => {
  it.each([
    null, {}, { ...draft(), project_id: sourceId }, { ...draft(), draft_id: sourceId },
    { ...draft(), language: 'en' }, { ...draft(), status: 'published' }, { ...draft(), mode: 'live' },
    { ...draft(), style: 'creative' }, { ...draft(), version: 0 }, { ...draft(), revision: 1.1 },
    { ...draft(), content: '' }, { ...draft(), content: 'Different text' }, { ...draft(), content: 'x'.repeat(20_001) },
    { ...draft(), original_content: 'Fabricated original' }, { ...draft(), content: '\ud800' },
    { ...draft(), status: 'edited', revision: 1 }, { ...draft(), revision: 2 },
    { ...draft(), created_at: '2026-02-30T10:00:00Z' }, { ...draft(), updated_at: 'today' },
    { ...draft(), source_memories: [] }, { ...draft(), source_memories: [source(), source()] },
    { ...draft(), source_memories: Array.from({ length: 201 }, () => source()) },
    { ...draft(), source_memories: [source({ memory_id: 'invalid' })] },
    { ...draft(), source_memories: [source({ memory_version: 0 })] },
    { ...draft(), source_memories: [source({ source_message_id: 'invalid' })] },
    { ...draft(), source_memories: [source({ fact_type: 'invented' as 'location' })] },
    { ...draft(), source_memories: [source({ value: '' })] }, { ...draft(), source_memories: [source({ evidence: '' })] },
    { ...draft(), source_memories: [source({ corrected_value: 'x'.repeat(1001) })] },
    { ...draft(), source_memories: [source({ year: 2101 })] }, { ...draft(), source_memories: [source({ slot: 'x'.repeat(81) })] },
    { ...draft(), source_memories: [source({ sentence: 'We invent something.' })] },
    { ...draft(), source_memories: [source({ sentence: 'Jag växte\nupp i Malmö.' })] },
    { ...draft(), private_field: token }, { ...draft(), source_memories: [{ ...source(), private_field: token }] },
    { ...draft(), verification: report({ status: 'not_generated', method: 'none', checked_revision: null, checked_at: null }) },
    { ...draft(), verification: report({ unsupported_claims: ['unsupported content'] }) },
    { ...draft(), verification: report({ sources_current: false }) },
    { ...draft(), verification: report({ checked_revision: 2 }) },
    { ...draft(), verification: report({ checked_at: null }) },
    { ...draft(), verification: report({ method: 'manual_unverified' }) },
    { ...draft(), verification: report({ status: 'stale_sources', sources_current: true }) },
    { ...draft(), verification: report({ status: 'needs_review', method: 'manual_unverified' }) },
    { ...edited(), verification: report({ status: 'stale_sources', sources_current: false, checked_revision: 2 }) },
    { ...edited(), verification: report({ checked_revision: 2 }) },
    { ...draft(), verification: { ...report(), private_field: token } },
  ].map(value => [value] as const))('rejects malformed, foreign, fabricated or falsely passed response %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.read()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it.each([{}, [draft(), draft()]].map(value => [value] as const))('rejects list shape beyond requested latest-only contract %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it.each([
    projectReport({ project_id: sourceId }), projectReport({ draft_id: null }), projectReport({ version: null }),
    projectReport({ revision: 2 }), projectReport({ draft_id: 'invalid' }),
    projectReport({ verification: report({ status: 'not_generated', method: 'none', checked_revision: null, checked_at: null }) }),
  ])('rejects inconsistent project verification %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value)); await expect(f.verify()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('marks malformed POST success uncertain without exposing or fabricating saved text', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ ...draft(), content: 'Private unsupported content' }, 201));
    await expect(f.generate()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});

describe('safe authentication, HTTP failures and cancellation', () => {
  it.each([null, '', 'sb_publishable_not-a-user-token', 'sb_secret_private', 'unsafe\nheader'])('rejects missing/non-user token %j', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.generate()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['', 'https://edbkuunyeyxnyenmmqud.supabase.co', 'https://example.com', 'http://127.0.0.1:8000',
    'http://8.8.8.8:8000', 'http://192.168.20.40:8000/unsafe'])('rejects absent or unapproved base %s before authentication', async value => {
    const f = fixture(); await expect(f.generate({ baseUrl: value })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'PROJECT_NOT_FOUND', 'not-found'], [409, 'NO_CONFIRMED_MEMORIES', 'conflict'],
    [409, 'NO_SUPPORTED_MEMORIES', 'conflict'], [409, 'CLARIFICATION_REQUIRED', 'conflict'],
    [409, 'STORY_CONTEXT_CHANGED', 'conflict'], [409, 'IDEMPOTENCY_CONFLICT', 'conflict'],
    [409, 'CONTEXT_LIMIT', 'conflict'], [409, 'STORY_CONTEXT_LIMIT', 'conflict'],
    [422, 'DRAFT_VERIFICATION_FAILED', 'validation'], [422, 'LANGUAGE_MISMATCH', 'validation'],
    [503, 'STORY_GENERATION_DISABLED', 'unavailable'], [503, 'STORY_WRITER_INVALID_RESPONSE', 'unavailable'],
    [503, 'SUPABASE_UNAVAILABLE', 'unavailable'], [504, 'STORY_WRITER_TIMEOUT', 'timeout'],
  ] as const)('maps %s %s without raw messages or automatic retry', async (status, code, kind) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: 'PRIVATE ' + token } }, status));
    await expect(f.generate()).rejects.toMatchObject({ name: 'StoryDraftsError', kind, status, code, mayHaveWritten: status >= 500 });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['PRIVATE_CODE_' + token, 'NO_CONFIRMED_MEMORIES'])('drops unknown or mismatched upstream codes %s', async code => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token } }, 503));
    const error = await f.generate().catch(value => value);
    expect(error).toBeInstanceOf(StoryDraftsError); expect(error.code).toBeUndefined();
    expect(String(error)).not.toContain(token); expect(JSON.stringify(error)).not.toContain(token);
  });
  it('never exposes transport exception content', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error(token));
    const error = await f.generate().catch(value => value);
    expect(String(error)).not.toContain(token); expect(JSON.stringify(error)).not.toContain(token);
  });
  it('safely maps non-JSON HTTP errors without parsing private HTML', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(new Response('<html>' + token + '</html>', { status: 503 }));
    const error = await f.generate().catch(value => value); expect(error).toMatchObject({ kind: 'unavailable', mayHaveWritten: true });
    expect(String(error)).not.toContain(token);
  });
  it.each([
    new Response('<html>not a draft</html>', { status: 201 }),
    new Response('{bad json', { status: 201, headers: { 'Content-Type': 'application/json' } }),
    response(draft(), 200),
  ])('rejects wrong/malformed successful POST without fake persistence %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(value);
    await expect(f.generate()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('cancels before token retrieval without dispatch', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.generate({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('cancels a dispatched write and ignores a late response without resubmitting', async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.generate({ signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await rejected; finish(response(draft(), 201)); await flush();
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('times out during authentication without sending a POST', async () => {
    jest.useFakeTimers(); const f = fixture(); f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.generate({ timeoutMs: 50 }); const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: false });
    await flush(); jest.advanceTimersByTime(50); await rejected; expect(f.request).not.toHaveBeenCalled();
  });
  it('ignores a read response arriving after cancellation', async () => {
    const f = fixture(), controller = new AbortController();
    f.request.mockImplementationOnce(async () => { controller.abort(); return response([draft()]); });
    await expect(f.list({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
  });
});
