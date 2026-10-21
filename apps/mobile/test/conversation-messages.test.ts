import {
  ConversationMessagesError, listConversationMessages, processTranscript,
  type ConversationMessage, type ConversationTurn, type ProcessTranscriptOptions,
  type ConversationMessagesOptions, type ConversationMemory, type ConversationClarification,
} from '../src/api/conversation-messages';
import { SIMULATED_TRANSCRIPT_NOTICE, type AudioTranscript } from '../src/api/audio-transcripts';
import { StoryProjectsError } from '../src/api/story-projects';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const baseUrl = 'http://192.168.20.40:8000';
const sessionId = '20000000-0000-4000-8000-000000000001';
const projectId = '10000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const assistantId = '40000000-0000-4000-8000-000000000002';
const key = '30000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature';
const date = '2026-10-21T12:34:56.123456Z';
function transcript(language: 'en' | 'sv' = 'en', overrides: Partial<AudioTranscript> = {}): AudioTranscript {
  return { transcript_id: sourceId, session_id: sessionId, language,
    text: SIMULATED_TRANSCRIPT_NOTICE + (language === 'en' ? 'I moved to Malmö in 1974.' : 'Jag flyttade till Malmö 1974.'),
    status: 'completed', created_at: date, ...overrides };
}
function message(sequence = 1, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id: String(sequence.toString(16)).padStart(8, '0') + '-0000-4000-8000-000000000001',
    session_id: sessionId, sequence, role: sequence % 2 === 0 ? 'assistant' : 'user',
    text: 'Fictional history text.', language: 'en', created_at: date, ...overrides };
}
function memory(): ConversationMemory {
  return { id: '50000000-0000-4000-8000-000000000001', project_id: projectId, session_id: sessionId,
    source_message_id: sourceId, fact_type: 'event', value: 'Malmö', evidence: 'Malmö',
    year: 1974, slot: 'move', uncertain: false, status: 'pending', corrected_value: null, version: 1,
    created_at: date, updated_at: date };
}
function clarification(): ConversationClarification {
  return { id: '60000000-0000-4000-8000-000000000001', fact_id: memory().id, session_id: sessionId,
    conflicts_with_fact_id: null, question: 'Can you confirm this fictional year?', status: 'open',
    resolution: null, created_at: date, resolved_at: null };
}
function turn(language: 'en' | 'sv' = 'en', overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return { user_message: message(1, { id: sourceId, language, text: transcript(language).text }),
    message: message(3, { id: assistantId, role: 'assistant', language, text: language === 'en' ? 'Thank you for sharing that memory.' : 'Tack för att du delade minnet.' }),
    memories: [], clarifications: [], requires_clarification: false, mode: 'mock', ...overrides };
}
function response(data: unknown, status = 201) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, init) =>
    init?.method === 'GET' ? response([], 200) : response(turn()));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, request, getAccessToken, sessionId, expectedLanguage: 'en' as const };
  return { request, getAccessToken,
    process: (overrides: Partial<ProcessTranscriptOptions> = {}) => processTranscript({
      ...options, projectId, sourceTranscript: transcript(), idempotencyKey: key, ...overrides }),
    list: (overrides: Partial<ConversationMessagesOptions> = {}) => listConversationMessages({ ...options, ...overrides }) };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
afterEach(() => { jest.useRealTimers(); });

