import { createApi, AppError } from './api.js';
import { createWorkspace } from './workspace.js';

const EXPECTED = 'https://edbkuunyeyxnyenmmqud.supabase.co';
const root = document.getElementById('app');
let config, auth, api, workspace, version = 0;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };

function authService(settings) {
  let session = null, user = null, refreshing = null, generation = 0;
  async function request(path, method, body, token) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(settings.supabaseUrl + path, { method,
        headers: { apikey: settings.publishableKey, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new AppError('Sign-in could not be verified. Check your email and password, or confirm your email first.', 'AUTH_FAILED');
      if (response.status === 204) return null;
      const raw = await response.text(); if (raw.length > 256000) throw new AppError('Sign-in could not be verified.');
      return JSON.parse(raw);
    } finally { clearTimeout(timer); }
  }
  async function verify(candidate) {
    if (!candidate?.access_token || !candidate.refresh_token || !Number.isFinite(candidate.expires_in)) throw new AppError('Sign-in could not be verified.');
    const claims = JSON.parse(atob(candidate.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.iss !== EXPECTED + '/auth/v1' || claims.role !== 'authenticated' || !claims.sub || claims.exp <= Date.now() / 1000) throw new AppError('Sign-in could not be verified.');
    const identity = await request('/auth/v1/user', 'GET', null, candidate.access_token);
    if (identity.id !== claims.sub || identity.is_anonymous !== false || !identity.email_confirmed_at || !identity.email) throw new AppError('Please use a confirmed Memy account.');
    return { id: identity.id, email: identity.email };
  }
  return {
    async signIn(email, password) {
      const epoch = ++generation;
      const candidate = await request('/auth/v1/token?grant_type=password', 'POST', { email, password });
      const identity = await verify(candidate);
      if (epoch !== generation) throw new AppError('Sign-in was interrupted.');
      session = { ...candidate, expiresAt: Date.now() + candidate.expires_in * 1000 }; user = identity;
      return identity;
    },
    async getAccessToken() {
      if (!session || !user) return null;
      if (session.expiresAt > Date.now() + 30000) return session.access_token;
      if (refreshing) return refreshing;
      const epoch = generation, oldId = user.id, refresh = session.refresh_token;
      refreshing = (async () => {
        try {
          const candidate = await request('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: refresh });
          const identity = await verify(candidate);
          if (epoch !== generation || identity.id !== oldId) throw new AppError('Please sign in again.');
          session = { ...candidate, expiresAt: Date.now() + candidate.expires_in * 1000 }; return session.access_token;
        } catch { if (epoch === generation) this.invalidate(); return null; }
        finally { refreshing = null; }
      })();
      return refreshing;
    },
    async signOut() {
      const token = session?.access_token; this.invalidate();
      if (token) { try { await request('/auth/v1/logout?scope=local', 'POST', null, token); } catch { /* Local credentials are already cleared. */ } }
    },
    invalidate() { generation++; session = null; user = null; refreshing = null; showLogin(); },
  };
}

function retire() { version++; try { workspace?.dispose(); } catch { /* Never expose private cleanup details. */ } workspace = null; api?.dispose(); api = null; }

function showLogin(note = '') {
  retire(); root.replaceChildren();
  const page = el('section', null, 'welcome-layout');
  const introduction = el('div', null, 'welcome-copy');
  const heading = el('h1', 'Every life deserves\nto be ');
  heading.append(el('span', 'remembered.', 'story-emphasis'));
  const reassurance = el('p', 'At your pace. In your own words.', 'welcome-reassurance');
  introduction.append(el('p', 'YOUR MEMORIES. YOUR LEGACY.', 'eyebrow'), heading,
    el('p', 'Tell the stories only you can tell. Memy helps you turn a memory, a conversation, a moment — into your own autobiography.', 'lead'), reassurance);
  const companion = el('section', null, 'welcome-companion');
  companion.setAttribute('aria-labelledby', 'inspiration-title');
  const companionHeading = el('div', null, 'companion-heading');
  const sprout = el('span', null, 'memy-sprout'); sprout.setAttribute('aria-hidden', 'true');
  sprout.append(el('span', '', 'sprout-leaf'), el('span', '', 'sprout-leaf'));
  const companionTitle = el('h2', 'Every story starts with a little spark.'); companionTitle.id = 'inspiration-title';
  companionHeading.append(sprout, companionTitle);
  const topics = el('div', null, 'inspiration-topics');
  topics.setAttribute('role', 'group'); topics.setAttribute('aria-label', 'Choose a memory inspiration');
  const prompt = el('div', null, 'inspiration-prompt');
  prompt.setAttribute('aria-live', 'polite'); prompt.setAttribute('aria-atomic', 'true');
  const question = el('p', '', 'inspiration-question'); question.id = 'inspiration-question';
  const promptNote = el('p', '', 'inspiration-note');
  prompt.append(question, promptNote);
  const inspirations = [
    { id: 'place', title: 'A special place', questions: [
      ['Is there a place you love to remember?', 'A kitchen, a garden, a street you knew by heart. Any place can be a beginning.'],
      ['What could you see from a favourite window?', 'Take a moment. The smallest detail can bring a memory closer.'],
    ] },
    { id: 'person', title: 'Someone dear', questions: [
      ['Who could always make you smile?', 'A friend, a neighbour, someone in your family. You choose who to remember.'],
      ['What is a little thing someone taught you?', 'A recipe, a saying, a way of seeing the world. Everyday lessons count too.'],
    ] },
    { id: 'joy', title: 'Little joys', questions: [
      ['What small everyday moment still makes you smile?', 'A song on the radio, a favourite meal, a walk. Ordinary moments belong here too.'],
      ['Is there a song that takes you somewhere?', 'You do not need perfect words. Start with whatever comes to mind.'],
    ] },
  ];
  let inspiration = inspirations[0], questionIndex = 0;
  const topicButtons = [];
  const refreshInspiration = () => {
    [question.textContent, promptNote.textContent] = inspiration.questions[questionIndex];
    for (const item of topicButtons) item.setAttribute('aria-pressed', String(item.dataset.topic === inspiration.id));
  };
  for (const item of inspirations) {
    const choice = el('button', item.title, 'inspiration-topic'); choice.type = 'button';
    choice.dataset.topic = item.id; choice.setAttribute('aria-controls', 'inspiration-question');
    choice.addEventListener('click', () => { inspiration = item; questionIndex = 0; refreshInspiration(); });
    topicButtons.push(choice); topics.append(choice);
  }
  const another = el('button', 'Another question', 'inspiration-next'); another.type = 'button';
  another.setAttribute('aria-controls', 'inspiration-question');
  another.addEventListener('click', () => { questionIndex = (questionIndex + 1) % inspiration.questions.length; refreshInspiration(); });
  const begin = el('button', 'Sign in to tell your story', 'inspiration-action'); begin.type = 'button';
  begin.addEventListener('click', () => document.getElementById('email')?.focus());
  const inspirationActions = el('div', null, 'inspiration-actions'); inspirationActions.append(another, begin);
  refreshInspiration();
  companion.append(companionHeading, el('p', 'No need to start at the beginning. Choose what feels right today.', 'inspiration-intro'), topics, prompt, inspirationActions);
  const artwork = el('div', null, 'memory-art'); artwork.setAttribute('aria-hidden', 'true');
  const book = el('div', null, 'book-object');
  book.append(el('span', '', 'book-spine'), el('span', 'memy.', 'book-cover-mark'),
    el('span', 'A life,\nin your\nown words.', 'book-cover-title'), el('span', '', 'book-cover-rule'),
    el('span', 'YOUR AUTOBIOGRAPHY', 'book-cover-subtitle'));
  artwork.append(el('span', '', 'book-shadow'), book, el('span', 'A little memory.\nA lasting story.', 'book-caption'));
  introduction.append(artwork);
  const card = el('section', null, 'card login-card');
  const loginIntro = el('div', null, 'login-intro');
  loginIntro.append(el('p', 'YOUR STORY STARTS HERE', 'eyebrow'), el('h2', 'Welcome to Memy.'),
    el('p', 'Use your existing Memy account to return to your stories.', 'muted'));
  card.append(loginIntro);
  const form = el('form', null, 'login-form'); form.autocomplete = 'on';
  const emailLabel = el('label', 'Email'); emailLabel.htmlFor = 'email';
  const email = el('input'); Object.assign(email, { id: 'email', type: 'email', required: true, autocomplete: 'username', placeholder: 'you@example.com' });
  email.inputMode = 'email'; email.autocapitalize = 'none'; email.spellcheck = false;
  const passwordLabel = el('label', 'Password'); passwordLabel.htmlFor = 'password';
  const password = el('input'); Object.assign(password, { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const passwordField = el('div', null, 'password-field');
  const reveal = el('button', 'Show', 'password-toggle'); reveal.type = 'button';
  reveal.setAttribute('aria-label', 'Show password'); reveal.setAttribute('aria-controls', 'password'); reveal.setAttribute('aria-pressed', 'false');
  reveal.addEventListener('click', () => {
    const showing = password.type === 'password'; password.type = showing ? 'text' : 'password';
    reveal.textContent = showing ? 'Hide' : 'Show'; reveal.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    reveal.setAttribute('aria-pressed', String(showing));
  });
  passwordField.append(password, reveal);
  const submit = el('button', 'Sign in', 'primary login-submit'); submit.type = 'submit';
  const status = el('p', note, 'notice login-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  form.append(emailLabel, email, passwordLabel, passwordField, submit, status);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const attempt = version, entered = password.value; password.value = ''; password.type = 'password';
    reveal.textContent = 'Show'; reveal.setAttribute('aria-label', 'Show password'); reveal.setAttribute('aria-pressed', 'false');
    submit.disabled = true; reveal.disabled = true; email.disabled = true; password.disabled = true;
    form.setAttribute('aria-busy', 'true'); submit.textContent = 'Opening your stories…'; status.textContent = 'Signing in securely…';
    try { const user = await auth.signIn(email.value.trim(), entered); if (attempt === version) showWorkspace(user); }
    catch (error) { if (attempt === version) {
      status.textContent = error instanceof AppError ? error.message : 'Sign-in could not be completed. Please try again.';
      status.classList.add('error'); submit.disabled = false; reveal.disabled = false; email.disabled = false; password.disabled = false;
      form.setAttribute('aria-busy', 'false'); submit.textContent = 'Sign in';
    } }
  });
  const sessionNote = el('details', null, 'session-note');
  sessionNote.append(el('summary', 'About this local session'), el('p', 'Use your existing confirmed Memy account. Your session stays in this tab’s memory. Closing or reloading the page signs you out.', 'fine-print'));
  card.append(form, sessionNote);
  const steps = el('ol', null, 'welcome-steps'); steps.setAttribute('aria-label', 'How your story takes shape');
  for (const [number, title, copy] of [
    ['01', 'Share a memory', 'Start with a moment, a person, or a place. Record it in your own words.'],
    ['02', 'Shape your story', 'Explore your memories with Memy, then review what you want to keep.'],
    ['03', 'Make it your own', 'Read, edit and download your autobiography. Your wording has the final say.'],
  ]) {
    const item = el('li', null, 'welcome-step'), content = el('div', null, 'step-copy');
    const stepNumber = el('span', number, 'step-number'); stepNumber.setAttribute('aria-hidden', 'true');
    content.append(el('h3', title), el('p', copy)); item.append(stepNumber, content); steps.append(item);
  }
  page.append(introduction, card, companion); root.append(page, steps);
}

function showWorkspace(user) {
  retire(); root.replaceChildren(); api = createApi(auth);
  workspace = createWorkspace({ root, api, user, onExit: () => { void auth.signOut(); }, onSessionLost: () => auth.invalidate() });
}

async function start() {
  try {
    const response = await fetch('/client-config', { cache: 'no-store', credentials: 'omit' });
    config = await response.json();
    if (!response.ok || config.supabaseUrl !== EXPECTED || !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(config.publishableKey)) throw new Error();
    auth = authService(config); showLogin();
  } catch { root.replaceChildren(el('div', 'Memy could not load its local connection settings. Refresh this page after the backend is ready.', 'card notice')); }
}
window.addEventListener('pagehide', () => { retire(); });
for (const control of document.querySelectorAll('[data-text-choice]')) {
  control.addEventListener('click', () => {
    const larger = control.dataset.textChoice === 'larger';
    document.documentElement.dataset.textSize = larger ? 'larger' : 'standard';
    for (const item of document.querySelectorAll('[data-text-choice]')) item.setAttribute('aria-pressed', String(item === control));
  });
}
start();
