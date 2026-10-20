import { createClient, type AuthChangeEvent, type Session, type User } from '@supabase/supabase-js';
import { createMobileAuth } from '../src/auth/client';
import { DEVELOPMENT_SUPABASE_URL } from '../src/auth/config';
import { AuthError, authErrorKind } from '../src/auth/errors';
import { MOBILE_AUTH_STORAGE_KEY } from '../src/auth/secure-storage';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(), processLock: jest.fn() }));
jest.mock('../src/auth/secure-storage', () => ({
  MOBILE_AUTH_STORAGE_KEY: 'memy.auth.edbkuunyeyxnyenmmqud.v1',
  createSecureSessionStorage: jest.fn(),
}));

const config = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: 'sb_publishable_synthetic_development_key_only' };
const password = 'synthetic-password-not-a-real-account';
const email = 'synthetic@example.invalid';
const disposals = new Set<() => void>();

function session(id = 'synthetic-a', overrides: Partial<Session> = {}): Session {
  const claims = { iss: `${DEVELOPMENT_SUPABASE_URL}/auth/v1`, sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  return {
    access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${Buffer.from('synthetic-signature').toString('base64url')}`,
    refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, email, is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' } as User,
    ...overrides,
  };
}

function fixture(initial: Session | null = null, timeoutMs = 50) {
  let callback: ((event: AuthChangeEvent, value: Session | null) => void) | undefined;
  const storage = {
    getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}), close: jest.fn(), clear: jest.fn(async () => {}),
  };
  const sdk = { auth: {
    getSession: jest.fn(async () => ({ data: { session: initial }, error: null as unknown })),
    getUser: jest.fn(async () => ({ data: { user: (initial ?? session()).user }, error: null as unknown })),
    signInWithPassword: jest.fn(async () => ({ data: { session: session() }, error: null as unknown })),
    signOut: jest.fn(async () => ({ error: null })),
    startAutoRefresh: jest.fn(async () => {}), stopAutoRefresh: jest.fn(async () => {}),
    onAuthStateChange: jest.fn((listener: typeof callback) => {
      callback = listener;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
  } };
  const factory = jest.fn(() => sdk);
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const auth = createMobileAuth(config, {
    clientFactory: factory as unknown as typeof createClient,
    storageFactory: () => storage, request, timeoutMs,
  });
  disposals.add(() => auth.dispose());
  const fetchAuth = () => (factory.mock.calls[0] as unknown as [string, string, { global: { fetch: typeof fetch } }])[2].global.fetch;
  return { auth, sdk, storage, factory, request, fetchAuth, emit: (event: AuthChangeEvent, value: Session | null = initial) => callback?.(event, value) };
}

afterEach(() => { disposals.forEach(dispose => dispose()); disposals.clear(); jest.useRealTimers(); });

test('empty secure storage restores signed-out without user verification or network', async () => {
  const f = fixture();
  await f.auth.restore();
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: null });
  expect(f.sdk.auth.getUser).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
  f.auth.dispose();
});

test('background startup does not initialize auth or send password requests', async () => {
  const f = fixture();
  f.auth.setForeground(false);
  await f.auth.restore();
  expect(f.factory).not.toHaveBeenCalled();
  await expect(f.auth.signIn(email, password)).rejects.toMatchObject({ kind: 'session' });
  expect(f.request).not.toHaveBeenCalled();
  f.auth.setForeground(true);
  await f.auth.restore();
  expect(f.auth.getSnapshot().status).toBe('signed-out');
  f.auth.dispose();
});

test('restored session is verified before exposing only id and email', async () => {
  const saved = session();
  const f = fixture(saved);
  await f.auth.restore();
  expect(f.sdk.auth.getUser).toHaveBeenCalledWith(saved.access_token);
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-in', user: { id: saved.user.id, email }, error: null });
  expect(JSON.stringify(f.auth.getSnapshot())).not.toContain(saved.access_token);
  expect(f.sdk.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  f.auth.dispose();
});

test('token access before restoration or while signed out performs no SDK work', async () => {
  const f = fixture();
  await expect(f.auth.getAccessToken('synthetic-a')).resolves.toBeNull();
  expect(f.factory).not.toHaveBeenCalled();
  await f.auth.restore();
  await expect(f.auth.getAccessToken('synthetic-a')).resolves.toBeNull();
  expect(f.sdk.auth.getSession).toHaveBeenCalledTimes(1);
  expect(f.sdk.auth.getUser).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

test.each(['restore', 'sign-in'] as const)('returns only the verified %s token for the expected account without extra SDK operations', async mode => {
  const saved = session();
  const f = fixture(mode === 'restore' ? saved : null);
  await f.auth.restore();
  if (mode === 'sign-in') {
    f.sdk.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: saved }, error: null });
    await f.auth.signIn(email, password);
  }
  const reads = f.sdk.auth.getSession.mock.calls.length;
  const verifications = f.sdk.auth.getUser.mock.calls.length;
  const writes = f.storage.setItem.mock.calls.length;
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBe(saved.access_token);
  await expect(f.auth.getAccessToken('synthetic-b')).resolves.toBeNull();
  await expect(f.auth.getAccessToken('')).resolves.toBeNull();
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBe(saved.access_token);
  expect(f.sdk.auth.getSession).toHaveBeenCalledTimes(reads);
  expect(f.sdk.auth.getUser).toHaveBeenCalledTimes(verifications);
  expect(f.storage.setItem).toHaveBeenCalledTimes(writes);
  expect(f.request).not.toHaveBeenCalled();
  expect(JSON.stringify(f.auth.getSnapshot())).not.toContain(saved.access_token);
});

test('does not expose a restored token until server verification finishes', async () => {
  const saved = session(); const f = fixture(saved);
  let finish!: (value: Awaited<ReturnType<typeof f.sdk.auth.getUser>>) => void;
  f.sdk.auth.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.auth.restore();
  for (let step = 0; step < 12 && !finish; step += 1) await Promise.resolve();
  expect(finish).toBeDefined();
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  finish({ data: { user: saved.user }, error: null }); await pending;
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBe(saved.access_token);
});

test('token access is blocked in background and until foreground revalidation completes', async () => {
  const saved = session(); const f = fixture(saved);
  await f.auth.restore();
  f.auth.setForeground(false);
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  let finish!: (value: Awaited<ReturnType<typeof f.sdk.auth.getUser>>) => void;
  f.sdk.auth.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.auth.setForeground(true);
  const pending = f.auth.restore();
  for (let step = 0; step < 12 && !finish; step += 1) await Promise.resolve();
  expect(finish).toBeDefined();
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  finish({ data: { user: saved.user }, error: null }); await pending;
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBe(saved.access_token);
});

test('checks token expiry on every read even before the expiry timer runs', async () => {
  const saved = session(); const f = fixture(saved);
  await f.auth.restore();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(saved.expires_at! * 1000);
  try { await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull(); }
  finally { clock.mockRestore(); }
});

test.each(['project', 'deadline', 'identity'] as const)('rejects a cached token whose %s no longer matches its verified session', async mismatch => {
  const saved = session(); const f = fixture(saved);
  await f.auth.restore();
  if (mismatch === 'project') saved.access_token = `synthetic.${Buffer.from(JSON.stringify({ iss: 'https://legacy.invalid/auth/v1', sub: saved.user.id, role: 'authenticated', exp: saved.expires_at })).toString('base64url')}.signature`;
  else if (mismatch === 'deadline') saved.expires_at = saved.expires_at! + 60;
  else saved.user = { ...saved.user, id: 'synthetic-b' };
  await expect(f.auth.getAccessToken('synthetic-a')).resolves.toBeNull();
  expect(f.sdk.auth.getUser).toHaveBeenCalledTimes(1);
});

test('sign-out immediately closes token access while cleanup is pending and after completion', async () => {
  const saved = session(); const f = fixture(saved);
  await f.auth.restore();
  let finish!: () => void;
  f.storage.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = f.auth.signOut();
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  for (let step = 0; step < 12 && !finish; step += 1) await Promise.resolve();
  expect(finish).toBeDefined();
  finish(); await pending;
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
});

test('cleanup failure and disposal never expose the cached token', async () => {
  const saved = session(); const f = fixture(saved);
  await f.auth.restore();
  f.storage.clear.mockRejectedValueOnce(new Error('synthetic-cleanup-failure'));
  await expect(f.auth.signOut()).rejects.toMatchObject({ kind: 'cleanup' });
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  const other = fixture(saved); await other.auth.restore(); other.auth.dispose();
  await expect(other.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
});

test('an earlier account cannot acquire a replacement account token', async () => {
  const saved = session(); const next = session('synthetic-b'); const f = fixture(saved);
  await f.auth.restore(); await f.auth.signOut();
  f.sdk.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: next }, error: null });
  f.sdk.auth.getUser.mockResolvedValueOnce({ data: { user: next.user }, error: null });
  await f.auth.signIn(email, password);
  await expect(f.auth.getAccessToken(saved.user.id)).resolves.toBeNull();
  await expect(f.auth.getAccessToken(next.user.id)).resolves.toBe(next.access_token);
});

test('SDK persists exclusively through secure native storage and disables URL auth detection', async () => {
  const f = fixture();
  await f.auth.restore();
  expect(f.factory).toHaveBeenCalledWith(config.supabaseUrl, config.publishableKey, expect.objectContaining({
    auth: expect.objectContaining({ storageKey: MOBILE_AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, debug: false }),
  }));
  f.auth.dispose();
});

test('sign-in trims email, preserves password, and verifies the returned user', async () => {
  const f = fixture();
  await f.auth.restore();
  await f.auth.signIn(` ${email} `, password);
  expect(f.sdk.auth.signInWithPassword).toHaveBeenCalledWith({ email, password });
  expect(f.sdk.auth.getUser).toHaveBeenCalledTimes(1);
  expect(f.auth.getSnapshot().status).toBe('signed-in');
  f.auth.dispose();
});

test.each([
  [{ code: 'invalid_credentials', status: 400, message: password }, 'credentials'],
  [{ code: 'email_not_confirmed', status: 400 }, 'confirmation'],
  [{ status: 429, message: password }, 'rate-limit'],
  [{ name: 'AuthRetryableFetchError', message: password }, 'network'],
  [{ status: 401 }, 'session'],
  [new Error(password), 'unknown'],
] as const)('sign-in failure is sanitized and clears local credentials (%#)', async (error, expected) => {
  const f = fixture();
  await f.auth.restore();
  f.sdk.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: session() }, error });
  await expect(f.auth.signIn(email, password)).rejects.toMatchObject({ kind: expected });
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: expected });
  expect(f.storage.close).toHaveBeenCalled();
  expect(f.storage.clear).toHaveBeenCalled();
  expect(JSON.stringify(f.auth.getSnapshot())).not.toContain(password);
  f.auth.dispose();
});

test.each([
  ['anonymous user', { ...session().user, is_anonymous: true }],
  ['unconfirmed email', { ...session().user, email_confirmed_at: undefined }],
  ['different user', { ...session().user, id: 'synthetic-b' }],
] as const)('rejects %s after server user verification', async (_label, user) => {
  const f = fixture(session());
  f.sdk.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
  await f.auth.restore();
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: 'session' });
  await expect(f.auth.getAccessToken('synthetic-a')).resolves.toBeNull();
  expect(f.storage.clear).toHaveBeenCalled();
  f.auth.dispose();
});

test.each([
  ['wrong project', { access_token: `synthetic.${Buffer.from(JSON.stringify({ iss: 'https://legacy.invalid/auth/v1', sub: 'synthetic-a', role: 'authenticated' })).toString('base64url')}.signature` }],
  ['expired token', { expires_at: 1 }],
  ['nonfinite deadline', { expires_at: Infinity }],
  ['deadline different from signed claim', { expires_at: Math.floor(Date.now() / 1000) + 7200 }],
  ['malformed token', { access_token: 'not-a-jwt' }],
  ['missing refresh token', { refresh_token: '' }],
] as const)('rejects %s before sending it to user validation', async (_label, overrides) => {
  const f = fixture(session('synthetic-a', overrides));
  await f.auth.restore();
  expect(f.auth.getSnapshot().status).toBe('signed-out');
  expect(f.sdk.auth.getUser).not.toHaveBeenCalled();
  f.auth.dispose();
});

test('failed remote user verification cannot expose a cached user', async () => {
  const f = fixture(session());
  f.sdk.auth.getUser.mockResolvedValueOnce({ data: { user: session().user }, error: { status: 401 } });
  await f.auth.restore();
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.storage.clear).toHaveBeenCalled();
  f.auth.dispose();
});

test('expiry hides and clears the account even when SDK emits no refresh or sign-out event', async () => {
  jest.useFakeTimers();
  const f = fixture(session());
  await f.auth.restore();
  expect(f.auth.getSnapshot().status).toBe('signed-in');
  await jest.advanceTimersByTimeAsync(3_600_000);
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.auth.getSnapshot().status).toBe('signed-out');
  expect(f.storage.clear).toHaveBeenCalled();
  f.auth.dispose();
});

test('a token that expires while getUser is pending is never displayed as authenticated', async () => {
  jest.useFakeTimers();
  const f = fixture(session(), 4_000_000);
  let finish!: (value: Awaited<ReturnType<typeof f.sdk.auth.getUser>>) => void;
  f.sdk.auth.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.auth.restore();
  for (let step = 0; step < 12 && !finish; step += 1) await Promise.resolve();
  await jest.advanceTimersByTimeAsync(3_601_000);
  finish({ data: { user: session().user }, error: null });
  await pending;
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.auth.getSnapshot().status).toBe('signed-out');
  f.auth.dispose();
});

test('background stops refresh and hides the account; foreground verifies before showing it', async () => {
  const f = fixture(session());
  await f.auth.restore();
  f.auth.setForeground(false);
  expect(f.auth.getSnapshot()).toEqual({ status: 'checking', user: null, error: null });
  expect(f.sdk.auth.stopAutoRefresh).toHaveBeenCalled();
  f.auth.setForeground(true);
  expect(f.auth.getSnapshot().user).toBeNull();
  await f.auth.restore();
  expect(f.sdk.auth.getUser).toHaveBeenCalledTimes(2);
  expect(f.auth.getSnapshot().status).toBe('signed-in');
  f.auth.dispose();
});

test('foreground rejects a changed account instead of showing another cached identity', async () => {
  const f = fixture(session());
  await f.auth.restore();
  f.auth.setForeground(false);
  f.sdk.auth.getSession.mockResolvedValueOnce({ data: { session: session('synthetic-b') }, error: null });
  f.sdk.auth.getUser.mockResolvedValueOnce({ data: { user: session('synthetic-b').user }, error: null });
  f.auth.setForeground(true);
  await f.auth.restore();
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: 'session' });
  f.auth.dispose();
});

test('a delayed refresh start is stopped if the app backgrounds before it settles', async () => {
  const f = fixture(session());
  let finish!: () => void;
  f.sdk.auth.startAutoRefresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = f.auth.restore();
  for (let step = 0; step < 12 && !finish; step += 1) await Promise.resolve();
  expect(f.sdk.auth.startAutoRefresh).toHaveBeenCalled();
  f.auth.setForeground(false);
  finish();
  await pending;
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.sdk.auth.stopAutoRefresh.mock.calls.length).toBeGreaterThanOrEqual(2);
  f.auth.dispose();
});

test.each(['restore', 'sign-in'] as const)('foreground bounce during %s refresh startup queues fresh verification instead of remaining stuck', async mode => {
  const saved = session();
  const f = fixture(mode === 'restore' ? saved : null);
  if (mode === 'sign-in') {
    await f.auth.restore();
    f.sdk.auth.getSession.mockResolvedValue({ data: { session: saved }, error: null });
  }
  let finishStart!: () => void;
  let finishVerification!: (value: Awaited<ReturnType<typeof f.sdk.auth.getUser>>) => void;
  f.sdk.auth.startAutoRefresh.mockImplementationOnce(() => new Promise<void>(resolve => { finishStart = resolve; }));
  f.sdk.auth.getUser.mockResolvedValueOnce({ data: { user: saved.user }, error: null });
  f.sdk.auth.getUser.mockImplementationOnce(() => new Promise(resolve => { finishVerification = resolve; }));
  const pending = mode === 'restore' ? f.auth.restore() : f.auth.signIn(email, password);
  for (let step = 0; step < 16 && !finishStart; step += 1) await Promise.resolve();
  expect(f.sdk.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  f.auth.setForeground(false);
  f.auth.setForeground(true);
  expect(f.auth.getSnapshot()).toEqual({ status: 'checking', user: null, error: null });
  finishStart();
  await pending;
  for (let step = 0; step < 16 && !finishVerification; step += 1) await Promise.resolve();
  expect(f.sdk.auth.getUser).toHaveBeenCalledTimes(2);
  expect(f.auth.getSnapshot().user).toBeNull();
  finishVerification({ data: { user: saved.user }, error: null });
  await f.auth.restore();
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-in', user: { id: saved.user.id, email }, error: null });
  expect(f.sdk.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  f.auth.dispose();
});

test('sign-out immediately hides identity, fences late writes, and clears even when SDK logout fails', async () => {
  const f = fixture(session());
  await f.auth.restore();
  f.sdk.auth.signOut.mockRejectedValueOnce(new Error(password));
  const result = f.auth.signOut();
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.storage.close).toHaveBeenCalledTimes(1);
  await result;
  expect(f.sdk.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: null });
  expect(f.storage.clear).toHaveBeenCalledTimes(1);
  f.auth.dispose();
});

test('cleanup failure blocks account reuse and can be retried safely', async () => {
  const f = fixture(session());
  await f.auth.restore();
  f.storage.clear.mockRejectedValueOnce(new Error(password));
  await expect(f.auth.signOut()).rejects.toMatchObject({ kind: 'cleanup' });
  expect(f.auth.getSnapshot()).toEqual({ status: 'blocked', user: null, error: 'cleanup' });
  await expect(f.auth.signIn(email, password)).rejects.toMatchObject({ kind: 'session' });
  await f.auth.signOut();
  expect(f.auth.getSnapshot().status).toBe('signed-out');
  f.auth.dispose();
});

test('timed-out sign-in closes storage and a late result never authenticates', async () => {
  jest.useFakeTimers();
  const f = fixture(null, 10);
  await f.auth.restore();
  let resolve!: (value: Awaited<ReturnType<typeof f.sdk.auth.signInWithPassword>>) => void;
  f.sdk.auth.signInWithPassword.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const result = f.auth.signIn(email, password).catch(error => error);
  await jest.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ kind: 'timeout' });
  expect(f.storage.close).toHaveBeenCalled();
  resolve({ data: { session: session() }, error: null });
  await Promise.resolve();
  expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: 'timeout' });
  f.auth.dispose();
});

test('sign-out while sign-in is pending prevents late account resurrection', async () => {
  const f = fixture();
  await f.auth.restore();
  let resolve!: (value: Awaited<ReturnType<typeof f.sdk.auth.signInWithPassword>>) => void;
  f.sdk.auth.signInWithPassword.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = f.auth.signIn(email, password).catch(error => error);
  await f.auth.signOut();
  resolve({ data: { session: session() }, error: null });
  expect(await pending).toBeInstanceOf(AuthError);
  expect(f.auth.getSnapshot().user).toBeNull();
  expect(f.sdk.auth.getUser).not.toHaveBeenCalled();
  f.auth.dispose();
});

test('auth events schedule validation outside the synchronous SDK callback', async () => {
  const f = fixture(session());
  await f.auth.restore();
  f.emit('TOKEN_REFRESHED');
  expect(f.sdk.auth.getSession).toHaveBeenCalledTimes(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.sdk.auth.getSession).toHaveBeenCalledTimes(2);
  f.emit('SIGNED_OUT');
  await new Promise(resolve => setTimeout(resolve, 0));
  await f.auth.signOut();
  expect(f.auth.getSnapshot().user).toBeNull();
  f.auth.dispose();
});

test('dispose stops refresh, unsubscribes, fences storage, and ignores late events', async () => {
  const f = fixture(session());
  await f.auth.restore();
  const listener = jest.fn();
  f.auth.subscribe(listener);
  f.auth.dispose();
  f.emit('SIGNED_OUT');
  await Promise.resolve();
  expect(f.storage.close).toHaveBeenCalled();
  expect(f.sdk.auth.stopAutoRefresh).toHaveBeenCalled();
  expect(f.storage.clear).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

test.each([
  ['https://legacy.invalid/auth/v1/token?grant_type=password', 'POST'],
  [`${DEVELOPMENT_SUPABASE_URL}/rest/v1/profiles`, 'GET'],
  [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/signup`, 'POST'],
  [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/recover`, 'POST'],
  [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`, 'PUT'],
  [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/logout?scope=global`, 'POST'],
  [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/token?grant_type=password&redirect_to=https://evil.invalid`, 'POST'],
])('transport blocks unapproved endpoint/method %s %s', async (url, method) => {
  const f = fixture();
  await f.auth.restore();
  await expect(f.fetchAuth()(url, { method })).rejects.toMatchObject({ kind: 'configuration' });
  expect(f.request).not.toHaveBeenCalled();
  f.auth.dispose();
});

