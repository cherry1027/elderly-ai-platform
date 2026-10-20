import {
  CreateStoryInputError, getStoryProject, StoryProjectsError, updateStoryProject, UpdateStoryInputError,
  validateStoryProjectId, validateUpdateStoryInput, type StoryProject, type UpdateStoryProjectInput,
} from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000';
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'synthetic.user-access-token.signature';
const input = { title: 'A changed memory', description: 'A synthetic description.' };
function row(overrides: Partial<StoryProject> = {}): StoryProject {
  return { id: projectId, title: 'A synthetic memory', description: null, language: 'en', status: 'draft',
    created_at: '2026-10-20T12:34:56.123456Z', updated_at: '2026-10-20T12:34:56+00:00', ...overrides };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, options) =>
    response(options?.method === 'PATCH' ? row(input) : row()));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, projectId, request, getAccessToken };
  return { request, getAccessToken,
    get: (extra: { projectId?: string; signal?: AbortSignal; timeoutMs?: number; baseUrl?: string } = {}) => getStoryProject({ ...options, ...extra }),
    update: (extra: { projectId?: string; input?: UpdateStoryProjectInput; expectedLanguage?: 'en' | 'sv'; signal?: AbortSignal; timeoutMs?: number; baseUrl?: string } = {}) =>
      updateStoryProject({ ...options, input, expectedLanguage: 'en', ...extra }) };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
afterEach(() => { jest.useRealTimers(); });

describe('details UUID and patch validation before authentication', () => {
  it('accepts UUIDs canonically, without restricting their version', () => {
    expect(validateStoryProjectId(projectId.toUpperCase())).toBe(projectId);
    expect(validateStoryProjectId('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000');
  });
  it.each(['', 'not-a-uuid', ` ${projectId}`, `${projectId}/sessions`, `${projectId}?owner=other`, '../other',
    encodeURIComponent(`${projectId}/other`), 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'])('rejects invalid ID %s before GET or PATCH token acquisition', async value => {
    const f = fixture();
    await expect(f.get({ projectId: value })).rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
    await expect(f.update({ projectId: value })).rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { language: 'sv' }, { user_id: 'other' }, { status: 'draft' }, { id: projectId },
    { title: 'Title', language: 'en' }, { description: null, extra: 'not-allowed' }].map(value => [value] as const))(
    'rejects an empty or unsupported patch %# before a token or request', async value => {
      const f = fixture();
      await expect(f.update({ input: value as UpdateStoryProjectInput })).rejects.toEqual(new UpdateStoryInputError('payload'));
      expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    });
  it.each([null, undefined, '', ' \t\n ', '\u0085\u001C', '\u200B', 'a'.repeat(121), '🌷'.repeat(121)])(
    'reuses safe create-title validation for patch title %#', async title => {
      const f = fixture();
      await expect(f.update({ input: { title } as UpdateStoryProjectInput })).rejects.toBeInstanceOf(CreateStoryInputError);
      expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    });
  it.each([undefined, 1, false, {}, [], 'a'.repeat(4001), '🌷'.repeat(4001)].map(value => [value] as const))('rejects invalid or overlong description %# before token acquisition', async description => {
    const f = fixture();
    await expect(f.update({ input: { description } as UpdateStoryProjectInput })).rejects.toEqual(new UpdateStoryInputError('description'));
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([null, '', '  Preserve this spacing.\n\nAnd this line.  ', 'a'.repeat(4000), '🌷'.repeat(4000)])(
    'preserves a valid nullable description exactly %#', description => {
      expect(validateUpdateStoryInput({ description })).toEqual({ description });
    });
  it('keeps omitted fields omitted and trims only title boundaries', () => {
    expect(validateUpdateStoryInput({ title: '\u0085  Återblick på min barndom  \u001F' })).toEqual({ title: 'Återblick på min barndom' });
    expect(validateUpdateStoryInput({ description: null })).toEqual({ description: null });
    expect(validateUpdateStoryInput({ title: '🌷'.repeat(120) }).title).toHaveLength(240);
  });
  it('snapshots each provided field once', () => {
    let titleReads = 0; let descriptionReads = 0;
    expect(validateUpdateStoryInput({
      get title() { titleReads++; return titleReads === 1 ? '  Stable title  ' : ''; },
      get description() { descriptionReads++; return descriptionReads === 1 ? '  Stable description  ' : undefined; },
    })).toEqual({ title: 'Stable title', description: '  Stable description  ' });
    expect(titleReads).toBe(1); expect(descriptionReads).toBe(1);
  });
  it('sanitizes a throwing input property', () => {
    expect(() => validateUpdateStoryInput({ get description() { throw new Error('private-detail'); } }))
      .toThrow(new UpdateStoryInputError('payload'));
  });
  it('rejects an unsupported expected language without adding it to the body', async () => {
    const f = fixture();
    await expect(f.update({ expectedLanguage: 'de' as 'en' })).rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
});

describe('single-project GET and PATCH using the shared transport', () => {
  it.each(['', '/', '/api/v1', '/api/v1/'])('loads the canonical UUID path without list query or duplicate prefix: %s', async suffix => {
    const f = fixture(); await expect(f.get({ baseUrl: baseUrl + suffix, projectId: projectId.toUpperCase() })).resolves.toEqual(row());
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects/${projectId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(f.request).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('loads the latest metadata without assuming an old title or draft status', async () => {
    const f = fixture(); const value = row({ title: 'A newly changed title', language: 'sv', status: 'future-status', description: 'Latest server description' });
    f.request.mockResolvedValueOnce(response({ ...value, user_id: 'not-for-UI' }));
    await expect(f.get()).resolves.toEqual(value);
  });
  it.each([null, [], [row()], {}, row({ language: 'de' as 'en' }), row({ updated_at: 'not-a-date' })]
    .map(value => [value] as const))('rejects malformed detail data %# instead of treating it as a list', async value => {
      const f = fixture(); f.request.mockResolvedValueOnce(response(value));
      await expect(f.get()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
    });
  it.each([
    { title: '  A changed memory  ' }, { description: null }, { description: '' },
    { title: '  A changed memory  ', description: '  Preserve\n\nspacing  ' },
  ])('PATCH sends only provided normalized fields %#', async value => {
    const f = fixture(); const validated = validateUpdateStoryInput(value);
    f.request.mockResolvedValueOnce(response(row({ ...validated, status: 'future-status' })));
    await expect(f.update({ input: value })).resolves.toEqual(row({ ...validated, status: 'future-status' }));
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects/${projectId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(validated), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(f.request).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves the immutable Swedish language and strips unknown response fields', async () => {
    const f = fixture(); const value = row({ ...input, language: 'sv' });
    f.request.mockResolvedValueOnce(response({ ...value, user_id: 'private-owner', unknown: 'not-for-UI' }));
    await expect(f.update({ expectedLanguage: 'sv' })).resolves.toEqual(value);
  });
  it.each(['get', 'update'] as const)('blocks %s without a user token or with unsafe configuration', async method => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(null);
    await expect(f[method]()).rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
    expect(f.request).not.toHaveBeenCalled();
    f.getAccessToken.mockClear();
    await expect(f[method]({ baseUrl: 'https://public.example.test' })).rejects.toMatchObject({ kind: 'configuration', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'authentication'], [403, 'forbidden'], [404, 'not-found'], [409, 'conflict'], [400, 'validation'], [422, 'validation'],
  ] as const)('does not read raw HTTP%s bodies or claim an uncertain write for a known rejection', async (status, kind) => {
    const f = fixture(); const text = jest.fn(async () => 'private-token private-title');
    f.request.mockResolvedValue({ status, ok: false, text } as unknown as Response);
    await expect(f.get()).rejects.toEqual(new StoryProjectsError(kind, status));
    await expect(f.update()).rejects.toMatchObject({ kind, status, mayHaveWritten: false });
    expect(text).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each(['get', 'update'] as const)('handles a%s503 failure conservatively without automatic retries', async method => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ message: 'private-upstream' }, 503));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'unavailable', status: 503, mayHaveWritten: method === 'update' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['get', 'update'] as const)('rejects mismatched IDs in%s responses', async method => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(row({ ...input, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: method === 'update' });
  });
  it.each([
    row({ ...input, title: 'Different title' }), row({ ...input, description: 'Different description' }), row({ ...input, language: 'sv' }),
    null, [], [row(input)], { id: projectId }, row({ ...input, created_at: 'not-a-date' }),
  ].map(value => [value] as const))('rejects malformed or mismatched PATCH data %# without false success', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.update()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['get', 'update'] as const)('requires exactly HTTP200 for%s', async method => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(row(input), 201));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: method === 'update' });
  });
  it.each(['get', 'update'] as const)('sanitizes network/body/JSON failures for%s', async method => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new TypeError(`${token} private-description`));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: method === 'update' });
    f.request.mockResolvedValueOnce(new Response('private-broken-json', { headers: { 'Content-Type': 'application/json' } }));
    await expect(f[method]()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: method === 'update' });
    f.request.mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => { throw new Error('private-body-failure'); } } as unknown as Response);
    await expect(f[method]()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: method === 'update' });
  });
  it('exposes generic write uncertainty as a prototype getter while preserving create compatibility', () => {
    const definite = new StoryProjectsError('validation', 422);
    const uncertain = new StoryProjectsError('timeout', undefined, true);
    expect(definite.mayHaveWritten).toBe(false); expect(uncertain.mayHaveWritten).toBe(true);
    expect(uncertain.mayHaveCreated).toBe(true);
    expect(Object.hasOwn(uncertain, 'mayHaveWritten')).toBe(false);
    expect(typeof Object.getOwnPropertyDescriptor(StoryProjectsError.prototype, 'mayHaveWritten')?.get).toBe('function');
  });
});

