/* Offline adapter: execute only the pinned, dependency-free mobile API module.
 * No Expo launch, native storage, real fetch, sockets or Supabase connection.
 * Requests travel over JSON-lines to Python's in-process FastAPI TestClient.
 */
'use strict';

const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { createInterface } = require('node:readline');

const lines = createInterface({ input: process.stdin, terminal: false });
const iterator = lines[Symbol.asyncIterator]();
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
async function receive() {
  const item = await iterator.next();
  if (item.done || item.value.length > 200_000) throw new Error('bridge');
  return JSON.parse(item.value);
}

async function main() {
  const initial = await receive();
  assert.equal(initial.type, 'source');
  const code = stripTypeScriptTypes(initial.source, { mode: 'transform' });
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  // The genuine mobile URL normalizer rejects loopback. This synthetic LAN
  // origin is validated by it, but the injected transport makes no LAN request.
  const baseUrl = 'http://192.168.50.2:8000/api/v1';
  let currentCase = '';
  let serial = 0;
  const counts = new Map();
  const checks = [];
  const request = async (url, options) => {
    counts.set(currentCase, (counts.get(currentCase) || 0) + 1);
    const id = ++serial;
    send({ type: 'request', id, case: currentCase, url, method: options.method,
      headers: options.headers, body: options.body ?? null,
      credentials: options.credentials, cache: options.cache, redirect: options.redirect });
    const reply = await receive();
    assert.equal(reply.type, 'response');
    assert.equal(reply.id, id);
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  };
  const options = (token = 'synthetic-alice-token') => ({
    baseUrl, request, getAccessToken: async () => token, timeoutMs: 10_000,
  });
  const check = async (name, operation) => {
    currentCase = name;
    await operation();
    checks.push(name);
  };
  const rejects = async (operation, kind, status, ambiguous = false) => {
    await assert.rejects(operation, error => {
      assert.ok(error instanceof api.StoryProjectsError);
      assert.equal(error.kind, kind);
      assert.equal(error.status, status);
      assert.equal(error.mayHaveWritten, ambiguous);
      assert.ok(!error.message.includes('SYNTHETIC_PRIVATE_UPSTREAM_RESPONSE'));
      assert.ok(!error.message.includes('synthetic-'));
      return true;
    });
  };
  let english, swedish;
  await check('create-en', async () => {
    english = await api.createStoryProject({ ...options(), input: { title: '  My Childhood  ', language: 'en' } });
    assert.equal(english.title, 'My Childhood');
    assert.equal(english.language, 'en');
    assert.equal(english.status, 'draft');
    assert.equal(counts.get(currentCase), 1);
  });
  await check('create-sv', async () => {
    swedish = await api.createStoryProject({ ...options(), input: { title: '  Min barndom i Malmö  ', language: 'sv' } });
    assert.equal(swedish.title, 'Min barndom i Malmö');
    assert.equal(swedish.language, 'sv');
    assert.notEqual(swedish.id, english.id);
    assert.equal(counts.get(currentCase), 1);
  });
  await check('list-own-projects', async () => {
    const result = await api.listStoryProjects(options());
    assert.deepEqual(new Set(result.map(row => row.id)), new Set([english.id, swedish.id]));
  });
  for (const [language, getProject] of [['en', () => english], ['sv', () => swedish]]) {
    await check(`detail-${language}`, async () => {
      assert.deepEqual(await api.getStoryProject({ ...options(), projectId: getProject().id }), getProject());
    });
    await check(`patch-${language}`, async () => {
      const title = language === 'sv' ? 'Åren i Göteborg' : 'My Early Years';
      const updated = await api.updateStoryProject({ ...options(), projectId: getProject().id,
        input: { title: ` ${title} `, description: language === 'sv' ? 'Fiktiva minnen' : 'Fictional memories' },
        expectedLanguage: language });
      assert.equal(updated.title, title);
      assert.equal(updated.language, language);
      if (language === 'en') english = updated; else swedish = updated;
    });
  }
  await check('patch-clear-description', async () => {
    swedish = await api.updateStoryProject({ ...options(), projectId: swedish.id,
      input: { description: null }, expectedLanguage: 'sv' });
    assert.equal(swedish.description, null);
    assert.equal(swedish.title, 'Åren i Göteborg');
  });
  await check('missing-auth-no-dispatch', async () => {
    await rejects(() => api.listStoryProjects(options(null)), 'authentication', undefined);
    assert.equal(counts.get(currentCase) || 0, 0);
  });
  await check('expired-auth', async () => {
    await rejects(() => api.listStoryProjects(options('synthetic-expired-token')), 'authentication', 401);
  });
  await check('cross-user-detail', async () => {
    await rejects(() => api.getStoryProject({ ...options('synthetic-bob-token'), projectId: english.id }), 'not-found', 404);
  });
  await check('cross-user-update', async () => {
    await rejects(() => api.updateStoryProject({ ...options('synthetic-bob-token'), projectId: english.id,
      input: { title: 'Must not write' }, expectedLanguage: 'en' }), 'not-found', 404);
  });
  await check('other-owner-list', async () => {
    const rows = await api.listStoryProjects(options('synthetic-bob-token'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Bob fictional project');
  });
  await check('database-read-unavailable', async () => {
    await rejects(() => api.listStoryProjects(options()), 'unavailable', 503);
    assert.equal(counts.get(currentCase), 1);
  });
  await check('database-write-unavailable-no-retry', async () => {
    await rejects(() => api.createStoryProject({ ...options(), input: { title: 'Do not duplicate', language: 'en' } }),
      'unavailable', 503, true);
    assert.equal(counts.get(currentCase), 1);
  });
  await check('local-validation-no-dispatch', async () => {
    await assert.rejects(() => api.createStoryProject({ ...options(), input: { title: '   ', language: 'en' } }),
      error => error instanceof api.CreateStoryInputError);
    assert.equal(counts.get(currentCase) || 0, 0);
  });
  await check('reconcile-owner-data', async () => {
    const rows = await api.listStoryProjects(options());
    assert.equal(rows.length, 2);
    assert.ok(rows.some(row => row.title === 'My Early Years'));
    assert.ok(rows.some(row => row.title === 'Åren i Göteborg' && row.description === null));
  });
  send({ type: 'result', checks, request_count: serial });
  lines.close();
}

main().catch(() => {
  // Never echo exception text, response bodies or request credentials.
  process.stderr.write('MOBILE_CONTRACT_CLIENT_FAILED\n');
  lines.close();
  process.exitCode = 1;
});
