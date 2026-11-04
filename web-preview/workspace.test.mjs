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
import { createApi } from './api.js';

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
      if (method === 'GET' && path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true };
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
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
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
  const stop = find('Stop recording'); stop.focus();
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(document.activeElement, stop, 'the live timer does not replace the focused Stop button');
  assert.equal(find('Stop recording'), stop, 'the same recording control stays mounted on timer ticks');
  assert(stop.textContent.includes('1s'));
  await click('Stop recording');
  assert(find('Finishing recording…').disabled, 'a second recording cannot start before onstop');
  assert(root.querySelector('input[type=file]').disabled, 'a file cannot replace audio during finalization');
  assert.equal(paidCalls, 0, 'stopping a recording never transcribes automatically');
  recorder.finish();
  assert(root.textContent.includes('Saving your words'));
  assert(!find('Save transcript · Real AI').disabled);
  assert(stoppedTracks >= 2, 'microphone tracks are stopped when capture ends');
  visibility(true);
  assert(root.hidden, 'private story prose is hidden in the background');
  visibility(false);
  assert(!root.hidden);
  assert(find('Save transcript · Real AI').disabled, 'background cleanup removes raw audio and consent');

  const send = find('Get Memy’s reply');
  send.click(); send.click(); await tick();
  assert.equal(paidCalls, 1, 'a rapid second click cannot submit another turn');
  assert(find('Get Memy’s reply').disabled, 'uncertain actions block a replacement provider call');
  await click('Reload saved action');
  assert.equal(reconciliations, 1);
  assert(find('Transcript already sent').disabled);
  assert.equal(paidCalls, 1, 'reconciliation reloads saved data without resending the turn');
  await click('Review memories');
  await click('Confirm');
  assert(calls.some(call => call.method === 'PATCH' && call.path === `/api/v2/memories/${ids.memory}`));
  await click('Your autobiography');
  assert.equal(root.querySelector('.book-reader .book-paragraph').textContent, draft.content);
  assert.equal(root.querySelector('textarea[aria-label="Draft content"]'), null, 'reading a saved story is not an editing form');
  assert(find('Generate new draft · Real AI').disabled, 'generation needs a fresh explicit confirmation');
  await click('Edit your story');
  const edit = root.querySelector('textarea[aria-label="Draft content"]');
  assert.equal(edit.value, draft.content);
  edit.value = 'My own unsaved wording'; edit.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  assert(!find('Save revision').disabled, 'typing enables the explicit save action immediately');
  await click('Reload saved story');
  assert.equal(root.querySelector('textarea[aria-label="Draft content"]').value, 'My own unsaved wording', 'rereading saved resources does not replace unsaved editor text');
  assert(!find('Save revision').disabled);
  visibility(true); visibility(false);
  assert.equal(root.querySelector('textarea[aria-label="Draft content"]'), null, 'backgrounding clears private unsaved editing memory');
  assert.equal(root.querySelector('.book-reader .book-paragraph').textContent, draft.content);
  workspace.dispose();
  assert.equal(root.textContent, '');
  assert.equal(root.hidden, false, 'the next signed-out view is allowed to display');
});

test('paused AI keeps saved reading, memory review and deliberate editing available', async t => {
  const { root, onCleanup } = installDOM(t);
  const when = '2026-01-01T12:00:00Z';
  const project = { id: ids.project, title: 'A synthetic saved story', language: 'en', updated_at: when };
  const session = { id: ids.session, project_id: ids.project, status: 'active', created_at: when };
  let memory = { id: ids.memory, fact_type: 'event', value: 'Synthetic saved fact', evidence: 'Synthetic source', version: 1, status: 'pending' };
  let draft = { draft_id: ids.draft, version: 1, revision: 1, content: 'Saved synthetic wording.', original_content: 'Saved synthetic wording.', updated_at: when,
    verification: { status: 'needs_review', sources_current: true, unsupported_claims: [] }, source_memories: [] };
  const writes = [];
  const api = {
    hasPending: () => false,
    async paid() { assert.fail('A paused workspace must not submit provider work.'); },
    async call(method, path, options) {
      if (method === 'GET' && path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', enabled: false, reason: 'AI_SPENDING_NOT_APPROVED' };
      if (method === 'GET' && path === `/api/v1/story-projects/${ids.project}`) return project;
      if (method === 'POST' && path === `/api/v1/story-projects/${ids.project}/continue`) return { session };
      const collections = {
        '/api/v1/story-projects': [project],
        [`/api/v2/story-projects/${ids.project}/drafts`]: [draft],
        [`/api/v2/story-projects/${ids.project}/exports`]: [],
        [`/api/v1/story-projects/${ids.project}/sessions`]: [session],
        [`/api/v2/story-sessions/${ids.session}/transcripts`]: [{ transcript_id: ids.transcript, text: 'Synthetic original words', created_at: when }],
        [`/api/v2/story-sessions/${ids.session}/messages`]: [],
        [`/api/v2/story-sessions/${ids.session}/memories`]: [memory],
      };
      for (const [base, rows] of Object.entries(collections)) if (method === 'GET' && path === `${base}?limit=100&offset=0`) return rows;
      if (method === 'PATCH' && path === `/api/v2/memories/${ids.memory}`) {
        assert.deepEqual(options.json, { expected_version: 1, status: 'confirmed' });
        writes.push(path); memory = { ...memory, version: 2, status: 'confirmed' }; return memory;
      }
      if (method === 'PATCH' && path === `/api/v2/story-drafts/${ids.draft}`) {
        assert.deepEqual(options.json, { expected_revision: 1, content: 'My deliberate revision.' });
        writes.push(path); draft = { ...draft, revision: 2, content: options.json.content }; return draft;
      }
      assert.fail(`Unexpected fake API request: ${method} ${path}`);
    },
  };
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); };
  const workspace = createWorkspace({ root, api, user: { email: 'synthetic-user@example.invalid' } });
  onCleanup(() => workspace.dispose()); await tick();
  assert(root.textContent.includes('AI testing is currently paused.'));
  const newTitle = root.querySelector('input[name=title]');
  newTitle.value = 'My unfinished new title'; newTitle.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  await click('Reload stories');
  assert.equal(root.querySelector('input[name=title]').value, 'My unfinished new title', 'presentation refresh retains unsaved form input');
  await click('Open story');
  assert(find('Get Memy’s reply').disabled);
  await click('Review memories'); await click('Confirm');
  await click('Your autobiography');
  assert(root.querySelector('.book-reader').textContent.includes(draft.content));
  assert(find('Generate new draft · Real AI').disabled);
  await click('Edit your story');
  const content = root.querySelector('[aria-label="Draft content"]');
  content.value = 'My deliberate revision.'; content.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  assert(!find('Save revision').disabled, 'typing enables Save without replacing the editor');
  await click('Save revision');
  assert(root.querySelector('.book-reader').textContent.includes('My deliberate revision.'));
  assert.equal(writes.length, 2, 'only the two explicit non-provider writes were made');
});