describe('details/update deadline and cancellation at every asynchronous stage', () => {
  const stages = (['get', 'update'] as const).flatMap(method => (['token', 'request', 'body'] as const).map(stage => [method, stage] as const));
  it.each(stages)('bounds%s while%s hangs even when the mock ignores abort', async (method, stage) => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f[method]({ timeoutMs: 25 }); const checked = expect(pending).rejects.toMatchObject({
      kind: 'timeout', mayHaveWritten: method === 'update' && stage !== 'token',
    });
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1); expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(1000); expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
  });
  it.each(stages)('cancels%s while%s hangs even when the mock ignores abort', async (method, stage) => {
    const f = fixture(); const controller = new AbortController();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f[method]({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({
      kind: 'cancelled', mayHaveWritten: method === 'update' && stage !== 'token',
    });
    await flush(); controller.abort(); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
  });
  it.each(['get', 'update'] as const)('cancels%s before token acquisition and ignores late token results', async method => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f[method]({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    const second = new AbortController(); let finish!: (value: string) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f[method]({ signal: second.signal }); const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    second.abort(); await checked; finish(token); await flush(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['get', 'update'] as const)('ignores a late%s response after cancellation', async method => {
    const f = fixture(); const controller = new AbortController(); let finish!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f[method]({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({
      kind: 'cancelled', mayHaveWritten: method === 'update',
    });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => JSON.stringify(row(input)));
    finish({ status: 200, ok: true, text } as unknown as Response); await flush(); expect(text).not.toHaveBeenCalled();
  });
  it('never logs tokens, titles, descriptions or raw response errors', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(`${token} ${input.title} ${input.description}`));
      await expect(f.update()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
