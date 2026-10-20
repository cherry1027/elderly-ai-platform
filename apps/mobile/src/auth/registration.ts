import 'react-native-url-polyfill/auto';
import { createClient, type Session } from '@supabase/supabase-js';
import { DEVELOPMENT_SUPABASE_URL, validateMobileAuthConfig, type MobileAuthConfig } from './config';
import { createConfirmationStorage, ConfirmationStorageError, REGISTRATION_STORAGE_KEY, type ConfirmationStorage } from './confirmation-storage';
import { assertRegistrationCrypto, createRegistrationState, type RegistrationCrypto } from './registration-crypto';

export const REGISTRATION_REDIRECT_URL = 'memy-foundation://auth/confirm';
export type RegistrationErrorKind = 'unavailable' | 'validation' | 'rate-limit' | 'network' | 'timeout' |
  'weak-password' | 'link' | 'cleanup' | 'configuration' | 'pending' | 'failed';
export class RegistrationError extends Error {
  constructor(readonly kind: RegistrationErrorKind) { super(`Registration ${kind}.`); this.name = 'RegistrationError'; }
}
class UnrelatedConfirmation extends RegistrationError {
  constructor() { super('link'); }
}
export interface RegistrationSnapshot {
  status: 'idle' | 'sending' | 'check-email' | 'confirming' | 'confirmed' | 'blocked';
  error: RegistrationErrorKind | null;
}
export interface Registration {
  getSnapshot(): RegistrationSnapshot;
  subscribe(listener: () => void): () => void;
  signUp(email: string, password: string): Promise<void>;
  confirm(input: { code: string; state: string }): Promise<void>;
  cancel(): Promise<void>;
  dispose(): void;
}
interface Dependencies {
  // This is an offline unit-test seam, not an activation setting. Native crypto,
  // stable callbacks and live registration require separate review/approval.
  testHarness?: {
    request: typeof fetch;
    crypto: RegistrationCrypto;
    clientFactory?: typeof createClient;
    storageFactory?: () => ConfirmationStorage;
    timeoutMs?: number;
  };
}
const TIMEOUT_MS = 10_000;
const safeCodes = new Set(['weak_password', 'email_address_invalid', 'user_already_exists', 'email_exists',
  'over_request_rate_limit', 'over_email_send_rate_limit', 'otp_expired', 'bad_code_verifier', 'flow_state_not_found',
  'flow_state_expired', 'validation_failed', 'invalid_credentials']);
function kind(error: unknown): RegistrationErrorKind {
  if (error instanceof RegistrationError) return error.kind;
  if (error instanceof ConfirmationStorageError) return error.kind === 'pending' ? 'pending' : 'cleanup';
  if (!error || typeof error !== 'object') return 'failed';
  const value = error as { status?: number; code?: string; name?: string; originalError?: unknown };
  if (value.originalError instanceof RegistrationError) return value.originalError.kind;
  if (value.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(value.code ?? '')) return 'rate-limit';
  if (value.code === 'weak_password') return 'weak-password';
  if (value.code === 'email_address_invalid' || value.code === 'validation_failed') return 'validation';
  if (value.status === 401 || value.status === 403) return 'link';
  if (['otp_expired', 'bad_code_verifier', 'flow_state_not_found', 'flow_state_expired'].includes(value.code ?? '') ||
      ['AuthPKCECodeVerifierMissingError', 'AuthInvalidTokenResponseError'].includes(value.name ?? '')) return 'link';
  if (value.name === 'AuthRetryableFetchError' || value.name === 'TypeError') return 'network';
  return 'failed';
}
async function bounded<T>(promise: Promise<T>, timeout: number, abort?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { abort?.(); reject(new RegistrationError('timeout')); }, timeout);
    })]);
  } finally { clearTimeout(timer); }
}
function verified(session: Session, user: Session['user'] | null, email: string) {
  try {
    const encoded = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!user || user.id !== session.user.id || user.is_anonymous !== false || !user.email_confirmed_at ||
        user.email?.trim().toLowerCase() !== email || claims.sub !== user.id || claims.role !== 'authenticated' ||
        claims.iss !== `${DEVELOPMENT_SUPABASE_URL}/auth/v1` || !Number.isFinite(claims.exp) ||
        claims.exp !== session.expires_at || claims.exp <= Date.now() / 1000) throw new Error();
  } catch { throw new RegistrationError('link'); }
}

