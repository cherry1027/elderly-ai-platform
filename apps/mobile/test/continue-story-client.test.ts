import {
  continueStoryProject, listStorySessions, StoryProjectsError,
  type ConversationSession, type StorySessionOptions,
} from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000';
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = 'synthetic.user-access-token.signature';
const timestamp = '2026-10-20T12:34:56.123456Z';

function session(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return { id: sessionId, project_id: projectId, language: 'en', status: 'active',
    created_at: timestamp, updated_at: timestamp, ended_at: null, ...overrides };
}
function continuation(overrides: Record<string, unknown> = {}) {
  return { project_id: projectId, language: 'en', session: session(), session_created: true,
    latest_draft: null, generation_triggered: false, ...overrides };
}
function draft(overrides: Record<string, unknown> = {}) {
  return { draft_id: otherId, project_id: projectId, language: 'en', status: 'ready_for_review',
    style: 'warm', mode: 'mock', version: 2, revision: 1, created_at: timestamp, updated_at: timestamp,
    content: 'Private fictional saved prose.', original_content: 'Private fictional saved prose.',
    source_memories: [{ memory_id: sessionId, memory_version: 1, source_message_id: otherId,
      fact_type: 'event', value: 'A fictional walk.', evidence: 'I remember a fictional walk.',
      corrected_value: null, year: null, slot: null, sentence: 'Private fictional saved prose.' }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
      checked_revision: 1, checked_at: timestamp, sources_current: true, reason: null }, ...overrides };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, options) =>
    response(options?.method === 'POST' ? continuation() : [session()]));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options: StorySessionOptions = { baseUrl, projectId, expectedLanguage: 'en', request, getAccessToken };
  return { request, getAccessToken,
    resume: (extra: Partial<StorySessionOptions> = {}) => continueStoryProject({ ...options, ...extra }),
    list: (extra: Partial<StorySessionOptions> = {}) => listStorySessions({ ...options, ...extra }) };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
afterEach(() => { jest.useRealTimers(); });

