import 'react-native-url-polyfill/auto';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import { validateMobileAuthConfig, type MobileAuthConfig } from './config';
import { AuthError, authErrorKind, type AuthErrorKind } from './errors';
import { createSecureSessionStorage, MOBILE_AUTH_STORAGE_KEY, type SecureSessionStorage } from './secure-storage';

export interface AuthUser { id: string; email: string }
export interface AuthSnapshot {
  status: 'checking' | 'signed-out' | 'signed-in' | 'busy' | 'blocked';
  user: AuthUser | null;
  error: AuthErrorKind | null;
}
export interface MobileAuth {
  getSnapshot(): AuthSnapshot;
  getAccessToken(expectedUserId: string): Promise<string | null>;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setForeground(active: boolean): void;
  dispose(): void;
}
interface Dependencies {
  clientFactory?: typeof createClient;
  storageFactory?: () => SecureSessionStorage;
  request?: typeof fetch;
  timeoutMs?: number;
}
const AUTH_TIMEOUT_MS = 10_000;
const SAFE_ERROR_CODES = new Set([
  'invalid_credentials', 'email_not_confirmed', 'over_request_rate_limit',
  'over_email_send_rate_limit', 'refresh_token_not_found',
  'refresh_token_already_used', 'session_not_found',
]);

function bounded<T>(operation: Promise<T>, duration: number, expired?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired?.(); reject(new AuthError('timeout')); }, duration);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sessionBelongsToProject(session: Session, origin: string): boolean {
  try {
    const encoded = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    // Routing checks only. getUser below validates the token with Supabase Auth.
    return claims.iss === `${origin}/auth/v1` && claims.role === 'authenticated' &&
      claims.sub === session.user.id && Boolean(session.refresh_token) &&
      typeof session.expires_at === 'number' && Number.isFinite(session.expires_at) &&
      Number.isFinite(claims.exp) && claims.exp === session.expires_at &&
      session.expires_at > Date.now() / 1000;
  } catch { return false; }
}

function verifiedUser(user: User | null, expectedId: string): AuthUser {
  if (!user || user.id !== expectedId || user.is_anonymous !== false || !user.email_confirmed_at || !user.email) throw new AuthError('session');
  return { id: user.id, email: user.email };
}

