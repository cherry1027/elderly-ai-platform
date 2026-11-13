import { fetch as nativeFetch } from 'expo/fetch';
import { digest } from 'expo-crypto';
import { createHash } from 'node:crypto';
import { apiBackoff } from '../src/api/backoff';
import { RealAiError, sendRealMessage, sendRealTextMessage, type RealConversationProgress, type RealScope, type RealTurn } from '../src/real-ai/api';
import { realIds as ids, realMessage, realScope } from './real-ai-fixtures';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
const operationId = ids.draft, original = '  Jag minns Malmö och vår trädgård. 🌷\n';
const reply = 'Vad minns du från trädgården i Malmö? 🌷';
const encoder = new TextEncoder();
const operation = { type: 'operation', operation_id: operationId, project_id: ids.project, session_id: ids.session };
function turn(typed = true, language: 'en' | 'sv' = 'sv'): RealTurn {
  const source = typed ? { source_transcript_id: null, source_text_input_id: operationId } : { source_transcript_id: ids.transcript, source_text_input_id: null };
  return { mode: 'real', user_message: realMessage('user', { ...source, id: typed ? operationId : ids.transcript, language,
    text: original, ...(typed ? { provenance: { mode: 'original', provider: 'user', model: null, version: 1 } as const } : {}) }),
    message: realMessage('assistant', { ...source, language, text: reply }), memories: [] };
}
const completed = (value: RealTurn = turn()) => ({ type: 'completed', result: value });
const frames = (events: unknown[], newline = '\n') => events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join('');
const streamHeaders = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Memy-Operation-Id': operationId };
function response(events: unknown[], options: { fragment?: number; headers?: Record<string, string>; raw?: Uint8Array; newline?: string } = {}) {
  const bytes = options.raw ?? encoder.encode(frames(events, options.newline));
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += options.fragment ?? bytes.length) controller.enqueue(bytes.slice(offset, offset + (options.fragment ?? bytes.length)));
    controller.close();
  } });
  return new Response(stream, { headers: { ...streamHeaders, ...options.headers } });
}
function fixture(value: Response = response([operation, { type: 'reply', text: reply }, { type: 'saving' }, completed()])) {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => value);
  const scope: RealScope = { ...realScope(), language: 'sv', request };
  return { scope, request, value };
}
function errorEvent(code: string, status = 503, recovery: string | null = null, retry_after: string | null = null) {
  return { type: 'error', status, error: { code, message: 'Sanitized service failure.' }, operation_id: operationId, recovery, retry_after };
}
beforeEach(() => { apiBackoff.clear(); apiBackoff.activate('synthetic-owner-A'); jest.mocked(nativeFetch).mockReset(); });
afterEach(() => { jest.useRealTimers(); apiBackoff.clear(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each([1, 3, 17, 5000])('decodes fragmented UTF-8 progress and a strictly verified saved typed turn with chunk size %i', async fragment => {
  const events = [operation, { type: 'reply', text: reply }, { type: 'saving' }, completed()];
  const f = fixture(response(events, { fragment })), progress = jest.fn();
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).resolves.toEqual(turn());
  expect(progress.mock.calls.map(([event]) => event)).toEqual(events.slice(0, 3));
  expect(f.request).toHaveBeenCalledTimes(1); expect(f.value.body!.locked).toBe(false);
  expect(f.request.mock.calls[0][1]).toMatchObject({ headers: { Accept: 'text/event-stream', 'Idempotency-Key': ids.key }, redirect: 'error', credentials: 'omit', cache: 'no-store' });
});
it('accepts CRLF framing and a voice turn without changing transcript provenance', async () => {
  const f = fixture(response([operation, { type: 'reply', text: reply }, completed(turn(false))], { newline: '\r\n', fragment: 1 }));
  await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key, jest.fn())).resolves.toMatchObject({ user_message: { source_transcript_id: ids.transcript }, message: { text: reply } });
  expect(f.request).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('delivers the saved %s reply before one verified automatic speech payload', async language => {
  const voice = turn(false, language);
  const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
  const hash = createHash('sha256').update(wav).digest();
  jest.mocked(digest).mockResolvedValueOnce(Uint8Array.from(hash).buffer);
  const metadata = { speech_id: ids.memory, assistant_message_id: ids.assistant, language, media_type: 'audio/wav',
    audio_sha256: hash.toString('hex'), audio_size: wav.length, expires_at: new Date(Date.now() + 60_000).toISOString(), status: 'ready' };
  const f = fixture(response([operation, { type: 'saving' }, { type: 'saved', result: voice },
    { type: 'speech', metadata, audio: wav.toString('base64') }], { fragment: 37 }));
  const order: string[] = [];
  await expect(sendRealMessage({ ...f.scope, language }, { source_transcript_id: ids.transcript }, ids.key, jest.fn(), {
    onSaved: value => { expect(value).toEqual(voice); order.push('saved'); },
    onSpeech: (value, bytes) => { expect(value).toEqual(metadata); expect(Buffer.from(bytes)).toEqual(wav); order.push('audio'); },
  })).resolves.toEqual(voice);
  expect(order).toEqual(['saved', 'audio']);
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0][0]).toMatch(/\/messages\?autoplay=true$/);
});