describe('owned story continuation and session reconciliation contract', () => {
  it.each(['', '/', '/api/v1', '/api/v1/'])('sends only {} and the current user Bearer to continue with one prefix: %s', async suffix => {
    const f = fixture();
    await expect(f.resume({ baseUrl: baseUrl + suffix, projectId: projectId.toUpperCase() })).resolves.toEqual(continuation());
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects/${projectId}/continue`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(f.request).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('accepts a resumed Swedish session and strips response owner/unknown fields', async () => {
    const f = fixture(); const value = continuation({ language: 'sv', session: session({ language: 'sv' }), session_created: false });
    f.request.mockResolvedValueOnce(response({ ...value, user_id: 'not-for-UI' }));
    await expect(f.resume({ expectedLanguage: 'sv' })).resolves.toEqual(value);
  });
  it('retrieves the read-only newest-first session page without creating a session', async () => {
    const f = fixture(); const completed = session({ id: otherId, status: 'completed', ended_at: timestamp });
    f.request.mockResolvedValueOnce(response([session(), completed]));
    await expect(f.list()).resolves.toEqual([session(), completed]);
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects/${projectId}/sessions?limit=50&offset=0`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('allows an empty reconciliation result without manufacturing a session', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([]));
    await expect(f.list()).resolves.toEqual([]); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('retains only validated latest-draft metadata, never prose or source memories', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(continuation({ latest_draft: draft() })));
    const result = await f.resume();
    expect(result.latest_draft).toEqual({ draft_id: otherId, project_id: projectId, language: 'en',
      status: 'ready_for_review', version: 2, revision: 1, created_at: timestamp, updated_at: timestamp });
    expect(JSON.stringify(result)).not.toMatch(/Private|source_memories|original_content|verification/);
  });
  it.each(['resume', 'list'] as const)('rejects unsafe configuration, UUID and language before %s authentication', async method => {
    const f = fixture();
    await expect(f[method]({ baseUrl: 'https://public.example.test' })).rejects.toMatchObject({ kind: 'configuration', mayHaveWritten: false });
    await expect(f[method]({ projectId: `${projectId}/sessions` })).rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
    await expect(f[method]({ expectedLanguage: 'de' as 'en' })).rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic', 'unsafe token', 'a'.repeat(16385)])(
    'requires a current user access token instead of key/header substitutions %#', async value => {
      const f = fixture(); f.getAccessToken.mockResolvedValue(value);
      await expect(f.resume()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
      await expect(f.list()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
      expect(f.request).not.toHaveBeenCalled();
    });
  it.each([
    null, [], {}, continuation({ project_id: otherId }), continuation({ language: 'sv' }),
    continuation({ session_created: 'false' }), continuation({ generation_triggered: true }),
    continuation({ generation_triggered: 0 }), continuation({ generation_triggered: undefined }),
    continuation({ session: session({ project_id: otherId }) }), continuation({ session: session({ language: 'sv' }) }),
    continuation({ session: session({ status: 'completed' }) }), continuation({ session: session({ created_at: 'not-a-date' }) }),
    continuation({ session: session({ ended_at: timestamp }) }),
    continuation({ session: session({ id: 'not-a-uuid' }) }), continuation({ session: session({ ended_at: 'not-a-date' }) }),
    continuation({ latest_draft: undefined }), continuation({ latest_draft: [] }),
    continuation({ latest_draft: draft({ project_id: otherId }) }), continuation({ latest_draft: draft({ language: 'sv' }) }),
    continuation({ latest_draft: draft({ version: 0 }) }), continuation({ latest_draft: draft({ revision: 1.5 }) }),
    continuation({ latest_draft: draft({ mode: 'live' }) }), continuation({ latest_draft: draft({ updated_at: '2026-02-30T12:00:00Z' }) }),
  ].map(value => [value] as const))('rejects mismatched or malformed continuation %# as an uncertain write', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.resume()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    null, {}, [session(), session()], Array.from({ length: 51 }, () => session()),
    [session({ project_id: otherId })], [session({ language: 'sv' })],
    [session({ status: 'future-status' as 'active' })], [session({ ended_at: undefined as unknown as null })],
  ].map(value => [value] as const))('rejects malformed reconciliation %# without write uncertainty', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 409, 422])('handles known HTTP%s rejection without parsing raw errors or retrying', async status => {
    const f = fixture(); const text = jest.fn(async () => `${token} private-error`);
    f.request.mockResolvedValue({ status, ok: false, text } as unknown as Response);
    await expect(f.resume()).rejects.toMatchObject({ status, mayHaveWritten: false });
    await expect(f.list()).rejects.toMatchObject({ status, mayHaveWritten: false });
    expect(text).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each(['resume', 'list'] as const)('treats503 text/plain as unavailable in %s without retries', async method => {
    const f = fixture(); f.request.mockResolvedValueOnce(new Response('private-upstream', { status: 503 }));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'unavailable', status: 503, mayHaveWritten: method === 'resume' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['resume', 'list'] as const)('rejects wrong status, non-JSON or malformed body safely for %s', async method => {
    const f = fixture();
    for (const result of [response(continuation(), 201), new Response('private-html', { status: 200 }),
      new Response('invalid-json', { status: 200, headers: { 'Content-Type': 'application/json' } })]) {
      f.request.mockResolvedValueOnce(result);
      await expect(f[method]()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: method === 'resume' });
    }
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it('reports an uncertain network outcome and leaves reconciliation to the caller, never auto-POSTs', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new TypeError(`${token} private-story`));
    await expect(f.resume()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.list()).resolves.toEqual([session()]);
    expect(f.request.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'GET']);
  });
});

describe('continuation deadlines, cancellation and sanitized failures', () => {
  const stages = (['resume', 'list'] as const).flatMap(method => (['token', 'request', 'body'] as const).map(stage => [method, stage] as const));
  it.each(stages)('bounds %s while %s hangs without repeated requests', async (method, stage) => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f[method]({ timeoutMs: 25 }); const checked = expect(pending).rejects.toMatchObject({
      kind: 'timeout', mayHaveWritten: method === 'resume' && stage !== 'token',
    });
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1); expect(jest.getTimerCount()).toBe(0);
  });
  it.each(stages)('cancels %s while %s hangs without leaking a late response', async (method, stage) => {
    const f = fixture(); const controller = new AbortController();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f[method]({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({
      kind: 'cancelled', mayHaveWritten: method === 'resume' && stage !== 'token',
    });
    await flush(); controller.abort(); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
  });
  it.each(['resume', 'list'] as const)('rejects already cancelled %s before acquiring a token', async method => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f[method]({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('never logs access tokens, response bodies or thrown network details', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(`${token} private-story-content`));
      let failure: unknown;
      try { await f.resume(); } catch (error) { failure = error; }
      expect(failure).toEqual(new StoryProjectsError('network', undefined, true));
      expect(String(failure)).not.toMatch(/synthetic|private/);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