export function createRegistration(settings?: MobileAuthConfig, dependencies: Dependencies = {}): Registration {
  let snapshot: RegistrationSnapshot = { status: 'idle', error: null };
  const listeners = new Set<() => void>();
  let disposed = false;
  let working = false;
  let generation = 0;
  let cleaning: Promise<void> | null = null;
  let engine: {
    storage: ConfirmationStorage; client: ReturnType<typeof createClient>;
    controllers: Set<AbortController>; closed: boolean; cleanup: boolean; session: Session | null; state: string | null;
  } | null = null;
  const harness = dependencies.testHarness;
  // There is deliberately no environment/URL/user setting that enables live
  // registration. Even a supplied harness is inert outside the test runtime.
  const enabled = process.env.NODE_ENV === 'test' && Boolean(harness?.request && harness.crypto);
  const timeout = harness?.timeoutMs ?? TIMEOUT_MS;
  function publish(status: RegistrationSnapshot['status'], error: RegistrationErrorKind | null = null) {
    if (disposed) return;
    snapshot = { status, error }; listeners.forEach(listener => listener());
  }
  function requireEnabled() { if (!enabled || disposed) throw new RegistrationError('unavailable'); }
  function active(target: NonNullable<typeof engine>, attempt: number) {
    return !disposed && !target.closed && engine === target && generation === attempt;
  }
  function close(target: NonNullable<typeof engine>) {
    target.closed = true; target.storage.close();
    target.controllers.forEach(controller => controller.abort()); target.controllers.clear();
    try { void Promise.resolve(target.client.auth.stopAutoRefresh()).catch(() => {}); } catch { /* Sanitized cleanup only. */ }
  }
  async function ensureEngine(attempt: number) {
    requireEnabled();
    if (generation !== attempt) throw new RegistrationError('link');
    if (engine && !engine.closed) return engine;
    let config: MobileAuthConfig;
    try { config = validateMobileAuthConfig(settings!); } catch { throw new RegistrationError('configuration'); }
    try { await bounded(assertRegistrationCrypto(harness!.crypto), timeout); }
    catch { throw new RegistrationError('configuration'); }
    if (disposed || generation !== attempt) throw new RegistrationError('link');
    const storage = (harness!.storageFactory ?? createConfirmationStorage)();
    const target = { storage, controllers: new Set<AbortController>(), closed: false, cleanup: false, session: null, state: null } as NonNullable<typeof engine>;
    engine = target;
    const request: typeof fetch = async (input, init) => {
      const attempt = generation;
      let url: URL;
      try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); }
      catch { throw new RegistrationError('configuration'); }
      const method = (init?.method ?? 'GET').toUpperCase();
      const signup = url.pathname === '/auth/v1/signup' && method === 'POST' &&
        Boolean(target.state && /^[a-f0-9]{64}$/.test(target.state)) &&
        url.searchParams.get('redirect_to') === `${REGISTRATION_REDIRECT_URL}?state=${target.state}` && [...url.searchParams.keys()].length === 1;
      const exchange = url.pathname === '/auth/v1/token' && method === 'POST' && url.search === '?grant_type=pkce';
      const user = url.pathname === '/auth/v1/user' && method === 'GET' && !url.search;
      const logout = url.pathname === '/auth/v1/logout' && method === 'POST' && url.search === '?scope=local';
      if (url.origin !== config.supabaseUrl || url.username || url.password || url.hash || !(signup || exchange || user || logout)) throw new RegistrationError('configuration');
      const allowed = () => active(target, attempt) || (!disposed && engine === target && generation === attempt && target.cleanup && logout);
      if (!allowed() || (signup && snapshot.status !== 'sending') || (exchange && snapshot.status !== 'confirming')) throw new RegistrationError('link');
      if (signup) {
        try {
          const body = JSON.parse(String(init?.body));
          if (body.code_challenge_method !== 's256' || !/^[A-Za-z0-9_-]{43}$/.test(body.code_challenge)) throw new Error();
        } catch { throw new RegistrationError('configuration'); }
      }
      const controller = new AbortController(); target.controllers.add(controller);
      try {
        return await bounded((async () => {
          const response = await harness!.request(url.href, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
          const body = await response.text();
          if (!allowed() || controller.signal.aborted) throw new RegistrationError('link');
          if (!response.ok) {
            let code = 'registration_failed';
            try { const value = JSON.parse(body); code = [value.code, value.error_code].find(item => typeof item === 'string' && safeCodes.has(item)) ?? code; } catch { /* No server text escapes. */ }
            return new Response(JSON.stringify({ code, error_code: code, message: 'Registration request failed.' }), {
              status: response.status, headers: { 'Content-Type': 'application/json' },
            });
          }
          if (response.status !== 204) { try { JSON.parse(body); } catch { throw new RegistrationError('failed'); } }
          return new Response(response.status === 204 ? null : body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
        })(), timeout, () => controller.abort());
      } catch (error) { throw new RegistrationError(kind(error)); }
      finally { target.controllers.delete(controller); }
    };
    target.client = (harness!.clientFactory ?? createClient)(config.supabaseUrl, config.publishableKey, {
      auth: {
        storageKey: REGISTRATION_STORAGE_KEY, persistSession: true, flowType: 'pkce',
        autoRefreshToken: false, detectSessionInUrl: false, debug: false,
        storage: {
          getItem: key => target.closed ? Promise.resolve(target.cleanup && key === REGISTRATION_STORAGE_KEY && target.session ? JSON.stringify(target.session) : null) : storage.getItem(key),
          setItem: (key, value) => storage.setItem(key, value), removeItem: key => storage.removeItem(key),
        },
      },
      global: { fetch: request },
    });
    const initialization = await bounded(target.client.auth.initialize(), timeout);
    if (!active(target, attempt)) throw new RegistrationError('link');
    if (initialization.error) throw initialization.error;
    return target;
  }
  async function cleanup() {
    if (cleaning) return cleaning;
    const target = engine;
    if (!target) return;
    generation++; close(target);
    cleaning = (async () => {
      target.cleanup = Boolean(target.session);
      try { await bounded(Promise.resolve(target.client.auth.signOut({ scope: 'local' })), timeout); } catch { /* Explicit local deletion still required. */ }
      finally { target.cleanup = false; target.session = null; target.state = null; }
      try { await bounded(target.storage.clear(), timeout); if (engine === target) engine = null; }
      catch { publish('blocked', 'cleanup'); throw new RegistrationError('cleanup'); }
    })().finally(() => { cleaning = null; });
    return cleaning;
  }
  async function failed(error: unknown, target?: NonNullable<typeof engine>, attempt?: number) {
    const reason = kind(error);
    if (attempt !== undefined && generation !== attempt) throw new RegistrationError(reason);
    if (target && attempt !== undefined && !active(target, attempt)) throw new RegistrationError(reason);
    if (error instanceof UnrelatedConfirmation) { publish('check-email', 'link'); throw new RegistrationError('link'); }
    if (reason === 'pending') { publish('check-email', 'pending'); throw new RegistrationError('pending'); }
    await cleanup(); publish('idle', reason); throw new RegistrationError(reason);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async signUp(email, password) {
      if (working || cleaning || snapshot.status === 'blocked') throw new RegistrationError('pending');
      if (typeof email !== 'string' || typeof password !== 'string') throw new RegistrationError('validation');
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254 || password.length < 6 || password.length > 4096) {
        publish('idle', 'validation'); throw new RegistrationError('validation');
      }
      try { requireEnabled(); } catch { publish('idle', 'unavailable'); throw new RegistrationError('unavailable'); }
      working = true;
      const attempt = ++generation; publish('sending');
      let target: NonNullable<typeof engine> | undefined;
      try {
        target = await ensureEngine(attempt);
        const state = createRegistrationState(harness!.crypto);
        await bounded(target.storage.begin(normalized, state), timeout);
        if (!active(target, attempt)) throw new RegistrationError('link');
        target.state = state;
        const result = await bounded(target.client.auth.signUp({ email: normalized, password,
          options: { emailRedirectTo: `${REGISTRATION_REDIRECT_URL}?state=${state}` } }), timeout);
        if (!active(target, attempt)) throw new RegistrationError('link');
        if (result.data.session) { target.session = result.data.session; throw new RegistrationError('configuration'); }
        if (result.error && !['user_already_exists', 'email_exists'].includes(result.error.code ?? '')) throw result.error;
        publish('check-email');
      } catch (error) { await failed(error, target, attempt); }
      finally { working = false; }
    },
    async confirm({ code, state }) {
      try { requireEnabled(); } catch { publish('idle', 'unavailable'); throw new RegistrationError('unavailable'); }
      if (working || cleaning || snapshot.status === 'blocked') throw new RegistrationError('pending');
      if (typeof code !== 'string' || code.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(code) ||
          typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) { publish('idle', 'link'); throw new RegistrationError('link'); }
      working = true;
      const attempt = ++generation; publish('confirming');
      let target: NonNullable<typeof engine> | undefined;
      try {
        target = await ensureEngine(attempt);
        const pending = await bounded(target.storage.pending(), timeout);
        if (!active(target, attempt)) throw new RegistrationError('link');
        if (!pending) throw new RegistrationError('link');
        // Public correlation state prevents an old or unrelated link from
        // consuming the current pending verifier. PKCE still proves ownership.
        if (state !== pending.state) throw new UnrelatedConfirmation();
        target.state = pending.state;
        const result = await bounded(target.client.auth.exchangeCodeForSession(code), timeout);
        if (!active(target, attempt)) throw new RegistrationError('link');
        if (result.error || !result.data.session) throw result.error ?? new RegistrationError('link');
        target.session = result.data.session;
        // These are routing checks only; getUser below remains authoritative.
        verified(result.data.session, result.data.session.user, pending.email);
        const response = await bounded(target.client.auth.getUser(result.data.session.access_token), timeout);
        if (!active(target, attempt)) throw new RegistrationError('link');
        if (response.error) throw response.error;
        verified(result.data.session, response.data.user, pending.email);
        await cleanup(); publish('confirmed');
      } catch (error) { await failed(error, target, attempt); }
      finally { working = false; }
    },
    async cancel() {
      if (!enabled || disposed) { publish('idle'); return; }
      generation++;
      if (!engine) {
        const storage = (harness!.storageFactory ?? createConfirmationStorage)();
        storage.close();
        try { await bounded(storage.clear(), timeout); }
        catch { publish('blocked', 'cleanup'); throw new RegistrationError('cleanup'); }
      }
      await cleanup(); publish('idle');
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++;
      if (engine) { close(engine); engine.session = null; }
      listeners.clear();
    },
  };
}