it.each(['truncated', 'bad-hash', 'claimed-timeout', 'wrong-claim'] as const)('keeps the saved reply when audio is %s and never reports the conversation ID as speech', async problem => {
  const voice = turn(false), speech = jest.fn(), saved = jest.fn();
  const events: unknown[] = [operation, { type: 'saving' }, { type: 'saved', result: voice }];
  if (problem === 'bad-hash') {
    const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
    jest.mocked(digest).mockResolvedValueOnce(new Uint8Array(32).buffer);
    events.push({ type: 'speech', audio: wav.toString('base64'), metadata: { speech_id: ids.memory, assistant_message_id: ids.assistant,
      language: 'sv', media_type: 'audio/wav', audio_sha256: 'a'.repeat(64), audio_size: wav.length,
      expires_at: new Date(Date.now() + 60_000).toISOString(), status: 'ready' } });
  }
  if (problem === 'claimed-timeout' || problem === 'wrong-claim') events.push({
    ...errorEvent('AI_PROVIDER_TIMEOUT', 504, 'check-saved'), type: 'speech-error', operation_id: problem === 'claimed-timeout' ? ids.memory : operationId,
  });
  const f = fixture(response(events));
  await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key, jest.fn(), { onSaved: saved, onSpeech: speech }))
    .rejects.toMatchObject({ mayHaveWritten: true, recovery: 'check-saved', operationId: problem === 'claimed-timeout' ? ids.memory : undefined });
  expect(saved).toHaveBeenCalledWith(voice); expect(speech).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
});
it.each([[operation, completed()], [operation, { type: 'saving' }, completed()]].map(events => ({ events })))('allows a verified final without an early preview %#', async ({ events }) => {
  const f = fixture(response(events)); await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).resolves.toEqual(turn());
});
it('shows the reply progress before the saved promise resolves, with no extra request', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, shown!: () => void;
  const previewShown = new Promise<void>(resolve => { shown = resolve; });
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const f = fixture(new Response(stream, { headers: streamHeaders })); let saved = false;
  const progress = jest.fn((event: RealConversationProgress) => { if (event.type === 'reply') shown(); });
  const pending = sendRealTextMessage(f.scope, original, ids.key, progress).then(result => { saved = true; return result; });
  controller.enqueue(encoder.encode(frames([operation, { type: 'reply', text: reply }]))); await previewShown;
  expect(saved).toBe(false); expect(f.request).toHaveBeenCalledTimes(1);
  controller.enqueue(encoder.encode(frames([{ type: 'saving' }, completed()]))); controller.close();
  await expect(pending).resolves.toEqual(turn()); expect(f.value.body!.locked).toBe(false);
});
it('uses expo streaming fetch by default while retaining the injected token and fixed URL', async () => {
  jest.mocked(nativeFetch).mockResolvedValueOnce(response([operation, completed()]) as never);
  const scope = { ...realScope(), language: 'sv' as const };
  await expect(sendRealTextMessage(scope, original, ids.key, jest.fn())).resolves.toEqual(turn());
  expect(nativeFetch).toHaveBeenCalledTimes(1);
});
it('accepts an older backend JSON response in the same POST, without resending or invented progress', async () => {
  const f = fixture(new Response(JSON.stringify(turn()), { headers: { 'Content-Type': 'application/json' } })), progress = jest.fn();
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).resolves.toEqual(turn());
  expect(progress).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
});
it('keeps three-argument calls on the existing JSON contract', async () => {
  const f = fixture(new Response(JSON.stringify(turn()), { headers: { 'Content-Type': 'application/json' } }));
  await expect(sendRealTextMessage(f.scope, original, ids.key)).resolves.toEqual(turn());
  expect(f.request.mock.calls[0][1]!.headers).toMatchObject({ Accept: 'application/json' }); expect(nativeFetch).not.toHaveBeenCalled();
});
it.each([
  [{ ...operation, operation_id: ids.memory }, streamHeaders],
  [{ ...operation, project_id: ids.memory }, streamHeaders],
  [{ ...operation, session_id: ids.memory }, streamHeaders],
  [operation, { ...streamHeaders, 'X-Memy-Operation-Id': 'invalid' }],
  [operation, { ...streamHeaders, 'Cache-Control': 'public' }],
])('rejects an unverified operation scope/header or cache policy before progress %#', async (first, headers) => {
  const f = fixture(response([first, completed()], { headers })), progress = jest.fn();
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  expect(progress).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it.each([
  [], [operation], [{ type: 'reply', text: reply }, operation, completed()],
  [operation, operation, completed()], [operation, { type: 'saving' }, { type: 'reply', text: reply }, completed()],
  [operation, { type: 'reply', text: reply }, { type: 'reply', text: reply }, completed()],
  [operation, { type: 'saving' }, { type: 'saving' }, completed()],
  [operation, { type: 'unknown' }, completed()],
  [operation, { type: 'reply', text: 'Why? Where?' }, completed()],
  [operation, { type: 'reply', text: reply, extra: 'untrusted' }, completed()],
  [operation, { type: 'reply', text: reply }, completed(turn(true, 'en'))],
  [operation, { type: 'reply', text: reply }, completed({ ...turn(), message: { ...turn().message, text: 'Different final reply.' } })],
  [operation, completed({ ...turn(), user_message: { ...turn().user_message, text: 'Overwritten original.' } })],
  [operation, completed({ ...turn(), user_message: { ...turn().user_message, id: ids.memory, source_text_input_id: ids.memory }, message: { ...turn().message, source_text_input_id: ids.memory } })],
].map(events => ({ events })))('retains uncertainty and the original operation ID for malformed/order/EOF/final-scope failures %#', async ({ events }) => {
  const f = fixture(response(events));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true, operationId });
  expect(f.request).toHaveBeenCalledTimes(1); expect(f.value.body!.locked).toBe(false);
});
it.each([
  encoder.encode(frames([operation]) + 'data: {"type":"completed"}'),
  new Uint8Array([...encoder.encode(frames([operation])), 0xff, 0xfe]),
  encoder.encode(frames([operation]) + 'event: reply\ndata: {}\n\n'),
  encoder.encode(frames([operation]) + 'data: ' + 'x'.repeat(1_000_001) + '\n\n'),
  new Uint8Array(2_000_001),
])('bounds and validates framing, UTF-8, individual events and total byte count %#', async raw => {
  const f = fixture(response([], { raw }));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true, operationId });
  expect(f.request).toHaveBeenCalledTimes(1);
});
it.each([
  ['AI_USER_BUDGET_EXHAUSTED', 429, 'contact-operator', 'unavailable'],
  ['AI_PROVIDER_UNAVAILABLE', 503, 'check-saved', 'unavailable'],
  ['AI_PROVIDER_TIMEOUT', 504, 'check-saved', 'timeout'],
  ['INVALID_ACCESS_TOKEN', 401, 'sign-in', 'authentication'],
] as const)('preserves sanitized SSE recovery for %s and never retries', async (code, status, recovery, kind) => {
  const f = fixture(response([operation, errorEvent(code, status, recovery, '60')]));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ kind, code, recovery, operationId, mayHaveWritten: true, retry: undefined });
  expect(f.request).toHaveBeenCalledTimes(1); expect(apiBackoff.getAdvice(f.scope.baseUrl)).toBeUndefined();
});
it('records only validated wait advice without resubmitting a claimed action', async () => {
  const f = fixture(response([operation, errorEvent('AI_BUSY', 429, 'wait', '45')]));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ code: 'AI_BUSY', recovery: 'wait', retry: { retryAfterSeconds: 45 }, mayHaveWritten: true });
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ retry: { retryAfterSeconds: 45 }, mayHaveWritten: false });
  expect(f.request).toHaveBeenCalledTimes(1);
});
it('sanitizes unknown error codes/messages and rejects mismatched claimed error operations', async () => {
  const unknown = errorEvent('PRIVATE_UNKNOWN', 503, null); unknown.error.message = 'PRIVATE PROVIDER TEXT';
  const f = fixture(response([operation, unknown]));
  const error = await sendRealTextMessage(f.scope, original, ids.key, jest.fn()).catch(error => error as RealAiError);
  expect(error).toMatchObject({ kind: 'unavailable', mayHaveWritten: true, operationId, code: undefined });
  expect(String(error)).not.toContain('PRIVATE');
  f.request.mockResolvedValueOnce(response([operation, { ...errorEvent('REAL_AI_UNCERTAIN'), operation_id: ids.memory }]));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true, operationId });
});
it('preserves a pre-stream HTTP gate rejection without inventing a claimed operation', async () => {
  const f = fixture(new Response(JSON.stringify({ error: { code: 'LIVE_AI_DISABLED', message: 'Private' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Memy-Recovery': 'contact-operator' } }));
  await expect(sendRealTextMessage(f.scope, original, ids.key, jest.fn())).rejects.toMatchObject({ code: 'LIVE_AI_DISABLED', mayHaveWritten: false, recovery: 'contact-operator' });
  expect(f.request).toHaveBeenCalledTimes(1);
});
it('callback failures cannot resend, accept a final turn or expose private callback errors', async () => {
  const f = fixture();
  const error = await sendRealTextMessage(f.scope, original, ids.key, () => { throw new Error('PRIVATE CALLBACK'); }).catch(error => error as RealAiError);
  expect(error).toMatchObject({ kind: 'invalid-response', mayHaveWritten: true, operationId });
  expect(String(error)).not.toContain('PRIVATE'); expect(f.request).toHaveBeenCalledTimes(1);
});
it.each(['cancelled', 'timeout'] as const)('cancels and joins an open reader on %s while preserving the claimed operation', async kind => {
  let shown!: () => void; const admitted = new Promise<void>(resolve => { shown = resolve; });
  const cancel = jest.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(frames([operation]))); }, cancel });
  const f = fixture(new Response(body, { headers: streamHeaders })), abort = new AbortController();
  const reader = f.value.body!.getReader(), cancelReader = jest.spyOn(reader, 'cancel');
  jest.spyOn(f.value.body!, 'getReader').mockReturnValue(reader as never);
  const pending = sendRealTextMessage({ ...f.scope, signal: abort.signal, ...(kind === 'timeout' ? { timeoutMs: 25 } : {}) }, original, ids.key, () => shown());
  await admitted; const rejected = expect(pending).rejects.toMatchObject({ kind, operationId, mayHaveWritten: true });
  if (kind === 'cancelled') abort.abort();
  await rejected;
  expect(cancelReader).toHaveBeenCalledTimes(1); expect(f.value.body!.locked).toBe(false); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it('rejects late progress when the authenticated request epoch changes', async () => {
  const f = fixture(), progress = jest.fn(() => apiBackoff.activate('synthetic-owner-B'));
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).rejects.toMatchObject({ kind: 'cancelled', operationId, mayHaveWritten: true });
  expect(progress).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
});


it('a reader failure after verified progress stays uncertain and never retries the original key', async () => {
  let count = 0;
  const releaseLock = jest.fn(), cancel = jest.fn(async () => {});
  const value = { ok: true, status: 200, headers: new Headers(streamHeaders), body: { getReader: () => ({
    read: async () => { if (++count === 1) return { done: false, value: encoder.encode(frames([operation, { type: 'reply', text: reply }])) }; throw new Error('PRIVATE STREAM FAILURE'); },
    cancel, releaseLock,
  }) } } as unknown as Response;
  const f = fixture(value), progress = jest.fn();
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).rejects.toMatchObject({ kind: 'invalid-response', operationId, mayHaveWritten: true });
  expect(progress).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
});
it('progress cannot mutate the original scope into accepting another project or session', async () => {
  const f = fixture();
  const progress = jest.fn(() => { f.scope.projectId = ids.memory; f.scope.sessionId = ids.key; });
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).resolves.toEqual(turn());
  expect(f.request.mock.calls[0][0]).toContain(`/story-sessions/${ids.session}/text-messages`);
  expect(f.request).toHaveBeenCalledTimes(1);
});