async function microphoneTestWorkspace(t, getUserMedia, Recorder = class {
  static isTypeSupported() { return true; }
  constructor() { assert.fail('A rejected microphone request must not construct a recorder.'); }
}) {
  const { root, onCleanup } = installDOM(t);
  const when = '2026-01-01T12:00:00Z';
  const project = { id: ids.project, title: 'Synthetic microphone check', language: 'en', updated_at: when };
  const session = { id: ids.session, project_id: ids.project, status: 'active', created_at: when };
  const calls = []; let paidCalls = 0;
  const api = {
    hasPending: () => false,
    async paid() { paidCalls++; assert.fail('A microphone failure must not dispatch paid work.'); },
    async call(method, path) {
      calls.push({ method, path });
      if (method === 'GET' && path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true };
      if (method === 'GET' && path === '/api/v1/story-projects?limit=100&offset=0') return [project];
      if (method === 'GET' && path === `/api/v1/story-projects/${ids.project}`) return project;
      if (method === 'POST' && path === `/api/v1/story-projects/${ids.project}/continue`) return { session };
      if (method === 'GET' && /\/(drafts|exports|sessions|transcripts|messages|memories)\?limit=100&offset=0$/.test(path)) return [];
      assert.fail(`Unexpected fake API request: ${method} ${path}`);
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { value: Recorder, configurable: true });
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); };
  const workspace = createWorkspace({ root, api, user: { email: 'synthetic-user@example.invalid' } });
  onCleanup(() => workspace.dispose()); await tick(); await click('Open story');
  return { root, find, click, calls, api, paidCalls: () => paidCalls };
}

test('system microphone denial shows recovery and preserves an unsent file without upload or retry', async t => {
  let microphoneRequests = 0;
  const { root, find, click, calls, paidCalls } = await microphoneTestWorkspace(t, async () => {
    microphoneRequests++; throw new DOMException('Permission denied by system', 'NotAllowedError');
  });
  const fileInput = root.querySelector('input[type=file]');
  const selected = new document.defaultView.File(['synthetic audio bytes'], 'unsent-memory.wav', { type: 'audio/wav' });
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [selected] });
  fileInput.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  root.querySelector('input[type=checkbox]').click();
  const callsBefore = calls.length;
  await click('Start recording'); await tick();
  const alert = root.querySelector('.notice.error');
  assert(alert.textContent.includes('Microphone access is blocked by your browser or system.'));
  assert(alert.textContent.includes('system privacy settings'));
  assert(!root.textContent.includes('Permission denied by system'), 'raw browser error is replaced with guidance');
  const fallback = [...root.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === 'Use an audio file instead');
  assert(fallback.open, 'the alternative audio input is opened after denial');
  assert(!root.querySelector('input[type=file]').disabled);
  assert(root.textContent.includes('unsent-memory.wav'), 'denial preserves previously selected unsent audio');
  assert(!find('Save transcript · Real AI').disabled, 'upload stays an explicit separate user action');
  assert.equal(microphoneRequests, 1, 'there is no automatic permission retry');
  assert.equal(calls.length, callsBefore, 'permission failure makes no API call');
  assert.equal(paidCalls(), 0, 'permission failure never consumes a provider attempt');
});

