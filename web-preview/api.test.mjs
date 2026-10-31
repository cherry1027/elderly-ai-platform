import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, validatePath } from './api.js';
const key = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const auth = { getAccessToken: async () => 'synthetic-user-token', invalidate() {} };
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('only fixed relative backend API paths are admitted', () => {
  for (const bad of ['https://other.example/api/v2/messages', '//other.example/api/v2/messages', '/client-config', '/api/v2/../private', '/api/v2/%2e%2e/private']) assert.throws(() => validatePath(bad));
  assert.equal(validatePath('/api/v2/story-projects/' + project + '/drafts?limit=50&offset=0'), '/api/v2/story-projects/' + project + '/drafts?limit=50&offset=0');
});
test('uncertain paid request is never retried or replaced; reconciliation reads only', async () => {
  const calls = [];
  const api = createApi(auth, { makeId: () => key, request: async (path, init) => {
    calls.push([path, init.method, init.headers]);
    if (init.method === 'POST') throw Error('synthetic network loss');
    return response({ kind: 'transcription', status: 'completed', project_id: project, session_id: session, result: { transcript_id: key, project_id: project, session_id: session } });
  } });
  await assert.rejects(api.paid('transcription', `/api/v2/story-sessions/${session}/transcribe`, { scope: { projectId: project, sessionId: session } }));
  assert.equal(api.hasPending(), true);
  await assert.rejects(api.paid('speech', '/api/v2/messages/other/speech'));
  assert.equal(calls.length, 1);
  assert.deepEqual(await api.reconcile(), { transcript_id: key, project_id: project, session_id: session });
  assert.equal(calls.length, 2); assert.equal(calls[1][1], 'GET'); assert.equal(api.hasPending(), false);
  assert.equal(calls[0][2]['Idempotency-Key'], key);
});
test('successful but wrongly scoped paid output stays blocked for reconciliation', async () => {
  const api = createApi(auth, { makeId: () => key, request: async () => response({ project_id: key, session_id: session, language: 'en' }) });
  await assert.rejects(api.paid('transcription', `/api/v2/story-sessions/${session}/transcribe`, { scope: { projectId: project, sessionId: session, language: 'en' } }), e => e.code === 'INVALID_RESPONSE' && e.uncertain);
  assert.equal(api.hasPending(), true);
});
test('disposal fences a late successful private response', async () => {
  let resolve;
  const api = createApi(auth, { request: () => new Promise(r => { resolve = r; }) });
  const read = api.call('GET', '/api/v1/story-projects');
  await Promise.resolve(); await Promise.resolve(); api.dispose();
  resolve(response([{ title: 'synthetic private title' }]));
  await assert.rejects(read, e => e.code === 'CANCELLED');
});

test('known failures before a paid operation claim do not trap later explicit actions', async () => {
  const cases = [
    ['NO_CONFIRMED_MEMORIES', 409], ['CLARIFICATION_REQUIRED', 409],
    ['SESSION_COMPLETED', 409], ['AI_CONTEXT_LIMIT', 409],
    ['LIVE_AI_DISABLED', 503], ['REAL_AI_NOT_CONFIGURED', 503],
    ['AI_SPENDING_NOT_APPROVED', 503], ['AI_USAGE_UNAVAILABLE', 503],
  ];
  for (const [code, status] of cases) {
    let calls = 0;
    const api = createApi(auth, { makeId: () => key, request: async () => {
      calls++;
      if (calls === 1) return response({ error: { code } }, status);
      return response({ project_id: project, language: 'en' }, 201);
    } });
    const options = { scope: { projectId: project, language: 'en' } };
    await assert.rejects(api.paid('generation', `/api/v2/story-projects/${project}/generate`, options),
      error => error.code === code && error.uncertain === false);
    assert.equal(calls, 1, `${code} must not trigger an automatic retry`);
    assert.equal(api.hasPending(), false, `${code} has no operation to reconcile`);
    await api.paid('generation', `/api/v2/story-projects/${project}/generate`, options);
    assert.equal(calls, 2, 'a later explicit click can submit a new action');
  }
});

test('postclaim headers and unknown errors retain paid uncertainty', async () => {
  const cases = [
    ['AI_SPENDING_NOT_APPROVED', 503, { 'X-Memy-Operation-Id': key }],
    ['NO_CONFIRMED_MEMORIES', 409, { 'X-Memy-Operation-Id': key }],
    ['REAL_AI_CONFLICT', 409, {}], ['SUPABASE_UNAVAILABLE', 503, {}],
    ['PREVIEW_BACKEND_UNAVAILABLE', 503, {}],
    // A known code with a status outside its inspected backend contract is held.
    ['NO_CONFIRMED_MEMORIES', 503, {}],
  ];
  for (const [code, status, headers] of cases) {
    let calls = 0;
    const api = createApi(auth, { makeId: () => key, request: async () => {
      calls++; return response({ error: { code } }, status, headers);
    } });
    await assert.rejects(api.paid('generation', `/api/v2/story-projects/${project}/generate`),
      error => error.uncertain === true);
    assert.equal(api.hasPending(), true, code);
    await assert.rejects(api.paid('generation', `/api/v2/story-projects/${project}/generate`));
    assert.equal(calls, 1, `${code} must not allow a replacement POST`);
  }
});

test('reconciliation checks result language and keeps a mismatched result held', async () => {
  const api = createApi(auth, { makeId: () => key, request: async (_path, init) => {
    if (init.method === 'POST') throw Error('synthetic network loss');
    return response({ kind: 'transcription', status: 'completed', project_id: project, session_id: session,
      result: { transcript_id: key, project_id: project, session_id: session, language: 'sv' } });
  } });
  await assert.rejects(api.paid('transcription', `/api/v2/story-sessions/${session}/transcribe`,
    { scope: { projectId: project, sessionId: session, language: 'en' } }));
  await assert.rejects(api.reconcile(), error => error.code === 'INVALID_RESPONSE' && error.uncertain);
  assert.equal(api.hasPending(), true);
});

test('speech reconciliation checks the original assistant message', async () => {
  const api = createApi(auth, { makeId: () => key, request: async (_path, init) => {
    if (init.method === 'POST') throw Error('synthetic network loss');
    return response({ kind: 'speech', status: 'completed', project_id: project, session_id: session,
      result: { speech_id: key, assistant_message_id: project, language: 'en' } });
  } });
  await assert.rejects(api.paid('speech', `/api/v2/conversation-messages/${session}/speech`,
    { scope: { projectId: project, sessionId: session, language: 'en' } }));
  await assert.rejects(api.reconcile(), error => error.code === 'INVALID_RESPONSE' && error.uncertain);
  assert.equal(api.hasPending(), true);
});
