import { listMemoryReview, patchMemory, validateMemoryPatchInput, MemoryReviewError,
  type MemoryFact, type MemoryClarification, type MemoryPatchInput, type PatchMemoryOptions, type MemoryReviewOptions } from '../src/api/memory-review';
import { StoryProjectsError } from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000', projectId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001', sourceId = '30000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature', date = '2026-10-22T10:00:00.123456Z';
function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return { id: '50000000-0000-4000-8000-000000000001', project_id: projectId, session_id: sessionId,
    source_message_id: sourceId, fact_type: 'event', value: 'Malmö', evidence: 'Jag flyttade till Malmö 1974.',
    year: 1974, slot: 'move', uncertain: true, status: 'pending', corrected_value: null, version: 1,
    created_at: date, updated_at: date, ...overrides };
}
function question(overrides: Partial<MemoryClarification> = {}): MemoryClarification {
  return { id: '60000000-0000-4000-8000-000000000001', fact_id: fact().id, session_id: sessionId,
    conflicts_with_fact_id: null, question: 'Var det 1974?', status: 'open', resolution: null,
    created_at: date, resolved_at: null, ...overrides };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (url, init) =>
    init?.method === 'PATCH' ? response(fact({ status: 'confirmed', version: 2 }))
      : response(String(url).includes('/clarifications?') ? [] : [fact()]));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, projectId, sessionId, expectedLanguage: 'sv' as const, request, getAccessToken };
  return { request, getAccessToken,
    list: (overrides: Partial<MemoryReviewOptions> = {}) => listMemoryReview({ ...options, ...overrides }),
    patch: (input: MemoryPatchInput = { status: 'confirmed', expected_version: 1 },
      overrides: Partial<PatchMemoryOptions> = {}) => patchMemory({ ...options, memory: fact(), input, ...overrides }) };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
afterEach(() => jest.useRealTimers());