test.each([
  ['/auth/v1/token?grant_type=password', 'POST'],
  ['/auth/v1/token?grant_type=refresh_token', 'POST'],
  ['/auth/v1/user', 'GET'],
  ['/auth/v1/logout?scope=local', 'POST'],
])('transport allows only approved dev auth operation %s', async (path, method) => {
  const f = fixture();
  await f.auth.restore();
  f.request.mockResolvedValueOnce(new Response('{}', { status: 200 }));
  await f.fetchAuth()(`${DEVELOPMENT_SUPABASE_URL}${path}`, { method });
  expect(f.request).toHaveBeenCalledWith(`${DEVELOPMENT_SUPABASE_URL}${path}`, expect.objectContaining({ method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal) }));
  f.auth.dispose();
});

test('transport strips arbitrary error detail before SDK receives it', async () => {
  const f = fixture();
  await f.auth.restore();
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid_credentials', message: `${password} synthetic-refresh-token ${email}` }), { status: 400 }));
  const response = await f.fetchAuth()(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST' });
  expect(await response.json()).toEqual({ code: 'invalid_credentials', error_code: 'invalid_credentials', message: 'Authentication request failed.' });
  f.auth.dispose();
});

test('transport body read is bounded and aborted on timeout', async () => {
  jest.useFakeTimers();
  const f = fixture(null, 10);
  await f.auth.restore();
  f.request.mockResolvedValueOnce({ text: () => new Promise(() => {}) } as unknown as Response);
  const result = f.fetchAuth()(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`).catch(error => error);
  await jest.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ kind: 'timeout' });
  expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  f.auth.dispose();
});

test('transport discards responses arriving after sign-out', async () => {
  const f = fixture();
  await f.auth.restore();
  let resolve!: (value: Response) => void;
  f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const result = f.fetchAuth()(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`).catch(error => error);
  await f.auth.signOut();
  resolve(new Response('{}'));
  expect(await result).toMatchObject({ kind: 'session' });
  f.auth.dispose();
});

test('error classification does not reproduce raw credential text', () => {
  expect(authErrorKind({ message: password })).toBe('unknown');
  expect(authErrorKind({ originalError: new AuthError('storage') })).toBe('storage');
  expect(String(new AuthError('credentials'))).not.toContain(password);
});

test('concurrent sign-in is rejected without creating another password request', async () => {
  const f = fixture();
  await f.auth.restore();
  let resolve!: (value: Awaited<ReturnType<typeof f.sdk.auth.signInWithPassword>>) => void;
  f.sdk.auth.signInWithPassword.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = f.auth.signIn(email, password);
  await expect(f.auth.signIn('other@example.invalid', 'different-synthetic-password')).rejects.toMatchObject({ kind: 'session' });
  resolve({ data: { session: session() }, error: null });
  await first;
  expect(f.sdk.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  f.auth.dispose();
});

test('failed refresh validation clears identity and never logs credentials or SDK error detail', async () => {
  const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  spies.forEach(spy => spy.mockImplementation(() => {}));
  const f = fixture(session());
  try {
    await f.auth.restore();
    f.sdk.auth.getSession.mockResolvedValueOnce({ data: { session: session() }, error: { status: 401, message: `${password} synthetic-refresh-token` } });
    f.emit('TOKEN_REFRESHED');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: 'session' });
    expect(f.storage.clear).toHaveBeenCalled();
    const output = JSON.stringify(spies.flatMap(spy => spy.mock.calls));
    expect(output).not.toContain(password);
    expect(output).not.toContain('synthetic-refresh-token');
    expect(output).not.toContain(session().access_token);
  } finally { f.auth.dispose(); spies.forEach(spy => spy.mockRestore()); }
});

