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
      if (method === 'GET' && path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', enabled: true };
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
  assert(find('Send selected transcript · Real AI').disabled);
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
      if (method === 'GET' && path === '/api/v2/capabilities') return { contract: 'real-v2', mode: 'real', enabled: true };
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
  return { root, find, click, calls, paidCalls: () => paidCalls };
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
      if (method === 'GET' && path === `/api/v2/conversation-messages/${assistantId}/speech`) { metadataGets++; if (options.metadataError) throw options.metadataError; return { ...metadata }; }
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
  assert(view.find('Listen to Memy · Real AI').disabled);
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
