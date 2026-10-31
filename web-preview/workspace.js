const MAX_AUDIO = 25_000_000;
const languages = { en: 'English', sv: 'Svenska' };
const text = (value) => String(value ?? '');
const date = (value) => new Date(value).toLocaleString();
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('aria-')) node.setAttribute(key, value);
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
  let audioFile = null, audioName = '', consent = false, generationConsent = false;
  let speech = null, player = null, speechUrl = null, downloadUrl = null, downloadName = '';
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
  const paidButton = (name, action, disabled = false) => button(name, action, disabled || pending());
  const provenance = (item) => p(`Real AI · ${item.provenance?.provider || 'OpenAI'} · ${item.provenance?.model || 'saved result'}`, 'muted');
  const empty = (items, message, map) => items.length ? items.map(map) : [p(message, 'muted')];
  const checkboxChange = (setter) => value => { setter(value); render(); };

  function clearPlayback() {
    if (player) { player.pause(); player.removeAttribute('src'); player.load(); player = null; }
    if (speechUrl) URL.revokeObjectURL(speechUrl);
    speechUrl = null; speech = null;
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
    epoch++; clearPrivateMedia(); generationConsent = false; history = []; historyDraft = '';
    selectedTranscript = ''; selectedDraft = ''; transcripts = []; messages = []; memories = []; drafts = []; exports = []; sessions = [];
    error = ''; notice = ''; return epoch;
  }
  function showError(cause) {
    if (cause?.status === 401 || ['UNAUTHORIZED', 'SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(cause?.code)) {
      dispose(); onSessionLost?.(); return;
    }
    error = cause instanceof Error ? cause.message : 'This action could not be completed. Please reload saved data.';
  }
  async function run(action) {
    if (busy || disposed) return;
    busy = true; error = ''; notice = ''; render();
    try { await action(epoch); } catch (cause) { if (!disposed) showError(cause); }
    finally { busy = false; if (!disposed) render(); }
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
  async function refresh(g = epoch) {
    if (!project) { const data = await collection('/api/v1/story-projects'); if (alive(g)) projects = data; return; }
    const projectId = project.id, sessionId = session?.id;
    const paths = [`${v2}/story-projects/${projectId}/drafts`, `${v2}/story-projects/${projectId}/exports`, `/api/v1/story-projects/${projectId}/sessions`];
    if (sessionId) paths.push(...['transcripts', 'messages', 'memories'].map(name => `${v2}/story-sessions/${sessionId}/${name}`));
    const data = await Promise.all(paths.map(collection));
    if (!alive(g)) return;
    [drafts, exports, sessions] = data;
    [transcripts, messages, memories] = sessionId ? data.slice(3) : [[], [], []];
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
  async function prepareSpeech(metadata, g) {
    clearPlayback();
    if (!messages.some(message => message.id === metadata.assistant_message_id && message.role === 'assistant')) return;
    if (Date.parse(metadata.expires_at) <= Date.now()) throw Error('This spoken reply expired. Prepare another reply explicitly.');
    const response = await api.call('GET', `${v2}/spoken-replies/${metadata.speech_id}/audio`, { binary: 'wav' });
    await verifySpeech(response.bytes, metadata);
    if (!alive(g) || document.hidden) return;
    speechUrl = URL.createObjectURL(new Blob([response.bytes], { type: 'audio/wav' }));
    speech = metadata; player = new Audio(speechUrl); player.preload = 'none';
    player.onerror = () => { if (alive(g)) { error = 'This spoken reply could not be played. Prepare it again explicitly.'; clearPlayback(); render(); } };
  }
  async function preparePdf(path, options, g, filename) {
    const response = await api.call(options ? 'POST' : 'GET', path, { ...options, binary: 'pdf' });
    if (!alive(g) || document.hidden) return;
    if (!(response.bytes instanceof Uint8Array) || response.bytes.length > 2_000_000
      || new TextDecoder().decode(response.bytes.subarray(0, 5)) !== '%PDF-') throw Error('The PDF response could not be verified.');
    const name = safePdfName(response.headers, filename);
    clearDownload(); downloadName = name;
    downloadUrl = URL.createObjectURL(new Blob([response.bytes], { type: 'application/pdf' }));
    await refresh(g); notice = 'Your PDF is ready. Use the download link below.';
  }
  async function startRecording(g) {
    if (!consent || !session) throw Error('Give recording and transcription consent first.');
    if (recording) throw Error('Wait for the current recording to finish.');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw Error('Microphone recording is unavailable. Choose an audio file instead.');
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw Error('This browser cannot record a supported format. Choose an audio file instead.');
    clearPlayback(); audioFile = null; audioName = '';
    const tracks = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!alive(g) || document.hidden || !consent) { tracks.getTracks().forEach(track => track.stop()); return; }
    let recorder;
    try { recorder = new MediaRecorder(tracks, { mimeType: mime }); }
    catch { tracks.getTracks().forEach(track => track.stop()); throw Error('Recording could not start. Choose an audio file instead.'); }
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
    catch { entry.discard = true; tracks.getTracks().forEach(track => track.stop()); recording = null; throw Error('Recording could not start. Choose an audio file instead.'); }
    entry.timer = setTimeout(() => { if (recording === entry) stopRecording(); }, 60_000);
    entry.tick = setInterval(() => { if (alive(g) && recording === entry) { entry.seconds++; render(); } }, 1000);
  }

  function renderHome() {
    const title = input({ name: 'title', required: true, maxLength: 120, placeholder: 'A title for your memories', disabled: busy });
    const description = el('textarea', { name: 'description', maxLength: 4000, rows: 3, disabled: busy });
    const language = el('select', { name: 'language', disabled: busy }, ...Object.entries(languages).map(([value, name]) => el('option', { value }, name)));
    const form = el('form', { class: 'form', onsubmit: (event) => { event.preventDefault(); if (!form.reportValidity()) return; run(async () => {
      const created = await api.call('POST', '/api/v1/story-projects', { json: { title: title.value.trim(), description: description.value.trim() || null, language: language.value } });
      await openProject(created.id);
    }); } }, el('h2', {}, 'Start a story'), label('Story title', title), label('Description (optional)', description), label('Story language · fixed after creation', language), el('button', { type: 'submit', disabled: busy }, 'Create story'));
    return [card(el('h1', {}, 'Your stories'), p('Record a memory, review the facts, and shape your story.'), button('Reload stories', () => refresh()), ...empty(projects, 'You have no saved stories yet.', item => card(el('h3', {}, item.title), p(`${languages[item.language]} · ${date(item.updated_at)}`, 'muted'), item.description && prose(item.description), button('Open story', () => openProject(item.id))))), card(form)];
  }
  function renderProject() {
    const title = input({ value: project.title, required: true, maxLength: 120, disabled: busy });
    const description = el('textarea', { value: project.description || '', maxLength: 4000, rows: 3, disabled: busy });
    const edit = el('details', {}, el('summary', {}, 'Edit story details'), label('Title', title), label('Description', description), button('Save details', async (g) => {
      if (!title.reportValidity()) return;
      const updated = await api.call('PATCH', `/api/v1/story-projects/${project.id}`, { json: { title: title.value.trim(), description: description.value.trim() || null } });
      if (alive(g)) { project = updated; notice = 'Story details saved.'; }
    }));
    const select = el('select', { value: session?.id || '', disabled: busy, 'aria-label': 'Conversation session', onchange: (event) => run(async () => {
      const chosen = sessions.find(item => item.id === event.target.value); if (!chosen) return;
      const g = switchContext(); session = chosen; await refresh(g);
    }) }, ...sessions.map(item => el('option', { value: item.id, selected: item.id === session?.id }, `${date(item.created_at)} · ${item.status}`)));
    return card(button('← All stories', async () => { const g = switchContext(); project = null; session = null; await refresh(g); }, false, 'secondary'), el('h1', {}, project.title), p(`${languages[project.language]} · story language is fixed`, 'muted'), edit,
      label('Session', select), session?.status !== 'active' && button('Continue story', async () => { await openProject(project.id); }),
      el('nav', { class: 'tabs', 'aria-label': 'Story workspace' }, ...[['conversation', 'Conversation'], ['memories', 'Review memories'], ['drafts', 'Drafts & PDFs']].map(([value, name]) => button(name, () => { clearPlayback(); clearDownload(); tab = value; }, false, tab === value ? 'active' : 'secondary'))));
  }
  function renderConversation() {
    const isRecording = recording && recording.recorder.state !== 'inactive', finalizing = recording && !isRecording, active = session?.status === 'active';
    const file = input({ type: 'file', accept: '.wav,.mp3,.m4a,.webm,audio/wav,audio/mpeg,audio/mp4,audio/webm', disabled: busy || Boolean(recording) || !active, onchange: (event) => {
      const selected = event.target.files?.[0]; if (!selected) return;
      if (!/\.(wav|mp3|m4a|webm)$/i.test(selected.name) || !selected.size || selected.size > MAX_AUDIO) { error = 'Choose a WAV, MP3, M4A, or WebM audio file up to 25 MB.'; audioFile = null; audioName = ''; }
      else { const extension = selected.name.split('.').at(-1).toLowerCase(); audioFile = selected.slice(0, selected.size, { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', webm: 'audio/webm' }[extension]); audioName = selected.name; error = ''; notice = 'Audio selected in memory. It has not been uploaded.'; }
      event.target.value = ''; render();
    } });
    const used = new Set(messages.filter(item => item.role === 'user').map(item => item.source_transcript_id));
    const chosen = transcripts.find(item => item.transcript_id === selectedTranscript);
    const source = el('select', { disabled: busy || !transcripts.length, 'aria-label': 'Saved transcript to send', onchange: event => { selectedTranscript = event.target.value; render(); } },
      ...transcripts.map(item => el('option', { value: item.transcript_id, selected: item.transcript_id === selectedTranscript }, `${date(item.created_at)}${used.has(item.transcript_id) ? ' · sent' : ''} · ${item.text.slice(0, 65)}`)));
    return [card(el('h2', {}, 'Share a memory'), p('Audio stays in memory until you explicitly save a transcript. Recordings stop at 60 seconds. Files are limited to 25 MB.', 'muted'),
      check('I consent to recording and sending this audio to OpenAI for transcription.', consent, checkboxChange(value => { consent = value; if (!value) stopRecording(true); })),
      isRecording ? button(`Stop recording · ${recording.seconds}s`, () => stopRecording()) : button(finalizing ? 'Finishing recording…' : 'Start recording', startRecording, !consent || !active || Boolean(recording)),
      label('Or choose an audio file', file), audioFile && p(`Ready: ${audioName} · ${(audioFile.size / 1_000_000).toFixed(2)} MB`),
      paidButton('Save transcript · Real AI', async (g) => {
        if (!audioFile || !consent) return;
        const form = new FormData(); form.append('file', audioFile, `recording.${audioName.split('.').at(-1).toLowerCase()}`); form.append('language', project.language); form.append('consent', 'true');
        const result = await performPaid('transcription', `${v2}/story-sessions/${session.id}/transcribe`, { form }, g);
        if (!result) return;
        selectedTranscript = result.transcript_id; audioFile = null; audioName = ''; consent = false; await refresh(g); notice = 'Original transcript saved. Review it before sending a conversation turn.';
      }, !audioFile || !consent || Boolean(recording) || !active), audioFile && button('Discard audio', () => { audioFile = null; audioName = ''; consent = false; }, false, 'secondary')),
      card(el('h2', {}, 'Saved original transcripts'), label('Choose transcript', source), chosen ? el('div', {}, prose(chosen.text), provenance(chosen), p('The saved original remains unchanged.', 'muted'),
        paidButton(used.has(chosen.transcript_id) ? 'Transcript already sent' : 'Send selected transcript · Real AI', async (g) => {
          await performPaid('conversation', `${v2}/story-sessions/${session.id}/messages`, { json: { source_transcript_id: chosen.transcript_id, language: project.language } }, g);
          if (alive(g)) { await refresh(g); notice = 'Conversation turn saved. Review the suggested memories.'; }
        }, used.has(chosen.transcript_id) || !active)) : p('Save a transcript to begin.', 'muted')),
      card(el('h2', {}, 'Conversation'), ...empty(messages, 'Your saved conversation will appear here.', item => el('article', { class: `bubble ${item.role}` }, el('strong', {}, item.role === 'user' ? 'You · original transcript' : 'Interviewer'), prose(item.text), provenance(item),
        item.role === 'assistant' && paidButton('Prepare spoken reply · Real AI', async (g) => {
          const result = await performPaid('speech', `${v2}/conversation-messages/${item.id}/speech`, { json: { language: project.language } }, g);
          if (result) await prepareSpeech(result, g);
        }), speech?.assistant_message_id === item.id && el('div', {}, p('Verified spoken reply is ready. Playback starts only when you press Play.', 'muted'),
          button('Play spoken reply', async () => { if (Date.parse(speech.expires_at) <= Date.now()) { clearPlayback(); throw Error('This spoken reply expired. Prepare it again explicitly.'); } await player.play(); }),
          button('Stop spoken reply', () => clearPlayback(), false, 'secondary')))))];
  }
  function renderMemories() {
    return card(el('h2', {}, 'Review suggested memories'), p('Confirm facts you want included in your story. Originals and evidence are preserved; corrections create a new version.'),
      ...empty(memories, 'Saved memory suggestions appear after a conversation turn.', memory => {
        const correction = input({ value: memory.corrected_value || '', placeholder: 'Your correction', maxLength: 1000, disabled: busy, 'aria-label': `Correct ${memory.fact_type} memory` });
        const review = async (g, status, corrected) => {
          const payload = { expected_version: memory.version, status }; if (corrected) payload.corrected_value = corrected;
          await api.call('PATCH', `${v2}/memories/${memory.id}`, { json: payload });
          if (alive(g)) { await refresh(g); notice = 'Memory review saved.'; }
        };
        return card(el('h3', {}, `${memory.fact_type} · ${memory.status} · version ${memory.version}`), prose(memory.corrected_value || memory.value),
          p(`Original: ${memory.value}`), p(`Evidence: ${memory.evidence}`, 'muted'), memory.uncertain && p('This suggested fact is uncertain.', 'notice'),
          memory.clarification_question && p(`Question: ${memory.clarification_question}`, 'notice'),
          button('Confirm', g => review(g, 'confirmed'), memory.status === 'confirmed' && !memory.clarification_question), button('Reject', g => review(g, 'rejected'), memory.status === 'rejected', 'secondary'),
          label('Correct the value', correction), button('Save correction and confirm', g => { if (!correction.value.trim()) throw Error('Enter a correction first.'); return review(g, 'confirmed', correction.value.trim()); }));
      }));
  }
  function renderDrafts() {
    const draft = drafts.find(item => item.draft_id === selectedDraft);
    const choose = el('select', { disabled: busy || !drafts.length, 'aria-label': 'Story draft', onchange: event => { selectedDraft = event.target.value; history = []; historyDraft = ''; clearDownload(); render(); } }, ...drafts.map(item => el('option', { value: item.draft_id, selected: item.draft_id === selectedDraft }, `Version ${item.version} · revision ${item.revision} · ${date(item.updated_at)}`)));
    const generate = card(el('h2', {}, 'Write your story'), p('Real AI writes a warm draft using confirmed memories. Review every draft before sharing.'),
      check('I want to generate a new story draft with Real AI.', generationConsent, checkboxChange(value => { generationConsent = value; })),
      paidButton('Generate new draft · Real AI', async (g) => {
        const result = await performPaid('generation', `${v2}/story-projects/${project.id}/generate`, { json: { language: project.language, style: 'warm', confirm_generation: true } }, g);
        if (result) { selectedDraft = result.draft_id; generationConsent = false; history = []; historyDraft = ''; await refresh(g); notice = 'Draft saved. Please review its wording and facts.'; }
      }, !generationConsent));
    let editor = null;
    if (draft) {
      const content = el('textarea', { value: draft.content, maxLength: 20_000, rows: 15, disabled: busy, 'aria-label': 'Draft content' });
      const titlePage = input({ type: 'checkbox', checked: true, disabled: busy }), pageNumbers = input({ type: 'checkbox', checked: true, disabled: busy });
      editor = card(el('h2', {}, `Draft ${draft.version} · revision ${draft.revision}`), provenance(draft), p(`Review: ${draft.verification.status} · ${draft.verification.method}`, 'notice'),
        !draft.verification.sources_current && p('Source memories have changed. Check this draft against the current facts.', 'notice'),
        ...draft.verification.unsupported_claims.map(claim => p(`Review claim: ${claim}`, 'notice')), draft.verification.reason && p(draft.verification.reason),
        label('Edit your story', content), button('Save revision', async (g) => {
          if (!content.value.trim()) throw Error('Your story needs some content.');
          const result = await api.call('PATCH', `${v2}/story-drafts/${draft.draft_id}`, { json: { expected_revision: draft.revision, content: content.value.trim() } });
          if (alive(g)) { selectedDraft = result.draft_id; history = []; historyDraft = ''; clearDownload(); await refresh(g); notice = 'Manual revision saved. It still needs your review.'; }
        }), el('details', {}, el('summary', {}, 'Immutable original draft'), prose(draft.original_content)),
        el('details', {}, el('summary', {}, 'Source facts used in this draft'), ...draft.source_memories.map(source => card(prose(source.sentence), p(`Evidence: ${source.evidence}`, 'muted'), p(`Memory version ${source.memory_version}`, 'muted')))),
        button('Load edit history', async (g) => { const rows = await collection(`${v2}/story-drafts/${draft.draft_id}/history`); if (alive(g)) { history = rows; historyDraft = draft.draft_id; } }, false, 'secondary'),
        historyDraft === draft.draft_id && el('div', {}, ...empty(history, 'No manual revisions yet.', entry => el('details', {}, el('summary', {}, `Revision ${entry.revision} · ${date(entry.created_at)}`), p('Previous content', 'muted'), prose(entry.previous_content), p('Saved content', 'muted'), prose(entry.content)))),
        el('h3', {}, 'Create a PDF from this saved revision'), label('Include title page', titlePage), label('Include page numbers', pageNumbers),
        button('Prepare PDF', g => preparePdf(`${v2}/story-drafts/${draft.draft_id}/export`, { json: { expected_revision: draft.revision, include_title_page: titlePage.checked, include_page_numbers: pageNumbers.checked } }, g)));
    }
    const saved = card(el('h2', {}, 'Saved PDF exports'), ...empty(exports, 'No PDF exports yet.', item => card(el('h3', {}, item.title), p(`Draft ${item.draft_version} · revision ${item.draft_revision} · ${item.page_count} pages · ${date(item.created_at)}`, 'muted'),
      button('Prepare saved PDF download', g => preparePdf(`${v2}/story-exports/${item.export_id}/download`, null, g, item.filename), false, 'secondary'))));
    return [generate, card(el('h2', {}, 'Saved drafts'), choose, !draft && p('Your generated drafts will appear here.', 'muted')), editor, saved];
  }
  function render() {
    if (disposed) return;
    const exit = el('button', { type: 'button', class: 'secondary', onclick: () => { dispose(); onExit?.(); } }, 'Sign out');
    root.replaceChildren(el('div', { class: 'workspace stack' }, ...[el('header', { class: 'workspace-header topbar' }, p(user.email || 'Signed in', 'muted'), exit),
      p('Real AI · shared $10 budget · each AI action requires your click. Reloading saved data does not call an AI provider.', 'muted'),
      el('div', { role: 'status', 'aria-live': 'polite', class: busy ? 'notice' : '' }, busy ? 'Working… Please wait.' : notice),
      error && el('div', { role: 'alert', class: 'notice error' }, error),
      pending() && card(p('A previous AI action needs reconciliation. Reload its saved result before starting another AI action.', 'notice'), button('Reload saved action', async (g) => {
        const result = await api.reconcile(); if (!alive(g)) return;
        await refresh(g); if (result?.speech_id) await prepareSpeech(result, g); notice = 'Saved AI action reloaded.';
      })),
      ...(project ? [renderProject(), button('Reload saved story', g => refresh(g), false, 'secondary'), ...(tab === 'conversation' ? renderConversation() : tab === 'memories' ? [renderMemories()] : renderDrafts())] : renderHome()).filter(Boolean),
      downloadUrl && card(el('h2', {}, 'PDF ready'), el('a', { href: downloadUrl, download: downloadName, class: 'download' }, `Download ${downloadName}`), button('Clear prepared download', () => clearDownload(), false, 'secondary'))].filter(item => item !== false && item != null)));
  }
  function onBackground() {
    if (disposed) return;
    root.hidden = document.hidden;
    if (document.hidden) { clearPrivateMedia(); notice = 'Private audio and prepared downloads were cleared while the app was in the background.'; }
    render();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; epoch++; clearPrivateMedia();
    document.removeEventListener('visibilitychange', onBackground);
    projects = []; project = null; session = null; sessions = []; transcripts = []; messages = []; memories = []; drafts = []; exports = []; history = [];
    root.replaceChildren(); root.hidden = false;
  }
  document.addEventListener('visibilitychange', onBackground);
  root.hidden = document.hidden; render(); run(g => refresh(g));
  return { dispose };
}