test('configuration rejects legacy URLs and privileged keys before constructing SDK', () => {
  const factory = jest.fn();
  expect(() => createMobileAuth({ ...config, supabaseUrl: 'https://legacy.invalid' }, { clientFactory: factory })).toThrow(AuthError);
  expect(() => createMobileAuth({ ...config, publishableKey: 'service-role-secret' }, { clientFactory: factory })).toThrow(AuthError);
  expect(factory).not.toHaveBeenCalled();
});

test('actual pinned SDK signs in, rotates refresh tokens, verifies users, and logs out using mocked transport and the fixed storage key', async () => {
  const actual = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const saved = session();
  const refreshed = session('synthetic-a', { refresh_token: 'synthetic-rotated-refresh-token' });
  let value: string | null = null;
  let closed = false;
  const keys: string[] = [];
  const storage = {
    async getItem(key: string) {
      keys.push(key);
      if (key !== MOBILE_AUTH_STORAGE_KEY || closed) throw new AuthError('storage');
      return value;
    },
    async setItem(key: string, next: string) {
      keys.push(key);
      if (key !== MOBILE_AUTH_STORAGE_KEY || closed) throw new AuthError('storage');
      value = next;
    },
    async removeItem(key: string) {
      keys.push(key);
      if (key !== MOBILE_AUTH_STORAGE_KEY || closed) throw new AuthError('storage');
      value = null;
    },
    close() { closed = true; },
    async clear() { value = null; },
  };
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/token') return new Response(JSON.stringify(url.searchParams.get('grant_type') === 'refresh_token' ? refreshed : saved), { status: 200 });
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(saved.user), { status: 200 });
    if (url.pathname === '/auth/v1/logout' && init?.method === 'POST') return new Response(null, { status: 204 });
    throw new Error('Unexpected mocked SDK request.');
  });
  const auth = createMobileAuth(config, { clientFactory: actual.createClient, storageFactory: () => storage, request, timeoutMs: 1000 });
  try {
    await auth.restore();
    expect(auth.getSnapshot().status).toBe('signed-out');
    await auth.signIn(email, password);
    expect(auth.getSnapshot().status).toBe('signed-in');
    expect(value).not.toBeNull();
    auth.setForeground(false);
    // Only the synthetic in-memory fixture is changed, never native data.
    value = JSON.stringify({ ...saved, expires_at: Math.floor(Date.now() / 1000) - 1 });
    auth.setForeground(true);
    await auth.restore();
    expect(auth.getSnapshot().status).toBe('signed-in');
    expect(JSON.parse(value!).refresh_token).toBe(refreshed.refresh_token);
    expect(request).toHaveBeenCalledWith(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, expect.objectContaining({ method: 'POST' }));
    await auth.signOut();
    expect(auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: null });
    expect(value).toBeNull();
    expect(keys.every(key => key === MOBILE_AUTH_STORAGE_KEY)).toBe(true);
    expect(request).toHaveBeenCalledWith(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/logout?scope=local`, expect.objectContaining({ method: 'POST' }));
  } finally { auth.dispose(); }
});

test.each([
  ['code', 'invalid_credentials', 400, 'credentials'],
  ['error_code', 'invalid_credentials', 400, 'credentials'],
  ['code', 'email_not_confirmed', 400, 'confirmation'],
  ['error_code', 'email_not_confirmed', 400, 'confirmation'],
  ['code', 'over_request_rate_limit', 429, 'rate-limit'],
] as const)('actual SDK classifies sanitized %s=%s without leaking server error detail', async (field, code, status, expected) => {
  const actual = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const storage = {
    getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}), close: jest.fn(), clear: jest.fn(async () => {}),
  };
  const sensitive = `${password} synthetic-refresh-token ${email}`;
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => new Response(
    JSON.stringify({ [field]: code, message: sensitive, error_description: sensitive }),
    // No API-version header, matching the transport's intentional normalization.
    { status },
  ));
  const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  spies.forEach(spy => spy.mockImplementation(() => {}));
  let auth: ReturnType<typeof createMobileAuth> | undefined;
  try {
    auth = createMobileAuth(config, { clientFactory: actual.createClient, storageFactory: () => storage, request, timeoutMs: 1000 });
    await auth.restore();
    const failure: unknown = await auth.signIn(email, password).catch(error => error);
    expect(failure).toMatchObject({ kind: expected });
    expect(String(failure)).not.toContain(password);
    expect(String(failure)).not.toContain('synthetic-refresh-token');
    expect(auth.getSnapshot()).toEqual({ status: 'signed-out', user: null, error: expected });
    expect(storage.clear).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(spies.flatMap(spy => spy.mock.calls));
    expect(output).not.toContain(password);
    expect(output).not.toContain('synthetic-refresh-token');
    expect(output).not.toContain(email);
  } finally { auth?.dispose(); spies.forEach(spy => spy.mockRestore()); }
});
