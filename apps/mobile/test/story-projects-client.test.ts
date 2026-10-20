import {
  listStoryProjects, normalizeMobileApiBaseUrl, StoryProjectsError, storyProjectsUrl, type StoryProject,
} from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000';
const token = 'synthetic.user-access-token.signature';
function row(overrides: Partial<StoryProject> = {}): StoryProject {
  return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'A synthetic memory', description: null,
    language: 'en', status: 'draft', created_at: '2026-10-20T12:34:56.123456Z', updated_at: '2026-10-20T12:34:56+00:00', ...overrides };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture(data: unknown = [row()]) {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response(data));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  return { request, getAccessToken,
    list: (options: { signal?: AbortSignal; timeoutMs?: number } = {}) => listStoryProjects({ baseUrl, request, getAccessToken, ...options }) };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
afterEach(() => { jest.useRealTimers(); });

describe('pure read-only projects client, synthetic transport only', () => {
  it('requests the exact first-page endpoint with a user Bearer token and no credentials or writes', async () => {
    const f = fixture();
    await expect(f.list()).resolves.toEqual([row()]);
    expect(f.getAccessToken).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects?limit=50&offset=0`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['', '/', '/api/v1', '/api/v1/'])('avoids a duplicate API prefix for base suffix %s', suffix => {
    expect(storyProjectsUrl(baseUrl + suffix)).toBe(`${baseUrl}/api/v1/story-projects?limit=50&offset=0`);
  });

  it('preserves backend order, supports Swedish, strips unknown fields and does not mutate input', async () => {
    const first = { ...row({ title: 'En svensk berättelse', language: 'sv', status: 'future-status' }), user_id: 'private-owner', extra: 'not for UI' };
    const second = row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'English story' });
    const f = fixture([first, second]);
    const result = await f.list();
    expect(result).toEqual([row({ title: 'En svensk berättelse', language: 'sv', status: 'future-status' }), second]);
    expect(Object.keys(result[0]).sort()).toEqual(['created_at', 'description', 'id', 'language', 'status', 'title', 'updated_at']);
    expect(first.user_id).toBe('private-owner');
  });

  it('accepts an empty list', async () => { await expect(fixture([]).list()).resolves.toEqual([]); });

  it('accepts exactly fifty unique rows', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: `${i.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }));
    await expect(fixture(rows).list()).resolves.toEqual(rows);
  });

  it.each([null, '', 'contains whitespace', 'contains\nnewline', 'sb_publishable_synthetic-key', 'sb_secret_synthetic-key', 'x'.repeat(16385)])(
    'rejects missing or unusable token without a request: %s', async value => {
      const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
      await expect(f.list()).rejects.toMatchObject({ kind: 'authentication' });
      expect(f.request).not.toHaveBeenCalled();
    });

  it('sanitizes a rejected token acquisition', async () => {
    const f = fixture(); f.getAccessToken.mockRejectedValueOnce(new Error('sensitive-token-detail'));
    await expect(f.list()).rejects.toEqual(new StoryProjectsError('authentication'));
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentication'], [403, 'forbidden'], [404, 'not-found'], [400, 'validation'], [422, 'validation'],
    [429, 'unavailable'], [500, 'unavailable'], [503, 'unavailable'],
  ] as const)('classifies HTTP %s without reading or exposing the server body', async (status, kind) => {
    const f = fixture(); const text = jest.fn(async () => 'private-upstream-body');
    f.request.mockResolvedValueOnce({ ok: false, status, text } as unknown as Response);
    await expect(f.list()).rejects.toEqual(new StoryProjectsError(kind, status));
    expect(text).not.toHaveBeenCalled();
  });

  it('sanitizes network errors without exposing endpoint, token or server details', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new TypeError(`${baseUrl} ${token} private-error`));
    await expect(f.list()).rejects.toEqual(new StoryProjectsError('network'));
  });

  it.each([
    null, {}, { projects: [row()] }, [null], [5], [row({ id: 'not-a-uuid' })], [row({ language: 'de' as 'en' })],
    [row({ title: null as unknown as string })], [row({ description: 1 as unknown as string })],
    [row({ status: null as unknown as string })], [row({ created_at: 'not-a-date' })],
    [row({ updated_at: '2026-02-30T00:00:00Z' })], [row({ created_at: '2026-10-20T12:34:56' })],
    [row({ created_at: '2026-10-20T24:00:00Z' })],
    [row(), row()], Array.from({ length: 51 }, () => row()),
  ].map(data => [data] as const))('rejects malformed response %#', async data => {
    await expect(fixture(data).list()).rejects.toEqual(new StoryProjectsError('invalid-response'));
  });

  it.each(['description', 'created_at', 'updated_at', 'id', 'title', 'language', 'status'])('requires the %s response field', async field => {
    const value: Record<string, unknown> = { ...row() }; delete value[field];
    await expect(fixture([value]).list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([201, 202, 204])('rejects successful HTTP %s instead of assuming a list response', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce({ ok: true, status } as Response);
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([undefined, 'text/html', 'text/plain', 'application/problem+json'])('rejects unexpected Content-Type %s', async contentType => {
    const f = fixture(); f.request.mockResolvedValueOnce(new Response('[]', { headers: contentType ? { 'Content-Type': contentType } : {} }));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('sanitizes malformed JSON and oversized responses', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(new Response('not-json private-detail', { headers: { 'Content-Type': 'application/json' } }));
    await expect(f.list()).rejects.toEqual(new StoryProjectsError('invalid-response'));
    f.request.mockResolvedValueOnce(new Response(' '.repeat(1_048_577), { headers: { 'Content-Type': 'application/json' } }));
    await expect(f.list()).rejects.toEqual(new StoryProjectsError('invalid-response'));
  });

  it('reports body transport failure without exposing its detail', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => { throw new Error('private-body'); } } as unknown as Response);
    await expect(f.list()).rejects.toEqual(new StoryProjectsError('network'));
  });

  it('rejects cancellation before token acquisition without a request', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.list({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['token', 'request', 'body'])('times out while %s is hanging even when the mock ignores abort', async stage => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f.list({ timeoutMs: 25 });
    const checked = expect(pending).rejects.toEqual(new StoryProjectsError('timeout'));
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    if (stage === 'token') expect(f.request).not.toHaveBeenCalled();
    else expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['token', 'request', 'body'])('cancels while %s is hanging even when the mock ignores abort', async stage => {
    const f = fixture(); const controller = new AbortController();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f.list({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await flush(); controller.abort(); await checked;
  });

  it('never fetches after late token acquisition following timeout', async () => {
    jest.useFakeTimers(); const f = fixture(); let finish!: (value: string | null) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.list({ timeoutMs: 25 }); const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await jest.advanceTimersByTimeAsync(25); await checked;
    finish(token); await flush(); expect(f.request).not.toHaveBeenCalled();
  });

  it('never reads a late response body after cancellation', async () => {
    const f = fixture(); const controller = new AbortController(); let finish!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.list({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => '[]'); finish({ status: 200, ok: true, text } as unknown as Response);
    await flush(); expect(text).not.toHaveBeenCalled();
  });

  it('cleans up its abort listener and timer after success', async () => {
    jest.useFakeTimers(); const f = fixture(); const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    await f.list({ signal: controller.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 60_001])('rejects unsafe timeout %s before token acquisition', async timeoutMs => {
    const f = fixture(); await expect(f.list({ timeoutMs })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('rejects an unsafe endpoint before reading a token', async () => {
    const f = fixture(); await expect(listStoryProjects({ baseUrl: 'https://public.example.test', request: f.request,
      getAccessToken: f.getAccessToken })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('never logs credentials or upstream details on errors', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(`${token} private-password private-error`));
      await expect(f.list()).rejects.toMatchObject({ kind: 'network' });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});

describe('strict development LAN endpoint normalization', () => {
  it.each([
    ['http://10.1.2.3:8000', 'http://10.1.2.3:8000'], ['http://172.16.0.1/', 'http://172.16.0.1'],
    ['https://172.31.255.254/api/v1', 'https://172.31.255.254'], ['http://192.168.1.3:65535/api/v1/', 'http://192.168.1.3:65535'],
    ['https://10.1.2.3:443', 'https://10.1.2.3'], ['http://10.1.2.3:80', 'http://10.1.2.3'],
  ])('normalizes %s', (value, expected) => { expect(normalizeMobileApiBaseUrl(value)).toBe(expected); });

  it.each([
    '', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000', 'http://0.0.0.0:8000',
    'http://169.254.1.2', 'http://100.64.0.1', 'http://172.15.255.255', 'http://172.32.0.1', 'http://192.169.1.1',
    'https://8.8.8.8', 'https://edbkuunyeyxnyenmmqud.supabase.co', 'https://development.example.test',
    'http://10.1.2.256', 'http://010.1.2.3', 'http://10.01.2.3', 'http://10.1', 'http://167838211',
    'http://0x0a010203', 'http://10.1.2.3.', 'http://user:password@10.1.2.3', 'http://10.1.2.3?secret=value',
    'http://10.1.2.3#fragment', 'http://10.1.2.3/api/v1/api/v1', 'http://10.1.2.3/auth',
    'http://10.1.2.3/api/v1/../auth', 'http://10.1.2.3//api/v1', 'http://10.1.2.3/%61pi/v1',
    'HTTP://10.1.2.3', ' http://10.1.2.3', 'http://10.1.2.3\n', 'ftp://10.1.2.3',
    'http://10.1.2.3:0', 'http://10.1.2.3:08000', 'http://10.1.2.3:65536',
  ])('rejects unsafe or ambiguous endpoint %s', value => {
    expect(() => normalizeMobileApiBaseUrl(value)).toThrow(new StoryProjectsError('configuration'));
  });
});
