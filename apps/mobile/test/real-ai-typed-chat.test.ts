import { createHash } from 'node:crypto';
import * as Crypto from 'expo-crypto';
import { apiBackoff } from '../src/api/backoff';
import { decodeMessage, findRealOperation, getRealMessages, getRealOperation, hashRealText, sendRealTextMessage } from '../src/real-ai/api';
import { realIds as ids, realMemory, realMessage, realScope } from './real-ai-fixtures';

const originalProvenance = { mode: 'original' as const, provider: 'user' as const, model: null, version: 1 as const };
function turn(text = '  Jag minns Malmö.\n', language: 'en' | 'sv' = 'sv') {
  return { user_message: realMessage('user', { id: ids.key, text, language, source_transcript_id: null,
    source_text_input_id: ids.key, provenance: originalProvenance }),
  message: realMessage('assistant', { language, source_transcript_id: null, source_text_input_id: ids.key }),
  memories: [], mode: 'real' as const };
}
function fixture(value: unknown = turn(), status = 200, headers: Record<string, string> = {}) {
  const request = jest.fn(async () => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } }));
  return { request, scope: { ...realScope(), language: 'sv' as const, request } };
}
beforeEach(() => {
  apiBackoff.clear();
  jest.mocked(Crypto.digestStringAsync).mockImplementation(async (_algorithm, value) => createHash('sha256').update(value, 'utf8').digest('hex'));
});
describe('native typed-chat contracts — offline HTTP only', () => {
  it('keeps both historical voice shapes compatible', () => {
    expect(decodeMessage(realMessage(), realScope()).source_text_input_id).toBeNull();
    expect(decodeMessage(realMessage('assistant', { source_text_input_id: null }), realScope()).source_transcript_id).toBe(ids.transcript);
  });
  it('distinguishes the user original from model-authored replies in mixed history', async () => {
    const data = turn(); const f = fixture([data.user_message, data.message]);
    await expect(getRealMessages(f.scope)).resolves.toEqual([data.user_message, data.message]);
    expect(data.user_message.provenance.provider).toBe('user');
  });
  it.each([
    { source_transcript_id: ids.transcript }, { source_text_input_id: null },
    { id: ids.assistant }, { provenance: { mode: 'real', provider: 'openai', model: 'test', version: 1 } },
    { project_id: ids.memory }, { session_id: ids.memory }, { language: 'en' },
  ])('rejects inconsistent or foreign typed originals %#', changes => {
    expect(() => decodeMessage({ ...turn().user_message, ...changes }, { ...realScope(), language: 'sv' })).toThrow();
  });
  it('sends the exact Swedish original once with the project language and explicit action key', async () => {
    const original = '  Jag minns Malmö.\n'; const f = fixture();
    await expect(sendRealTextMessage(f.scope, original, ids.key)).resolves.toMatchObject({ mode: 'real' });
    expect(f.request).toHaveBeenCalledTimes(1);
    const [url, init] = f.request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${f.scope.baseUrl}/api/v2/story-sessions/${ids.session}/text-messages`);
    expect(JSON.parse(init.body as string)).toEqual({ text: original, language: 'sv' });
    expect(init.headers).toHaveProperty('Idempotency-Key', ids.key);
  });
  it.each(['', ' \n\t', '\0', '\ud800', 'a'.repeat(4001)])('rejects invalid text before dispatch %#', original => {
    const f = fixture(); expect(() => sendRealTextMessage(f.scope, original, ids.key)).toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it('counts Unicode characters consistently with the backend', async () => {
    const original = '🌳'.repeat(4000); const f = fixture(turn(original));
    await expect(sendRealTextMessage(f.scope, original, ids.key)).resolves.toMatchObject({ mode: 'real' });
  });
  it.each([
    { message: realMessage('assistant', { source_transcript_id: null, source_text_input_id: ids.memory, language: 'sv' }) },
    { user_message: { ...turn().user_message, text: 'Altered original' } },
    { message: { ...turn().message, provenance: originalProvenance } },
  ])('holds a dispatched response with a mismatching original or source pair %#', async changes => {
    const f = fixture({ ...turn(), ...changes });
    await expect(sendRealTextMessage(f.scope, '  Jag minns Malmö.\n', ids.key)).rejects.toMatchObject({ mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['TEXT_CHAT_NOT_READY', 'LIVE_AI_DISABLED', 'AI_SPENDING_NOT_APPROVED'])('recognizes proven pre-dispatch %s without holding the draft', async code => {
    const f = fixture({ error: { code } }, 503);
    await expect(sendRealTextMessage(f.scope, 'My original', ids.key)).rejects.toMatchObject({ code, mayHaveWritten: false });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('keeps a claimed operation held even when its error code can also occur before dispatch', async () => {
    const f = fixture({ error: { code: 'AI_SPENDING_NOT_APPROVED' } }, 503, { 'X-Memy-Operation-Id': ids.memory });
    await expect(sendRealTextMessage(f.scope, 'My original', ids.key)).rejects.toMatchObject({ operationId: ids.memory, mayHaveWritten: true });
  });
});


describe('strict typed operation recovery and digest contracts — offline fixtures', () => {
  const operation = (result: unknown = turn()) => ({ operation_id: ids.key, kind: 'conversation', status: 'completed',
    project_id: ids.project, session_id: ids.session, created_at: '2026-11-03T12:00:00Z',
    updated_at: '2026-11-03T12:00:01Z', error_code: null, result });
  it('hashes exact UTF-8 words without trimming or making an HTTP request', async () => {
    const original = '  Åsa minns Malmö. 🌳\n';
    await expect(hashRealText(original)).resolves.toBe(createHash('sha256').update(original, 'utf8').digest('hex'));
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith(Crypto.CryptoDigestAlgorithm.SHA256, original);
  });
  it('fails safely when native hashing returns an invalid digest', async () => {
    jest.mocked(Crypto.digestStringAsync).mockResolvedValueOnce('not-a-digest');
    await expect(hashRealText('Synthetic words')).rejects.toMatchObject({ mayHaveWritten: false });
  });
  it('caps saved typed originals at 4,000 while retaining the legacy voice limit', () => {
    expect(() => decodeMessage({ ...turn().user_message, text: 'a'.repeat(4001) }, { ...realScope(), language: 'sv' })).toThrow();
    expect(decodeMessage(realMessage('user', { text: 'a'.repeat(4001) }), realScope()).text).toHaveLength(4001);
  });
  it('decodes an owned typed operation against its server operation ID while leaving old recovery unchanged', async () => {
    const f = fixture(operation());
    await expect(getRealOperation(f.scope, ids.key, true)).resolves.toMatchObject({ result: null, typedTurn: turn() });
    const legacy = await getRealOperation(f.scope, ids.key);
    expect(legacy.result).toBeNull(); expect(legacy).not.toHaveProperty('typedTurn');
    await expect(findRealOperation(f.scope, 'conversation', ids.key, true)).resolves.toMatchObject({ typedTurn: turn() });
    expect(f.request).toHaveBeenCalledTimes(3);
    expect((f.request.mock.calls as unknown as [string, RequestInit][]).every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it.each([
    ['null completed result', { result: null }],
    ['arbitrary completed result', { result: {} }],
    ['completed error code', { error_code: 'PROVIDER_FAILED' }],
    ['foreign operation ID', { operation_id: ids.memory }],
    ['wrong top-level mode', { result: { ...turn(), mode: 'mock' } }],
    ['wrong typed source ID', { result: { ...turn(), user_message: { ...turn().user_message, id: ids.memory, source_text_input_id: ids.memory }, message: { ...turn().message, source_text_input_id: ids.memory } } }],
    ['wrong assistant provenance', { result: { ...turn(), message: { ...turn().message, provenance: { mode: 'real', provider: 'openai', model: null, version: 2 } } } }],
    ['wrong project', { result: { ...turn(), user_message: { ...turn().user_message, project_id: ids.memory } } }],
    ['wrong session', { session_id: ids.memory }],
    ['failed result object', { status: 'failed', error_code: 'AI_RATE_LIMIT', result: {} }],
    ['failed missing code', { status: 'failed', result: null }],
    ['in-progress error code', { status: 'in_progress', result: null, error_code: 'AI_RATE_LIMIT' }],
  ])('rejects %s before releasing a typed pending action', async (_name, changes) => {
    const f = fixture({ ...operation(), ...changes });
    await expect(getRealOperation(f.scope, ids.key, true)).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('accepts a well-formed failed typed operation as proven unsent without inventing a saved turn', async () => {
    const f = fixture({ ...operation(null), status: 'failed', error_code: 'AI_RATE_LIMIT' });
    const state = await getRealOperation(f.scope, ids.key, true);
    expect(state.status).toBe('failed'); expect(state).not.toHaveProperty('typedTurn');
  });
});


describe('typed memory candidates remain exact pending source evidence', () => {
  const memory = () => realMemory({ source_message_id: ids.key, value: 'Malmö', evidence: 'Malmö', uncertain: false, clarification_question: null });
  it('accepts an exact source-grounded pending candidate', async () => {
    const f = fixture({ ...turn(), memories: [memory()] });
    await expect(sendRealTextMessage(f.scope, '  Jag minns Malmö.\n', ids.key)).resolves.toMatchObject({ memories: [memory()] });
  });
  it.each([
    { source_message_id: ids.transcript }, { project_id: ids.memory }, { session_id: ids.memory },
    { status: 'confirmed' }, { value: 'Invented place' }, { evidence: 'Invented evidence' }, { year: 1980 },
  ])('rejects inconsistent typed evidence %#', async changes => {
    const f = fixture({ ...turn(), memories: [{ ...memory(), ...changes }] });
    await expect(sendRealTextMessage(f.scope, '  Jag minns Malmö.\n', ids.key)).rejects.toMatchObject({ mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});
