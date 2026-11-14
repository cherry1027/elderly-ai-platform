import { readMobileAuthConfig, DEVELOPMENT_SUPABASE_URL } from './config.web';
import { readWebStaging } from '../web-staging';

export type PasswordSetupFailure = 'invalid-link' | 'expired' | 'network' | 'rate-limit' | 'weak-password' | 'failed' | 'check-sign-in';
export class PasswordSetupError extends Error {
  constructor(readonly kind: PasswordSetupFailure) { super('Password setup could not be completed.'); this.name = 'PasswordSetupError'; }
}
type Link = { accessToken: string; subject: string; expiresAt: number };
type BrowserLocation = { href: string };
type BrowserHistory = { replaceState(data: unknown, unused: string, url?: string | URL | null): void };
const MAX_LINK_LENGTH = 24_000, TIMEOUT_MS = 10_000, MAX_BODY = 32_000, MAX_AGE_MS = 300_000;
const PREVIEW_ORIGIN = 'https://memy-visual-redesign-preview.onrender.com';
const CALLBACK_PATH = '/auth/callback';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);

function readRecoverySession(accessToken: unknown): Link {
  if (typeof accessToken !== 'string' || accessToken.length > 16_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) throw new Error();
  const part = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
  // These are routing guards only. Supabase GET /user verifies the credential.
  if (claims.iss !== `${DEVELOPMENT_SUPABASE_URL}/auth/v1` || claims.role !== 'authenticated' || !uuid(claims.sub) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error();
  return { accessToken, subject: claims.sub, expiresAt: Math.min(claims.exp * 1000, Date.now() + MAX_AGE_MS) };
}

/** Remove callback credentials from browser history before verification or rendering. */
export function consumeWebRecoveryLink(location: BrowserLocation, history: BrowserHistory): Link {
  let raw = location.href;
  const approved = readWebStaging();
  try { history.replaceState(null, '', CALLBACK_PATH); } catch { raw = ''; }
  try {
    if (!approved || !raw || raw.length > MAX_LINK_LENGTH) throw new Error();
    const url = new URL(raw); raw = '';
    if (url.origin !== approved.webOrigin || url.pathname !== CALLBACK_PATH || url.search || url.username || url.password) throw new Error();
    const parameters = new URLSearchParams(url.hash.slice(1));
    const allowed = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type'];
    if ([...parameters.keys()].some(key => !allowed.includes(key) || parameters.getAll(key).length !== 1) ||
        !['invite', 'recovery'].includes(parameters.get('type') ?? '') || parameters.get('token_type') !== 'bearer') throw new Error();
    const accessToken = parameters.get('access_token'), refreshToken = parameters.get('refresh_token');
    if (!refreshToken || refreshToken.length > 4096 || /[\s\0]/.test(refreshToken)) throw new Error();
    return readRecoverySession(accessToken);
  } catch { throw new PasswordSetupError('invalid-link'); }
}

export interface WebPasswordSetup {
  verify(): Promise<void>;
  submitCode?(email: string, code: string): Promise<void>;
  save(password: string): Promise<{ cleanup: 'complete' | 'unknown' }>;
  dispose(): void;
}
/** One callback owns one RAM-only token. It never creates an app login session. */
export function createWebPasswordSetup(location: BrowserLocation, history: BrowserHistory, request: typeof fetch = fetch): WebPasswordSetup {
  const codeEntry = location.href === `${PREVIEW_ORIGIN}${CALLBACK_PATH}` && readWebStaging()?.webOrigin === PREVIEW_ORIGIN;
  let link: Link | null = codeEntry ? null : consumeWebRecoveryLink(location, history);
  const config = readMobileAuthConfig();
  let disposed = false, verified = false, writing = false, verification: Promise<void> | null = null;
  let submittingCode = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Set<AbortController>();
  const dispose = () => {
    disposed = true; verified = false; link = null;
    controllers.forEach(controller => controller.abort()); controllers.clear(); clearTimeout(expiry);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', dispose);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
  };
  const background = () => { if (document.visibilityState === 'hidden' && (link || submittingCode)) dispose(); };
  function armExpiry(current: Link) {
    expiry = setTimeout(dispose, Math.max(0, current.expiresAt - Date.now()));
  }
  if (link) armExpiry(link);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', dispose);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  function checkOrigin() {
    if (disposed) throw new PasswordSetupError('expired');
    if (!readWebStaging()) { dispose(); throw new PasswordSetupError('invalid-link'); }
  }
  function check() {
    checkOrigin();
    if (!link || link.expiresAt <= Date.now()) throw new PasswordSetupError('expired');
    return link;
  }
  async function call(method: 'GET' | 'PUT' | 'POST', path: string, body?: string): Promise<Record<string, unknown>> {
    const verifyCode = path === '/auth/v1/verify';
    const guard = verifyCode ? checkOrigin : check;
    const accessToken = verifyCode ? undefined : check().accessToken;
    guard();
    const controller = new AbortController();
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const action = (async () => {
        const response = await request(`${config.supabaseUrl}${path}`, { method,
          headers: { apikey: config.publishableKey,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), 'Content-Type': 'application/json' },
          body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        });
        guard();
        if (response.status === 204 && path === '/auth/v1/logout?scope=local') return {};
        const raw = await response.text(); guard();
        if (raw.length > MAX_BODY) throw new PasswordSetupError('failed');
        let value: Record<string, unknown>;
        try { value = JSON.parse(raw); } catch { throw new PasswordSetupError('failed'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PasswordSetupError('failed');
        if (!response.ok) {
          const kind = response.status === 429 ? 'rate-limit'
            : response.status === 401 || response.status === 403 || (verifyCode && value.error_code === 'otp_expired') ? 'invalid-link'
            : value.code === 'weak_password' ? 'weak-password' : 'failed';
          throw new PasswordSetupError(kind);
        }
        return value;
      })();
      return await Promise.race([action, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PasswordSetupError('network')); }, TIMEOUT_MS);
      })]);
    } catch (error) {
      if (error instanceof PasswordSetupError) throw error;
      throw new PasswordSetupError(disposed ? 'expired' : 'network');
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function confirmUser(user: Record<string, unknown>, expectedEmail?: string) {
    const current = check();
    if (user.id !== current.subject || user.is_anonymous !== false || typeof user.email !== 'string' ||
        !user.email || (expectedEmail && user.email.toLowerCase() !== expectedEmail) ||
        typeof user.email_confirmed_at !== 'string' || !user.email_confirmed_at) {
      dispose(); throw new PasswordSetupError('invalid-link');
    }
  }
  return {
    ...(codeEntry ? { async submitCode(email: string, code: string) {
      checkOrigin();
      if (link || submittingCode) throw new PasswordSetupError('failed');
      email = email.trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9]{6}$/.test(code)) {
        throw new PasswordSetupError('invalid-link');
      }
      submittingCode = true;
      try {
        const response = await call('POST', '/auth/v1/verify', JSON.stringify({ email, token: code, type: 'recovery' }));
        if (response.token_type !== 'bearer') throw new PasswordSetupError('invalid-link');
        try { link = readRecoverySession(response.access_token); }
        catch { throw new PasswordSetupError('invalid-link'); }
        armExpiry(link);
        confirmUser(await call('GET', '/auth/v1/user'), email);
        verified = true;
      } catch (error) {
        if (link && !verified) dispose();
        throw error;
      } finally { submittingCode = false; }
    } } : {}),
    verify() {
      check();
      if (verified) return Promise.resolve();
      if (!verification) verification = call('GET', '/auth/v1/user').then(user => { confirmUser(user); verified = true; });
      return verification;
    },
    async save(password) {
      check();
      if (!verified || writing) throw new PasswordSetupError('failed');
      if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\0\r\n]/.test(password)) throw new PasswordSetupError('weak-password');
      writing = true;
      try {
        try {
          const result = await call('PUT', '/auth/v1/user', JSON.stringify({ password }));
          confirmUser(result);
        } catch (error) {
          // Only proven pre-write rejections permit another explicit attempt.
          if (error instanceof PasswordSetupError && ['weak-password', 'rate-limit'].includes(error.kind)) throw error;
          dispose(); throw new PasswordSetupError('check-sign-in');
        }
        let cleanup: 'complete' | 'unknown' = 'complete';
        try { await call('POST', '/auth/v1/logout?scope=local'); } catch { cleanup = 'unknown'; }
        // A confirmed password write remains successful even if revocation fails.
        // Neither outcome can dispatch a second password write in this callback.
        dispose(); return { cleanup };
      } finally { writing = false; password = ''; }
    },
    dispose,
  };
}
