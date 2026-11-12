import { apiBackoff } from '../src/api/backoff';
import { digest } from 'expo-crypto';
import { listSessionTranscripts, SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import { createRealSpeech, decodeCapabilities, decodeDraft, decodeMemory, decodeMessage, decodeTranscript, editRealDraft,
  exportRealDraft, findRealOperation, generateRealDraft, getRealCapabilities, getRealDrafts, getRealMemories, getRealMessages, getRealOperation,
  getRealSpeechAudio, getPreparedRealSpeech, getRealTranscripts, reviewRealMemory, saveRealMemoryFromMessage, sendRealMessage, transcribeRealRecording } from '../src/real-ai/api';
import { realDate, realDraft, realIds as ids, realMemory, realMessage, realScope, realTranscript } from './real-ai-fixtures';
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

const response = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const capabilities = { contract: 'real-v2', mode: 'real', enabled: false, transcription: false, conversation: false, writing: false, speech: false, reason: 'LIVE_AI_DISABLED' };
function fixture(value: unknown = []) {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response(value));
  return { request, scope: { ...realScope(), request } };
}
beforeEach(() => apiBackoff.clear());
describe('real-v2 strict contracts with synthetic HTTP, no paid or hosted requests', () => {
  it('reports disabled capabilities honestly and requests only the fixed v2 resource', async () => {
    const f = fixture(capabilities);
    await expect(getRealCapabilities(f.scope)).resolves.toEqual(capabilities);
    expect(f.request).toHaveBeenCalledWith(f.scope.baseUrl + '/api/v2/capabilities', expect.objectContaining({ method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store' }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([{ ...capabilities, mode: 'mock' }, { ...capabilities, contract: 'v1' }, { ...capabilities, transcription: true },
    { ...capabilities, secret: 'forbidden' }])('rejects incompatible or internally contradictory capabilities %#', value => {
    expect(() => decodeCapabilities(value)).toThrow();
  });
  it.each(['en', 'sv'] as const)('accepts original %s text only with owned session/project and real provenance', language => {
    const value = realTranscript({ language, text: language === 'sv' ? 'Syntetisk svensk kontraktstext.' : 'Synthetic English contract text.' });
    expect(decodeTranscript(value, { ...realScope(), language })).toEqual(value);
  });
  it.each([
    { project_id: '10000000-0000-4000-8000-000000000002' }, { session_id: '20000000-0000-4000-8000-000000000002' },
    { language: 'sv' }, { text: SIMULATED_TRANSCRIPT_NOTICE + 'Fixture' }, { provenance: { mode: 'mock' } }, { status: 'pending' },
  ])('rejects wrong ownership/language and simulated provenance %#', changes => {
    expect(() => decodeTranscript({ ...realTranscript(), ...changes }, realScope())).toThrow();
  });
  it('keeps strict v1 mock parsing unchanged; real payload never masquerades as a mock transcript', async () => {
    const f = fixture([realTranscript()]);
    await expect(listSessionTranscripts({ ...f.scope, expectedLanguage: 'en' })).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(f.request.mock.calls[0][0]).toContain('/api/v1/');
  });
  it('sends only a saved transcript reference and explicit key; validates pending memory evidence linkage', async () => {
    const f = fixture({ user_message: realMessage(), message: realMessage('assistant'), memories: [realMemory()], mode: 'real' });
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).resolves.toMatchObject({ mode: 'real' });
    const [url, init] = f.request.mock.calls[0];
    expect(url).toBe(`${f.scope.baseUrl}/api/v2/story-sessions/${ids.session}/messages`);
    expect(JSON.parse(init!.body as string)).toEqual({ source_transcript_id: ids.transcript, language: 'en' });
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer synthetic.access-token.signature', 'Idempotency-Key': ids.key });
  });
  it.each([
    { memories: [realMemory({ status: 'confirmed' })] },
    { memories: [realMemory({ source_message_id: ids.assistant })] },
    { message: realMessage('assistant', { sequence: 4 }) },
    { message: realMessage('assistant', { project_id: ids.memory }) },
    { mode: 'mock' }, { clarifications: [] },
  ])('never accepts auto-confirmation, cross-user turns or extra result envelopes %#', async changes => {
    const f = fixture({ user_message: realMessage(), message: realMessage('assistant'), memories: [realMemory()], mode: 'real', ...changes });
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('saves only a literal excerpt of an owned user message as a confirmed memory', async () => {
    const message = realMessage(), excerpt = message.text.slice(0, 9);
    const saved = realMemory({ value: excerpt, evidence: excerpt, status: 'confirmed', uncertain: false, clarification_question: null });
    const f = fixture(saved);
    await expect(saveRealMemoryFromMessage(f.scope, message, excerpt)).resolves.toEqual(saved);
    const [url, init] = f.request.mock.calls[0];
    expect(url).toBe(f.scope.baseUrl + '/api/v2/story-sessions/' + ids.session + '/memories/from-message');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ source_message_id: message.id, excerpt });
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });
  it.each([
    [realMessage('assistant'), 'Synthetic'],
    [realMessage('user', { session_id: ids.project }), 'Synthetic'],
    [realMessage('user', { text: '🙂'.repeat(1001) }), '🙂'.repeat(1001)],
    [realMessage(), 'Not part of the original.'],
  ] as const)('refuses unauthorized or out-of-bounds excerpts before HTTP %#', (message, excerpt) => {
    const f = fixture();
    expect(() => saveRealMemoryFromMessage(f.scope, message, excerpt)).toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each([{ status: 'pending' }, { evidence: 'Changed original evidence' }, { source_message_id: ids.assistant }])
  ('rejects a response that changes the excerpt, ownership or confirmation %#', async changes => {
    const message = realMessage();
    const saved = realMemory({ value: message.text, evidence: message.text, status: 'confirmed', uncertain: false, clarification_question: null });
    const f = fixture({ ...saved, ...changes });
    await expect(saveRealMemoryFromMessage(f.scope, message, message.text))
      .rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('keeps source values/evidence immutable during an explicit versioned correction', async () => {
    const f = fixture(realMemory({ status: 'confirmed', corrected_value: 'A correction', version: 2 }));
    await expect(reviewRealMemory(f.scope, realMemory(), 'confirmed', 'A correction')).resolves.toMatchObject({ version: 2, corrected_value: 'A correction' });
    expect(JSON.parse(f.request.mock.calls[0][1]!.body as string)).toEqual({ expected_version: 1, status: 'confirmed', corrected_value: 'A correction' });
    f.request.mockResolvedValueOnce(response(realMemory({ status: 'confirmed', version: 2, evidence: 'Changed original evidence' })));
    await expect(reviewRealMemory(f.scope, realMemory(), 'confirmed')).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('requires model review, preserves generated prose independent of source sentence concatenation', () => {
    expect(decodeDraft(realDraft(), realScope()).verification.status).toBe('needs_review');
    expect(() => decodeDraft({ ...realDraft(), verification: { ...realDraft().verification, status: 'passed' } }, realScope())).toThrow();
    expect(() => decodeDraft({ ...realDraft(), mode: 'mock' }, realScope())).toThrow();
  });
  it('creates a new version only after an explicit generation request with a stable key', async () => {
    const f = fixture(realDraft()); await generateRealDraft(f.scope, ids.key);
    expect(JSON.parse(f.request.mock.calls[0][1]!.body as string)).toEqual({ language: 'en', style: 'warm', confirm_generation: true });
    expect(f.request.mock.calls[0][1]!.headers).toHaveProperty('Idempotency-Key', ids.key);
  });
  it('saves edits with optimistic revision and refuses overwritten originals or source snapshots', async () => {
    const baseline = realDraft(), after = realDraft({ revision: 2, status: 'edited', content: 'An explicit edit.',
      verification: { ...baseline.verification, method: 'manual_unverified', checked_revision: 2 } });
    const f = fixture(after); await expect(editRealDraft(f.scope, baseline, after.content)).resolves.toEqual(after);
    expect(JSON.parse(f.request.mock.calls[0][1]!.body as string)).toEqual({ expected_revision: 1, content: after.content });
    f.request.mockResolvedValueOnce(response({ ...after, original_content: 'Overwritten' }));
    await expect(editRealDraft(f.scope, baseline, after.content)).rejects.toMatchObject({ mayHaveWritten: true });
  });
  it('does not interpret server availability or missing funding as a fabricated success', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code: 'LIVE_AI_DISABLED', message: 'private provider content' } }, 503));
    await expect(generateRealDraft(f.scope, ids.key)).rejects.toMatchObject({ kind: 'unavailable', code: 'LIVE_AI_DISABLED', mayHaveWritten: false });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('marks an interrupted dispatched paid action uncertain and never automatically retries', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('private token / path / payload'));
    await expect(generateRealDraft(f.scope, ids.key)).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('retains a validated server operation ID separately from the client action key after a claimed failure', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code: 'REAL_AI_UNCERTAIN' } }, 503, { 'X-Memy-Operation-Id': ids.memory }));
    await expect(generateRealDraft(f.scope, ids.key)).rejects.toMatchObject({ operationId: ids.memory, mayHaveWritten: true });
    expect(f.request.mock.calls[0][1]!.headers).toHaveProperty('Idempotency-Key', ids.key);
  });
  it('looks up lost-response actions by kind/key without treating the idempotency key as a server ID', async () => {
    const f = fixture({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session, kind: 'conversation', status: 'uncertain',
      created_at: realDate, updated_at: realDate, error_code: null, result: null });
    await expect(findRealOperation(f.scope, 'conversation', ids.key)).resolves.toMatchObject({ operation_id: ids.memory });
    expect(f.request.mock.calls[0][0]).toBe(`${f.scope.baseUrl}/api/v2/operations/by-key/conversation/${ids.key}`);
  });
  it('preserves only validated owned speech metadata from a completed operation for read-only replay', async () => {
    const metadata = { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en', media_type: 'audio/wav',
      audio_sha256: '0'.repeat(64), audio_size: 64, expires_at: '2020-10-29T12:00:00Z', status: 'ready' };
    const f = fixture({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session, kind: 'speech', status: 'completed',
      created_at: realDate, updated_at: realDate, error_code: null, result: metadata });
    await expect(getRealOperation(f.scope, ids.memory)).resolves.toMatchObject({ result: metadata });
    f.request.mockResolvedValueOnce(response({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session, kind: 'speech', status: 'completed',
      created_at: realDate, updated_at: realDate, error_code: null, result: { ...metadata, language: 'sv' } }));
    await expect(getRealOperation(f.scope, ids.memory)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it.each(['AI_RATE_LIMIT', 'AI_BUSY', 'AUDIO_BUSY'])('preserves %s and honors its shared admission cooldown without retrying', async code => {
    apiBackoff.activate('synthetic-owner'); const f = fixture();
    f.request.mockResolvedValueOnce(response({ error: { code } }, 429, { 'Retry-After': '120' }));
    await expect(generateRealDraft(f.scope, ids.key)).rejects.toMatchObject({ code, retry: { code: 'RATE_LIMITED', retryAfterSeconds: 120 }, mayHaveWritten: code === 'AI_RATE_LIMIT' });
    await expect(generateRealDraft(f.scope, ids.key)).rejects.toMatchObject({ retry: { retryAfterSeconds: 120 } }); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('verifies owned WAV content against the saved hash before returning bytes to native playback', async () => {
    const wave = new Uint8Array(64); wave.set(new TextEncoder().encode('RIFF')); wave.set(new TextEncoder().encode('WAVE'), 8);
    const metadata = { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en' as const, media_type: 'audio/wav' as const,
      audio_sha256: '0'.repeat(64), audio_size: 64, expires_at: '2099-10-29T12:00:00Z', status: 'ready' as const };
    const f = fixture(); f.request.mockResolvedValueOnce(new Response(wave, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store' } }));
    jest.mocked(digest).mockResolvedValueOnce(new Uint8Array(32).buffer);
    await expect(getRealSpeechAudio(f.scope, metadata)).resolves.toEqual(wave);
    expect(digest).toHaveBeenCalledWith('SHA-256', expect.any(ArrayBuffer));
    f.request.mockResolvedValueOnce(new Response(wave, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store' } }));
    jest.mocked(digest).mockResolvedValueOnce(new Uint8Array(32).fill(1).buffer);
    await expect(getRealSpeechAudio(f.scope, metadata)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('keeps additional saved pages reachable through validated offsets', async () => {
    const f = fixture([realMessage('assistant')]); await getRealMessages(f.scope, 100);
    expect(f.request.mock.calls[0][0]).toContain('/messages?limit=100&offset=100');
    expect(() => getRealMessages(f.scope, -1)).toThrow(); expect(() => getRealMessages(f.scope, 1.5)).toThrow();
  });
  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic', 'token with whitespace'])('rejects absent or key-like Bearer credentials %#', async token => {
    const f = fixture(); f.scope.getAccessToken = async () => token;
    await expect(getRealTranscripts(f.scope)).rejects.toMatchObject({ kind: 'authentication' }); expect(f.request).not.toHaveBeenCalled();
  });
  it('fences a token resolver after cancellation before dispatch', async () => {
    const f = fixture(); const controller = new AbortController(); let resolve!: (value: string) => void;
    f.scope.getAccessToken = () => new Promise(yes => { resolve = yes; });
    const result = getRealMessages({ ...f.scope, signal: controller.signal }); controller.abort(); resolve('synthetic.token');
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' }); expect(f.request).not.toHaveBeenCalled();
  });
  it('validates safe operation status then reloads owned resources instead of trusting result payload', async () => {
    const f = fixture({ operation_id: ids.key, project_id: ids.project, session_id: ids.session, kind: 'transcription', status: 'completed',
      created_at: realDate, updated_at: realDate, error_code: null, result: { not_a_valid_transcript: 'must not be displayed' } });
    await expect(getRealOperation(f.scope, ids.key)).resolves.toMatchObject({ status: 'completed', result: null });
    f.request.mockResolvedValueOnce(response({ operation_id: ids.key, project_id: ids.memory, session_id: ids.session, kind: 'transcription', status: 'completed', created_at: realDate, updated_at: realDate, error_code: null, result: null }));
    await expect(getRealOperation(f.scope, ids.key)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it.each([getRealTranscripts, getRealMessages, getRealMemories, getRealDrafts])('validates owned bounded list responses %#', async method => {
    const f = fixture(Array(101).fill(realTranscript())); await expect(method(f.scope)).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('rejects malformed memory/message data outside turn responses too', () => {
    expect(() => decodeMemory({ ...realMemory(), corrected_value: 'automatic correction' }, realScope())).toThrow();
    expect(() => decodeMessage(realMessage('assistant', { role: 'user', sequence: 0 }), realScope())).toThrow();
  });
  it('requests revision-specific private PDF bytes and rejects stale revision headers', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\nsynthetic bounded bytes\n%%EOF');
    const f = fixture(); f.request.mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Memy-Draft-Version': '1', 'X-Memy-Draft-Revision': '1' } }));
    await expect(exportRealDraft(f.scope, realDraft())).resolves.toEqual(bytes);
    expect(JSON.parse(f.request.mock.calls[0][1]!.body as string)).toEqual({ expected_revision: 1, include_title_page: true, include_page_numbers: true });
    f.request.mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Memy-Draft-Version': '1', 'X-Memy-Draft-Revision': '2' } }));
    await expect(exportRealDraft(f.scope, realDraft())).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('never accepts a spoken reply for a different assistant message or simulated media', async () => {
    const f = fixture({ speech_id: ids.key, assistant_message_id: ids.userMessage, language: 'en', media_type: 'audio/wav',
      audio_sha256: '0'.repeat(64), audio_size: 44, expires_at: '2099-10-29T12:00:00Z', status: 'ready' });
    await expect(createRealSpeech(f.scope, ids.assistant, ids.key)).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });
  it('requires explicit recording consent and validates native URI before any request', () => {
    const f = fixture(), clip = { uri: 'file:///synthetic/recording.m4a', name: 'recording.m4a' as const, type: 'audio/mp4' as const, size: 100, durationMs: 1000 };
    expect(() => transcribeRealRecording(f.scope, clip, false, ids.key)).toThrow();
    expect(() => transcribeRealRecording(f.scope, { ...clip, uri: 'https://unowned.example/clip.m4a' }, true, ids.key)).toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('stable backend recovery metadata', () => {
  it.each([
    ['LIVE_AI_DISABLED', 503],
    ['REAL_AI_NOT_CONFIGURED', 503], ['AI_PILOT_ACCESS_DENIED', 403], ['AI_PILOT_CONFIG_UNAVAILABLE', 503],
  ] as const)('keeps %s out of backoff', async (code, status) => {
    const f = fixture(); f.request.mockImplementation(async () => response({ error: { code, message: 'DO NOT DISPLAY' } }, status,
      { 'X-Memy-Recovery': 'contact-operator', 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({ code, recovery: 'contact-operator', mayHaveWritten: false, retry: undefined });
    await expect(getRealMessages(f.scope)).rejects.toMatchObject({ code }); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each([['INVALID_ACCESS_TOKEN', 401], ['MISSING_ACCESS_TOKEN', 401], ['AI_USER_LIMIT_UNAVAILABLE', 503]] as const)('routes %s to authentication', async (code, status) => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, status, { 'X-Memy-Recovery': 'sign-in' }));
    await expect(getRealMessages(f.scope)).rejects.toMatchObject({ kind: 'authentication', recovery: 'sign-in', code });
  });
  it.each([['AI_BUSY', 429], ['AUDIO_BUSY', 429], ['API_BUSY', 503], ['AI_RATE_LIMIT', 429], ['RATE_LIMITED', 429]] as const)('bounds %s wait advice', async (code, status) => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, status, { 'X-Memy-Recovery': 'wait', 'Retry-After': '99999999' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({ code, recovery: 'wait', mayHaveWritten: code === 'AI_RATE_LIMIT', retry: { retryAfterSeconds: 86400 } });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([['AI_PROVIDER_RATE_LIMIT', 503], ['AI_PROVIDER_TIMEOUT', 504], ['AI_PROVIDER_UNAVAILABLE', 503], ['REAL_AI_UNCERTAIN', 503]] as const)('preserves %s reconciliation identity without retries', async (code, status) => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, status,
      { 'X-Memy-Recovery': 'check-saved', 'X-Memy-Operation-Id': ids.key, 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({ code, recovery: 'check-saved', operationId: ids.key, mayHaveWritten: true, retry: undefined });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['AI_BUSY', 'AUDIO_BUSY', 'API_BUSY', 'AI_RATE_LIMIT', 'RATE_LIMITED', 'AI_SPENDING_NOT_APPROVED',
    'AI_USAGE_LIMIT', 'INVALID_ACCESS_TOKEN', 'AI_PILOT_ACCESS_DENIED', 'AI_PILOT_CONFIG_UNAVAILABLE'])('keeps unexpected HTTP 500 with %s uncertain and out of admission backoff', async code => {
    apiBackoff.activate('synthetic-owner');
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, 500,
      { 'X-Memy-Recovery': code === 'INVALID_ACCESS_TOKEN' ? 'sign-in' : 'wait', 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      code, status: 500, kind: 'unavailable', mayHaveWritten: true, retry: undefined, recovery: undefined,
    });
    expect(apiBackoff.getAdvice(f.scope.baseUrl)).toBeUndefined();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('keeps code semantics authoritative over contradictory recovery headers', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code: 'AI_SPENDING_NOT_APPROVED' } }, 503,
      { 'X-Memy-Recovery': 'wait', 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      recovery: 'contact-operator', mayHaveWritten: true, retry: undefined,
    });
    f.request.mockResolvedValueOnce(response({ error: { code: 'AI_PROVIDER_UNAVAILABLE' } }, 503,
      { 'X-Memy-Recovery': 'sign-in' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      recovery: 'check-saved', kind: 'unavailable', mayHaveWritten: true, retry: undefined,
    });
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each([['AI_BUSY', 503], ['API_BUSY', 429], ['AI_SPENDING_NOT_APPROVED', 429],
    ['AI_PROVIDER_ACCESS_DENIED', 403], ['INVALID_ACCESS_TOKEN', 503]] as const)(
    'does not infer an unsent POST from mismatched %s/status %s', async (code, status) => {
      const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, status,
        { 'X-Memy-Recovery': 'wait', 'Retry-After': '60' }));
      await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
        status, code, mayHaveWritten: true, recovery: undefined, retry: undefined,
      });
      expect(f.request).toHaveBeenCalledTimes(1);
    });
  it('does not let a header alone turn a legacy error into admission retry advice', async () => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code: 'AI_INPUT_LIMIT' } }, 503,
      { 'X-Memy-Recovery': 'wait', 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      recovery: undefined, mayHaveWritten: true, retry: undefined,
    });
  });
  it.each([['AI_PILOT_ACCESS_DENIED', 403, 'forbidden'], ['AI_PILOT_CONFIG_UNAVAILABLE', 503, 'unavailable']] as const)(
    'keeps free owned reads available after %s blocks a paid action', async (code, status, kind) => {
    apiBackoff.activate('synthetic-owner');
    const f = fixture(); f.request.mockImplementation(async (_url, request) => request?.method === 'POST'
      ? response({ error: { code } }, status,
        { 'X-Memy-Recovery': 'contact-operator', 'Retry-After': '60' }) : response([]));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      code, kind, recovery: 'contact-operator', mayHaveWritten: false, retry: undefined,
    });
    await expect(getRealMessages(f.scope)).resolves.toEqual([]);
    expect(apiBackoff.getAdvice(f.scope.baseUrl)).toBeUndefined();
    expect(f.request).toHaveBeenCalledTimes(2);
    });
  it('preserves the existing fallback for unknown forbidden responses without exposing their body', async () => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code: 'PRIVATE_UNKNOWN_FORBIDDEN', message: 'DO NOT DISPLAY' } }, 403,
      { 'X-Memy-Recovery': 'contact-operator' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      kind: 'forbidden', code: undefined, recovery: undefined, retry: undefined,
    });
  });
  it.each(['AI_PROVIDER_QUOTA_EXHAUSTED', 'AI_PROVIDER_AUTHENTICATION_FAILED', 'AI_PROVIDER_ACCESS_DENIED',
    'AI_USAGE_UNAVAILABLE', 'AI_SPENDING_NOT_APPROVED'])(
    'retains uncertain dispatch for %s even without an operation header', async code => {
      const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, 503,
        { 'X-Memy-Recovery': 'contact-operator' }));
      await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
        recovery: 'contact-operator', mayHaveWritten: true, retry: undefined, operationId: undefined,
      });
    });
  it.each(['AI_USAGE_LIMIT', 'AI_GLOBAL_BUDGET_EXHAUSTED', 'AI_USER_BUDGET_EXHAUSTED', 'AI_RATE_LIMIT'])(
    'preserves possible partial-stage dispatch for %s even without an operation header', async code => {
      const f = fixture(); f.request.mockResolvedValue(response({ error: { code } }, 429,
        { 'X-Memy-Recovery': code === 'AI_RATE_LIMIT' ? 'wait' : 'contact-operator', 'Retry-After': '60' }));
      await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
        code, mayHaveWritten: true, operationId: undefined,
        recovery: code === 'AI_RATE_LIMIT' ? 'wait' : 'contact-operator',
      });
      expect(f.request).toHaveBeenCalledTimes(1);
    });
  it('never treats a validated operation header as proof that an admission response was unsent', async () => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code: 'AI_BUSY' } }, 429,
      { 'X-Memy-Recovery': 'wait', 'X-Memy-Operation-Id': ids.key, 'Retry-After': '60' }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({
      code: 'AI_BUSY', mayHaveWritten: true, operationId: ids.key,
    });
  });
  it.each(['unknown', 'WAIT', 'wait,sign-in', ''])('ignores malformed recovery %s and unknown code', async header => {
    const f = fixture(); f.request.mockResolvedValue(response({ error: { code: 'PRIVATE_PROVIDER_SECRET', message: 'DO NOT DISPLAY' } }, 503, { 'X-Memy-Recovery': header }));
    await expect(sendRealMessage(f.scope, { source_transcript_id: ids.transcript }, ids.key)).rejects.toMatchObject({ code: undefined, recovery: undefined, mayHaveWritten: true, retry: undefined });
  });
});

it('reads owned prepared speech metadata with no paid request or key', async () => {
  const metadata = { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en', media_type: 'audio/wav',
    audio_sha256: 'a'.repeat(64), audio_size: 44, expires_at: '2099-01-01T00:00:00Z', status: 'ready' };
  const f = fixture(metadata);
  await expect(getPreparedRealSpeech(f.scope, ids.assistant)).resolves.toEqual(metadata);
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0][1]?.method).toBe('GET');
  expect(f.request.mock.calls[0][1]?.headers).not.toHaveProperty('Idempotency-Key');
});
