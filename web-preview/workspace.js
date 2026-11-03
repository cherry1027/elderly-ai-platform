const MAX_AUDIO = 25_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPEECH_FIELDS = ['speech_id', 'assistant_message_id', 'language', 'media_type', 'audio_sha256', 'audio_size', 'expires_at', 'status'];
const languages = { en: 'English', sv: 'Svenska' };
const chatCopy = {
  en: { eyebrow: 'ONE MEMORY AT A TIME', title: 'A conversation worth keeping.', intro: 'Write as you would talk to a friend. Memy will help you find the next little detail.', saved: 'Saved conversation', typed: 'You · typed message', voice: 'You · original transcript', interviewer: 'Memy · AI interviewer', label: 'What would you like to remember?', placeholder: 'Write a memory or answer…', send: 'Send', useVoice: 'Use voice instead', hideVoice: 'Hide voice options', hint: 'Your words stay yours. Memy’s reply uses AI; listening is optional.', idle: 'Not sent · only in this tab', thinking: 'Memy is thinking…', done: 'Your message and Memy’s reply are saved.', failed: 'Not sent. Your words are still here.', uncertain: 'Checking your saved action. Please don’t send again.', tooLong: 'Please keep your message to 4,000 characters.', counter: 'characters', review: 'Review suggested memories', reviewHint: 'You decide what belongs in your story.', emptyTitle: 'Let’s begin with a little memory.', empty: 'A familiar place, someone you remember, or a moment that still makes you smile. Start wherever feels right.', emptyNote: 'A gentle starting suggestion, not an AI reply.', paused: 'AI is paused. You can write here, but sending will wait until testing is available.', original: 'Saved in your own words', updated: 'Conversation saved. Review any suggested memories when you’re ready.' },
  sv: { eyebrow: 'ETT MINNE I TAGET', title: 'Ett samtal att bevara.', intro: 'Skriv som om du pratade med en vän. Memy hjälper dig att hitta nästa lilla detalj.', saved: 'Sparat samtal', typed: 'Du · skrivet meddelande', voice: 'Du · ursprunglig transkription', interviewer: 'Memy · AI-intervjuare', label: 'Vad vill du minnas?', placeholder: 'Skriv ett minne eller ett svar…', send: 'Skicka', useVoice: 'Använd rösten i stället', hideVoice: 'Dölj röstalternativ', hint: 'Dina ord är dina. Memys svar använder AI; du väljer själv om du vill lyssna.', idle: 'Inte skickat · bara i den här fliken', thinking: 'Memy tänker…', done: 'Ditt meddelande och Memys svar har sparats.', failed: 'Inte skickat. Dina ord finns kvar här.', uncertain: 'Kontrollerar det sparade resultatet. Skicka inte igen ännu.', tooLong: 'Skriv högst 4 000 tecken.', counter: 'tecken', review: 'Granska föreslagna minnen', reviewHint: 'Du bestämmer vad som hör hemma i din berättelse.', emptyTitle: 'Vi börjar med ett litet minne.', empty: 'En välbekant plats, någon du minns eller ett ögonblick som får dig att le. Börja där det känns rätt.', emptyNote: 'Ett förslag som inspiration, inte ett AI-svar.', paused: 'AI är pausad. Du kan skriva här, men vänta med att skicka tills testningen är tillgänglig.', original: 'Sparat med dina egna ord', updated: 'Samtalet har sparats. Granska föreslagna minnen när du vill.' },
};
const memoryPrompts = {
  en: [
    { name: 'A familiar place', mark: '⌂', questions: ['Is there a place you remember clearly? What do you notice when you picture it?', 'Can you remember a sound, a scent or a view from a place you once knew?'] },
    { name: 'Someone memorable', mark: '✦', questions: ['Is there someone you would like to remember in your story? What comes to mind?', 'Can you recall a small moment with someone who made an impression on you?'] },
    { name: 'Everyday moments', mark: '☼', questions: ['Is there an ordinary moment you would like to keep? What made it yours?', 'Was there a small pleasure, a routine or a skill that was part of your day?'] },
  ],
  sv: [
    { name: 'En välbekant plats', mark: '⌂', questions: ['Finns det en plats du minns tydligt? Vad lägger du märke till när du tänker på den?', 'Minns du ett ljud, en doft eller en utsikt från en plats du en gång kände?'] },
    { name: 'En minnesvärd person', mark: '✦', questions: ['Finns det någon du vill minnas i din berättelse? Vad kommer du att tänka på?', 'Minns du en liten stund med någon som gjorde intryck på dig?'] },
    { name: 'Vardagliga stunder', mark: '☼', questions: ['Finns det en vardaglig stund du vill bevara? Vad gjorde den speciell för dig?', 'Fanns det ett litet glädjeämne, en rutin eller en färdighet som var en del av din dag?'] },
  ],
};
const text = (value) => String(value ?? '');
const date = (value) => new Date(value).toLocaleString();
function microphoneFailure(cause) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(cause?.name)) {
    return 'Microphone access is blocked by your browser or system. Allow microphone access for this app or browser in your system privacy settings, then choose Start recording again. You can also use an audio file below.';
  }
  if (['NotFoundError', 'DevicesNotFoundError'].includes(cause?.name)) {
    return 'No microphone was found. Connect a microphone and try again, or use an audio file below.';
  }
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(cause?.name)) {
    return 'Your microphone could not be opened. Close other apps using it, check the microphone, then try again. You can also use an audio file below.';
  }
  return 'Microphone recording could not start. Check microphone access in your browser and system settings, or use an audio file below.';
}
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(text(child)));
  }
  return node;
}

export function safePdfName(headers, fallback) {
  const name = /filename="(memy-[a-z0-9]+(?:-[a-z0-9]+)*\.pdf)"/i.exec(headers.get('Content-Disposition') || '')?.[1] || fallback;
  if (!/^memy-[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/.test(name || '')) throw Error('The PDF filename could not be verified.');
  return name;
}

export async function verifySpeech(bytes, metadata) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== metadata.audio_size || bytes.length < 44 || bytes.length > 8_000_000
    || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE'
    || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 !== bytes.length) {
    throw Error('The spoken reply failed its audio integrity check.');
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== metadata.audio_sha256) throw Error('The spoken reply failed its audio integrity check.');
}