describe('current owned memories and open questions', () => {
  it.each(['en', 'sv'] as const)('reads both resources using only the current user token (%s)', async language => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([fact()])).mockResolvedValueOnce(response([question()]));
    await expect(f.list({ expectedLanguage: language })).resolves.toEqual({ memories: [fact()], clarifications: [question()], complete: true });
    expect(f.request.mock.calls.map(([url]) => url)).toEqual([
      baseUrl + '/api/v1/story-sessions/' + sessionId + '/memories?limit=100&offset=0',
      baseUrl + '/api/v1/story-sessions/' + sessionId + '/clarifications?limit=100&offset=0',
    ]);
    for (const [, init] of f.request.mock.calls) expect(init).toEqual({
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('accepts empty resources without inventing memories', async () => {
    const f = fixture(); f.request.mockImplementation(async () => response([]));
    await expect(f.list()).resolves.toEqual({ memories: [], clarifications: [], complete: true });
  });
  it.each(['', ' '])('preserves the optional backend slot value %j', async slot => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([fact({ slot })]));
    await expect(f.list()).resolves.toMatchObject({ memories: [fact({ slot })], complete: true });
  });
  it('preserves pending, confirmed/corrected and rejected states separately from immutable originals', async () => {
    const rows = [fact(), fact({ id: '50000000-0000-4000-8000-000000000002', status: 'confirmed', corrected_value: '1975', version: 2 }),
      fact({ id: '50000000-0000-4000-8000-000000000003', status: 'rejected', version: 2 })];
    const f = fixture(); f.request.mockResolvedValueOnce(response(rows));
    const result = await f.list(); expect(result.memories).toEqual(rows);
    expect(result.memories[1]).toMatchObject({ value: 'Malmö', year: 1974, corrected_value: '1975' });
  });
  it('allows a conflict reference to another session fact without inventing its contents', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([fact()])).mockResolvedValueOnce(response([
      question({ conflicts_with_fact_id: '70000000-0000-4000-8000-000000000001' }),
    ]));
    await expect(f.list()).resolves.toMatchObject({ complete: true });
  });
  it.each([
    {}, [null], [fact({ project_id: sourceId })], [fact({ session_id: sourceId })], [fact({ source_message_id: 'bad' })],
    [fact({ fact_type: 'imagined' as 'event' })], [fact({ value: '' })], [fact({ evidence: '\u0085' })],
    [fact({ status: 'approved' as 'pending' })], [fact({ corrected_value: '1975' })],
    [fact({ version: 0 })], [fact({ version: 1.5 })], [fact({ year: 2101 })],
    [fact({ created_at: '2026-02-30T12:00:00Z' })], [fact(), fact()],
    [fact({ value: 'x'.repeat(1001) })], [{ ...fact(), private_field: token }],
  ].map(value => [value] as const))('rejects invalid or cross-scope fact response %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it.each([
    question({ session_id: sourceId }), question({ fact_id: sourceId }), question({ question: '' }),
    { ...question(), status: 'resolved' }, { ...question(), resolution: 'confirmed' },
    { ...question(), resolved_at: date }, { ...question(), private_field: token },
  ])('rejects invalid/open-question scope %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([fact()])).mockResolvedValueOnce(response([value]));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('loads subsequent pages and marks a full capped resource incomplete', async () => {
    const f = fixture();
    f.request.mockImplementation(async url => {
      if (String(url).includes('/clarifications?')) return response([]);
      const offset = Number(new URL(String(url)).searchParams.get('offset'));
      return response(Array.from({ length: 100 }, (_, i) => fact({
        id: (offset + i + 1).toString(16).padStart(8, '0') + '-0000-4000-8000-000000000001',
      })));
    });
    const result = await f.list();
    expect(result.memories).toHaveLength(1000); expect(result.complete).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(11);
  });
  it('requires an empty following page to establish a complete exactly-full resource', async () => {
    const f = fixture(); const rows = Array.from({ length: 100 }, (_, i) => fact({
      id: (i + 1).toString(16).padStart(8, '0') + '-0000-4000-8000-000000000001',
    }));
    f.request.mockResolvedValueOnce(response(rows)).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([]));
    await expect(f.list()).resolves.toEqual({ memories: rows, clarifications: [], complete: true });
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it('preserves database ordering with different microseconds inside the same millisecond', async () => {
    const rows = [fact({ id: '50000000-0000-4000-8000-000000000002', created_at: '2026-10-22T10:00:00.123455Z' }),
      fact({ created_at: '2026-10-22T10:00:00.123456Z' })];
    const f = fixture(); f.request.mockResolvedValueOnce(response(rows));
    await expect(f.list()).resolves.toMatchObject({ memories: rows });
  });
  it('rejects decreasing creation time even within one millisecond', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([
      fact({ created_at: '2026-10-22T10:00:00.123457Z' }),
      fact({ id: '50000000-0000-4000-8000-000000000002', created_at: '2026-10-22T10:00:00.123456Z' }),
    ]));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('does not continue pagination after cancellation', async () => {
    const f = fixture(); const controller = new AbortController();
    f.request.mockImplementationOnce(async () => { controller.abort(); return response([]); });
    await expect(f.list({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});

describe('explicit optimistic memory review writes', () => {
  it.each(['confirmed', 'rejected'] as const)('sends only %s/current version to the fixed owned memory endpoint', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(fact({ status, version: 2 })));
    await expect(f.patch({ status, expected_version: 1 })).resolves.toEqual(fact({ status, version: 2 }));
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/memories/' + fact().id, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, expected_version: 1 }), credentials: 'omit', cache: 'no-store',
      redirect: 'error', signal: expect.any(AbortSignal),
    });
  });
  it.each(['  Malmö  ', '\u0085Svenska minnen\u0085', 'English  internal spaces', '1975'])('normalizes only the correction %s', async value => {
    const input = validateMemoryPatchInput({ status: 'confirmed', expected_version: 1, corrected_value: value });
    const f = fixture(); const expected = fact({ status: 'confirmed', corrected_value: input.corrected_value!, version: 2 });
    f.request.mockResolvedValueOnce(response(expected));
    await expect(f.patch({ status: 'confirmed', expected_version: 1, corrected_value: value })).resolves.toEqual(expected);
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual(input);
    expect(expected.year).toBe(1974); expect(expected.evidence).toBe(fact().evidence); expect(expected.value).toBe('Malmö');
  });
  it('accepts 1,000 code points including legitimate Swedish letters', async () => {
    const value = 'å'.repeat(1000);
    expect(validateMemoryPatchInput({ status: 'confirmed', expected_version: 1, corrected_value: value }).corrected_value).toBe(value);
  });
  it('preserves an existing correction when confirming without a new correction', async () => {
    const before = fact({ status: 'confirmed', corrected_value: '1975', version: 2 });
    const f = fixture(); f.request.mockResolvedValueOnce(response(before));
    await expect(f.patch({ status: 'confirmed', expected_version: 2 }, { memory: before })).resolves.toEqual(before);
    expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).not.toHaveProperty('corrected_value');
  });
  it('clears active correction on rejection without rewriting extracted year or evidence', async () => {
    const before = fact({ status: 'confirmed', corrected_value: '1975', version: 2 });
    const after = { ...before, status: 'rejected' as const, corrected_value: null, version: 3 };
    const f = fixture(); f.request.mockResolvedValueOnce(response(after));
    await expect(f.patch({ status: 'rejected', expected_version: 2 }, { memory: before })).resolves.toEqual(after);
  });
  it('accepts an exact committed retry at the next version, with no automatic retry', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('private lost response'));
    await expect(f.patch()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.patch()).resolves.toMatchObject({ status: 'confirmed', version: 2 });
    expect(f.request.mock.calls[0][1]?.body).toBe(f.request.mock.calls[1][1]?.body);
  });
  it.each([
    {}, { status: 'pending', expected_version: 1 }, { status: 'confirmed', expected_version: 0 },
    { status: 'confirmed', expected_version: 1.5 }, { status: 'confirmed', expected_version: 2 },
    { status: 'confirmed', expected_version: 1, corrected_value: null },
    { status: 'rejected', expected_version: 1, corrected_value: 'new' },
    { status: 'confirmed', expected_version: 1, corrected_value: '' },
    { status: 'confirmed', expected_version: 1, corrected_value: ' \t\n' },
    { status: 'confirmed', expected_version: 1, corrected_value: '\u0085' },
    { status: 'confirmed', expected_version: 1, corrected_value: '\u200b\u2060' },
    { status: 'confirmed', expected_version: 1, corrected_value: 'x'.repeat(1001) },
    { status: 'confirmed', expected_version: 1, corrected_value: 'abc\0' },
    { status: 'confirmed', expected_version: 1, value: 'forged original' },
    { status: 'confirmed', expected_version: 1, year: 1975 },
  ])('rejects invalid review input %# before token acquisition or PATCH', async value => {
    const f = fixture(); await expect(f.patch(value as MemoryPatchInput)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    { memory: { ...fact(), project_id: sourceId } }, { memory: { ...fact(), session_id: sourceId } },
    { memory: null }, { sessionId: 'bad' }, { projectId: 'bad' }, { expectedLanguage: 'de' },
  ])('rejects invalid baseline/scope %# before request', async value => {
    const f = fixture(); await expect(f.patch(undefined, value as Partial<PatchMemoryOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    { id: sourceId }, { source_message_id: projectId }, { value: 'Invented' }, { evidence: 'Invented' },
    { year: 1975 }, { fact_type: 'emotion' }, { slot: null }, { uncertain: false }, { created_at: '2026-10-23T10:00:00Z' },
    { status: 'rejected' }, { corrected_value: 'Unexpected' }, { version: 1 }, { version: 3 },
  ])('rejects a response changing immutable or unexpected state %#', async change => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ ...fact({ status: 'confirmed', version: 2 }), ...change }));
    await expect(f.patch()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'MEMORY_NOT_FOUND', 'not-found'], [409, 'CONVERSATION_CHANGED', 'conflict'],
    [422, 'VALIDATION_ERROR', 'validation'], [503, 'SUPABASE_UNAVAILABLE', 'unavailable'],
  ] as const)('handles %s %s without exposing private errors', async (status, code, kind) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token + ' private evidence' } }, status));
    await expect(f.patch()).rejects.toMatchObject({ name: 'MemoryReviewError', kind, status, code, mayHaveWritten: status >= 500 });
  });
  it.each(['__proto__', 'constructor', 'PRIVATE_UNKNOWN'])('drops unknown backend code %s', async code => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token } }, 503));
    const pending = f.patch(); await expect(pending).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(pending.catch((error: MemoryReviewError) => error.code)).resolves.toBeUndefined();
  });
  it.each([201, 202, 204])('does not claim PATCH success for HTTP %s', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status, ok: true } as Response);
    await expect(f.patch()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('rejects non-JSON and invalid JSON success safely', async () => {
    const f = fixture();
    for (const contentType of ['text/html', 'application/json']) {
      f.request.mockResolvedValueOnce(new Response('private ' + token, { headers: { 'Content-Type': contentType } }));
      await expect(f.patch()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    }
  });
  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic'])('never substitutes unusable credentials %s', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.patch()).rejects.toMatchObject({ kind: 'authentication' }); expect(f.request).not.toHaveBeenCalled();
  });
  it('keeps a private/legacy backend origin unconfigured rather than sending a token there', async () => {
    const f = fixture(); await expect(f.patch(undefined, { baseUrl: 'https://example.test' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['token', 'request', 'body'])('bounds a hanging %s and preserves write uncertainty', async stage => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body') f.request.mockResolvedValueOnce({ status: 200, ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}) } as unknown as Response);
    const pending = f.patch(undefined, { timeoutMs: 25 });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: stage !== 'token' });
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked; expect(jest.getTimerCount()).toBe(0);
    if (stage === 'token') expect(f.request).not.toHaveBeenCalled();
  });
  it('ignores a late reply after cancellation without publishing or retrying', async () => {
    const f = fixture(); const controller = new AbortController(); let resolve!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.patch(undefined, { signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => JSON.stringify(fact({ status: 'confirmed', version: 2 })));
    resolve({ status: 200, ok: true, text } as unknown as Response); await flush();
    expect(text).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('never logs originals, corrections, credentials or arbitrary native errors', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(token + fact().evidence));
      await expect(f.patch()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
      logs.forEach(log => expect(log).not.toHaveBeenCalled()); expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