describe('source-linked conversation API with blocked real network', () => {
  it.each(['en', 'sv'] as const)('sends only the returned source ID and fixed session language %s', async language => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(turn(language)));
    await expect(f.process({ expectedLanguage: language, sourceTranscript: transcript(language) })).resolves.toEqual(turn(language));
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-sessions/' + sessionId + '/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ source_message_id: sourceId, language }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('validates complete pending-memory/open-question metadata without treating it as confirmation', async () => {
    const expected = turn('en', { memories: [memory()], clarifications: [clarification()], requires_clarification: true });
    const f = fixture(); f.request.mockResolvedValueOnce(response(expected));
    await expect(f.process()).resolves.toEqual(expected);
  });

  it('allows a non-adjacent assistant sequence and does not invent a pairing from history', async () => {
    const f = fixture(); const rows = [turn().user_message, message(2), turn().message];
    f.request.mockResolvedValueOnce(response(rows, 200));
    const history = await f.list();
    expect(history).toEqual({ messages: rows, complete: true });
    expect(Object.keys(history)).toEqual(['messages', 'complete']);
    await expect(f.process()).resolves.toEqual(turn());
  });

  it('keeps exactly the same key and source JSON during explicit uncertain retry', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('private lost response'));
    await expect(f.process()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.process()).resolves.toEqual(turn());
    for (const [, init] of f.request.mock.calls) {
      expect(init?.headers).toHaveProperty('Idempotency-Key', key);
      expect(init?.body).toBe(JSON.stringify({ source_message_id: sourceId, language: 'en' }));
    }
  });

  it.each([
    { sessionId: 'bad' }, { projectId: 'bad' }, { expectedLanguage: 'de' }, { idempotencyKey: '' },
    { idempotencyKey: 'bad' }, { sourceTranscript: null }, { sourceTranscript: { ...transcript(), transcript_id: 'bad' } },
    { sourceTranscript: { ...transcript(), session_id: projectId } },
    { sourceTranscript: { ...transcript(), language: 'sv' } },
    { sourceTranscript: { ...transcript(), status: 'processing' } },
    { sourceTranscript: { ...transcript(), text: 'Not a verified simulated original' } },
    { sourceTranscript: { ...transcript(), text: SIMULATED_TRANSCRIPT_NOTICE } },
    { sourceTranscript: { ...transcript(), text: SIMULATED_TRANSCRIPT_NOTICE + '\0' } },
    { sourceTranscript: { ...transcript(), created_at: '2026-02-30T12:00:00Z' } },
    { sourceTranscript: { ...transcript(), extra_private_field: token } },
  ])('rejects invalid input %# before token acquisition or fetch', async overrides => {
    const f = fixture();
    await expect(f.process(overrides as Partial<ProcessTranscriptOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic', 'invalid token'])('rejects unusable credentials %s', async value => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(value);
    await expect(f.process()).rejects.toMatchObject({ kind: 'authentication' }); expect(f.request).not.toHaveBeenCalled();
  });

  it('sanitizes token acquisition failure and never uses a production/DNS origin', async () => {
    const f = fixture(); f.getAccessToken.mockRejectedValueOnce(new Error('private password'));
    await expect(f.process()).rejects.toMatchObject({ kind: 'authentication' }); expect(f.request).not.toHaveBeenCalled();
    f.getAccessToken.mockClear();
    await expect(f.process({ baseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'SOURCE_NOT_FOUND', 'not-found'], [404, 'RESOURCE_NOT_FOUND', 'not-found'],
    [409, 'IDEMPOTENCY_CONFLICT', 'conflict'], [409, 'CONVERSATION_CHANGED', 'conflict'],
    [409, 'CONTEXT_LIMIT', 'conflict'], [409, 'SESSION_COMPLETED', 'conflict'],
    [422, 'LANGUAGE_MISMATCH', 'validation'], [422, 'VALIDATION_ERROR', 'validation'],
    [503, 'CONVERSATION_DISABLED', 'unavailable'], [503, 'CONVERSATION_INVALID_RESPONSE', 'unavailable'],
    [503, 'SUPABASE_UNAVAILABLE', 'unavailable'], [504, 'CONVERSATION_TIMEOUT', 'timeout'],
  ] as const)('handles HTTP %s %s using only allowlisted safe metadata', async (status, code, kind) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token + ' private transcript' } }, status));
    await expect(f.process()).rejects.toMatchObject({ name: 'ConversationMessagesError', status, code, kind,
      mayHaveWritten: status >= 500 && code !== 'CONVERSATION_DISABLED' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it.each(['PRIVATE_UNKNOWN', '__proto__', 'constructor', 'TRANSCRIPTION_DISABLED'])('drops unsupported error code %s', async code => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token } }, 503));
    const pending = f.process();
    await expect(pending).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(pending.catch((error: ConversationMessagesError) => error.code)).resolves.toBeUndefined();
  });

  it.each(['text/html', 'application/json'])('handles malformed error bodies safely (%s)', async contentType => {
    const f = fixture(); f.request.mockResolvedValueOnce(new Response('private ' + token,
      { status: 503, headers: { 'Content-Type': contentType } }));
    await expect(f.process()).rejects.toMatchObject({ kind: 'unavailable', mayHaveWritten: true });
  });

  it.each([
    {}, { ...turn(), mode: 'live' }, { ...turn(), user_message: { ...turn().user_message, id: projectId } },
    { ...turn(), user_message: { ...turn().user_message, text: 'Rewritten original' } },
    { ...turn(), user_message: { ...turn().user_message, role: 'assistant' } },
    { ...turn(), message: { ...turn().message, role: 'user' } },
    { ...turn(), message: { ...turn().message, id: sourceId } },
    { ...turn(), message: { ...turn().message, session_id: projectId } },
    { ...turn(), message: { ...turn().message, language: 'sv' } },
    { ...turn(), message: { ...turn().message, sequence: 1 } },
    { ...turn(), message: { ...turn().message, sequence: 0.5 } },
    { ...turn(), message: { ...turn().message, text: '\u0085' } },
    { ...turn(), message: { ...turn().message, text: '\ud800' } },
    { ...turn(), message: { ...turn().message, created_at: 'invalid' } },
    { ...turn(), memories: null }, { ...turn(), memories: Array.from({ length: 9 }, memory) },
    { ...turn(), memories: [{ ...memory(), project_id: sessionId }] },
    { ...turn(), memories: [{ ...memory(), source_message_id: projectId }] },
    { ...turn(), memories: [{ ...memory(), value: 'Invented personal fact' }] },
    { ...turn(), memories: [{ ...memory(), status: 'confirmed' }] },
    { ...turn(), memories: [{ ...memory(), corrected_value: '1975' }] },
    { ...turn(), memories: [memory(), memory()] }, { ...turn(), clarifications: [clarification()] },
    { ...turn(), memories: [memory()], clarifications: [clarification()], requires_clarification: false },
    { ...turn(), requires_clarification: true }, { ...turn(), extra_private_field: token },
  ])('rejects malformed or source-inconsistent turn %# without false success', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.process()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });

  it.each(['user_message', 'message', 'memories', 'clarifications', 'requires_clarification', 'mode'])('requires turn field %s', async field => {
    const data: Record<string, unknown> = { ...turn() }; delete data[field];
    const f = fixture(); f.request.mockResolvedValueOnce(response(data));
    await expect(f.process()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([200, 202, 204])('rejects wrong successful POST status %s', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status, ok: true } as Response);
    await expect(f.process()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });

  it('rejects non-JSON and malformed success without revealing data', async () => {
    const f = fixture();
    for (const contentType of ['text/html', 'application/json']) {
      f.request.mockResolvedValueOnce(new Response('private ' + token, { headers: { 'Content-Type': contentType }, status: 201 }));
      await expect(f.process()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
    }
  });

  it('does not let a caller mutate the expected source text during an in-flight request', async () => {
    const f = fixture(); const source = transcript();
    const pending = f.process({ sourceTranscript: source });
    source.text = 'Changed after the deliberate action';
    await expect(pending).resolves.toEqual(turn());
  });

  it('uses a 30-second conversation budget and cleans timers', async () => {
    jest.useFakeTimers(); const f = fixture(); f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.process(); const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
    await flush(); await jest.advanceTimersByTimeAsync(29_999);
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1); await checked; expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['token', 'request', 'body', 'error-body'])('times out during %s even when the fake ignores abort', async stage => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body' || stage === 'error-body') f.request.mockResolvedValueOnce({
      status: stage === 'body' ? 201 : 503, ok: stage === 'body',
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}),
    } as unknown as Response);
    const pending = f.process({ timeoutMs: 25 });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: stage !== 'token' });
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    if (stage === 'token') expect(f.request).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not dispatch after a cancelled token request resolves late', async () => {
    const f = fixture(); const controller = new AbortController(); let resolve!: (token: string) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.process({ signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    controller.abort(); await checked; resolve(token); await flush(); expect(f.request).not.toHaveBeenCalled();
  });

  it('does not read a late response after cancellation or automatically retry', async () => {
    const f = fixture(); const controller = new AbortController(); let resolve!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.process({ signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => JSON.stringify(turn()));
    resolve({ status: 201, ok: true, text } as unknown as Response); await flush(); expect(text).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});

describe('bounded ordered history, not a processing-status lookup', () => {
  it('returns empty complete history with a read-only authenticated request', async () => {
    const f = fixture(); await expect(f.list()).resolves.toEqual({ messages: [], complete: true });
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-sessions/' + sessionId + '/messages?limit=100&offset=0', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
  });
  it('loads subsequent pages and preserves server sequence order', async () => {
    const f = fixture(); const first = Array.from({ length: 100 }, (_, i) => message(i + 1));
    const last = [message(101)];
    f.request.mockResolvedValueOnce(response(first, 200)).mockResolvedValueOnce(response(last, 200));
    await expect(f.list()).resolves.toEqual({ messages: [...first, ...last], complete: true });
    expect(f.request.mock.calls[1][0]).toBe(baseUrl + '/api/v1/story-sessions/' + sessionId + '/messages?limit=100&offset=100');
    expect(f.request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('checks an empty following page when the final page was exactly full', async () => {
    const f = fixture(); const first = Array.from({ length: 100 }, (_, i) => message(i + 1));
    f.request.mockResolvedValueOnce(response(first, 200));
    await expect(f.list()).resolves.toEqual({ messages: first, complete: true });
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('bounds history at 1,000 rows and explicitly reports an incomplete result', async () => {
    const f = fixture();
    f.request.mockImplementation(async url => {
      const offset = Number(new URL(String(url)).searchParams.get('offset'));
      return response(Array.from({ length: 100 }, (_, i) => message(offset + i + 1)), 200);
    });
    const result = await f.list();
    expect(result.messages).toHaveLength(1000); expect(result.complete).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(10);
  });
  it.each([
    {}, [null], [message(1), message(1)], [message(2), message(1)], [message(1, { sequence: 0 })],
    [message(1, { sequence: Number.MAX_SAFE_INTEGER + 1 })], [message(1, { language: 'sv' })],
    [message(1, { session_id: projectId })], Array.from({ length: 101 }, (_, i) => message(i + 1)),
    [message(1, { role: 'system' as 'user' })],
  ].map(value => [value] as const))('rejects invalid or unordered history %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value, 200));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });
  it('rejects duplicate IDs or decreasing sequences across page boundaries', async () => {
    const f = fixture(); const first = Array.from({ length: 100 }, (_, i) => message(i + 1));
    f.request.mockResolvedValueOnce(response(first, 200)).mockResolvedValueOnce(response([message(101, { id: first[0].id })], 200));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('does not fetch a later page after cancellation during the first page', async () => {
    const f = fixture(); const controller = new AbortController();
    const first = Array.from({ length: 100 }, (_, i) => message(i + 1));
    f.request.mockImplementationOnce(async () => { controller.abort(); return response(first, 200); });
    await expect(f.list({ signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('reports second-page failure without returning a misleading partial complete result', async () => {
    const f = fixture(); const first = Array.from({ length: 100 }, (_, i) => message(i + 1));
    f.request.mockResolvedValueOnce(response(first, 200)).mockResolvedValueOnce(response({ error: { code: 'SUPABASE_UNAVAILABLE' } }, 503));
    await expect(f.list()).rejects.toMatchObject({ kind: 'unavailable', mayHaveWritten: false });
  });
  it('normalizes an optional API prefix once', async () => {
    const f = fixture(); await f.list({ baseUrl: baseUrl + '/api/v1/' });
    expect(String(f.request.mock.calls[0][0])).not.toContain('/api/v1/api/v1');
  });
  it('never logs tokens, transcripts or raw backend errors', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(token + transcript().text));
      await expect(f.process()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
      logs.forEach(log => expect(log).not.toHaveBeenCalled());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
