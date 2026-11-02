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

const failedOperation = (kind = 'generation', patch = {}) => ({
  operation_id: key, kind, status: 'failed', project_id: project,
  session_id: kind === 'generation' ? null : session,
  created_at: '2026-11-02T12:00:00Z', updated_at: '2026-11-02T12:00:01+00:00',
  error_code: 'AI_USAGE_LIMIT', result: null, ...patch,
});
const actionFor = kind => ({
  path: kind === 'generation' ? `/api/v2/story-projects/${project}/generate` :
    kind === 'speech' ? `/api/v2/conversation-messages/${key}/speech` :
    `/api/v2/story-sessions/${session}/${kind === 'transcription' ? 'transcribe' : 'messages'}`,
  scope: { projectId: project, language: 'en', ...(kind === 'generation' ? {} : { sessionId: session }) },
});

test('authoritative failed operations release only the held action and never retry it automatically', async t => {
  for (const kind of ['generation', 'transcription', 'conversation', 'speech']) await t.test(kind, async () => {
    const calls = [], replacementKey = '44444444-4444-4444-8444-444444444444';
    let ids = 0;
    const api = createApi(auth, { makeId: () => ++ids === 1 ? key : replacementKey,
      request: async (path, init) => {
        calls.push({ path, method: init.method, key: init.headers['Idempotency-Key'] });
        if (init.method === 'GET') return response(failedOperation(kind));
        if (calls.length === 1) return response({ error: { code: 'AI_USAGE_LIMIT' } }, 429, { 'X-Memy-Operation-Id': key });
        const item = { project_id: project, session_id: session, language: 'en', assistant_message_id: key };
        return response(kind === 'conversation' ? { message: item } : item, 201);
      } });
    const action = actionFor(kind);
    await assert.rejects(api.paid(kind, action.path, { scope: action.scope }), error => error.uncertain);
    assert(api.hasPending());
    await assert.rejects(api.reconcile(), error => error.code === 'ACTION_NOT_PROCESSED' && error.uncertain === false && /before sending an AI request/.test(error.message));
    assert.equal(api.hasPending(), false);
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET'], 'recovery only reads the authoritative operation');
    await api.paid(kind, action.path, { scope: action.scope });
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST'], 'only a later explicit action dispatches again');
    assert.equal(calls[2].key, replacementKey, 'a later action has a new idempotency key');
  });
});

test('malformed or wrongly scoped failed-operation evidence cannot release pending work', async t => {
  const cases = [
    ['wrong project', { project_id: session }],
    ['generation has a session', { session_id: session }],
    ['wrong kind', { kind: 'speech' }],
    ['wrong original operation', { operation_id: session }],
    ['invalid operation ID', { operation_id: 'not-a-uuid' }],
    ['non-null result', { result: {} }],
    ['missing field', { result: undefined }],
    ['unexpected field', { private_extra: true }],
    ['non-aware created time', { created_at: '2026-11-02T12:00:00' }],
    ['invalid updated time', { updated_at: 'invalid' }],
    ['malformed error code', { error_code: {} }],
    ['null failed error code', { error_code: null }],
    ['missing failed error code', { error_code: undefined }],
    ['empty failed error code', { error_code: '' }],
    ['noncanonical failed error code', { error_code: 'raw private detail' }],
    ['oversized failed error code', { error_code: 'A'.repeat(81) }],
  ];
  for (const [name, patch] of cases) await t.test(name, async () => {
    const calls = [];
    const api = createApi(auth, { makeId: () => key, request: async (_path, init) => {
      calls.push(init.method);
      if (init.method === 'POST') return response({ error: { code: 'AI_USAGE_LIMIT' } }, 429, { 'X-Memy-Operation-Id': key });
      return response(failedOperation('generation', patch));
    } });
    const action = actionFor('generation');
    await assert.rejects(api.paid('generation', action.path, { scope: action.scope }));
    await assert.rejects(api.reconcile(), error => error.code === 'INVALID_RESPONSE' && error.uncertain);
    assert(api.hasPending());
    await assert.rejects(api.paid('generation', action.path, { scope: action.scope }), error => error.code === 'ACTION_PENDING');
    assert.deepEqual(calls, ['POST', 'GET']);
  });
  await t.test('session-owned operation has wrong session', async () => {
    const api = createApi(auth, { makeId: () => key, request: async (_path, init) => init.method === 'POST'
      ? response({ error: { code: 'AI_USAGE_LIMIT' } }, 429, { 'X-Memy-Operation-Id': key })
      : response(failedOperation('speech', { session_id: project })) });
    const action = actionFor('speech');
    await assert.rejects(api.paid('speech', action.path, { scope: action.scope }));
    await assert.rejects(api.reconcile(), error => error.code === 'INVALID_RESPONSE' && error.uncertain);
    assert(api.hasPending());
  });
});