export function createMobileAuth(settings: MobileAuthConfig, dependencies: Dependencies = {}): MobileAuth {
  const config = validateMobileAuthConfig(settings);
  const makeClient = dependencies.clientFactory ?? createClient;
  const makeStorage = dependencies.storageFactory ?? createSecureSessionStorage;
  const request = dependencies.request ?? ((input, init) => fetch(input, init));
  const timeout = dependencies.timeoutMs ?? AUTH_TIMEOUT_MS;
  let snapshot: AuthSnapshot = { status: 'checking', user: null, error: null };
  const listeners = new Set<() => void>();
  let foreground = true;
  let disposed = false;
  let generation = 0;
  let knownUserId: string | null = null;
  let restoring: Promise<void> | null = null;
  let cleaning: Promise<void> | null = null;
  let performing = false;
  let revalidateOnIdle = false;

  type Engine = {
    client: ReturnType<typeof createClient>;
    storage: SecureSessionStorage;
    unsubscribe: () => void;
    controllers: Set<AbortController>;
    events: Set<ReturnType<typeof setTimeout>>;
    expiry?: ReturnType<typeof setTimeout>;
    closed: boolean;
    cleanupAllowed: boolean;
    verifiedSession: Session | null;
  };
  let engine: Engine | null = null;

  function publish(next: AuthSnapshot) {
    if (disposed) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  function current(target: Engine, attempt: number) {
    return !disposed && !target.closed && target === engine && attempt === generation;
  }
  function stopRefresh(target: Engine) {
    try { void Promise.resolve(target.client.auth.stopAutoRefresh()).catch(() => {}); } catch { /* No SDK details escape cleanup. */ }
  }
  function drainRevalidation() {
    // A foreground transition can arrive while SDK work is still settling.
    // Drain after that operation releases its busy flag, keeping identity hidden.
    if (!revalidateOnIdle || disposed || !foreground || restoring || performing || cleaning) return;
    revalidateOnIdle = false;
    if (snapshot.status === 'blocked' || (!knownUserId && snapshot.status !== 'checking')) return;
    void restore();
  }
  function close(target: Engine) {
    if (target.closed) return;
    target.closed = true;
    target.storage.close();
    target.unsubscribe();
    stopRefresh(target);
    target.controllers.forEach(controller => controller.abort());
    target.controllers.clear();
    target.events.forEach(timer => clearTimeout(timer));
    target.events.clear();
    clearTimeout(target.expiry);
  }
  function ensureEngine(): Engine {
    if (engine && !engine.closed) return engine;
    const storage = makeStorage();
    const controllers = new Set<AbortController>();
    const target = { storage, controllers, events: new Set(), closed: false, cleanupAllowed: false, verifiedSession: null, unsubscribe: () => {} } as Engine;
    const privateFetch: typeof fetch = async (input, init) => {
      const attempt = generation;
      let url: URL;
      try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); }
      catch { throw new AuthError('configuration'); }
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
      const token = url.pathname === '/auth/v1/token' && method === 'POST' &&
        ['password', 'refresh_token'].includes(url.searchParams.get('grant_type') ?? '') &&
        [...url.searchParams.keys()].every(key => key === 'grant_type');
      const user = url.pathname === '/auth/v1/user' && method === 'GET' && !url.search;
      const logout = url.pathname === '/auth/v1/logout' && method === 'POST' && url.search === '?scope=local';
      if (url.origin !== config.supabaseUrl || url.username || url.password || url.hash || !(token || user || logout)) throw new AuthError('configuration');
      const mayFinish = () => current(target, attempt) || (!disposed && target === engine &&
        attempt === generation && target.cleanupAllowed && logout);
      if (!mayFinish()) throw new AuthError('session');
      const controller = new AbortController();
      const signal = init?.signal;
      const cancel = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      controllers.add(controller);
      try {
        return await bounded((async () => {
          const response = await request(url.href, {
            ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
          });
          // Reading the body is included in the deadline; an unresponsive body
          // must not keep auth locks or retain a password indefinitely.
          const body = await response.text();
          if (!mayFinish() || controller.signal.aborted) throw new AuthError('session');
          if (!response.ok) {
            let code = 'authentication_failed';
            try {
              const parsed = JSON.parse(body);
              const allowed = [parsed.code, parsed.error_code].find(value => typeof value === 'string' && SAFE_ERROR_CODES.has(value));
              if (allowed) code = allowed;
            } catch { /* Generic response only. */ }
            // The pinned SDK reads error_code when an API-version header is
            // absent. Retain only the allowlisted code in both SDK formats.
            return new Response(JSON.stringify({ code, error_code: code, message: 'Authentication request failed.' }), {
              status: response.status, headers: { 'Content-Type': 'application/json' },
            });
          }
          if (response.status !== 204) {
            try { JSON.parse(body); } catch { throw new AuthError('unknown'); }
          }
          return new Response(response.status === 204 ? null : body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
        })(), timeout, cancel);
      } catch (error) { throw new AuthError(authErrorKind(error)); }
      finally {
        controllers.delete(controller);
        signal?.removeEventListener('abort', cancel);
      }
    };
    engine = target;
    const sdkStorage = {
      async getItem(key: string) {
        // A retiring SDK may read only its already verified session for its
        // own local-scope logout. It cannot read a replacement account's data.
        if (target.closed) return target.cleanupAllowed && key === MOBILE_AUTH_STORAGE_KEY && target.verifiedSession
          ? JSON.stringify(target.verifiedSession) : null;
        try { return await storage.getItem(key); } catch { throw new AuthError('storage'); }
      },
      async setItem(key: string, value: string) { try { await storage.setItem(key, value); } catch { throw new AuthError('storage'); } },
      async removeItem(key: string) { try { await storage.removeItem(key); } catch { throw new AuthError('storage'); } },
    };
    target.client = makeClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        storage: sdkStorage, storageKey: MOBILE_AUTH_STORAGE_KEY, persistSession: true,
        autoRefreshToken: false, detectSessionInUrl: false, debug: false,
      },
      global: { fetch: privateFetch },
    });
    engine = target;
    const { data } = target.client.auth.onAuthStateChange(event => {
      // Defer a whole task beyond the SDK's callback/notification cycle.
      // Never await SDK work inside an auth-state callback.
      if (event !== 'SIGNED_OUT' && event !== 'TOKEN_REFRESHED') return;
      const timer = setTimeout(() => {
        target.events.delete(timer);
        void (async () => {
          if (disposed || target.closed || target !== engine || performing || cleaning) return;
          if (event === 'SIGNED_OUT' && knownUserId) await discard('session');
          else if (event === 'TOKEN_REFRESHED' && knownUserId && foreground) await restore();
        })().catch(() => { /* discard/restore publish sanitized failures. */ });
      }, 0);
      target.events.add(timer);
    });
    target.unsubscribe = () => data.subscription.unsubscribe();
    return target;
  }

  async function discard(error: AuthErrorKind | null): Promise<void> {
    if (cleaning) return cleaning;
    generation++;
    knownUserId = null;
    revalidateOnIdle = false;
    publish({ status: 'checking', user: null, error });
    const target = engine;
    if (!target) { publish({ status: 'signed-out', user: null, error }); return; }
    close(target);
    cleaning = (async () => {
      // Fence all normal work immediately. The retiring SDK gets a narrow,
      // bounded chance to revoke its own verified session; it cannot refresh,
      // write secrets, or read storage belonging to a replacement account.
      target.cleanupAllowed = Boolean(target.verifiedSession);
      try { await bounded(Promise.resolve(target.client.auth.signOut({ scope: 'local' })), timeout); } catch { /* Still remove local credentials. */ }
      finally { target.cleanupAllowed = false; target.verifiedSession = null; }
      try {
        await bounded(target.storage.clear(), timeout);
        if (engine === target) engine = null;
        publish({ status: 'signed-out', user: null, error });
      } catch {
        publish({ status: 'blocked', user: null, error: 'cleanup' });
        throw new AuthError('cleanup');
      }
    })().finally(() => { cleaning = null; revalidateOnIdle = false; });
    return cleaning;
  }

  async function checkSession(target: Engine, session: Session | null, attempt: number) {
    if (!current(target, attempt)) throw new AuthError('session');
    if (!session) {
      if (knownUserId) throw new AuthError('session');
      publish({ status: 'signed-out', user: null, error: null });
      return;
    }
    if (!sessionBelongsToProject(session, config.supabaseUrl)) throw new AuthError('session');
    const result = await bounded(target.client.auth.getUser(session.access_token), timeout);
    if (!current(target, attempt)) throw new AuthError('session');
    if (result.error) throw result.error;
    if (!sessionBelongsToProject(session, config.supabaseUrl)) throw new AuthError('session');
    const user = verifiedUser(result.data.user, session.user.id);
    if (knownUserId && knownUserId !== user.id) throw new AuthError('session');
    knownUserId = user.id;
    target.verifiedSession = session;
    clearTimeout(target.expiry);
    if (foreground && !revalidateOnIdle) {
      target.expiry = setTimeout(() => {
        if (disposed || target.closed || target !== engine || !foreground) return;
        publish({ status: 'checking', user: null, error: null });
        revalidateOnIdle = true;
        drainRevalidation();
      }, Math.max(0, Math.min(2_147_483_647, session.expires_at! * 1000 - Date.now())));
      publish({ status: 'signed-in', user, error: null });
      const started = Promise.resolve(target.client.auth.startAutoRefresh());
      const stopIfAbandoned = () => { if (!current(target, attempt) || !foreground || revalidateOnIdle) stopRefresh(target); };
      // SDK work can settle after a foreground change or our deadline.
      void started.then(stopIfAbandoned, stopIfAbandoned);
      await bounded(started, timeout);
      stopIfAbandoned();
    } else publish({ status: 'checking', user: null, error: null });
  }

  async function restore() {
    if (disposed || !foreground || snapshot.status === 'blocked' || cleaning) return;
    if (restoring) return restoring;
    if (performing) return;
    const attempt = ++generation;
    publish({ status: 'checking', user: null, error: null });
    restoring = (async () => {
      let target: Engine | undefined;
      try {
        target = ensureEngine();
        const result = await bounded(target.client.auth.getSession(), timeout);
        if (!current(target, attempt)) return;
        if (result.error) throw result.error;
        await checkSession(target, result.data.session, attempt);
      } catch (error) {
        if (target && !current(target, attempt)) return;
        await discard(authErrorKind(error)).catch(() => {});
      }
    })().finally(() => { restoring = null; drainRevalidation(); });
    return restoring;
  }

  return {
    getSnapshot: () => snapshot,
    async getAccessToken(expectedUserId) {
      const target = engine;
      const session = target?.verifiedSession;
      // Only expose a session already checked by getUser. This read does not
      // initialize the SDK, refresh tokens, or put credentials in React state.
      if (disposed || !foreground || snapshot.status !== 'signed-in' ||
          snapshot.user?.id !== expectedUserId || knownUserId !== expectedUserId ||
          !target || target.closed || !session || session.user?.id !== expectedUserId ||
          !sessionBelongsToProject(session, config.supabaseUrl)) return null;
      return session.access_token;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore,
    async signIn(email, password) {
      if (disposed || !foreground || performing || restoring || cleaning || snapshot.status !== 'signed-out') throw new AuthError('session');
      performing = true;
      const attempt = ++generation;
      publish({ status: 'busy', user: null, error: null });
      let target: Engine | undefined;
      try {
        target = ensureEngine();
        const result = await bounded(target.client.auth.signInWithPassword({ email: email.trim(), password }), timeout);
        if (!current(target, attempt)) throw new AuthError('session');
        if (result.error) throw result.error;
        if (!result.data.session) throw new AuthError('session');
        await checkSession(target, result.data.session, attempt);
      } catch (error) {
        const kind = authErrorKind(error);
        if (!target || current(target, attempt)) await discard(kind);
        throw new AuthError(kind);
      } finally { performing = false; drainRevalidation(); }
    },
    async signOut() {
      if (disposed) return;
      await discard(null);
    },
    setForeground(active) {
      if (disposed || foreground === active) return;
      foreground = active;
      if (!active) {
        revalidateOnIdle = false;
        if (engine) { clearTimeout(engine.expiry); stopRefresh(engine); }
        if (snapshot.status === 'signed-in') publish({ status: 'checking', user: null, error: null });
      } else if (snapshot.status !== 'blocked' && (knownUserId || snapshot.status === 'checking' || performing || restoring)) {
        publish({ status: 'checking', user: null, error: null });
        revalidateOnIdle = true;
        drainRevalidation();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      revalidateOnIdle = false;
      if (engine) { close(engine); engine.verifiedSession = null; }
      listeners.clear();
    },
  };
}