it.each(['cancelled', 'timeout'] as const)('bounds a never-resolving native cancellation on %s, releases and joins without late progress or resubmission', async kind => {
  let shown!: () => void, failRead!: (error: Error) => void;
  const admitted = new Promise<void>(resolve => { shown = resolve; });
  let reads = 0, released = false;
  const cancel = jest.fn(() => new Promise<void>(() => {}));
  const releaseLock = jest.fn(() => { released = true; failRead?.(new Error('Reader released')); });
  const read = jest.fn(() => ++reads === 1 ? Promise.resolve({ done: false as const, value: encoder.encode(frames([operation])) })
    : new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => { failRead = reject; }));
  const f = fixture({ ok: true, status: 200, headers: new Headers(streamHeaders), body: { getReader: () => ({ read, cancel, releaseLock }) } } as unknown as Response);
  const abort = new AbortController(), progress = jest.fn(() => shown());
  const pending = sendRealTextMessage({ ...f.scope, signal: abort.signal, timeoutMs: kind === 'timeout' ? 30 : 5000 }, original, ids.key, progress);
  await admitted; const since = Date.now();
  const rejected = expect(pending).rejects.toMatchObject({ kind, mayHaveWritten: true, operationId });
  if (kind === 'cancelled') abort.abort();
  await rejected;
  expect(Date.now() - since).toBeLessThan(2000); expect(released).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0][1]!.signal!.aborted).toBe(true);
  // Any eventual native settlement cannot re-enter the already joined parser.
  failRead?.(new Error('Late native failure'));
  await Promise.resolve(); expect(progress).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
});


