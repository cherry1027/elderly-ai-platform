import {
  createStoryProject, CreateStoryInputError, StoryProjectsError, validateCreateStoryInput,
  type CreateStoryProjectInput, type StoryProject,
} from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000';
const token = 'synthetic.user-access-token.signature';
const input: CreateStoryProjectInput = { title: 'A synthetic story', language: 'en' };
function row(overrides: Partial<StoryProject> = {}): StoryProject {
  return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...input, description: null, status: 'draft',
    created_at: '2026-10-20T12:34:56.123456Z', updated_at: '2026-10-20T12:34:56+00:00', ...overrides };
}
function response(value: unknown = row(), status = 201) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response());
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  return { request, getAccessToken,
    create: (options: { input?: CreateStoryProjectInput; signal?: AbortSignal; timeoutMs?: number; baseUrl?: string } = {}) =>
      createStoryProject({ baseUrl, input, request, getAccessToken, ...options }) };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
afterEach(() => { jest.useRealTimers(); });

describe('create input, before authentication or requests', () => {
  it.each(['en', 'sv'] as const)('trims only title and preserves the %s story language', language => {
    const value = { title: '  En berättelse 🌷  ', language };
    expect(validateCreateStoryInput(value)).toEqual({ title: 'En berättelse 🌷', language });
    expect(value.title).toBe('  En berättelse 🌷  ');
  });
  it.each(['a', 'å'.repeat(120), '🌷'.repeat(120), 'e\u0301'.repeat(60)])('accepts one through120 Unicode code points %#', title => {
    expect(validateCreateStoryInput({ title, language: 'en' })).toEqual({ title, language: 'en' });
  });
  it.each([null, undefined, [], {}, { language: 'en' }, { title: 'title' }, { title: 5, language: 'en' },
    { title: '', language: 'en' }, { title: ' \n\t ', language: 'sv' },
    { ...input, description: null }, { ...input, user_id: 'not-permitted' }, { ...input, status: 'draft' }]
    .map(value => [value] as const))('rejects empty, malformed or extra-field input %# without a token or request', async value => {
      const f = fixture();
      await expect(f.create({ input: value as CreateStoryProjectInput })).rejects.toEqual(new CreateStoryInputError('required'));
      expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    });
  it.each(['a'.repeat(121), '🌷'.repeat(121), 'e\u0301'.repeat(61)])('rejects more than120 Unicode code points %#', async title => {
    const f = fixture();
    await expect(f.create({ input: { title, language: 'en' } })).rejects.toEqual(new CreateStoryInputError('too-long'));
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['', 'EN', 'sv-SE', 'de', null, 1])('rejects invalid language %s before token acquisition', async language => {
    const f = fixture();
    await expect(f.create({ input: { title: 'title', language } as CreateStoryProjectInput })).rejects.toEqual(new CreateStoryInputError('language'));
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it('does not expose throwing property details', () => {
    const value = { get title() { throw new Error('private-input-detail'); }, language: 'en' };
    expect(() => validateCreateStoryInput(value)).toThrow(new CreateStoryInputError('required'));
  });
});

describe('Unicode blank-title boundary and immutable input snapshots', () => {
  const unicodeWhitespace = [
    ['NEXT LINE U+0085', '\u0085'],
    ['FILE SEPARATOR U+001C', '\u001C'], ['GROUP SEPARATOR U+001D', '\u001D'],
    ['RECORD SEPARATOR U+001E', '\u001E'], ['UNIT SEPARATOR U+001F', '\u001F'],
    ['NO-BREAK SPACE U+00A0', '\u00A0'], ['OGHAM SPACE U+1680', '\u1680'],
    ['EN QUAD U+2000', '\u2000'], ['EM QUAD U+2001', '\u2001'],
    ['EN SPACE U+2002', '\u2002'], ['EM SPACE U+2003', '\u2003'],
    ['THREE-PER-EM SPACE U+2004', '\u2004'], ['FOUR-PER-EM SPACE U+2005', '\u2005'],
    ['SIX-PER-EM SPACE U+2006', '\u2006'], ['FIGURE SPACE U+2007', '\u2007'],
    ['PUNCTUATION SPACE U+2008', '\u2008'], ['THIN SPACE U+2009', '\u2009'],
    ['HAIR SPACE U+200A', '\u200A'], ['LINE SEPARATOR U+2028', '\u2028'],
    ['PARAGRAPH SEPARATOR U+2029', '\u2029'], ['NARROW NO-BREAK SPACE U+202F', '\u202F'],
    ['MEDIUM MATHEMATICAL SPACE U+205F', '\u205F'], ['IDEOGRAPHIC SPACE U+3000', '\u3000'],
  ] as const;
  const invisibleOnly = [
    ['ZERO WIDTH SPACE', '\u200B'], ['ZERO WIDTH JOINER', '\u200D'], ['ZERO WIDTH NON-JOINER', '\u200C'],
    ['BOM', '\uFEFF'], ['WORD JOINER', '\u2060'], ['SOFT HYPHEN', '\u00AD'],
    ['ARABIC LETTER MARK', '\u061C'], ['LEFT-TO-RIGHT MARK', '\u200E'], ['RIGHT-TO-LEFT MARK', '\u200F'],
    ['LEFT-TO-RIGHT EMBEDDING', '\u202A'], ['RIGHT-TO-LEFT EMBEDDING', '\u202B'],
    ['POP DIRECTIONAL FORMATTING', '\u202C'], ['LEFT-TO-RIGHT OVERRIDE', '\u202D'],
    ['RIGHT-TO-LEFT OVERRIDE', '\u202E'], ['LEFT-TO-RIGHT ISOLATE', '\u2066'],
    ['RIGHT-TO-LEFT ISOLATE', '\u2067'], ['FIRST STRONG ISOLATE', '\u2068'], ['POP DIRECTIONAL ISOLATE', '\u2069'],
    ['VARIATION SELECTOR ONE', '\uFE00'], ['TEXT VARIATION SELECTOR', '\uFE0E'], ['EMOJI VARIATION SELECTOR', '\uFE0F'],
    ['SUPPLEMENTARY VARIATION SELECTOR', '\u{E0100}'], ['COMBINING GRAPHEME JOINER', '\u034F'],
    ['HANGUL CHOSEONG FILLER', '\u115F'], ['HANGUL JUNGSEONG FILLER', '\u1160'],
    ['HANGUL COMPATIBILITY FILLER', '\u3164'], ['HALFWIDTH HANGUL FILLER', '\uFFA0'],
    ['BRAILLE PATTERN BLANK', '\u2800'], ['COMBINING ACUTE ONLY', '\u0301'], ['COMBINING DIAERESIS ONLY', '\u0308'],
    ['MONGOLIAN VARIATION SELECTOR', '\u180B'], ['MONGOLIAN VOWEL SEPARATOR', '\u180E'],
    ['LANGUAGE TAG', '\u{E0001}'], ['TAG SPACE', '\u{E0020}'],
    ['EGYPTIAN HIEROGLYPH VERTICAL JOINER', '\u{13430}'],
    ['INTERLINEAR ANNOTATION ANCHOR', '\uFFF9'], ['NUL CONTROL', '\u0000'],
    ['MIXED INVISIBLE CHARACTERS AND SPACES', '\u200B \u0301\u2060\u115F'],
  ] as const;

  it.each([...unicodeWhitespace, ...invisibleOnly])('rejects %s-only titles before obtaining a token or dispatching POST', async (_label, title) => {
    const f = fixture();
    await expect(f.create({ input: { title, language: 'en' } })).rejects.toEqual(new CreateStoryInputError('required'));
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['English internal spaces', 'Childhood  memories in spring', 'en'],
    ['Swedish letters', 'Återblick på min barndom i Örebro', 'sv'],
    ['Swedish decomposed accent', 'Minnen från A\u030Aland', 'sv'],
    ['English combining accents', 'Cafe\u0301 memories', 'en'],
    ['Internal Unicode spacing', 'Min\u00A0lugna\u2002berättelse', 'sv'],
    ['ZWJ family emoji', 'Our family 👩‍👩‍👧‍👦', 'en'],
    ['Emoji presentation selector', 'Sommarminnen ☀️', 'sv'],
    ['Internal zero-width shaping', 'Family a\u200Cb and a\u200Db', 'en'],
  ] as const)('preserves a legitimate %s title exactly', async (_label, title, language) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(row({ title, language })));
    const validated = validateCreateStoryInput({ title, language });
    expect(validated).toEqual({ title, language });
    await expect(f.create({ input: { title, language } })).resolves.toEqual(row({ title, language }));
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual(validated);
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it.each(['A'.repeat(120), 'Å'.repeat(120), '🌷'.repeat(120)])('normalizes backend whitespace before the120-code-point limit and sends the validated body %#', async title => {
    const f = fixture();
    const boundary = '\u0085\u001C\u001D\u001E\u001F\u2003\u3000\t ';
    const value: CreateStoryProjectInput = { title: `${boundary}${title}${boundary}`, language: 'sv' };
    const validated = validateCreateStoryInput(value);
    expect(validated).toEqual({ title, language: 'sv' });
    f.request.mockResolvedValueOnce(response(row(validated)));
    await expect(f.create({ input: value })).resolves.toEqual(row(validated));
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual(validated);
  });

  it('rejects121 visible code points after backend-compatible edge whitespace normalization without POST', async () => {
    const f = fixture();
    await expect(f.create({ input: { title: `\u0085${'Å'.repeat(121)}\u001F`, language: 'sv' } }))
      .rejects.toEqual(new CreateStoryInputError('too-long'));
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('snapshots a title getter exactly once so the validated title is the one sent', async () => {
    const f = fixture(); let reads = 0;
    const value: CreateStoryProjectInput = { get title() { return ++reads === 1 ? `  ${input.title}  ` : 'Changed title'; }, language: 'en' };
    await expect(f.create({ input: value })).resolves.toEqual(row());
    expect(reads).toBe(1);
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual(input);
  });

  it('snapshots a language getter exactly once so a later unsupported language cannot reach POST', async () => {
    const f = fixture(); let reads = 0;
    const value = { title: input.title, get language() { return ++reads === 1 ? 'en' : 'de'; } } as CreateStoryProjectInput;
    await expect(f.create({ input: value })).resolves.toEqual(row());
    expect(reads).toBe(1);
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual(input);
  });

  it('rejects the first invalid language snapshot even if a getter would later return English', async () => {
    const f = fixture(); let reads = 0;
    const value = { title: input.title, get language() { return ++reads === 1 ? 'de' : 'en'; } } as CreateStoryProjectInput;
    await expect(f.create({ input: value })).rejects.toEqual(new CreateStoryInputError('language'));
    expect(reads).toBe(1);
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
});

describe('create story using the shared projects transport, mocked only', () => {
  it.each(['', '/', '/api/v1', '/api/v1/'])('POSTs only trimmed title and language, with one prefix and no list query: %s', async suffix => {
    const f = fixture();
    await expect(f.create({ baseUrl: baseUrl + suffix, input: { ...input, title: `  ${input.title}  ` } })).resolves.toEqual(row());
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('accepts a Swedish201 response, strips extra fields and does not invent project data', async () => {
    const f = fixture(); const value = row({ title: 'Min berättelse', language: 'sv' });
    f.request.mockResolvedValueOnce(response({ ...value, user_id: 'private-owner', extra: 'not-used' }));
    await expect(f.create({ input: { title: value.title, language: 'sv' } })).resolves.toEqual(value);
  });
  it.each([null, '', 'invalid token', 'sb_publishable_synthetic_key', 'sb_secret_synthetic_key'])('does not dispatch without a usable token: %s', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.create()).rejects.toMatchObject({ kind: 'authentication', mayHaveCreated: false });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('sanitizes a rejected token lookup and keeps mayHaveCreated false', async () => {
    const f = fixture(); f.getAccessToken.mockRejectedValueOnce(new Error('private-token-detail'));
    await expect(f.create()).rejects.toEqual(new StoryProjectsError('authentication'));
    expect(f.request).not.toHaveBeenCalled();
  });
  it('rejects unsafe configuration before a token or POST', async () => {
    const f = fixture(); await expect(f.create({ baseUrl: 'https://public.example.test' }))
      .rejects.toMatchObject({ kind: 'configuration', mayHaveCreated: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'authentication'], [403, 'forbidden'], [404, 'not-found'], [409, 'conflict'],
    [400, 'validation'], [422, 'validation'], [429, 'unavailable'],
  ] as const)('treats known HTTP%s as a definite rejection without reading body or retrying', async (status, kind) => {
    const f = fixture(); const text = jest.fn(async () => 'private-server-details');
    f.request.mockResolvedValueOnce({ status, ok: false, text } as unknown as Response);
    await expect(f.create()).rejects.toEqual(new StoryProjectsError(kind, status, false));
    expect(f.request).toHaveBeenCalledTimes(1); expect(text).not.toHaveBeenCalled();
  });
  it.each([500, 502, 503, 504])('warns HTTP%s may follow a successful write, without retrying', async status => {
    const f = fixture(); const text = jest.fn(async () => 'private-server-details');
    f.request.mockResolvedValueOnce({ status, ok: false, text } as unknown as Response);
    await expect(f.create()).rejects.toEqual(new StoryProjectsError('unavailable', status, true));
    expect(f.request).toHaveBeenCalledTimes(1); expect(text).not.toHaveBeenCalled();
  });
  it.each([200, 202, 204])('requires201, treating unexpected success%s as an uncertain result', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status, ok: true } as Response);
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveCreated: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    null, [], [row()], {}, row({ title: 'A different title' }), row({ language: 'sv' }), row({ status: 'active' }),
    row({ id: 'invalid-id' }), row({ created_at: '2026-02-30T00:00:00Z' }), row({ description: undefined }),
  ].map(value => [value] as const))('rejects malformed or mismatched201 response %# without pretending no write occurred', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveCreated: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('treats malformed JSON, Content-Type and oversized responses as uncertain', async () => {
    const f = fixture();
    for (const value of [new Response('private-broken-json', { status: 201, headers: { 'Content-Type': 'application/json' } }),
      new Response('{}', { status: 201, headers: { 'Content-Type': 'text/html' } }),
      new Response(' '.repeat(1_048_577), { status: 201, headers: { 'Content-Type': 'application/json' } })]) {
      f.request.mockResolvedValueOnce(value);
      await expect(f.create()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveCreated: true });
    }
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it('treats a network failure after dispatch as uncertain and never retries', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new TypeError(`${token} private-title`));
    await expect(f.create()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('treats body failure after201 as uncertain', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status: 201, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => { throw new Error('private-body'); } } as unknown as Response);
    await expect(f.create()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
  });
  it('cancels before acquiring a token without dispatch or uncertainty', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.create({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mayHaveCreated: false });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['token', 'request', 'body'])('bounds a hanging%s stage and correctly reports write uncertainty', async stage => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 201, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f.create({ timeoutMs: 25 }); const checked = expect(pending).rejects
      .toEqual(new StoryProjectsError('timeout', undefined, stage !== 'token'));
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
  });
  it.each(['token', 'request', 'body'])('cancels a hanging%s stage even when transport ignores abort', async stage => {
    const f = fixture(); const controller = new AbortController();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 201, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f.create({ signal: controller.signal }); const checked = expect(pending).rejects
      .toEqual(new StoryProjectsError('cancelled', undefined, stage !== 'token'));
    await flush(); controller.abort(); await checked;
    expect(f.request).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
  });
  it('never dispatches a late token result after timeout', async () => {
    jest.useFakeTimers(); const f = fixture(); let finish!: (value: string) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.create({ timeoutMs: 25 }); const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveCreated: false });
    await jest.advanceTimersByTimeAsync(25); await checked; finish(token); await flush();
    expect(f.request).not.toHaveBeenCalled();
  });
  it('ignores a late successful response after an uncertain cancellation', async () => {
    const f = fixture(); const controller = new AbortController(); let finish!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.create({ signal: controller.signal }); const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveCreated: true });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => JSON.stringify(row()));
    finish({ status: 201, ok: true, text } as unknown as Response); await flush();
    expect(text).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('does not log tokens, story titles or upstream failure details', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(`${token} ${input.title} private-error`));
      await expect(f.create()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
