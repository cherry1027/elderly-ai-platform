/**
 * Offline tests: all API, microphone and media behavior below is synthetic.
 * Run with an existing project dependency installation:
 *   node --test web-preview/workspace.test.mjs
 * If this checkout has no node_modules, reuse another installed jsdom:
 *   MEMY_JSDOM_PATH=/absolute/path/to/node_modules/jsdom/lib/api.js \
 *     node --test web-preview/workspace.test.mjs
 * No package installation, server, account, credentials or network is needed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createWorkspace, safePdfName, verifySpeech } from './workspace.js';

let JSDOM;
try {
  ({ JSDOM } = await import(process.env.MEMY_JSDOM_PATH
    ? pathToFileURL(process.env.MEMY_JSDOM_PATH).href : 'jsdom'));
} catch (cause) {
  throw new Error('Use the existing jsdom dependency, or set MEMY_JSDOM_PATH to its absolute lib/api.js path. See this file’s run instructions.', { cause });
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  transcript: '33333333-3333-4333-8333-333333333333',
  memory: '44444444-4444-4444-8444-444444444444',
  draft: '55555555-5555-4555-8555-555555555555',
};

function installDOM(t) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost', pretendToBeVisual: true });
  const descriptors = new Map(['document', 'Node', 'navigator', 'MediaRecorder', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cleanup = [];
  let hidden = false;
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true });
  // Any accidental request outside the fake API fails this test immediately.
  Object.defineProperty(globalThis, 'fetch', { value: () => { throw Error('Unexpected network request in offline workspace test'); }, configurable: true });
  t.after(() => {
    cleanup.forEach(callback => callback());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    root: document.querySelector('main'),
    onCleanup(callback) { cleanup.push(callback); },
    visibility(value) { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); },
  };
}

test('owned workspace reads, recorder finalization, explicit pending reconciliation and review safeguards', async t => {
  const { root, visibility, onCleanup } = installDOM(t);
  const calls = [], when = '2026-01-01T12:00:00Z';
  const project = { id: ids.project, title: '<script>unsafe fixture</script>', language: 'en', description: null, updated_at: when };
  const session = { id: ids.session, project_id: ids.project, language: 'en', status: 'active', created_at: when };
  const transcript = { transcript_id: ids.transcript, text: 'Synthetic original memory', created_at: when, provenance: { model: 'synthetic-test-model' } };
  const memory = { id: ids.memory, fact_type: 'event', value: 'Synthetic fact', evidence: transcript.text, version: 1, status: 'pending' };
  const draft = { draft_id: ids.draft, version: 1, revision: 1, content: 'Synthetic draft prose', original_content: 'Synthetic original draft', updated_at: when,
    verification: { status: 'needs_review', method: 'model_review_v1', sources_current: true, unsupported_claims: [] }, source_memories: [], provenance: { model: 'synthetic-test-model' } };
  let pending = false, conversationDone = false, paidCalls = 0, reconciliations = 0;
  const api = {
    hasPending: () => pending,
    async call(method, path, options) {
      calls.push({ method, path, options });
      if (method === 'GET' && path === '/api/v1/story-projects?limit=100&offset=0') return [project];
      if (method === 'GET' && path === `/api/v1/story-projects/${ids.project}`) return project;
      if (method === 'POST' && path === `/api/v1/story-projects/${ids.project}/continue`) { assert.deepEqual(options.json, {}); return { session }; }
      if (method === 'PATCH' && path === `/api/v2/memories/${ids.memory}`) {
        assert.deepEqual(options.json, { expected_version: 1, status: 'confirmed' }); return memory;
      }
      const collections = {
        [`/api/v2/story-projects/${ids.project}/drafts`]: [draft],
        [`/api/v2/story-projects/${ids.project}/exports`]: [],
        [`/api/v1/story-projects/${ids.project}/sessions`]: [session],
        [`/api/v2/story-sessions/${ids.session}/transcripts`]: [transcript],
        [`/api/v2/story-sessions/${ids.session}/messages`]: conversationDone
          ? [{ id: ids.transcript, role: 'user', sequence: 1, text: transcript.text, source_transcript_id: ids.transcript }] : [],
        [`/api/v2/story-sessions/${ids.session}/memories`]: [memory],
      };
      for (const [base, rows] of Object.entries(collections)) {
        if (method === 'GET' && path === `${base}?limit=100&offset=0`) return rows;
      }
      assert.fail(`Unexpected fake API request: ${method} ${path}`);
    },
    async paid(kind, path, options) {
      paidCalls++;
      assert.equal(kind, 'conversation');
      assert.equal(path, `/api/v2/story-sessions/${ids.session}/messages`);
      assert.deepEqual(options.scope, { projectId: ids.project, sessionId: ids.session, language: 'en' });
      assert.deepEqual(options.json, { source_transcript_id: ids.transcript, language: 'en' });
      pending = true;
      throw Error('Synthetic uncertain response');
    },
    async reconcile() { reconciliations++; pending = false; conversationDone = true; return {}; },
  };

  let recorder, stoppedTracks = 0, microphoneRequests = 0;
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(_tracks, options) { this.mimeType = options.mimeType; this.state = 'inactive'; recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    // Deliberately defer onstop to reproduce the browser's asynchronous stop.
    finish() { this.ondataavailable({ data: new Blob(['synthetic test audio']) }); this.onstop(); }
  }
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { async getUserMedia() {
    microphoneRequests++; return { getTracks: () => [{ stop() { stoppedTracks++; } }] };
  } } }, configurable: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { value: FakeRecorder, configurable: true });
  const find = name => [...root.querySelectorAll('button')].find(node => node.textContent === name);
  const click = async name => { const node = find(name); assert(node, `Button exists: ${name}`); assert(!node.disabled, `Button enabled: ${name}`); node.click(); await tick(); };
  const workspace = createWorkspace({ root, api, user: { email: 'synthetic-user@example.invalid' } });
  onCleanup(() => workspace.dispose());

  await tick();
  assert(root.textContent.includes(project.title));
  assert.equal(root.querySelectorAll('script').length, 0, 'saved titles are text rather than executable markup');
  assert(!root.textContent.includes('false'), 'empty branches do not become visible text');
  assert.equal(microphoneRequests, 0, 'opening the workspace does not access the microphone');
  await click('Open story');
  assert(root.textContent.includes(transcript.text));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'opening a story only resumes its session');
  assert.equal(paidCalls, 0, 'reading saved data never invokes a provider');
  assert(find('Start recording').disabled, 'microphone access needs explicit consent');
  root.querySelector('input[type=checkbox]').click();
  await click('Start recording');
  assert.equal(microphoneRequests, 1);
  assert.equal(recorder.state, 'recording');
  await click('Stop recording · 0s');
  assert(find('Finishing recording…').disabled, 'a second recording cannot start before onstop');
  assert(root.querySelector('input[type=file]').disabled, 'a file cannot replace audio during finalization');
  assert.equal(paidCalls, 0, 'stopping a recording never transcribes automatically');
  recorder.finish();
  assert(root.textContent.includes('Recording is held in memory'));
  assert(!find('Save transcript · Real AI').disabled);
  assert(stoppedTracks >= 2, 'microphone tracks are stopped when capture ends');
  visibility(true);
  assert(root.hidden, 'private story prose is hidden in the background');
  visibility(false);
  assert(!root.hidden);
  assert(find('Save transcript · Real AI').disabled, 'background cleanup removes raw audio and consent');

  const send = find('Send selected transcript · Real AI');
  send.click(); send.click(); await tick();
  assert.equal(paidCalls, 1, 'a rapid second click cannot submit another turn');
  assert(find('Send selected transcript · Real AI').disabled, 'uncertain actions block a replacement provider call');
  await click('Reload saved action');
  assert.equal(reconciliations, 1);
  assert(find('Transcript already sent').disabled);
  assert.equal(paidCalls, 1, 'reconciliation reloads saved data without resending the turn');
  await click('Review memories');
  await click('Confirm');
  assert(calls.some(call => call.method === 'PATCH' && call.path === `/api/v2/memories/${ids.memory}`));
  await click('Drafts & PDFs');
  assert.equal(root.querySelector('textarea[aria-label="Draft content"]').value, draft.content);
  assert(find('Generate new draft · Real AI').disabled, 'generation needs a fresh explicit confirmation');
  workspace.dispose();
  assert.equal(root.textContent, '');
  assert.equal(root.hidden, false, 'the next signed-out view is allowed to display');
});

test('spoken reply integrity rejects hash, size and container changes', async () => {
  const wav = new Uint8Array(44);
  wav.set(new TextEncoder().encode('RIFF'));
  wav.set(new TextEncoder().encode('WAVE'), 8);
  new DataView(wav.buffer).setUint32(4, 36, true);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', wav)).toString('hex');
  const metadata = { audio_size: wav.length, audio_sha256: hash };
  await verifySpeech(wav, metadata);
  await assert.rejects(() => verifySpeech(wav, { ...metadata, audio_sha256: '0'.repeat(64) }));
  await assert.rejects(() => verifySpeech(wav, { ...metadata, audio_size: wav.length + 1 }));
  const wrongContainer = wav.slice(); wrongContainer[8] = 0;
  await assert.rejects(() => verifySpeech(wrongContainer, metadata));
});

test('PDF downloads accept only the backend filename pattern', () => {
  assert.equal(safePdfName(new Headers({ 'Content-Disposition': 'attachment; filename="memy-story.pdf"' })), 'memy-story.pdf');
  assert.equal(safePdfName(new Headers(), 'memy-saved-story.pdf'), 'memy-saved-story.pdf');
  assert.throws(() => safePdfName(new Headers(), '../../private.pdf'));
  assert.throws(() => safePdfName(new Headers({ 'Content-Disposition': 'attachment; filename="../../private.pdf"' })));
});