it.each(['completed', 'error'] as const)('finishes at a verified %s event without waiting for the server to close', async kind => {
  const cancel = jest.fn();
  const last = kind === 'completed' ? completed() : errorEvent('AI_PROVIDER_UNAVAILABLE', 503, 'check-saved');
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(frames([operation, last]))); }, cancel });
  const f = fixture(new Response(body, { headers: streamHeaders }));
  const pending = sendRealTextMessage({ ...f.scope, timeoutMs: 500 }, original, ids.key, jest.fn());
  if (kind === 'completed') await expect(pending).resolves.toEqual(turn());
  else await expect(pending).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', recovery: 'check-saved', operationId, mayHaveWritten: true });
  expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); expect(f.request).toHaveBeenCalledTimes(1);
});
it('ignores same-chunk trailing frames after an authoritative validated completion', async () => {
  const raw = encoder.encode(frames([operation, { type: 'reply', text: reply }, completed(), { type: 'reply', text: 'Never displayed' }]) + 'data: NOT JSON\n\n');
  const f = fixture(response([], { raw })), progress = jest.fn();
  await expect(sendRealTextMessage(f.scope, original, ids.key, progress)).resolves.toEqual(turn());
  expect(progress.mock.calls.map(([event]) => event)).toEqual([operation, { type: 'reply', text: reply }]);
  expect(f.request).toHaveBeenCalledTimes(1);
});