test('uncertain and in-progress operations remain held even if their error resembles a budget failure', async t => {
  for (const status of ['uncertain', 'in_progress']) await t.test(status, async () => {
    let posts = 0;
    const api = createApi(auth, { makeId: () => key, request: async (_path, init) => {
      if (init.method === 'POST') { posts++; throw Error('Synthetic connection loss'); }
      return response(failedOperation('generation', { status }));
    } });
    const action = actionFor('generation');
    await assert.rejects(api.paid('generation', action.path, { scope: action.scope }));
    await assert.rejects(api.reconcile(), error => error.code === 'ACTION_PENDING' && error.uncertain);
    assert(api.hasPending());
    assert.equal(posts, 1);
  });
});

test('disposal fences late failed-operation recovery instead of clearing its held action', async () => {
  let resolveOperation;
  const api = createApi(auth, { makeId: () => key, request: async (_path, init) => {
    if (init.method === 'POST') throw Error('Synthetic connection loss');
    return await new Promise(resolve => { resolveOperation = resolve; });
  } });
  const action = actionFor('generation');
  await assert.rejects(api.paid('generation', action.path, { scope: action.scope }));
  const read = api.reconcile();
  await Promise.resolve(); await Promise.resolve(); api.dispose();
  resolveOperation(response(failedOperation()));
  await assert.rejects(read, error => error.code === 'CANCELLED');
  assert(api.hasPending(), 'a late response cannot reset the old instance');
});

test('an older recovery response cannot clear a newly submitted action', async () => {
  const resolves = [], replacementKey = '44444444-4444-4444-8444-444444444444';
  let ids = 0;
  const api = createApi(auth, { makeId: () => ++ids === 1 ? key : replacementKey, request: async (_path, init) => {
    if (init.method === 'POST') throw Error('Synthetic connection loss');
    return await new Promise(resolve => resolves.push(resolve));
  } });
  const action = actionFor('generation');
  await assert.rejects(api.paid('generation', action.path, { scope: action.scope }));
  const first = api.reconcile(), late = api.reconcile();
  await Promise.resolve(); await Promise.resolve();
  resolves[0](response(failedOperation()));
  await assert.rejects(first, error => error.code === 'ACTION_NOT_PROCESSED');
  await assert.rejects(api.paid('generation', action.path, { scope: action.scope }));
  resolves[1](response(failedOperation()));
  await assert.rejects(late, error => error.code === 'CANCELLED' && error.uncertain);
  assert(api.hasPending(), 'the newer action remains held');
});

test('local allowance and provider quota failures have distinct explanations without claiming a credit balance', async () => {
  for (const [code, expected] of [['AI_USAGE_LIMIT', 'local AI testing allowance'], ['AI_PROVIDER_QUOTA_EXHAUSTED', 'provider rejected']]) {
    const api = createApi(auth, { request: async () => response({ error: { code } }, 503) });
    await assert.rejects(api.call('GET', '/api/v2/capabilities'), error => error.message.includes(expected) && error.message.includes('separate') && !error.message.includes('$0'));
  }
});
