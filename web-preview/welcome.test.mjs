/** Offline welcome regression. No credentials, backend or provider requests.
 * node --test web-preview/welcome.test.mjs
 * Or set MEMY_JSDOM_PATH=/absolute/path/to/node_modules/jsdom/lib/api.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
let JSDOM;
try {
  ({ JSDOM } = await import(process.env.MEMY_JSDOM_PATH
    ? pathToFileURL(process.env.MEMY_JSDOM_PATH).href : 'jsdom'));
} catch (cause) {
  throw new Error('Use an existing jsdom install or set MEMY_JSDOM_PATH to its lib/api.js file.', { cause });
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const expected = 'https://edbkuunyeyxnyenmmqud.supabase.co';
let serial = 0;

async function install(t, authResponder = async () => { throw Error('Unexpected authentication in read-only welcome test'); }) {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8767/' });
  const saved = new Map(['window', 'document', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const calls = [];
  let writes = 0;
  const originalWrite = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => { writes++; throw Error('Welcome must not persist credentials or preferences'); };
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'fetch', { value: async (url, init) => {
    calls.push({ url, init });
    if (url === '/client-config') return new Response(JSON.stringify({ supabaseUrl: expected, publishableKey: 'sb_publishable_synthetic_test_value_1234567890' }), { headers: { 'Content-Type': 'application/json' } });
    if (url === expected + '/auth/v1/token?grant_type=password') return authResponder(url, init);
    throw Error('Unexpected network destination in offline welcome test');
  }, configurable: true });
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.Storage.prototype.setItem = originalWrite;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import(new URL(`./app.js?offline-welcome=${++serial}`, import.meta.url));
  await tick();
  return { dom, calls, writes: () => writes, root: document.getElementById('app') };
}

test('welcome has meaningful labels and decorative art; opening makes no account or AI request', async t => {
  const { root, calls, writes } = await install(t);
  assert(root.querySelector('h1').textContent.includes('remembered'));
  assert.equal(root.querySelector('.memory-art').getAttribute('aria-hidden'), 'true');
  assert.equal(root.querySelectorAll('.welcome-steps li').length, 3);
  assert.deepEqual([...root.querySelector('.welcome-layout').children].map(node => node.className), ['welcome-copy', 'card login-card', 'welcome-companion'], 'sign-in precedes optional inspiration in visual and keyboard order on narrow screens');
  assert.equal(document.querySelector('.skip-link').getAttribute('href'), '#app');
  assert.equal(document.getElementById('app').getAttribute('tabindex'), '-1');
  assert.equal(document.querySelector('label[for=email]').textContent, 'Email');
  assert.equal(document.querySelector('label[for=password]').textContent, 'Password');
  assert.equal(document.getElementById('password').type, 'password');
  assert.equal(root.querySelector('[role=status]').getAttribute('aria-live'), 'polite');
  assert.deepEqual(calls.map(call => call.url), ['/client-config']);
  assert.equal(writes(), 0);
});

test('password visibility is explicit and a failed sign-in clears the password without leaking the server error', async t => {
  let release;
  const { root, calls, writes, dom } = await install(t, async () => new Promise(resolve => { release = resolve; }));
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const reveal = root.querySelector('.password-toggle');
  const form = root.querySelector('form');
  const submit = root.querySelector('button[type=submit]');
  email.value = 'offline-person@example.invalid'; password.value = 'offline-only-password';
  reveal.click();
  assert.equal(password.type, 'text');
  assert.equal(reveal.getAttribute('aria-label'), 'Hide password');
  assert.equal(reveal.getAttribute('aria-pressed'), 'true');
  reveal.click();
  assert.equal(password.type, 'password');
  assert.equal(reveal.getAttribute('aria-label'), 'Show password');
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(password.value, '', 'password is cleared synchronously before awaiting authentication');
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert(submit.disabled && email.disabled && password.disabled && reveal.disabled);
  release(new Response(JSON.stringify({ error: 'upstream-secret-never-display' }), { status: 400 }));
  await tick();
  assert.equal(password.value, '');
  assert.equal(password.type, 'password');
  assert(!submit.disabled && !email.disabled && !password.disabled && !reveal.disabled);
  assert.equal(form.getAttribute('aria-busy'), 'false');
  assert(root.querySelector('[role=status]').textContent.includes('Sign-in could not be verified'));
  assert(!root.textContent.includes('upstream-secret-never-display'));
  assert.equal(calls.length, 2, 'no automatic login retry or provider action');
  assert.equal(writes(), 0);
});

test('reading-size controls expose their state and remain in tab memory', async t => {
  const { writes, calls } = await install(t);
  const larger = document.querySelector('[data-text-choice=larger]');
  const standard = document.querySelector('[data-text-choice=standard]');
  larger.click();
  assert.equal(document.documentElement.dataset.textSize, 'larger');
  assert.equal(larger.getAttribute('aria-pressed'), 'true');
  assert.equal(standard.getAttribute('aria-pressed'), 'false');
  standard.click();
  assert.equal(document.documentElement.dataset.textSize, 'standard');
  assert.equal(standard.getAttribute('aria-pressed'), 'true');
  assert.equal(larger.getAttribute('aria-pressed'), 'false');
  assert.equal(writes(), 0);
  assert.deepEqual(calls.map(call => call.url), ['/client-config']);
});

test('memory inspirations change locally without authentication, AI requests or storage', async t => {
  const { root, writes, calls } = await install(t);
  const topics = [...root.querySelectorAll('.inspiration-topic')];
  const prompt = root.querySelector('.inspiration-prompt');
  assert.equal(topics.length, 3);
  assert.equal(prompt.getAttribute('aria-live'), 'polite');
  assert.equal(prompt.getAttribute('aria-atomic'), 'true');
  assert.equal(topics[0].getAttribute('aria-pressed'), 'true');
  assert(root.querySelector('.inspiration-question').textContent.includes('place'));
  topics[1].click();
  assert(root.querySelector('.inspiration-question').textContent.includes('make you smile'));
  assert.equal(topics[0].getAttribute('aria-pressed'), 'false');
  assert.equal(topics[1].getAttribute('aria-pressed'), 'true');
  topics[2].click();
  assert(root.querySelector('.inspiration-question').textContent.includes('everyday moment'));
  assert.equal(topics[1].getAttribute('aria-pressed'), 'false');
  assert.equal(topics[2].getAttribute('aria-pressed'), 'true');
  for (const topic of topics) assert.equal(topic.type, 'button', 'exploration must not submit the sign-in form');
  assert.equal(writes(), 0);
  assert.deepEqual(calls.map(call => call.url), ['/client-config']);
});

test('another inspiration is explicit and the story action focuses sign-in without submitting', async t => {
  const { root, calls, writes } = await install(t);
  const question = root.querySelector('.inspiration-question');
  const original = question.textContent;
  const another = root.querySelector('.inspiration-next');
  another.click();
  assert.notEqual(question.textContent, original);
  another.click();
  assert.equal(question.textContent, original);
  root.querySelector('[data-topic=person]').click();
  another.click();
  assert(question.textContent.includes('taught you'));
  root.querySelector('[data-topic=person]').click();
  assert(question.textContent.includes('make you smile'), 'explicit topic choice returns to its first prompt');
  const email = document.getElementById('email');
  email.value = 'offline-person@example.invalid';
  root.querySelector('.inspiration-action').click();
  assert.equal(document.activeElement, email);
  assert.equal(email.value, 'offline-person@example.invalid');
  assert.equal(writes(), 0);
  assert.deepEqual(calls.map(call => call.url), ['/client-config']);
});