test('microphone failures give safe distinct guidance and stop acquired tracks if recording cannot start', async t => {
  for (const [name, expected] of [
    ['SecurityError', 'Microphone access is blocked'],
    ['NotFoundError', 'No microphone was found'],
    ['DevicesNotFoundError', 'No microphone was found'],
    ['NotReadableError', 'Your microphone could not be opened'],
    ['TrackStartError', 'Your microphone could not be opened'],
    ['UnexpectedError', 'Microphone recording could not start'],
  ]) {
    await t.test(name, async t => {
      let requests = 0;
      const { root, click, paidCalls } = await microphoneTestWorkspace(t, async () => {
        requests++; throw Object.assign(Error('RAW_PRIVATE_DRIVER_DETAIL'), { name });
      });
      root.querySelector('input[type=checkbox]').click(); await click('Start recording');
      assert(root.querySelector('.notice.error').textContent.includes(expected));
      assert(!root.textContent.includes('RAW_PRIVATE_DRIVER_DETAIL'));
      assert.equal(requests, 1); assert.equal(paidCalls(), 0);
    });
  }
  await t.test('recorder initialization failure', async t => {
    let stopped = 0;
    class FailingRecorder { static isTypeSupported() { return true; } constructor() { throw Error('RAW_PRIVATE_DRIVER_DETAIL'); } }
    const { root, click, paidCalls } = await microphoneTestWorkspace(t, async () => ({ getTracks: () => [{ stop() { stopped++; } }] }), FailingRecorder);
    root.querySelector('input[type=checkbox]').click(); await click('Start recording');
    assert.equal(stopped, 1, 'an acquired microphone is released after initialization fails');
    assert(root.querySelector('.notice.error').textContent.includes('Recording could not start'));
    assert(!root.textContent.includes('RAW_PRIVATE_DRIVER_DETAIL'));
    assert.equal(paidCalls(), 0);
  });
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

async function speechTestWorkspace(t, options = {}) {
  const dom = installDOM(t);
  const { root, onCleanup } = dom;
  const now = new Date().toISOString();
  const assistantId = '66666666-6666-4666-8666-666666666666';
  const speechId = '77777777-7777-4777-8777-777777777777';
  const project = { id: ids.project, title: 'Synthetic spoken reply test', language: 'en', updated_at: now };
  const session = { id: ids.session, project_id: project.id, language: 'en', status: 'active', created_at: now };
  const message = { id: assistantId, project_id: project.id, session_id: session.id, role: 'assistant', language: 'en', text: 'Synthetic saved interviewer reply.', sequence: 2, ...options.messagePatch };
  const bytes = new Uint8Array(44); bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WAVE'), 8); new DataView(bytes.buffer).setUint32(4, 36, true);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  let metadata = { speech_id: speechId, assistant_message_id: assistantId, language: 'en', media_type: 'audio/wav', audio_sha256: digest, audio_size: bytes.length, expires_at: new Date(Date.now() + 300_000).toISOString(), status: 'ready', ...options.metadataPatch };
  let paidCalls = 0, audioGets = 0, metadataGets = 0, playCalls = 0, pauseCalls = 0;
  const players = [], revoked = [];
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:offline-speech-${players.length + 1}`;
  URL.revokeObjectURL = value => revoked.push(value);
  class FakeAudio {
    constructor(url) { this.src = url; this.currentTime = 0; players.push(this); }
    async play() { playCalls++; if (options.playFailure?.(playCalls)) throw new DOMException('RAW_PRIVATE_AUDIO_DEVICE_DETAIL', 'NotAllowedError'); }
    pause() { pauseCalls++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
  const api = {
    hasPending: () => false,
    async paid(kind, path, payload) {
      paidCalls++;
      assert.equal(kind, 'speech'); assert.equal(path, `/api/v2/conversation-messages/${assistantId}/speech`);
      assert.deepEqual(payload.scope, { projectId: project.id, sessionId: session.id, language: 'en' });
      return options.paidGate ? options.paidGate() : { ...metadata };
    },
    async call(method, path) {
      if (path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', enabled: options.enabled !== false };
      if (path === '/api/v1/story-projects?limit=100&offset=0') return [project];
      if (path === `/api/v1/story-projects/${project.id}`) return project;
      if (method === 'POST' && path === `/api/v1/story-projects/${project.id}/continue`) return { session };
      if (method === 'GET' && path === `/api/v2/conversation-messages/${assistantId}/speech`) { metadataGets++; if (options.metadataError) throw options.metadataError; if (!paidCalls && !options.prepared && options.enabled !== false && !options.metadataPatch) throw Object.assign(Error('No prepared audio'), { status: 404 }); return { ...metadata }; }
      if (method === 'GET' && path === `/api/v2/spoken-replies/${speechId}/audio`) { audioGets++; return options.audioGate ? options.audioGate() : { bytes: bytes.slice(), headers: new Headers({ 'Content-Type': 'audio/wav' }) }; }
      if (method === 'GET' && path === `/api/v2/story-sessions/${session.id}/messages?limit=100&offset=0`) return [message];
      if (method === 'GET' && /\/(drafts|exports|sessions|transcripts|memories)\?limit=100&offset=0$/.test(path)) return [];
      assert.fail(`Unexpected offline speech API request: ${method} ${path}`);
    },
  };
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); await tick(); };
  const workspace = createWorkspace({ root, api, user: { email: 'synthetic-speech-user@example.invalid' } });
  onCleanup(() => { workspace.dispose(); URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL; if (audioDescriptor) Object.defineProperty(globalThis, 'Audio', audioDescriptor); else delete globalThis.Audio; });
  await tick(); await click('Open story');
  return { ...dom, workspace, find, click, players, revoked, bytes, metadata,
    setMetadata(value) { metadata = value; }, counts: () => ({ paidCalls, audioGets, metadataGets, playCalls, pauseCalls }) };
}

test('prepared speech plays and stops for free, and background reload uses only saved audio', async t => {
  const view = await speechTestWorkspace(t);
  await view.click('Listen to Memy · Real AI');
  assert.equal(view.counts().paidCalls, 1); assert.equal(view.counts().audioGets, 1);
  assert(!view.find('Listen to Memy · Real AI'), 'ready metadata suppresses a duplicate paid preparation');
  await view.click('Play spoken reply'); await view.click('Stop spoken reply'); await view.click('Play spoken reply');
  assert.equal(view.counts().playCalls, 2); assert.equal(view.players[0].currentTime, 0);
  assert.equal(view.counts().paidCalls, 1, 'Stop and replay never re-synthesize');
  view.visibility(true); assert.equal(view.players[0].src, ''); assert(view.revoked.length);
  view.visibility(false);
  assert(view.find('Load prepared audio'), 'owned expiring metadata survives background cleanup');
  assert(!view.find('Play spoken reply'), 'audio bytes are not retained in the background');
  await view.click('Load prepared audio'); await view.click('Play spoken reply');
  assert.equal(view.counts().audioGets, 2); assert.equal(view.counts().paidCalls, 1);
  await view.click('Review memories'); await view.click('Conversation');
  assert(view.find('Load prepared audio'), 'tab change clears bytes but keeps the same owned prepared reply');
  await view.click('← All stories'); await view.click('Open story');
  assert(!view.find('Load prepared audio'), 'context change clears prepared metadata');
  assert(view.find('Check prepared spoken reply'), 'context re-entry permits an explicit authenticated recovery lookup');
});

test('prepared audio recovery works with AI paused and never makes a paid request', async t => {
  const view = await speechTestWorkspace(t, { enabled: false });
  assert(!view.find('Listen to Memy · Real AI').disabled, 'owned prepared audio remains readable while paid synthesis is paused');
  await view.click('Check prepared spoken reply');
  assert(view.root.textContent.includes('This lookup made no new AI request'));
  await view.click('Play spoken reply');
  assert.deepEqual({ paidCalls: view.counts().paidCalls, audioGets: view.counts().audioGets, metadataGets: view.counts().metadataGets }, { paidCalls: 0, audioGets: 1, metadataGets: 1 });
});

test('hidden paid completion keeps only owned metadata and requires explicit free loading', async t => {
  let resolve;
  const view = await speechTestWorkspace(t, { paidGate: () => new Promise(done => { resolve = done; }) });
  view.find('Listen to Memy · Real AI').click(); await tick();
  view.visibility(true); resolve(view.metadata); await tick(); await tick();
  assert.equal(view.counts().audioGets, 0, 'hidden completion does not fetch private audio bytes');
  assert.equal(view.players.length, 0);
  view.visibility(false); await view.click('Load prepared audio');
  assert.equal(view.counts().paidCalls, 1); assert.equal(view.counts().audioGets, 1);
});

test('late audio cannot revive bytes after background cleanup or disposed context', async t => {
  await t.test('background and return while GET is pending', async t => {
    let resolve;
    const view = await speechTestWorkspace(t, { audioGate: () => new Promise(done => { resolve = done; }) });
    view.find('Listen to Memy · Real AI').click(); await tick();
    view.visibility(true); view.visibility(false);
    const responseBytes = view.bytes.slice(); resolve({ bytes: responseBytes }); await tick(); await tick();
    assert.equal(view.players.length, 0); assert(responseBytes.every(value => value === 0));
    assert(view.find('Load prepared audio')); assert.equal(view.counts().paidCalls, 1);
  });
  await t.test('disposed before synthesis completes', async t => {
    let resolve;
    const view = await speechTestWorkspace(t, { paidGate: () => new Promise(done => { resolve = done; }) });
    view.find('Listen to Memy · Real AI').click(); await tick(); view.workspace.dispose();
    resolve(view.metadata); await tick(); await tick();
    assert.equal(view.root.textContent, ''); assert.equal(view.counts().audioGets, 0); assert.equal(view.players.length, 0);
  });
});

test('malformed or cross-context spoken metadata is rejected without downloading audio', async t => {
  for (const patch of [{ language: 'sv' }, { assistant_message_id: ids.memory }, { audio_sha256: 'bad' }, { audio_size: 9_000_000 }, { expires_at: 'not-a-date' }, { unexpected: 'untrusted' }]) {
    await t.test(JSON.stringify(Object.keys(patch)), async t => {
      const view = await speechTestWorkspace(t, { enabled: false, metadataPatch: patch });
      await view.click('Check prepared spoken reply');
      assert(view.root.querySelector('.notice.error')); assert.equal(view.counts().audioGets, 0); assert.equal(view.counts().paidCalls, 0);
    });
  }
  await t.test('assistant belongs to a different session', async t => {
    const view = await speechTestWorkspace(t, { enabled: false, messagePatch: { session_id: ids.memory } });
    await view.click('Check prepared spoken reply'); assert.equal(view.counts().audioGets, 0); assert(view.root.querySelector('.notice.error'));
  });
});

test('expired audio and playback failures never request automatic re-synthesis', async t => {
  await t.test('expired recovered metadata', async t => {
    const view = await speechTestWorkspace(t, { enabled: false, metadataPatch: { expires_at: new Date(Date.now() - 1000).toISOString() } });
    await view.click('Check prepared spoken reply');
    assert.equal(view.counts().paidCalls, 0); assert.equal(view.counts().audioGets, 0);
    assert(view.find('Create new spoken reply · Real AI').disabled); assert(!view.find('Play spoken reply'));
  });
  await t.test('play rejection and decoder error retain free recovery', async t => {
    const view = await speechTestWorkspace(t, { playFailure: attempt => attempt === 1 });
    await view.click('Listen to Memy · Real AI'); await view.click('Play spoken reply');
    assert(view.root.textContent.includes('Playback was blocked or interrupted'));
    assert(!view.root.textContent.includes('RAW_PRIVATE_AUDIO_DEVICE_DETAIL'));
    await view.click('Play spoken reply'); assert.equal(view.counts().paidCalls, 1);
    view.players[0].onerror();
    assert(view.find('Load prepared audio')); assert(!view.find('Listen to Memy · Real AI'));
    await view.click('Load prepared audio'); assert.equal(view.counts().audioGets, 2); assert.equal(view.counts().paidCalls, 1);
  });
});

test('memory inspiration stays local, matches the story language and clears across private contexts', async t => {
  for (const language of ['en', 'sv']) {
    await t.test(language, async t => {
      const { root, onCleanup, visibility } = installDOM(t);
      const now = '2026-10-31T12:00:00Z';
      const project = { id: ids.project, title: 'Synthetic inspiration check', language, updated_at: now };
      const session = { id: ids.session, project_id: project.id, language, status: 'active', created_at: now };
      const calls = [];
      const api = {
        hasPending: () => false,
        async paid() { assert.fail('Reading or selecting local inspiration must never invoke AI.'); },
        async call(method, path) {
          calls.push({ method, path });
          if (path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', enabled: false };
          if (path === '/api/v1/story-projects?limit=100&offset=0') return [project];
          if (path === `/api/v1/story-projects/${project.id}`) return project;
          if (method === 'POST' && path === `/api/v1/story-projects/${project.id}/continue`) return { session };
          if (method === 'GET' && path === `/api/v2/story-sessions/${session.id}/transcripts?limit=100&offset=0`) return [{ transcript_id: ids.transcript, text: 'Synthetic original, unchanged.', created_at: now }, { transcript_id: ids.memory, text: 'A second synthetic original.', created_at: now }];
          if (method === 'GET' && path === `/api/v2/story-sessions/${session.id}/memories?limit=100&offset=0`) return [{ id: ids.memory, status: 'confirmed' }, { id: ids.transcript, status: 'pending' }];
          if (method === 'GET' && path === `/api/v2/story-projects/${project.id}/drafts?limit=100&offset=0`) return [{ draft_id: ids.draft }];
          if (method === 'GET' && /\/(exports|sessions|messages)\?limit=100&offset=0$/.test(path)) return [];
          assert.fail(`Unexpected inspiration request: ${method} ${path}`);
        },
      };
      const workspace = createWorkspace({ root, api, user: { email: 'synthetic-inspiration@example.invalid' } });
      onCleanup(() => workspace.dispose()); await tick();
      const click = async name => {
        const button = [...root.querySelectorAll('button')].find(node => node.textContent === name);
        assert(button && !button.disabled); button.click(); await tick();
      };
      await click('Open story');
      const inspiration = root.querySelector('details.memory-inspiration');
      assert(inspiration.open, 'an empty conversation opens optional inspiration by default');
      assert.equal(inspiration.querySelector('summary').textContent, language === 'sv' ? 'Vill du ha lite inspiration?' : 'Need a little inspiration?');
      const progress = root.querySelector('.story-progress');
      assert.deepEqual([...progress.querySelectorAll('strong')].map(node => node.textContent), ['2', '1', '1']);
      assert(progress.textContent.includes(language === 'sv' ? 'i den här konversationen' : 'in this conversation'), 'counts state their actual session scope');
      const choices = [...root.querySelectorAll('.inspiration-choice')], before = calls.length;
      assert.equal(choices.length, 3);
      assert(choices[0].textContent.includes(language === 'sv' ? 'En välbekant plats' : 'A familiar place'));
      assert(choices.every(button => button.getAttribute('aria-pressed') === 'false'));
      const question = root.querySelector('.inspiration-question');
      const initial = question.textContent;
      choices[0].focus(); choices[0].click();
      assert.equal(document.activeElement, choices[0], 'choosing inspiration does not replace the focused button');
      assert.equal(choices[0].getAttribute('aria-pressed'), 'true');
      assert.notEqual(question.textContent, initial);
      const first = question.textContent, another = root.querySelector('.inspiration-another');
      another.focus(); another.click();
      assert.equal(document.activeElement, another, 'another question keeps keyboard focus');
      assert.notEqual(question.textContent, first);
      assert.equal(calls.length, before, 'topic selection and rotation make no API reads or writes');
      assert(root.querySelector('.inspiration-note').textContent.includes(language === 'sv' ? 'Inget skickas eller sparas' : 'never sends or saves'));
      assert(root.textContent.includes('Synthetic original, unchanged.'), 'local suggestions do not replace original transcripts');
      await click('Reload saved story');
      assert.equal(root.querySelector('.inspiration-choice').getAttribute('aria-pressed'), 'true', 'saved-data refresh preserves the local choice');
      root.querySelector('details.memory-inspiration').open = false; await tick();
      await click('Reload saved story');
      assert(!root.querySelector('details.memory-inspiration').open, 'an explicit close is retained even for an empty conversation');
      visibility(true); visibility(false);
      assert(root.querySelector('details.memory-inspiration').open, 'background cleanup returns to the default for an empty conversation');
      assert([...root.querySelectorAll('.inspiration-choice')].every(button => button.getAttribute('aria-pressed') === 'false'), 'background privacy cleanup clears the choice');
      root.querySelector('.inspiration-choice').click();
      await click('← All stories'); await click('Open story');
      assert([...root.querySelectorAll('.inspiration-choice')].every(button => button.getAttribute('aria-pressed') === 'false'), 'context re-entry starts with no retained choice');
      assert.equal(calls.filter(call => call.method !== 'GET').length, 2, 'only the two explicit session-continuation actions write');
    });
  }
});

test('saved conversations keep inspiration collapsed until explicitly opened, without sending requests', async t => {
  const view = await speechTestWorkspace(t, { enabled: false });
  let inspiration = view.root.querySelector('details.memory-inspiration');
  assert(!inspiration.open, 'existing messages remain the focus on entry');
  const before = view.counts();
  inspiration.querySelector('summary').click(); await tick();
  assert(inspiration.open, 'native summary supports explicit expansion');
  view.root.querySelector('.inspiration-choice').click();
  view.root.querySelector('.inspiration-another').click();
  assert.deepEqual(view.counts(), before, 'expanding and choosing inspiration performs no speech lookup, paid call or playback');
  await view.click('Reload saved story');
  inspiration = view.root.querySelector('details.memory-inspiration');
  assert(inspiration.open, 'saved-data refresh keeps an explicit expanded choice');
  inspiration.querySelector('summary').click(); await tick();
  await view.click('Reload saved story');
  assert(!view.root.querySelector('details.memory-inspiration').open, 'an explicit close stays closed');
  view.visibility(true); view.visibility(false);
  assert(!view.root.querySelector('details.memory-inspiration').open, 'privacy cleanup restores the collapsed existing-conversation default');
});

test('startup requests saved stories without waiting for the capability round trip', async t => {
  const { root, onCleanup } = installDOM(t);
  const requests = [];
  let releaseCapabilities;
  const gate = new Promise(resolve => { releaseCapabilities = resolve; });
  const api = {
    hasPending: () => false,
    async call(_method, path) {
      requests.push(path);
      if (path === '/api/v2/capabilities') { await gate; return { contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true }; }
      assert.equal(path, '/api/v1/story-projects?limit=100&offset=0');
      return [{ id: ids.project, title: 'Synthetic parallel startup', language: 'en' }];
    },
    async paid() { assert.fail('Startup cannot dispatch paid work.'); },
  };
  const workspace = createWorkspace({ root, api, user: {} });
  onCleanup(() => workspace.dispose());
  await tick();
  assert.deepEqual(requests, ['/api/v2/capabilities', '/api/v1/story-projects?limit=100&offset=0'],
    'both independent reads start in the same network wave');
  releaseCapabilities(); await tick();
  assert(root.textContent.includes('Synthetic parallel startup'));
  assert(!root.querySelector('.workspace-status.is-working'));
});

test('successful actions reload only changed collections, while an explicit reload remains complete', async t => {
  const { root, onCleanup } = installDOM(t);
  const now = '2026-01-01T12:00:00Z';
  const project = { id: ids.project, title: 'Synthetic efficient workflow', language: 'en', updated_at: now };
  const session = { id: ids.session, project_id: ids.project, status: 'active', created_at: now };
  const transcript = { transcript_id: ids.transcript, text: 'Synthetic immutable original.', created_at: now };
  const originalDraft = { draft_id: ids.draft, content: 'An earlier synthetic draft.', original_content: 'An earlier synthetic draft.', revision: 1, version: 1, updated_at: now,
    source_memories: [], verification: { sources_current: true, unsupported_claims: [] } };
  let transcripts = [], messages = [], memories = [], drafts = [originalDraft], exports = [];
  const exportId = '88888888-8888-4888-8888-888888888888';
  const pdf = () => ({ bytes: new TextEncoder().encode('%PDF-synthetic-offline'), headers: new Headers({ 'Content-Disposition': 'attachment; filename="memy-synthetic.pdf"' }) });
  const collectionReads = [], paidKinds = [];
  const api = {
    hasPending: () => false,
    async call(method, path, options) {
      if (path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true };
      if (path === `/api/v1/story-projects/${ids.project}`) return project;
      if (method === 'POST' && path.endsWith('/continue')) return { session };
      const match = /\/(story-projects|drafts|exports|sessions|transcripts|messages|memories)\?limit=100&offset=0$/.exec(path);
      if (method === 'GET' && match) {
        collectionReads.push(match[1]);
        return { 'story-projects': [project], drafts, exports, sessions: [session], transcripts, messages, memories }[match[1]];
      }
      if (method === 'PATCH' && path === `/api/v2/memories/${ids.memory}`) {
        memories = [{ ...memories[0], status: options.json.status, version: 2, clarification_question: null }];
        return memories[0];
      }
      if (method === 'PATCH' && path === `/api/v2/story-drafts/${ids.draft}`) {
        drafts = [{ ...drafts[0], content: options.json.content, revision: 2 }];
        return drafts[0];
      }
      if (method === 'POST' && path === `/api/v2/story-drafts/${ids.draft}/export`) {
        exports = [{ export_id: exportId, title: project.title, draft_version: 1, draft_revision: drafts[0].revision, page_count: 1, created_at: now, filename: 'memy-synthetic.pdf' }];
        return pdf();
      }
      if (method === 'GET' && path === `/api/v2/story-exports/${exportId}/download`) return pdf();
      assert.fail(`Unexpected efficiency-test request: ${method} ${path}`);
    },
    async paid(kind) {
      paidKinds.push(kind);
      if (kind === 'transcription') { transcripts = [transcript]; return transcript; }
      if (kind === 'conversation') {
        messages = [
          { id: ids.transcript, role: 'user', text: transcript.text, sequence: 1, source_transcript_id: ids.transcript },
          { id: '66666666-6666-4666-8666-666666666666', role: 'assistant', text: 'Synthetic saved reply.', sequence: 2 },
        ];
        memories = [{ id: ids.memory, fact_type: 'event', value: 'Synthetic candidate', evidence: transcript.text, status: 'pending', version: 1,
          clarification_question: 'Which synthetic year was it?' }];
        drafts = [{ ...originalDraft, verification: { ...originalDraft.verification, sources_current: false, reason: 'A new clarification needs review.' } }];
        return { user_message: messages[0], message: messages[1], memories };
      }
      assert.equal(kind, 'generation');
      drafts = [{ draft_id: ids.draft, content: 'Synthetic generated prose.', original_content: 'Synthetic generated prose.', revision: 1, version: 1, updated_at: now,
        source_memories: [], verification: { sources_current: true, unsupported_claims: [] } }];
      return drafts[0];
    },
  };
  let recorder;
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(_tracks, options) { this.mimeType = options.mimeType; this.state = 'inactive'; recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish() { this.ondataavailable({ data: new Blob(['synthetic audio']) }); this.onstop(); }
  }
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() {} }] }; } } }, configurable: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { value: FakeRecorder, configurable: true });
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); };
  const readsAfter = async (name, expected) => {
    const start = collectionReads.length; await click(name);
    assert.deepEqual(collectionReads.slice(start).sort(), expected.sort(), `${name} does not reload unrelated collections`);
    assert(!root.querySelector('.workspace-status.is-working'), 'action finishes after its relevant saved reads');
  };
  const workspace = createWorkspace({ root, api, user: {} });
  onCleanup(() => workspace.dispose()); await tick(); await click('Open story');
  root.querySelector('input[type=checkbox]').click();
  await click('Start recording'); await click('Stop recording'); recorder.finish();
  await readsAfter('Save transcript · Real AI', ['transcripts']);
  assert(root.textContent.includes(transcript.text));
  assert.deepEqual(paidKinds, ['transcription'], 'saving the transcript never automatically sends the conversation turn');
  await readsAfter('Get Memy’s reply', ['messages', 'memories', 'drafts']);
  assert(root.textContent.includes('Synthetic saved reply.'));
  await click('Your autobiography');
  assert(root.textContent.includes('Source memories have changed.'), 'a new conversation clarification refreshes existing-draft freshness');
  assert(root.textContent.includes('A new clarification needs review.'));
  await click('Review memories');
  await readsAfter('Confirm', ['memories', 'drafts']);
  await click('Your autobiography');
  root.querySelector('.generation-panel input[type=checkbox]').click();
  await readsAfter('Generate new draft · Real AI', ['drafts']);
  await click('Edit your story');
  const editor = root.querySelector('textarea[aria-label="Draft content"]');
  editor.value = 'My efficient manual revision.'; editor.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  await readsAfter('Save revision', ['drafts']);
  assert(root.textContent.includes('My efficient manual revision.'));
  await readsAfter('Reload saved story', ['drafts', 'exports', 'sessions', 'transcripts', 'messages', 'memories']);
  await readsAfter('Prepare PDF', ['exports']);
  assert(root.querySelector('a[download="memy-synthetic.pdf"]'), 'the verified PDF is available after its metadata refresh');
  await readsAfter('Prepare saved PDF download', []);
  assert.deepEqual(paidKinds, ['transcription', 'conversation', 'generation'], 'all provider work remains explicit and unrepeated');
});

test('startup failure waits for late capabilities before rendering the final control state', async t => {
  const { root, onCleanup } = installDOM(t);
  const project = { id: ids.project, title: 'Synthetic startup recovery', language: 'en' };
  const session = { id: ids.session, project_id: project.id, language: 'en', status: 'active' };
  let releaseCapabilities, libraryReads = 0;
  const gate = new Promise(resolve => { releaseCapabilities = resolve; });
  const api = {
    hasPending: () => false,
    async paid() { assert.fail('Startup recovery cannot dispatch paid work.'); },
    async call(method, path) {
      if (path === '/api/v2/capabilities') { await gate; return { contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true }; }
      if (path === '/api/v1/story-projects?limit=100&offset=0') {
        if (++libraryReads === 1) throw Error('Synthetic library failure');
        return [project];
      }
      if (path === `/api/v1/story-projects/${project.id}`) return project;
      if (method === 'POST' && path.endsWith('/continue')) return { session };
      if (path === `/api/v2/story-sessions/${session.id}/transcripts?limit=100&offset=0`) return [{ transcript_id: ids.transcript, text: 'Synthetic saved words.', created_at: '2026-01-01T12:00:00Z' }];
      if (/\/(drafts|exports|sessions|messages|memories)\?limit=100&offset=0$/.test(path)) return [];
      assert.fail(`Unexpected startup-recovery request: ${method} ${path}`);
    },
  };
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); };
  const workspace = createWorkspace({ root, api, user: {} });
  onCleanup(() => workspace.dispose());
  await tick();
  assert(root.querySelector('.workspace-status.is-working'), 'early library failure does not finalize before capabilities settle');
  assert(!root.querySelector('.notice.error'));
  releaseCapabilities(); await tick();
  assert(root.querySelector('.notice.error').textContent.includes('Synthetic library failure'));
  assert(!root.querySelector('.workspace-status.is-working'));
  await click('Reload stories'); await click('Open story');
  assert(find('Get Memy’s reply') && !find('Get Memy’s reply').disabled,
    'the recovered story uses the completed capability state without another capability request');
});

test('a server-confirmed unsent generation releases the held UI and explains the draft-to-PDF sequence', async t => {
  const { root, onCleanup } = installDOM(t);
  const project = { id: ids.project, title: 'Synthetic PDF recovery', language: 'en' };
  const session = { id: ids.session, project_id: project.id, language: 'en', status: 'active' };
  const operationId = '99999999-9999-4999-8999-999999999999';
  let generationPosts = 0;
  const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const api = createApi({ getAccessToken: async () => 'synthetic-token', invalidate() {} }, {
    makeId: () => ids.draft,
    request: async (path, options) => {
      if (path === '/api/v2/capabilities') return reply({ contract: 'real-v2', mode: 'real', transcription: true, conversation: true, writing: true, speech: true, enabled: true });
      if (path === '/api/v1/story-projects?limit=100&offset=0') return reply([project]);
      if (path === `/api/v1/story-projects/${project.id}`) return reply(project);
      if (options.method === 'POST' && path.endsWith('/continue')) return reply({ session });
      if (options.method === 'POST' && path.endsWith('/generate')) {
        generationPosts++;
        return reply({ error: { code: 'AI_USAGE_LIMIT' } }, 429, { 'X-Memy-Operation-Id': operationId });
      }
      if (path === `/api/v2/operations/by-key/generation/${ids.draft}`) return reply({
        operation_id: operationId, kind: 'generation', status: 'failed', project_id: project.id, session_id: null,
        created_at: '2026-11-02T12:00:00Z', updated_at: '2026-11-02T12:00:01Z', error_code: 'AI_USAGE_LIMIT', result: null,
      });
      if (/\/(drafts|exports|sessions|transcripts|messages|memories)\?limit=100&offset=0$/.test(path)) return reply([]);
      assert.fail(`Unexpected draft-recovery request: ${options.method} ${path}`);
    },
  });
  const find = name => [...root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const node = find(name); assert(node && !node.disabled, `Enabled button: ${name}`); node.click(); await tick(); await tick(); };
  const workspace = createWorkspace({ root, api, user: {} });
  onCleanup(() => { workspace.dispose(); api.dispose(); });
  await tick(); await tick(); await click('Open story'); await click('Your autobiography');
  assert(root.textContent.includes('No autobiography draft is saved yet.'));
  assert(root.textContent.includes('Writing a new draft uses Real AI and its testing allowance.'));
  assert(root.textContent.includes('Preparing or downloading a PDF from a saved draft makes no AI request.'));
  assert(!find('Prepare PDF'), 'PDF export requires an actual saved draft');
  root.querySelector('.generation-panel input[type=checkbox]').click();
  await click('Generate new draft · Real AI');
  assert(api.hasPending());
  assert(root.textContent.includes('Your saved stories are still safe.'));
  await click('Reload saved action');
  assert(!api.hasPending());
  assert(!find('Reload saved action'), 'verified unsent work no longer traps every later action');
  assert(root.querySelector('.notice.error').textContent.includes('stopped before sending an AI request'));
  await click('Check AI availability');
  assert(!find('Generate new draft · Real AI').disabled, 'only a later explicit click may submit a new generation');
  assert.equal(generationPosts, 1, 'checking failure and availability never retries generation');
});

// These chat acceptance checks use only synthetic in-memory server responses.
async function typedWorkspace(t, { language = 'en', enabled = true, behavior = 'success' } = {}) {
  const view = installDOM(t), calls = [], when = '2026-11-03T12:00:00Z';
  const typedId = '66666666-6666-4666-8666-666666666666', replyId = '77777777-7777-4777-8777-777777777777';
  const project = { id: ids.project, title: 'Synthetic chat acceptance story', language, updated_at: when };
  const session = { id: ids.session, project_id: ids.project, language, status: 'active', created_at: when };
  let saved = [], savedMemories = [], release, turn, postCount = 0;
  const sendPath = `/api/v2/story-sessions/${ids.session}/text-messages`;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const api = createApi({ getAccessToken: async () => 'synthetic-test-token', invalidate() {} }, { makeId: () => '88888888-8888-4888-8888-888888888888', request: async (path, options) => {
    calls.push({ path, method: options.method, body: options.body });
    if (options.method === 'POST' && path === sendPath) {
      postCount++; const payload = JSON.parse(options.body);
      const common = { project_id: ids.project, session_id: ids.session, language, source_transcript_id: null, source_text_input_id: typedId, created_at: when };
      turn = { mode: 'real', user_message: { ...common, id: typedId, role: 'user', sequence: 1, text: payload.text, provenance: { mode: 'original', provider: 'user', model: null, version: 1 } },
        message: { ...common, id: replyId, role: 'assistant', sequence: 2, text: language === 'sv' ? 'Syntetiskt testsvar: vad minns du mer?' : 'Synthetic test reply: what else do you remember?', provenance: { mode: 'real', provider: 'openai', model: 'offline-test', version: 1 } }, memories: [] };
      if (behavior === 'failure') return json({ error: { code: 'AI_USAGE_LIMIT' } }, 429);
      if (behavior === 'uncertain') { saved = [turn.user_message, turn.message]; throw Error('Synthetic lost reply'); }
      return new Promise(resolve => { release = () => { saved = [turn.user_message, turn.message]; savedMemories = [{ id: ids.memory, fact_type: 'event', value: 'Synthetic unconfirmed fact', evidence: payload.text, status: 'pending', version: 1 }]; resolve(json(turn, 201)); }; });
    }
    if (options.method === 'GET' && path.startsWith('/api/v2/operations/by-key/')) return json({ operation_id: typedId, kind: 'conversation', status: 'completed', project_id: ids.project, session_id: ids.session, created_at: when, updated_at: when, error_code: null, result: turn });
    if (options.method === 'GET' && path === '/api/v2/capabilities') return json({ contract: 'real-v2', mode: 'real', enabled });
    if (options.method === 'GET' && path === '/api/v1/story-projects?limit=100&offset=0') return json([project]);
    if (options.method === 'GET' && path === `/api/v1/story-projects/${ids.project}`) return json(project);
    if (options.method === 'POST' && path.endsWith('/continue')) return json({ session });
    if (options.method === 'GET' && path.endsWith('/sessions?limit=100&offset=0')) return json([session]);
    if (options.method === 'GET' && path.endsWith('/messages?limit=100&offset=0')) return json(saved);
    if (options.method === 'GET' && path.endsWith('/memories?limit=100&offset=0')) return json(savedMemories);
    if (options.method === 'GET' && /\/(drafts|exports|transcripts)\?limit=100&offset=0$/.test(path)) return json([]);
    assert.fail(`Unexpected offline chat request ${options.method} ${path}`);
  } });
  const workspace = createWorkspace({ root: view.root, api, user: { email: 'synthetic@example.invalid' } });
  view.onCleanup(() => { workspace.dispose(); api.dispose(); });
  const find = name => [...view.root.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent) === name);
  const click = async name => { const button = find(name); assert(button, `Button exists: ${name}`); assert(!button.disabled, `Button enabled: ${name}`); button.click(); await tick(); };
  const write = value => { const field = view.root.querySelector('.chat-input'); assert(field); field.value = value; field.dispatchEvent(new document.defaultView.Event('input', { bubbles: true })); return field; };
  const ready = async () => { for (let count = 0; count < 100 && !release && behavior === 'success'; count++) await tick(); assert(behavior !== 'success' || release, 'synthetic POST is waiting'); };
  await tick(); await tick(); await click('Open story');
  return { ...view, api, calls, find, click, write, ready, release: () => release(), posts: () => postCount, workspace, sendPath };
}

test('typed chat sends exact words once, saves a real-contract reply and reopens shared history', async t => {
  const view = await typedWorkspace(t);
  assert(view.root.querySelector('#voice-options').hidden, 'voice is opt-in');
  assert.equal(view.posts(), 0);
  const original = '  Synthetic childhood memory.\nA little detail.  ';
  view.write(original);
  const send = view.root.querySelector('.chat-send'); assert(!send.disabled);
  send.click(); send.click();
  assert.match(view.root.querySelector('.workspace-status').textContent, /Memy is thinking/);
  await view.ready(); assert.equal(view.posts(), 1);
  view.release(); await tick(); await tick();
  assert.equal(view.root.querySelector('.chat-input').value, '');
  const user = view.root.querySelector('.bubble.user');
  assert.equal(user.querySelector('.prose').textContent, original);
  assert.equal(user.querySelector('.speaker-name').textContent, 'You · typed message');
  assert.equal(user.querySelector('.provenance-details'), null, 'the person’s original typed words are not labelled OpenAI');
  assert.match(view.root.querySelector('.bubble.assistant .provenance-details').textContent, /openai.*offline-test/);
  assert.match(view.root.querySelector('.chat-save-state').textContent, /are saved/);
  assert(view.find('Review suggested memories · 1'));
  assert(!view.calls.some(call => /transcribe|speech/.test(call.path)), 'typing never records, transcribes or speaks automatically');
  const paid = view.calls.filter(call => call.path === view.sendPath);
  assert.deepEqual(JSON.parse(paid[0].body), { text: original, language: 'en' });
  await view.click('← All stories'); await view.click('Open story');
  assert.equal(view.root.querySelector('.bubble.user .prose').textContent, original);
  assert(view.root.querySelector('.bubble.assistant'));
  assert.equal(view.posts(), 1);
  await view.click('Review suggested memories · 1');
  assert(view.root.querySelector('.memory-card.memory-pending'), 'reviewing does not automatically confirm facts');
});

test('composer handles Swedish, whitespace, length, newlines and IME without accidental submission', async t => {
  const view = await typedWorkspace(t, { language: 'sv' });
  assert.equal(view.root.querySelector('.chat-input').placeholder, 'Skriv ett minne eller ett svar…');
  assert(view.root.querySelector('.chat-send').textContent.includes('Skicka'));
  assert.match(view.root.querySelector('.chat-voice-toggle').textContent, /Använd rösten/);
  view.write(' \n '); assert(view.root.querySelector('.chat-send').disabled);
  view.write('a'.repeat(4001)); assert(view.root.querySelector('.chat-send').disabled);
  assert.match(view.root.querySelector('#chat-state').textContent, /4 000/);
  const field = view.write('När jag var liten i Örebro.');
  field.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  field.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  field.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, repeat: true, bubbles: true }));
  await tick(); assert.equal(view.posts(), 0);
  field.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await view.ready(); assert.match(view.root.querySelector('.workspace-status').textContent, /Memy tänker/);
  view.release(); await tick(); await tick();
  assert.match(view.root.querySelector('.bubble.user').textContent, /Du · skrivet meddelande/);
  assert.match(view.root.querySelector('#chat-state').textContent, /har sparats/);
});

test('a closed allowance preserves unsent words without retry and privacy cleanup clears them', async t => {
  const view = await typedWorkspace(t, { behavior: 'failure' });
  const original = 'Synthetic private words not saved after budget failure';
  view.write(original); view.root.querySelector('.chat-send').click();
  for (let count = 0; count < 8; count++) await tick();
  assert.equal(view.posts(), 1); assert.equal(view.api.hasPending(), false);
  assert.equal(view.root.querySelector('.chat-input').value, original);
  assert.match(view.root.querySelector('#chat-state').textContent, /Not sent/);
  assert.match(view.root.querySelector('[role=alert]').textContent, /AI allowance is currently used up/);
  assert(view.root.querySelector('.chat-send').disabled);
  view.visibility(true); view.visibility(false);
  assert.equal(view.root.querySelector('.chat-input').value, '');
  assert(!view.root.textContent.includes(original));
  view.write('Another unsent private draft');
  await view.click('← All stories'); await view.click('Open story');
  assert.equal(view.root.querySelector('.chat-input').value, '', 'project context clears unsent drafts');
  view.write('Cleared when signing out'); await view.click('Sign out');
  assert.equal(view.root.textContent, '');
});

test('uncertain typed result is recovered by GET only and clears the submitted composer', async t => {
  const view = await typedWorkspace(t, { behavior: 'uncertain' });
  view.write('Synthetic uncertain original'); view.root.querySelector('.chat-send').click();
  for (let count = 0; count < 8; count++) await tick();
  assert(view.api.hasPending()); assert(view.root.querySelector('.chat-input').disabled);
  assert.match(view.root.querySelector('#chat-state').textContent, /Checking your saved action/);
  await view.click('Reload saved action'); await tick();
  assert.equal(view.api.hasPending(), false); assert.equal(view.root.querySelector('.chat-input').value, '');
  assert(view.root.querySelector('.bubble.user')); assert.equal(view.posts(), 1);
  assert.equal(view.calls.filter(call => call.path.startsWith('/api/v2/operations/')).length, 1);
});

test('background during typed submission cannot revive the private composer, and voice toggle makes no request', async t => {
  const view = await typedWorkspace(t);
  const before = view.calls.length;
  await view.click('Use voice instead');
  assert.equal(view.root.querySelector('#voice-options').hidden, false);
  assert.equal(view.calls.length, before, 'showing voice options cannot open a microphone or submit an action');
  await view.click('Hide voice options');
  view.write('Synthetic unsent words before background'); view.root.querySelector('.chat-send').click();
  await view.ready(); view.visibility(true); view.visibility(false);
  assert.equal(view.root.querySelector('.chat-input').value, '');
  view.release(); await tick(); await tick();
  assert.equal(view.root.querySelector('.chat-input').value, '');
  assert(view.root.querySelector('.bubble.user'), 'the completed owned turn is still available as saved history');
});

test('paused AI still allows a private typed draft but never dispatches Send', async t => {
  const view = await typedWorkspace(t, { enabled: false });
  assert(!view.root.querySelector('.chat-input').disabled);
  view.write('A synthetic draft waiting for availability');
  assert(view.root.querySelector('.chat-send').disabled);
  assert.match(view.root.querySelector('.chat-paused').textContent, /AI is paused/);
  assert.equal(view.posts(), 0);
});

test('Listen first reuses already prepared owned audio without a paid generation', async t => {
  const app = await speechTestWorkspace(t, { prepared: true });
  await app.click('Listen to Memy · Real AI');
  assert.equal(app.counts().paidCalls, 0);
  assert.equal(app.counts().metadataGets, 1);
  assert.equal(app.counts().audioGets, 1);
});

test('record Stop saves once and replies once; an interrupted track never uploads', async t => {
  let recorder, stops = 0;
  const track = { onended: null, stop() { stops++; } };
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['synthetic voice']) }); this.onstop?.(); }, 0); }
  }
  const view = await microphoneTestWorkspace(t, async () => ({ getTracks: () => [track] }), Recorder);
  const paid = [];
  view.api.paid = async (kind, _path, options) => { paid.push(kind);
    if (kind === 'transcription') { assert.equal(options.form.get('consent'), 'true'); return { transcript_id: ids.transcript }; }
    assert.equal(options.json.source_transcript_id, ids.transcript); return {};
  };
  view.root.querySelector('input[type=checkbox]').click(); await view.click('Start recording');
  assert.equal(recorder.mimeType, 'audio/webm;codecs=opus');
  await view.click('Stop recording'); await tick(); await tick(); await tick();
  assert.deepEqual(paid, ['transcription', 'conversation']); assert(stops > 0); assert.equal(track.onended, null);
  view.root.querySelector('input[type=checkbox]').click(); await view.click('Start recording');
  track.onended(); await tick(); await tick();
  assert.deepEqual(paid, ['transcription', 'conversation']);
});

test('unsupported microphone format never asks permission or sends audio', async t => {
  let permissions = 0;
  class UnsupportedRecorder { static isTypeSupported() { return false; } }
  const view = await microphoneTestWorkspace(t, async () => { permissions++; throw Error('must not request'); }, UnsupportedRecorder);
  view.root.querySelector('input[type=checkbox]').click(); await view.click('Start recording');
  assert.equal(permissions, 0); assert.equal(view.paidCalls(), 0);
  assert(view.root.textContent.includes('cannot record a supported format'));
});
test('saved microphone transcription survives a reply failure without another upload', async t => {
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['synthetic voice']) }); this.onstop?.(); }, 0); }
  }
  const view = await microphoneTestWorkspace(t, async () => ({ getTracks: () => [{ stop() {} }] }), Recorder);
  const call = view.api.call, paid = []; let saved = false;
  const source = { transcript_id: ids.transcript, project_id: ids.project, session_id: ids.session, language: 'en', text: 'Synthetic saved words', created_at: '2026-01-01T00:00:00Z' };
  view.api.call = async (method, path) => saved && path.includes('/transcripts?') ? [source] : call(method, path);
  view.api.paid = async kind => { paid.push(kind); if (kind === 'transcription') { saved = true; return source; } throw Object.assign(Error('Memy is busy'), { recovery: 'wait' }); };
  view.root.querySelector('input[type=checkbox]').click(); await view.click('Start recording'); await view.click('Stop recording');
  await tick(); await tick(); await tick();
  assert.deepEqual(paid, ['transcription', 'conversation']);
  assert(view.root.textContent.includes(source.text)); assert(!view.find('Get Memy’s reply').disabled);
  await view.click('Get Memy’s reply'); assert.deepEqual(paid, ['transcription', 'conversation', 'conversation']);
  assert(view.find('Save transcript · Real AI').disabled, 'verified saved audio cannot be uploaded again');
});
