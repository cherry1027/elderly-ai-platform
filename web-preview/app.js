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
  introduction.append(el('p', 'A life, in your own words', 'eyebrow'), el('h1', 'Your memories.\nYour autobiography.'),
    el('p', 'A gentle place to share your story, discover what matters, and create a book that belongs to you.', 'lead'));
  const path = el('div', 'Record  →  Conversation  →  Memories  →  Your book', 'journey'); introduction.append(path);
  const card = el('section', null, 'card login-card');
  card.append(el('p', 'WELCOME TO MEMY', 'eyebrow'), el('h2', 'Let’s begin your story.'), el('p', 'Sign in with your existing Memy account.', 'muted'));
  const form = el('form'); form.autocomplete = 'on';
  const emailLabel = el('label', 'Email'); emailLabel.htmlFor = 'email';
  const email = el('input'); Object.assign(email, { id: 'email', type: 'email', required: true, autocomplete: 'username', placeholder: 'you@example.com' });
  const passwordLabel = el('label', 'Password'); passwordLabel.htmlFor = 'password';
  const password = el('input'); Object.assign(password, { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const submit = el('button', 'Sign in', 'primary'); submit.type = 'submit';
  const status = el('p', note, 'notice'); status.setAttribute('role', 'status');
  form.append(emailLabel, email, passwordLabel, password, submit, status);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const attempt = version, entered = password.value; password.value = ''; submit.disabled = true; status.textContent = 'Signing in securely…';
    try { const user = await auth.signIn(email.value.trim(), entered); if (attempt === version) showWorkspace(user); }
    catch (error) { if (attempt === version) { status.textContent = error instanceof AppError ? error.message : 'Sign-in could not be completed. Please try again.'; submit.disabled = false; } }
  });
  card.append(form, el('p', 'Your session stays in this tab’s memory. Closing or reloading the page signs you out.', 'fine-print'));
  page.append(introduction, card); root.append(page);
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
start();