it.each(['completed', 'error'] as const)('ignores invalid UTF-8 bytes in the same chunk after a validated %s terminal', async kind => {
  const terminal = kind === 'completed' ? completed() : errorEvent('AI_PROVIDER_UNAVAILABLE', 503, 'check-saved');
  const prefix = encoder.encode(frames([operation, terminal])), raw = new Uint8Array(prefix.byteLength + 2);
  raw.set(prefix); raw.set([0xff, 0xfe], prefix.byteLength);
  const f = fixture(response([], { raw }));
  const pending = sendRealTextMessage(f.scope, original, ids.key, jest.fn());
  if (kind === 'completed') await expect(pending).resolves.toEqual(turn());
  else await expect(pending).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', operationId, mayHaveWritten: true });
  expect(f.request).toHaveBeenCalledTimes(1);
});


it.each(['completed', 'error'] as const)('does not turn a known %s terminal into a deadline failure during bounded native cleanup', async kind => {
  let reads = 0;
  const cancel = jest.fn(() => new Promise<void>(() => {})), releaseLock = jest.fn();
  const last = kind === 'completed' ? completed() : errorEvent('AI_USER_BUDGET_EXHAUSTED', 429, 'contact-operator');
  const reader = { read: jest.fn(async () => ++reads === 1 ? { done: false, value: encoder.encode(frames([operation, last])) } : { done: true, value: undefined }), cancel, releaseLock };
  const f = fixture({ ok: true, status: 200, headers: new Headers(streamHeaders), body: { getReader: () => reader } } as unknown as Response);
  const result = sendRealTextMessage({ ...f.scope, timeoutMs: 25 }, original, ids.key, jest.fn());
  if (kind === 'completed') await expect(result).resolves.toEqual(turn());
  else await expect(result).rejects.toMatchObject({ code: 'AI_USER_BUDGET_EXHAUSTED', recovery: 'contact-operator', status: 429, operationId, mayHaveWritten: true });
  expect(reader.read).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
});
it('checks the current account again after terminal cleanup before returning any saved private result', async () => {
  let cleanupStarted!: () => void;
  const cleaning = new Promise<void>(resolve => { cleanupStarted = resolve; });
  const reader = { read: jest.fn(async () => ({ done: false, value: encoder.encode(frames([operation, completed()])) })),
    cancel: jest.fn(() => { cleanupStarted(); return new Promise<void>(() => {}); }), releaseLock: jest.fn() };
  const f = fixture({ ok: true, status: 200, headers: new Headers(streamHeaders), body: { getReader: () => reader } } as unknown as Response), progress = jest.fn();
  const pending = sendRealTextMessage(f.scope, original, ids.key, progress);
  await cleaning; apiBackoff.activate('synthetic-replacement-owner');
  await expect(pending).rejects.toMatchObject({ kind: 'cancelled', operationId, mayHaveWritten: true });
  expect(progress).toHaveBeenCalledTimes(1); expect(reader.read).toHaveBeenCalledTimes(1); expect(reader.releaseLock).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
});