export function createWorkspace({ root, api, user, onExit, onSessionLost }) {
  let disposed = false, epoch = 0, busy = false, error = '', notice = '', tab = 'conversation';
  let projects = [], project = null, session = null, sessions = [], transcripts = [], messages = [], memories = [], drafts = [], exports = [];
  let selectedTranscript = '', selectedDraft = '', history = [], historyDraft = '';
  let recording = null;
  let composerText = '', composerState = 'idle', voiceOpen = false, workingLabel = '';
  let homeForm = { title: '', description: '', language: 'en' }, detailForm = null, draftEditing = null;
  let correctionInputs = new Map(), openPanels = new Set();
  let capabilities = null;
  let includeTitlePage = true, includePageNumbers = true;
  let audioFile = null, audioName = '', consent = false, generationConsent = false;
  let speech = null, player = null, speechUrl = null, downloadUrl = null, downloadName = '';
  let audioVersion = 0;
  let inspirationTopic = null, inspirationQuestion = 0;
  const preparedSpeech = new Map();
  const alive = (g) => !disposed && g === epoch;
  const v2 = '/api/v2';
  const pending = () => Boolean(api.hasPending?.());
  const p = (content, cls = '') => el('p', { class: cls }, content);
  const card = (...content) => el('section', { class: 'card' }, ...content);
  const prose = (content) => el('p', { class: 'prose' }, content);
  const label = (name, control) => el('label', {}, el('span', {}, name), control);
  const input = (props = {}) => el('input', props);
  const check = (name, checked, change) => el('label', {}, input({ type: 'checkbox', checked, disabled: busy, onchange: (e) => change(e.target.checked) }), el('span', {}, name));
  const button = (name, action, disabled = false, cls = '') => el('button', { type: 'button', class: cls, disabled: busy || disabled, onclick: () => run(action) }, name);
  const paidButton = (name, action, disabled = false) => button(name, action, disabled || pending() || capabilities?.enabled !== true, 'primary');
  const provenance = (item) => el('details', { class: 'provenance-details' }, el('summary', {}, 'AI source details'), p(`Real AI · ${item.provenance?.provider || 'OpenAI'} · ${item.provenance?.model || 'saved result'}`, 'muted'));
  const empty = (items, message, map) => items.length ? items.map(map) : [p(message, 'muted')];
  const checkboxChange = (setter) => value => { setter(value); render(); };
  const panel = (key, title, ...children) => el('details', { class: 'disclosure', open: openPanels.has(key), ontoggle: event => {
    if (event.target.open) openPanels.add(key); else openPanels.delete(key);
  } }, el('summary', {}, title), ...children);
  const field = (node, key, change) => { node.dataset.focusKey = key; node.oninput = event => change(event.target.value); return node; };
  const badge = (content, cls = '') => el('span', { class: `badge ${cls}` }, content);
  function clearFormMemory() {
    homeForm = { title: '', description: '', language: 'en' }; detailForm = null; draftEditing = null;
    inspirationTopic = null; inspirationQuestion = 0;
    composerText = ''; composerState = 'idle'; voiceOpen = false;
    correctionInputs.clear(); openPanels.clear();
  }
  function savedBookParagraphs(content) {
    return String(content || '').split(/\n\s*\n/).filter(part => part.trim()).map(part => el('p', { class: 'book-paragraph' }, part));
  }
  function hasUnsavedDraft() { return Boolean(draftEditing?.dirty); }
  function allowLeaveDraft() {
    if (!hasUnsavedDraft()) return true;
    return typeof globalThis.confirm === 'function' && globalThis.confirm('Leave without saving your changes? Your last saved story will stay unchanged.');
  }


  function clearPlayback() {
    audioVersion++;
    if (player) {
      player.onerror = null;
      try { player.pause(); player.removeAttribute('src'); player.load(); } catch { /* Metadata remains available for an explicit authenticated reload. */ }
      player = null;
    }
    if (speechUrl) URL.revokeObjectURL(speechUrl);
    speechUrl = null; speech = null;
  }
  function ownedSpeech(metadata) {
    if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length !== SPEECH_FIELDS.length ||
      SPEECH_FIELDS.some(key => !Object.hasOwn(metadata, key)) || !UUID.test(metadata.speech_id || '') ||
      !UUID.test(metadata.assistant_message_id || '') || metadata.language !== project?.language ||
      metadata.media_type !== 'audio/wav' || metadata.status !== 'ready' ||
      !/^[0-9a-f]{64}$/.test(metadata.audio_sha256 || '') || !Number.isSafeInteger(metadata.audio_size) ||
      metadata.audio_size < 44 || metadata.audio_size > 8_000_000 || typeof metadata.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(metadata.expires_at)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.expires_at)) {
      throw Error('The prepared spoken reply could not be verified. No new AI request was made.');
    }
    const message = messages.find(item => item.id === metadata.assistant_message_id && item.role === 'assistant');
    if (!message || message.project_id !== project?.id || message.session_id !== session?.id || message.language !== project?.language) {
      throw Error('This prepared spoken reply does not belong to the open conversation.');
    }
    return { metadata: Object.freeze({ ...metadata }), projectId: project.id, sessionId: session.id, expired: Date.parse(metadata.expires_at) <= Date.now() };
  }
  function currentSpeech(record, g = epoch) {
    return alive(g) && record && project?.id === record.projectId && session?.id === record.sessionId &&
      project.language === record.metadata.language && preparedSpeech.get(record.metadata.assistant_message_id) === record;
  }
  function speechExpired(record) { return record.expired || Date.parse(record.metadata.expires_at) <= Date.now(); }
  function stopSpeech() {
    if (!player) return;
    try { player.pause(); player.currentTime = 0; }
    catch { clearPlayback(); throw Error('Playback stopped. Load the prepared audio again to replay it without a new AI request.'); }
  }
  function clearDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; downloadName = '';
  }
  function stopRecording(discard = false) {
    const entry = recording;
    if (entry) {
      entry.discard ||= discard;
      clearTimeout(entry.timer); clearInterval(entry.tick);
      if (entry.recorder.state !== 'inactive') entry.recorder.stop();
      entry.tracks.getTracks().forEach(track => track.stop());
      if (discard) entry.chunks = [];
    }
    if (discard) { audioFile = null; audioName = ''; }
  }
  function clearPrivateMedia() { stopRecording(true); clearPlayback(); clearDownload(); audioFile = null; audioName = ''; consent = false; }
  function switchContext() {
    epoch++; clearPrivateMedia(); preparedSpeech.clear(); clearFormMemory(); generationConsent = false; history = []; historyDraft = '';
    selectedTranscript = ''; selectedDraft = ''; transcripts = []; messages = []; memories = []; drafts = []; exports = []; sessions = [];
    error = ''; notice = ''; return epoch;
  }
  function showError(cause) {
    if (['AI_SPENDING_NOT_APPROVED', 'AI_USAGE_LIMIT', 'LIVE_AI_DISABLED', 'REAL_AI_NOT_CONFIGURED'].includes(cause?.code)) capabilities = { enabled: false };
    if (cause?.status === 401 || ['UNAUTHORIZED', 'SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(cause?.code)) {
      dispose(); onSessionLost?.(); return;
    }
    error = cause instanceof Error ? cause.message : 'This action could not be completed. Please reload saved data.';
  }
  async function run(action, busyLabel = '') {
    if (busy || disposed) return;
    busy = true; workingLabel = busyLabel; error = ''; notice = ''; render();
    try { await action(epoch); } catch (cause) { if (!disposed) showError(cause); }
    finally { busy = false; workingLabel = ''; if (!disposed) render(); }
  }
  async function loadCapabilities(g = epoch) {
    try {
      const value = await api.call('GET', '/api/v2/capabilities');
      if (alive(g)) capabilities = value?.contract === 'real-v2' && value?.mode === 'real' ? value : { enabled: false };
    } catch { if (alive(g)) capabilities = { enabled: false }; }
  }
  async function collection(path) {
    const rows = [];
    for (let offset = 0; offset <= 100_000; offset += 100) {
      const page = await api.call('GET', `${path}?limit=100&offset=${offset}`);
      if (!Array.isArray(page)) throw Error('The saved data response could not be read.');
      rows.push(...page);
      if (page.length < 100) return rows;
    }
    throw Error('There is too much saved data to display in this preview.');
  }
  async function refresh(g = epoch, resources = null) {
    if (!project) { const data = await collection('/api/v1/story-projects'); if (alive(g)) projects = data; return; }
    const projectId = project.id, sessionId = session?.id;
    const paths = {
      drafts: `${v2}/story-projects/${projectId}/drafts`,
      exports: `${v2}/story-projects/${projectId}/exports`,
      sessions: `/api/v1/story-projects/${projectId}/sessions`,
      ...(sessionId ? Object.fromEntries(['transcripts', 'messages', 'memories'].map(name => [name, `${v2}/story-sessions/${sessionId}/${name}`])) : {}),
    };
    // An explicit reload still reads every owned collection. After a successful
    // action, reread only the resources it can change; never cache private HTTP
    // responses or retry a paid request to make the interface feel faster.
    const names = resources || Object.keys(paths);
    if (names.some(name => !Object.hasOwn(paths, name))) throw Error('The saved data request is unavailable.');
    const data = await Promise.all(names.map(name => collection(paths[name])));
    if (!alive(g)) return;
    const updated = Object.fromEntries(names.map((name, index) => [name, data[index]]));
    if (updated.drafts) drafts = updated.drafts;
    if (updated.exports) exports = updated.exports;
    if (updated.sessions) sessions = updated.sessions;
    if (updated.transcripts) transcripts = updated.transcripts;
    if (updated.messages) messages = updated.messages;
    if (updated.memories) memories = updated.memories;
    if (!sessionId) [transcripts, messages, memories] = [[], [], []];
    messages.sort((a, b) => a.sequence - b.sequence);
    if (!transcripts.some(t => t.transcript_id === selectedTranscript)) selectedTranscript = transcripts.at(-1)?.transcript_id || '';
    if (!drafts.some(d => d.draft_id === selectedDraft)) selectedDraft = drafts[0]?.draft_id || '';
  }
  async function openProject(id) {
    const g = switchContext(); project = null; session = null;
    const saved = await api.call('GET', `/api/v1/story-projects/${id}`);
    if (!alive(g)) return;
    project = saved;
    const continued = await api.call('POST', `/api/v1/story-projects/${id}/continue`, { json: {} });
    if (!alive(g)) return;
    session = continued.session; tab = 'conversation'; await refresh(g);
  }
  async function performPaid(kind, path, options, g) {
    if (pending()) throw Error('Reload the saved result of your previous action before starting another AI action.');
    const result = await api.paid(kind, path, { ...options, scope: { projectId: project.id, language: project.language, ...(kind === 'generation' ? {} : { sessionId: session.id }) } });
    if (!alive(g)) return null;
    return result;
  }
  async function loadSpeech(record, g) {
    if (!currentSpeech(record, g)) throw Error('This prepared spoken reply is unavailable in the open conversation.');
    if (speechExpired(record)) { clearPlayback(); throw Error('This prepared audio expired after five minutes. A new spoken reply requires a separate AI action.'); }
    clearPlayback();
    if (document.hidden) return;
    const version = audioVersion;
    let response;
    try {
      response = await api.call('GET', `${v2}/spoken-replies/${record.metadata.speech_id}/audio`, { binary: 'wav' });
      await verifySpeech(response.bytes, record.metadata);
      if (!currentSpeech(record, g) || document.hidden || version !== audioVersion) return;
      const url = URL.createObjectURL(new Blob([response.bytes], { type: 'audio/wav' }));
      let audio;
      try { audio = new Audio(url); }
      catch { URL.revokeObjectURL(url); throw Error('Audio playback is unavailable in this browser.'); }
      speechUrl = url; speech = record.metadata; player = audio; player.preload = 'none';
      audio.onerror = () => {
        if (!currentSpeech(record, g) || player !== audio || version !== audioVersion) return;
        error = 'This browser could not play the prepared audio. Choose Load prepared audio to try loading the same reply again. No new AI request is needed.';
        clearPlayback(); if (!document.hidden) render();
      };
    } catch (cause) {
      if (!currentSpeech(record, g)) return;
      if (cause?.status === 410 || cause?.code === 'SPEECH_EXPIRED') {
        record.expired = true;
        throw Error('This prepared audio expired after five minutes or was cleared by a server restart. A new spoken reply requires a separate AI action.');
      }
      throw Error('The prepared audio could not be loaded or verified. Choose Load prepared audio to retry the same reply without a new AI request.');
    } finally { response?.bytes?.fill(0); }
  }
  async function prepareSpeech(metadata, g) {
    if (!alive(g)) return;
    const record = ownedSpeech(metadata);
    preparedSpeech.set(metadata.assistant_message_id, record);
    // Keep only owned, expiring IDs in RAM across backgrounding. Audio bytes and
    // object URLs are still cleared; returning never starts playback or synthesis.
    if (document.hidden) return;
    await loadSpeech(record, g);
  }
  async function recoverSpeech(message, g) {
    const messageId = message.id;
    let metadata;
    try { metadata = await api.call('GET', `${v2}/conversation-messages/${messageId}/speech`); }
    catch (cause) {
      if (!alive(g)) return;
      if (cause?.status === 410 || cause?.code === 'SPEECH_EXPIRED') throw Error('The prepared audio has expired or was cleared. Creating another spoken reply is a separate AI action.');
      if (cause?.status === 404) throw Error('No prepared audio is available for this reply. Creating one with Listen to Memy is a separate AI action.');
      throw cause;
    }
    if (!alive(g)) return;
    if (metadata?.assistant_message_id !== messageId) throw Error('The prepared spoken reply could not be verified.');
    await prepareSpeech(metadata, g);
    if (alive(g)) notice = 'Prepared audio found. Press Play spoken reply to listen. This lookup made no new AI request.';
  }
  function speechControls(item) {
    const record = preparedSpeech.get(item.id), available = currentSpeech(record), expired = available && speechExpired(record);
    const loaded = available && !expired && player && speech?.speech_id === record.metadata.speech_id;
    return el('div', { class: 'playback-controls' },
      !available && paidButton('Listen to Memy · Real AI', async g => {
        const result = await performPaid('speech', `${v2}/conversation-messages/${item.id}/speech`, { json: { language: project.language } }, g);
        if (result?.assistant_message_id !== item.id) throw Error('The prepared spoken reply could not be verified.');
        if (result) await prepareSpeech(result, g);
      }),
      expired && p('This prepared audio has expired. It is kept for only five minutes.', 'field-help'),
      expired && paidButton('Create new spoken reply · Real AI', async g => {
        const result = await performPaid('speech', `${v2}/conversation-messages/${item.id}/speech`, { json: { language: project.language } }, g);
        if (result?.assistant_message_id !== item.id) throw Error('The prepared spoken reply could not be verified.');
        if (result) await prepareSpeech(result, g);
      }),
      available && !expired && p(loaded ? 'Your spoken reply is ready. Press Play to listen. Replay makes no new AI request.' : 'Your reply was already prepared. Load its audio to listen without a new AI request.', 'muted'),
      available && !expired && !loaded && button('Load prepared audio', g => loadSpeech(record, g), false, 'primary'),
      loaded && button('Play spoken reply', async () => {
        if (!currentSpeech(record) || speechExpired(record)) { clearPlayback(); throw Error('This prepared audio expired. Creating a new reply is a separate AI action.'); }
        const audio = player;
        try { await audio.play(); }
        catch { throw Error('Playback was blocked or interrupted by this browser. Press Play again, or load the prepared audio again. No new AI request is needed.'); }
      }, false, 'primary'),
      loaded && button('Stop spoken reply', () => stopSpeech(), false, 'secondary'),
      loaded && button('Load prepared audio', g => loadSpeech(record, g), false, 'secondary'),
      button('Check prepared spoken reply', g => recoverSpeech(item, g), false, 'secondary'),
      p('AI-generated voice · prepared audio expires after five minutes.', 'field-help'));
  }
  async function preparePdf(path, options, g, filename) {
    const response = await api.call(options ? 'POST' : 'GET', path, { ...options, binary: 'pdf' });
    if (!alive(g) || document.hidden) return;
    if (!(response.bytes instanceof Uint8Array) || response.bytes.length > 2_000_000
      || new TextDecoder().decode(response.bytes.subarray(0, 5)) !== '%PDF-') throw Error('The PDF response could not be verified.');
    const name = safePdfName(response.headers, filename);
    clearDownload(); downloadName = name;
    downloadUrl = URL.createObjectURL(new Blob([response.bytes], { type: 'application/pdf' }));
    if (options) await refresh(g, ['exports']);
    notice = 'Your PDF is ready. Use the download link below.';
  }
  async function startRecording(g) {
    if (!consent || !session) throw Error('Give recording and transcription consent first.');
    if (recording) throw Error('Wait for the current recording to finish.');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { openPanels.add('record-options'); throw Error('Microphone recording is unavailable in this browser. Use an audio file below.'); }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) { openPanels.add('record-options'); throw Error('This browser cannot record a supported format. Use an audio file below.'); }
    clearPlayback();
    let tracks;
    try { tracks = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (cause) {
      if (!alive(g)) return;
      openPanels.add('record-options');
      throw Error(microphoneFailure(cause));
    }
    if (!alive(g) || document.hidden || !consent) { tracks.getTracks().forEach(track => track.stop()); return; }
    let recorder;
    try { recorder = new MediaRecorder(tracks, { mimeType: mime }); }
    catch { tracks.getTracks().forEach(track => track.stop()); openPanels.add('record-options'); throw Error('Recording could not start. Use an audio file below.'); }
    const entry = { recorder, tracks, chunks: [], bytes: 0, seconds: 0, discard: false, timer: null, tick: null }; recording = entry;
    recorder.ondataavailable = ({ data }) => {
      if (!alive(g) || entry.discard || !data.size) return;
      if (entry.bytes + data.size > MAX_AUDIO) { entry.discard = true; error = 'Recording reached the 25 MB limit and was discarded.'; stopRecording(true); return; }
      entry.bytes += data.size; entry.chunks.push(data);
    };
    recorder.onerror = () => { entry.discard = true; if (alive(g)) error = 'Recording failed. Choose an audio file or record again.'; if (recording === entry) stopRecording(true); };
    recorder.onstop = () => {
      const current = recording === entry, discard = entry.discard || !alive(g) || document.hidden;
      clearTimeout(entry.timer); clearInterval(entry.tick); tracks.getTracks().forEach(track => track.stop());
      if (current) recording = null;
      if (current && !discard && entry.chunks.length) {
        const container = (recorder.mimeType || mime).split(';')[0];
        audioFile = new Blob(entry.chunks, { type: container }); audioName = `recording.${container === 'audio/mp4' ? 'm4a' : 'webm'}`;
        notice = 'Recording is held in memory. Choose “Save transcript” to send it to Real AI.';
      }
      entry.chunks = [];
      if (alive(g)) render();
    };
    try { recorder.start(250); }
    catch { entry.discard = true; tracks.getTracks().forEach(track => track.stop()); recording = null; openPanels.add('record-options'); throw Error('Recording could not start. Use an audio file below.'); }
    // Replace an existing unsent file only once the new microphone capture has
    // actually started. A denied permission must not discard the user's file.
    audioFile = null; audioName = '';
    entry.timer = setTimeout(() => { if (recording === entry) stopRecording(); }, 60_000);
    entry.tick = setInterval(() => {
      if (alive(g) && recording === entry) {
        entry.seconds++;
        const stop = root.querySelector('[data-record-stop]');
        const state = root.querySelector('[data-record-state]');
        if (stop) stop.textContent = `Stop recording · ${entry.seconds}s`;
        if (state) state.textContent = `${String(Math.floor(entry.seconds / 60)).padStart(2, '0')}:${String(entry.seconds % 60).padStart(2, '0')} · Recording`;
      }
    }, 1000);
  }

  function renderHome() {
    const title = field(input({ name: 'title', value: homeForm.title, required: true, maxLength: 120, placeholder: 'For example, My early years', disabled: busy }), 'new-title', value => { homeForm.title = value; });
    const description = field(el('textarea', { name: 'description', value: homeForm.description, maxLength: 4000, rows: 3, disabled: busy, placeholder: 'What would you like to remember?' }), 'new-description', value => { homeForm.description = value; });
    const language = el('select', { name: 'language', disabled: busy, onchange: event => { homeForm.language = event.target.value; } }, ...Object.entries(languages).map(([value, name]) => el('option', { value, selected: value === homeForm.language }, name)));
    const form = el('form', { class: 'form', onsubmit: event => { event.preventDefault(); if (!form.reportValidity()) return; run(async () => {
      const created = await api.call('POST', '/api/v1/story-projects', { json: { title: homeForm.title.trim(), description: homeForm.description.trim() || null, language: homeForm.language } });
      await openProject(created.id);
    }); } }, p('A NEW CHAPTER', 'eyebrow'), el('h2', {}, 'Begin something worth keeping.'),
    p('A person, a place, a whole lifetime. Give your story a name; you can change it later.', 'muted'),
    label('Story title', title), label('Story language', language),
    p('Your story keeps this language throughout your conversations.', 'field-help'),
    panel('new-description', 'Add a description (optional)', label('Description', description)),
    el('button', { type: 'submit', class: 'primary', disabled: busy }, 'Create story'));
    const projectCards = projects.map((item, index) => el('article', { class: 'story-card' },
      el('div', { class: `book-thumbnail book-tone-${index % 3}`, 'aria-hidden': 'true' }, el('span', { class: 'book-label' }, 'A LIFE IN WORDS'), el('span', { class: 'book-monogram' }, item.title.trim().slice(0, 1).toLocaleUpperCase()), el('span', { class: 'book-cover-title' }, item.title)),
      el('div', { class: 'story-card-body' }, badge(languages[item.language] || item.language), el('h3', {}, item.title),
        item.description && p(item.description, 'story-description'), p(`Last updated ${date(item.updated_at)}`, 'story-date'),
        el('div', { class: 'story-card-footer' }, button('Open story', () => openProject(item.id), false, 'primary')))));
    return [el('section', { class: 'dashboard-welcome' }, p('YOUR PERSONAL STORY SPACE', 'eyebrow'), el('h1', {}, 'Every life holds a story.\nLet’s keep yours.'), p('A little conversation today. A story to treasure tomorrow.', 'lead')),
      el('div', { class: 'dashboard-layout' }, el('section', { class: 'story-library' },
        el('div', { class: 'section-heading' }, el('div', {}, p('YOUR COLLECTION', 'eyebrow'), el('h2', {}, 'Your stories')), button('Reload stories', () => refresh(), false, 'text-button')),
        projects.length ? el('div', { class: 'story-grid' }, ...projectCards) : el('div', { class: 'empty-state' }, el('span', { class: 'empty-symbol', 'aria-hidden': 'true' }, '“'), el('h3', {}, 'Your first story starts with you.'), p('There’s no right place to begin. Create a story, then share one memory at your own pace.', 'muted'))),
      el('aside', { class: 'new-story-panel card' }, form))];
  }
  function setTab(value) { clearPlayback(); clearDownload(); tab = value; }
  function nextStep() {
    const awaiting = memories.filter(memory => memory.status === 'pending' || memory.clarification_question).length;
    const confirmed = memories.filter(memory => memory.status === 'confirmed' && !memory.clarification_question).length;
    let title = 'One memory is a lovely place to begin.', body = 'You can speak naturally. Pause, take your time, and let your story unfold.', target = 'conversation', action = 'Share a memory';
    if (drafts.length) { title = 'Your words are becoming a book.'; body = 'Open your saved autobiography to read, refine and prepare a PDF.'; target = 'drafts'; action = 'Read your autobiography'; }
    else if (awaiting) { title = `${awaiting} ${awaiting === 1 ? 'memory is' : 'memories are'} waiting for your review.`; body = 'You decide which details belong in your story. Confirm, correct or leave them out.'; target = 'memories'; action = 'Review your memories'; }
    else if (confirmed) { title = 'Your memories are ready for the next chapter.'; body = 'When you’re ready, turn your confirmed memories into an autobiography draft.'; target = 'drafts'; action = 'Open your autobiography'; }
    else if (transcripts.length) { title = 'Your memory is safely transcribed.'; body = 'Read your original words, then choose to continue the conversation with Memy.'; }
    return el('aside', { class: 'next-step' }, el('div', { class: 'next-step-copy' }, p('AT YOUR OWN PACE', 'eyebrow'), el('h3', {}, title), p(body)), target !== tab && button(action, () => setTab(target), false, 'secondary'));
  }
  function renderProject() {
    if (!detailForm || detailForm.id !== project.id) detailForm = { id: project.id, title: project.title, description: project.description || '' };
    const title = field(input({ value: detailForm.title, required: true, maxLength: 120, disabled: busy }), 'project-title', value => { detailForm.title = value; });
    const description = field(el('textarea', { value: detailForm.description, maxLength: 4000, rows: 3, disabled: busy }), 'project-description', value => { detailForm.description = value; });
    const edit = panel('story-details', 'Edit story details', label('Title', title), label('Description', description), button('Save details', async g => {
      if (!title.reportValidity()) return;
      const updated = await api.call('PATCH', `/api/v1/story-projects/${project.id}`, { json: { title: detailForm.title.trim(), description: detailForm.description.trim() || null } });
      if (alive(g)) { project = updated; detailForm = null; notice = 'Story details saved.'; }
    }, false, 'primary'));
    const select = el('select', { disabled: busy, 'aria-label': 'Conversation session', onchange: event => run(async () => {
      const chosen = sessions.find(item => item.id === event.target.value); if (!chosen || !allowLeaveDraft()) return;
      const g = switchContext(); session = chosen; await refresh(g);
    }) }, ...sessions.map(item => el('option', { value: item.id, selected: item.id === session?.id }, `${date(item.created_at)} · ${item.status}`)));
    return el('section', { class: 'project-hero' },
      el('div', { class: 'project-topline' }, button('← All stories', async () => { if (!allowLeaveDraft()) return; const g = switchContext(); project = null; session = null; await refresh(g); }, false, 'text-button'),
        button('Reload saved story', g => refresh(g), false, 'text-button')),
      p('A STORY ONLY YOU CAN TELL', 'eyebrow'), el('h1', {}, project.title),
      el('div', { class: 'project-meta' }, badge(languages[project.language]), badge('Your personal story'), p('Your story language stays the same.', 'field-help')),
      renderStoryProgress(),
      el('div', { class: 'project-settings' }, edit, panel('sessions', 'Conversation sessions', label('Session', select), session?.status !== 'active' && button('Continue story', () => openProject(project.id), false, 'primary'))),
      el('nav', { class: 'tabs journey-tabs', 'aria-label': 'Story workspace' }, ...[['conversation', 'Conversation'], ['memories', 'Review memories'], ['drafts', 'Your autobiography']].map(([value, name], index) => {
        const node = button(name, () => setTab(value), false, `journey-step ${tab === value ? 'active' : 'secondary'}`);
        node.setAttribute('aria-label', name);
        node.setAttribute('aria-current', tab === value ? 'step' : 'false');
        node.prepend(el('span', { class: 'step-number', 'aria-hidden': 'true' }, String(index + 1)));
        return node;
      })));
  }
  function renderStoryProgress() {
    const swedish = project.language === 'sv';
    const confirmed = memories.filter(item => item.status === 'confirmed' && !item.clarification_question).length;
    const items = swedish ? [
      [transcripts.length, 'original i den här konversationen'],
      [confirmed, 'bekräftade minnen här'],
      [drafts.length, 'sparade utkast i berättelsen'],
    ] : [
      [transcripts.length, `original ${transcripts.length === 1 ? 'transcript' : 'transcripts'} in this conversation`],
      [confirmed, `${confirmed === 1 ? 'memory' : 'memories'} confirmed here`],
      [drafts.length, `saved story ${drafts.length === 1 ? 'draft' : 'drafts'} in this project`],
    ];
    return el('div', { class: 'story-progress', 'aria-label': swedish ? 'Ditt sparade arbete' : 'Your saved work' },
      ...items.map(([count, description]) => el('span', { class: 'story-progress-item' }, el('strong', {}, String(count)), el('span', {}, description))));
  }
  function renderInspiration() {
    const swedish = project.language === 'sv', topics = memoryPrompts[swedish ? 'sv' : 'en'];
    if (!openPanels.has('inspiration-initialized')) {
      openPanels.add('inspiration-initialized');
      if (!messages.length) openPanels.add('inspiration');
    }
    const question = p(inspirationTopic == null ? (swedish ? 'Välj det som väcker ett minne hos dig.' : 'Choose a little doorway into your story.') : topics[inspirationTopic].questions[inspirationQuestion], 'inspiration-question');
    question.setAttribute('role', 'status'); question.setAttribute('aria-live', 'polite');
    const choices = el('div', { class: 'inspiration-options', role: 'group', 'aria-label': swedish ? 'Välj ett minnestema' : 'Choose a memory theme' });
    const another = el('button', { type: 'button', class: 'inspiration-another text-button', disabled: busy || inspirationTopic == null,
      onclick: () => {
        if (disposed || busy || document.hidden || inspirationTopic == null || !root.contains(another)) return;
        inspirationQuestion = (inspirationQuestion + 1) % topics[inspirationTopic].questions.length;
        question.textContent = topics[inspirationTopic].questions[inspirationQuestion];
      } }, swedish ? 'En annan fråga' : 'Another question');
    topics.forEach((topic, index) => {
      const choice = el('button', { type: 'button', class: 'inspiration-choice', disabled: busy, 'aria-pressed': String(inspirationTopic === index),
        onclick: () => {
          if (disposed || busy || document.hidden || !root.contains(choice)) return;
          inspirationTopic = index; inspirationQuestion = 0;
          for (const [i, node] of [...choices.children].entries()) node.setAttribute('aria-pressed', String(i === index));
          question.textContent = topic.questions[0]; another.disabled = false;
        } }, el('span', { class: 'inspiration-mark', 'aria-hidden': 'true' }, topic.mark), el('span', {}, topic.name));
      choices.append(choice);
    });
    return el('details', { class: 'memory-inspiration', open: openPanels.has('inspiration'), ontoggle: event => {
      if (disposed || document.hidden || !root.contains(event.target)) return;
      if (event.target.open) openPanels.add('inspiration'); else openPanels.delete('inspiration');
    } }, el('summary', { class: 'inspiration-summary' }, swedish ? 'Vill du ha lite inspiration?' : 'Need a little inspiration?'),
    el('div', { class: 'inspiration-body' }, p(swedish ? 'EN LITEN GNISTA' : 'A LITTLE SPARK', 'eyebrow'), choices, question, another,
      p(swedish ? 'Frivillig inspiration, inte ett AI-svar. Inget skickas eller sparas när du väljer.' : 'Optional inspiration, not an AI reply. Choosing never sends or saves anything.', 'inspiration-note')));
  }
  function renderConversation() {
    const isRecording = recording && recording.recorder.state !== 'inactive', finalizing = recording && !isRecording, active = session?.status === 'active';
    const copy = chatCopy[project.language] || chatCopy.en;
    const characterCount = () => [...composerText].length;
    const canSend = () => !busy && !pending() && capabilities?.enabled === true && active && !recording && Boolean(composerText.trim()) && characterCount() <= 4000;
    const sendTyped = () => {
      if (!canSend() || document.hidden) return;
      const original = composerText;
      composerState = 'sending';
      run(async g => {
        try {
          const result = await performPaid('conversation', `${v2}/story-sessions/${session.id}/text-messages`, { json: { text: original, language: project.language } }, g);
          if (!result || !alive(g)) return;
          // Clear only the submitted draft, never resurrecting words cleared by
          // background/context privacy cleanup. Saved history is loaded below.
          if (composerText === original) { composerText = ''; composerState = 'saved'; }
          await refresh(g, ['messages', 'memories', 'drafts']);
          if (alive(g)) notice = copy.updated;
        } catch (cause) {
          if (alive(g) && !document.hidden && composerText === original) composerState = pending() ? 'uncertain' : 'failed';
          throw cause;
        }
      }, copy.thinking);
    };
    const typedInput = field(el('textarea', { class: 'chat-input', rows: 3, value: composerText, placeholder: copy.placeholder, disabled: busy || !active || pending() || Boolean(recording), 'aria-label': copy.placeholder, 'aria-describedby': 'chat-help chat-count chat-state' }), 'typed-memory', value => {
      composerText = value; composerState = 'idle';
      sendControl.disabled = !canSend();
      count.textContent = `${characterCount().toLocaleString(project.language)} / ${(4000).toLocaleString(project.language)} ${copy.counter}`;
      count.classList.toggle('is-over-limit', characterCount() > 4000);
      composerStatus.textContent = characterCount() > 4000 ? copy.tooLong : copy.idle;
    });
    // Enter remains a familiar newline. Only an explicit modified shortcut sends;
    // composition and key repeat never submit an unfinished message.
    typedInput.onkeydown = event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !event.repeat && event.keyCode !== 229) {
        event.preventDefault(); sendTyped();
      }
    };
    const sendControl = el('button', { type: 'button', class: 'primary chat-send', disabled: !canSend(), onclick: sendTyped }, el('span', {}, copy.send), el('span', { 'aria-hidden': 'true' }, '↑'));
    const count = p(`${characterCount().toLocaleString(project.language)} / ${(4000).toLocaleString(project.language)} ${copy.counter}`, `chat-count ${characterCount() > 4000 ? 'is-over-limit' : ''}`); count.id = 'chat-count';
    const composerStatus = p(characterCount() > 4000 ? copy.tooLong : composerState === 'sending' ? copy.thinking : composerState === 'saved' ? copy.done : composerState === 'failed' ? copy.failed : composerState === 'uncertain' ? copy.uncertain : composerText ? copy.idle : '', `chat-save-state state-${composerState}`);
    composerStatus.id = 'chat-state'; composerStatus.setAttribute('role', 'status'); composerStatus.setAttribute('aria-live', 'polite');
    const voiceToggle = el('button', { type: 'button', class: 'secondary chat-voice-toggle', disabled: busy || Boolean(recording), 'aria-expanded': String(voiceOpen), 'aria-controls': 'voice-options', onclick: () => { voiceOpen = !voiceOpen; render(); } }, el('span', { class: 'chat-mic-symbol', 'aria-hidden': 'true' }, ''), voiceOpen ? copy.hideVoice : copy.useVoice);
    const help = p(copy.hint, 'chat-help'); help.id = 'chat-help';
    const composer = el('section', { class: 'chat-composer', 'aria-label': copy.label },
      label(copy.label, typedInput),
      el('div', { class: 'chat-composer-bottom' }, count, el('div', { class: 'chat-composer-actions' }, voiceToggle, sendControl)),
      help, capabilities?.enabled !== true && p(copy.paused, 'chat-paused'), composerStatus);
    const file = input({ type: 'file', accept: '.wav,.mp3,.m4a,.webm,audio/wav,audio/mpeg,audio/mp4,audio/webm', disabled: busy || Boolean(recording) || !active, onchange: event => {
      const selected = event.target.files?.[0]; if (!selected) return;
      if (!/\.(wav|mp3|m4a|webm)$/i.test(selected.name) || !selected.size || selected.size > MAX_AUDIO) { error = 'Choose a WAV, MP3, M4A, or WebM audio file up to 25 MB.'; audioFile = null; audioName = ''; }
      else { const extension = selected.name.split('.').at(-1).toLowerCase(); audioFile = selected.slice(0, selected.size, { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', webm: 'audio/webm' }[extension]); audioName = selected.name; error = ''; notice = 'Audio selected in memory. It has not been uploaded.'; }
      event.target.value = ''; render();
    } });
    const used = new Set(messages.filter(item => item.role === 'user' && item.source_transcript_id).map(item => item.source_transcript_id));
    const chosen = transcripts.find(item => item.transcript_id === selectedTranscript);
    const source = el('select', { disabled: busy || !transcripts.length, 'aria-label': 'Saved transcript to send', onchange: event => { selectedTranscript = event.target.value; render(); } },
      ...transcripts.map(item => el('option', { value: item.transcript_id, selected: item.transcript_id === selectedTranscript }, `${date(item.created_at)}${used.has(item.transcript_id) ? ' · sent' : ''} · ${item.text.slice(0, 65)}`)));
    const chat = el('section', { class: 'conversation-card card' },
      el('div', { class: 'section-heading' }, el('div', {}, p(copy.eyebrow, 'eyebrow'), el('h2', {}, copy.title)), badge(project.language === 'sv' ? 'AI-intervjuare' : 'AI interviewer')),
      p(copy.intro, 'muted'),
      renderInspiration(),
      el('div', { class: 'thread', 'aria-label': copy.saved }, messages.length ? messages.map(item => el('article', { class: `bubble ${item.role}` },
        el('div', { class: 'speaker-heading' }, el('span', { class: `speaker-avatar ${item.role === 'assistant' ? 'memy-avatar' : 'your-avatar'}`, 'aria-hidden': 'true' }, item.role === 'assistant' ? '❧' : '“'), el('strong', { class: 'speaker-name' }, item.role === 'user' ? item.source_text_input_id && item.source_transcript_id === null ? copy.typed : copy.voice : copy.interviewer)), prose(item.text),
        el('div', { class: 'message-meta' }, item.role === 'user' && item.source_text_input_id && item.source_transcript_id === null ? p(copy.original, 'original-label') : provenance(item), item.created_at && p(date(item.created_at), 'message-time')),
        item.role === 'assistant' && speechControls(item))) :
        el('div', { class: 'thread-empty local-guidance' }, el('span', { class: 'empty-symbol', 'aria-hidden': 'true' }, '“'), p('MEMY', 'eyebrow'), el('h3', {}, copy.emptyTitle), p(copy.empty, 'muted'), p(copy.emptyNote, 'field-help'))),
      composer,
      memories.some(item => item.status === 'pending') && el('aside', { class: 'chat-memory-invitation' }, el('span', { class: 'memory-invitation-mark', 'aria-hidden': 'true' }, '❧'), el('div', {}, p(copy.reviewHint, 'muted'), button(`${copy.review} · ${memories.filter(item => item.status === 'pending').length}`, () => { tab = 'memories'; }, false, 'text-button'))));
    const recordControl = isRecording ? button(`Stop recording · ${recording.seconds}s`, () => stopRecording(), false, 'record-orb is-recording') :
      button(finalizing ? 'Finishing recording…' : 'Start recording', startRecording, !consent || !active || Boolean(recording), 'record-orb primary');
    if (isRecording) { recordControl.dataset.recordStop = ''; recordControl.setAttribute('aria-label', 'Stop recording'); }
    const recordState = p(isRecording ? `${String(Math.floor(recording.seconds / 60)).padStart(2, '0')}:${String(recording.seconds % 60).padStart(2, '0')} · Recording` : finalizing ? 'Finishing your recording…' : audioFile ? 'Unsent · only on this device' : 'Up to 60 seconds · no audio sent until you choose', `record-state ${isRecording ? 'recording' : ''}`);
    recordState.dataset.recordState = '';
    const recorder = el('section', { class: `record-studio card ${isRecording ? 'is-recording' : ''}` },
      p('TAKE YOUR TIME', 'eyebrow'), el('h2', {}, isRecording ? 'Your microphone is on.' : audioFile ? 'Your recording is ready.' : 'Share a memory'),
      p(isRecording ? 'Speak naturally. You can stop whenever you like.' : 'You don’t need perfect words. Just start with what you remember.', 'muted'),
      el('div', { class: `record-visual ${isRecording ? 'is-recording' : audioFile ? 'is-ready' : 'is-resting'}`, 'aria-hidden': 'true' }, ...Array.from({ length: 13 }, (_, index) => el('span', { class: `record-wave wave-${index % 5}` }))),
      el('div', { class: 'record-consent' }, check('I consent to recording and sending this audio to OpenAI for transcription.', consent, checkboxChange(value => { consent = value; if (!value) stopRecording(true); }))),
      el('div', { class: 'record-actions' }, recordControl), recordState,
      el('div', { class: 'unsent-audio' }, audioFile && p(`Ready: ${audioName} · ${(audioFile.size / 1_000_000).toFixed(2)} MB`, 'muted'),
        paidButton('Save transcript · Real AI', async g => {
          if (!audioFile || !consent) return;
          const form = new FormData(); form.append('file', audioFile, `recording.${audioName.split('.').at(-1).toLowerCase()}`); form.append('language', project.language); form.append('consent', 'true');
          const result = await performPaid('transcription', `${v2}/story-sessions/${session.id}/transcribe`, { form }, g);
          if (!result) return;
          selectedTranscript = result.transcript_id; audioFile = null; audioName = ''; consent = false; await refresh(g, ['transcripts']); notice = 'Original transcript saved. Review it before sending a conversation turn.';
        }, !audioFile || !consent || Boolean(recording) || !active), audioFile && button('Discard audio', () => { audioFile = null; audioName = ''; consent = false; }, false, 'text-button')),
      panel('record-options', 'Use an audio file instead', p('Choose a WAV, MP3, M4A or WebM file, up to 25 MB. It stays in memory until you explicitly save its transcript.', 'field-help'), label('Or choose an audio file', file)));
    const transcriptReview = el('section', { class: 'transcript-review card' }, p('PRESERVED IN YOUR OWN WORDS', 'eyebrow'), el('h2', {}, 'Saved original transcripts'),
      transcripts.length ? el('div', {}, label('Choose transcript', source), chosen && el('div', {}, prose(chosen.text), provenance(chosen), p('Your saved original remains unchanged.', 'field-help'),
        paidButton(used.has(chosen.transcript_id) ? 'Transcript already sent' : 'Send selected transcript · Real AI', async g => {
          await performPaid('conversation', `${v2}/story-sessions/${session.id}/messages`, { json: { source_transcript_id: chosen.transcript_id, language: project.language } }, g);
          if (alive(g)) { await refresh(g, ['messages', 'memories', 'drafts']); notice = 'Conversation turn saved. Review the suggested memories.'; }
        }, used.has(chosen.transcript_id) || !active))) : p('Your original words will appear here after you save a transcript.', 'muted'));
    const voiceOptions = el('div', { id: 'voice-options', class: 'voice-options', hidden: !voiceOpen }, recorder, transcriptReview);
    return [el('div', { class: `conversation-layout typed-conversation ${voiceOpen ? 'voice-is-open' : ''}` }, chat, voiceOptions), nextStep()];
  }
  function renderMemories() {
    const confirmed = memories.filter(item => item.status === 'confirmed').length;
    return el('section', { class: 'memory-section' }, p('YOU ARE THE AUTHOR', 'eyebrow'), el('h2', {}, 'Keep the details that feel right.'),
      p('Memy suggests details from your conversation. You decide what belongs in your story.', 'lead'),
      memories.length > 0 && p(`${confirmed} of ${memories.length} suggested memories confirmed`, 'memory-summary'),
      el('div', { class: 'memory-grid' }, ...empty(memories, 'After a conversation turn, your suggested memories will be ready to review here.', memory => {
        const correction = field(input({ value: correctionInputs.get(memory.id) ?? memory.corrected_value ?? '', placeholder: 'Your correction', maxLength: 1000, disabled: busy, 'aria-label': `Correct ${memory.fact_type} memory` }), `correction-${memory.id}`, value => correctionInputs.set(memory.id, value));
        const review = async (g, status, corrected) => {
          const payload = { expected_version: memory.version, status }; if (corrected) payload.corrected_value = corrected;
          await api.call('PATCH', `${v2}/memories/${memory.id}`, { json: payload });
          if (alive(g)) { correctionInputs.delete(memory.id); await refresh(g, ['memories', 'drafts']); notice = 'Memory review saved.'; }
        };
        return el('article', { class: `memory-card card memory-${memory.status}` },
          el('div', { class: 'memory-heading' }, p(memory.fact_type, 'eyebrow'), badge(memory.status === 'confirmed' ? 'Confirmed by you' : memory.status === 'rejected' ? 'Left out' : 'Needs your review', 'memory-status')),
          el('h3', {}, memory.corrected_value || memory.value), memory.uncertain && p('Memy is unsure about this detail. Please check it.', 'review-note'),
          memory.clarification_question && p(memory.clarification_question, 'review-note'),
          panel(`evidence-${memory.id}`, 'Read the original evidence', p(`Original: ${memory.value}`), p(`Evidence: ${memory.evidence}`, 'muted'), p(`Saved memory version ${memory.version}`, 'field-help')),
          el('div', { class: 'memory-actions' }, button('Confirm', g => review(g, 'confirmed'), memory.status === 'confirmed' && !memory.clarification_question, 'primary'), button('Reject', g => review(g, 'rejected'), memory.status === 'rejected', 'secondary')),
          panel(`correction-${memory.id}`, 'Correct this detail', label('Correct the value', correction), button('Save correction and confirm', g => { if (!correction.value.trim()) throw Error('Enter a correction first.'); return review(g, 'confirmed', correction.value.trim()); }, false, 'primary')));
      })), nextStep());
  }
  function renderDrafts() {
    const draft = drafts.find(item => item.draft_id === selectedDraft);
    const choose = el('select', { disabled: busy || !drafts.length, 'aria-label': 'Story draft', onchange: event => { if (!allowLeaveDraft()) { event.target.value = selectedDraft; return; } selectedDraft = event.target.value; draftEditing = null; history = []; historyDraft = ''; clearDownload(); render(); } }, ...drafts.map(item => el('option', { value: item.draft_id, selected: item.draft_id === selectedDraft }, `Version ${item.version} · revision ${item.revision} · ${date(item.updated_at)}`)));
    const generateAction = async g => {
      if (!allowLeaveDraft()) return;
      const result = await performPaid('generation', `${v2}/story-projects/${project.id}/generate`, { json: { language: project.language, style: 'warm', confirm_generation: true } }, g);
      if (result) { selectedDraft = result.draft_id; draftEditing = null; generationConsent = false; history = []; historyDraft = ''; await refresh(g, ['drafts']); notice = 'Draft saved. Please review its wording and facts.'; }
    };
    const generate = el('section', { class: 'generation-panel card' }, p('FROM MEMORIES TO MEANING', 'eyebrow'), el('h2', {}, draft ? 'There’s always another chapter.' : 'Your memories, beautifully told.'), p('Turn the memories you have confirmed into a warm autobiography draft. Read it carefully; every story still needs your review.', 'muted'),
      p('Writing a new draft uses Real AI and its testing allowance. Preparing or downloading a PDF from a saved draft makes no AI request.', 'field-help'),
      check('I want to generate a new story draft with Real AI.', generationConsent, checkboxChange(value => { generationConsent = value; })),
      paidButton('Generate new draft · Real AI', generateAction, !generationConsent));
    let reader = null;
    if (draft) {
      const editing = draftEditing?.id === draft.draft_id;
      const content = editing ? field(el('textarea', { value: draftEditing.content, maxLength: 20_000, rows: 15, disabled: busy, 'aria-label': 'Draft content' }), 'draft-content', value => {
        draftEditing.content = value; draftEditing.dirty = value !== draftEditing.savedContent;
        const save = [...root.querySelectorAll('button')].find(node => node.textContent === 'Save revision');
        if (save) save.disabled = busy || !draftEditing.dirty;
        const state = root.querySelector('.save-bar .field-help');
        if (state) state.textContent = draftEditing.dirty ? 'Unsaved changes · saved only when you choose' : 'Your saved wording is shown above.';
      }) : null;
      const titlePage = input({ type: 'checkbox', checked: includeTitlePage, disabled: busy, onchange: event => { includeTitlePage = event.target.checked; } });
      const pageNumbers = input({ type: 'checkbox', checked: includePageNumbers, disabled: busy, onchange: event => { includePageNumbers = event.target.checked; } });
      const review = el('aside', { class: 'review-note' }, p('YOUR REVIEW MATTERS', 'eyebrow'), p('This is an AI-generated draft. Please check its wording and facts before sharing.'),
        !draft.verification.sources_current && p('Source memories have changed. Check this draft against the current facts.'),
        ...draft.verification.unsupported_claims.map(claim => p(`Please review: ${claim}`)), draft.verification.reason && p(draft.verification.reason));
      reader = el('section', { class: 'draft-workspace' },
        el('div', { class: 'draft-toolbar' }, el('div', {}, el('h2', {}, editing ? 'Make it your own.' : 'Your autobiography'), p(`Version ${draft.version} · revision ${draft.revision}`, 'muted')), editing ? button('Return to reading', () => { if (allowLeaveDraft()) draftEditing = null; }, false, 'secondary') : button('Edit your story', () => { draftEditing = { id: draft.draft_id, content: draft.content, savedContent: draft.content, expectedRevision: draft.revision, dirty: false }; }, false, 'secondary')),
        review,
        editing ? el('section', { class: 'book-editor card' }, label('Edit your story', content), el('div', { class: 'save-bar' }, p(draftEditing.dirty ? 'Unsaved changes · saved only when you choose' : 'Your saved wording is shown above.', 'field-help'), button('Save revision', async g => {
          if (!content.value.trim()) throw Error('Your story needs some content.');
          const result = await api.call('PATCH', `${v2}/story-drafts/${draft.draft_id}`, { json: { expected_revision: draftEditing.expectedRevision, content: content.value.trim() } });
          if (alive(g)) { selectedDraft = result.draft_id; draftEditing = null; history = []; historyDraft = ''; clearDownload(); await refresh(g, ['drafts']); notice = 'Your revision is saved. Please review the wording before sharing.'; }
        }, !draftEditing.dirty, 'primary'))) :
        el('article', { class: 'book-reader' }, el('div', { class: 'book-page' }, p('A LIFE IN YOUR OWN WORDS', 'book-kicker'), el('h2', { class: 'book-title' }, project.title), p(`AUTOBIOGRAPHY · ${languages[project.language]}`, 'book-subtitle'), ...savedBookParagraphs(draft.content))),
        el('div', { class: 'draft-actions' },
          panel('original-draft', 'Read the original generated draft', prose(draft.original_content)),
          panel('source-facts', 'Explore the memories behind this story', ...draft.source_memories.map(source => card(prose(source.sentence), p(`Evidence: ${source.evidence}`, 'muted'), p(`Memory version ${source.memory_version}`, 'field-help')))),
          panel('edit-history', 'Earlier wording & edit history', button('Load edit history', async g => { const rows = await collection(`${v2}/story-drafts/${draft.draft_id}/history`); if (alive(g)) { history = rows; historyDraft = draft.draft_id; } }, false, 'secondary'),
            historyDraft === draft.draft_id && el('div', {}, ...empty(history, 'No manual revisions yet.', entry => el('details', {}, el('summary', {}, `Revision ${entry.revision} · ${date(entry.created_at)}`), p('Previous content', 'muted'), prose(entry.previous_content), p('Saved content', 'muted'), prose(entry.content))))), provenance(draft)),
        el('section', { class: 'export-panel card' }, p('SOMETHING TO HOLD ON TO', 'eyebrow'), el('h3', {}, 'Take your story with you.'), p('Prepare a PDF from this saved revision. Your unsaved edits are never exported.', 'muted'),
          panel('pdf-options', 'PDF options', label('Include title page', titlePage), label('Include page numbers', pageNumbers)),
          button('Prepare PDF', g => preparePdf(`${v2}/story-drafts/${draft.draft_id}/export`, { json: { expected_revision: draft.revision, include_title_page: includeTitlePage, include_page_numbers: includePageNumbers } }, g), false, 'primary')));
    }
    const saved = panel('saved-exports', 'Previously prepared PDFs', ...empty(exports, 'Your prepared PDFs will appear here.', item => card(el('h3', {}, item.title), p(`Version ${item.draft_version} · revision ${item.draft_revision} · ${item.page_count} pages · ${date(item.created_at)}`, 'muted'),
      button('Prepare saved PDF download', g => preparePdf(`${v2}/story-exports/${item.export_id}/download`, null, g, item.filename), false, 'secondary'))));
    return [el('section', { class: 'autobiography-heading' }, p('YOUR WORDS. YOUR LEGACY.', 'eyebrow'), !draft && el('h2', {}, 'A book that belongs to you.'), drafts.length ? label('Choose a saved autobiography', choose) : p('No autobiography draft is saved yet. Confirm your memories and generate a draft first; then you can prepare its PDF.', 'lead')),
      reader, draft ? panel('new-generation', 'Create another autobiography version', generate) : generate, saved];
  }
  function render() {
    if (disposed) return;
    const active = document.activeElement;
    const focusKey = root.contains(active) ? active.dataset?.focusKey : null;
    const selection = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const exit = el('button', { type: 'button', class: 'text-button', onclick: () => { dispose(); onExit?.(); } }, 'Sign out');
    root.replaceChildren(el('div', { class: 'workspace stack' }, ...[
      el('header', { class: 'account-bar' }, p('Your personal story space', 'account-label'), panel('account', 'Your account', p(user.email || 'Signed in', 'muted'), p('Real AI uses the same shared $10 testing allowance. Each processing action requires your click. Reading saved work makes no AI request.', 'field-help'), exit)),
      (busy || notice) && el('div', { role: 'status', 'aria-live': 'polite', class: `workspace-status ${busy ? 'is-working' : 'is-saved'}` }, busy ? workingLabel || 'Taking care of your story… Please wait.' : notice),
      error && el('div', { role: 'alert', class: 'notice error' }, error),
      capabilities && capabilities.enabled !== true && el('aside', { class: 'service-status' }, el('div', {}, p('AI testing is currently paused.', 'service-status-title'), p('Your saved work remains available. You can read stories, review memories, edit saved drafts and prepare PDFs.', 'muted')), button('Check AI availability', g => loadCapabilities(g), false, 'secondary')),
      pending() && card(el('h2', {}, 'Let’s check your last action.'), p('The connection was interrupted. Check the saved result before trying another AI action; your request will not be sent again.', 'notice'), button('Reload saved action', async g => {
        const result = await api.reconcile(); if (!alive(g)) return;
        if (result?.user_message?.source_text_input_id && result.user_message.source_transcript_id === null && result.user_message.text === composerText) { composerText = ''; composerState = 'saved'; }
        await refresh(g); if (result?.speech_id) await prepareSpeech(result, g); notice = 'Saved AI action reloaded.';
      }, false, 'primary')),
      ...(project ? [renderProject(), ...(tab === 'conversation' ? renderConversation() : tab === 'memories' ? [renderMemories()] : renderDrafts())] : renderHome()).filter(Boolean),
      downloadUrl && el('section', { class: 'export-panel card' }, p('YOUR STORY IS READY', 'eyebrow'), el('h2', {}, 'Keep it. Share it. Treasure it.'), p('Your PDF is ready to download to this device.', 'muted'), el('a', { href: downloadUrl, download: downloadName, class: 'download' }, `Download ${downloadName}`), button('Clear prepared download', () => clearDownload(), false, 'text-button'))
    ].filter(item => item !== false && item != null)));
    if (focusKey && !busy && !document.hidden) {
      const replacement = [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey);
      if (replacement && !replacement.disabled) { replacement.focus({ preventScroll: true }); if (selection && typeof replacement.setSelectionRange === 'function') { try { replacement.setSelectionRange(...selection); } catch { /* Some input types have no text selection. */ } } }
    }
  }
  function onBackground() {
    if (disposed) return;
    root.hidden = document.hidden;
    if (document.hidden) { clearPrivateMedia(); clearFormMemory(); notice = 'Private audio, unsaved changes and prepared downloads were cleared while the app was in the background.'; }
    render();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; epoch++; clearPrivateMedia(); preparedSpeech.clear(); clearFormMemory();
    document.removeEventListener('visibilitychange', onBackground);
    projects = []; project = null; session = null; sessions = []; transcripts = []; messages = []; memories = []; drafts = []; exports = []; history = [];
    root.replaceChildren(); root.hidden = false;
  }
  document.addEventListener('visibilitychange', onBackground);
  root.hidden = document.hidden; render(); run(async g => {
    // Settle both independent reads before the final render, including when the
    // library fails first. A late capability response must not silently change
    // button state after run() has already rendered the failure.
    const results = await Promise.allSettled([loadCapabilities(g), refresh(g)]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  });
  return { dispose };
}
