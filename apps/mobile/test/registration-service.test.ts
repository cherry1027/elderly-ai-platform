import { webcrypto } from 'node:crypto';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { CONFIRMATION_RECORD_KEY, createConfirmationStorage, REGISTRATION_STORAGE_KEY } from '../src/auth/confirmation-storage';
import { DEVELOPMENT_SUPABASE_URL } from '../src/auth/config';
import { createRegistration, REGISTRATION_REDIRECT_URL } from '../src/auth/registration';
import type { RegistrationCrypto } from '../src/auth/registration-crypto';

jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const values = new Map<string, string>();
const settings = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: 'sb_publishable_synthetic_registration_test_key' };
const email = 'synthetic@example.invalid';
const password = 'synthetic-password';
const pendingState = () => values.has(CONFIRMATION_RECORD_KEY)
  ? String(JSON.parse(values.get(CONFIRMATION_RECORD_KEY)!).state) : 'a'.repeat(64);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const disposals: (() => void)[] = [];
let warnings: jest.SpyInstance;
const cryptoProvider = webcrypto as unknown as RegistrationCrypto;
function setCrypto(value: unknown) { Object.defineProperty(globalThis, 'crypto', { configurable: true, value }); }
function session(overrides: Partial<Session> = {}): Session {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: 'synthetic-user', email, is_anonymous: false, email_confirmed_at: '2026-01-01' } as User;
  const claims = { iss: `${DEVELOPMENT_SUPABASE_URL}/auth/v1`, sub: user.id, role: 'authenticated', exp };
  return { access_token: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`,
    refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user, ...overrides };
}
function fixture(timeoutMs = 1000, provider = cryptoProvider) {
  let signupSession = false;
  let user = session().user;
  let exchangeError: { code: string; status: number } | null = null;
  let signupError: { code: string; status: number } | null = null;
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/signup') {
      if (signupError) return new Response(JSON.stringify({ code: signupError.code, message: password }), { status: signupError.status });
      return new Response(JSON.stringify(signupSession ? session() : { user: session().user }), { status: 200 });
    }
    if (url.pathname === '/auth/v1/token') {
      if (exchangeError) return new Response(JSON.stringify({ error_code: exchangeError.code, message: password }), { status: exchangeError.status });
      return new Response(JSON.stringify(session()), { status: 200 });
    }
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(user), { status: 200 });
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error('Unexpected test request.');
  });
  const factory = jest.fn(createClient);
  const registration = createRegistration(settings, { testHarness: { request, crypto: provider, clientFactory: factory as unknown as typeof createClient, timeoutMs } });
  disposals.push(() => registration.dispose());
  return { registration, request, factory,
    signupSession: () => { signupSession = true; },
    setUser: (next: User) => { user = next; },
    signupError: (code: string, status = 400) => { signupError = { code, status }; },
    exchangeError: (code: string, status = 400) => { exchangeError = { code, status }; },
  };
}
beforeEach(() => {
  values.clear(); setCrypto(webcrypto);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { values.delete(key); });
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  disposals.splice(0).forEach(dispose => dispose()); warnings.mockRestore();
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); else Reflect.deleteProperty(globalThis, 'crypto');
});

test('default service remains unavailable without creating SDK, reading configuration or touching native storage', async () => {
  const service = createRegistration();
  await expect(service.signUp(email, password)).rejects.toMatchObject({ kind: 'unavailable' });
  await expect(service.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'unavailable' });
  await service.cancel(); service.dispose();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('a supplied harness cannot enable registration outside the test runtime', async () => {
  const environment = jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development' });
  try {
    const f = fixture();
    await expect(f.registration.signUp(email, password)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(f.factory).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  } finally { environment.restore(); }
});

test.each([['bad-email', '123456'], [email, '12345']])('validates inputs locally without opening a client', async (address, secret) => {
  const f = fixture(); await expect(f.registration.signUp(address, secret)).rejects.toMatchObject({ kind: 'validation' });
  expect(f.factory).not.toHaveBeenCalled();
});

test('actual SDK creates only an S256 signup and a separate secure pending record, never a normal auth session', async () => {
  const f = fixture(); values.set('memy.auth.edbkuunyeyxnyenmmqud.v1.pointer', 'synthetic-main-account');
  await f.registration.signUp(` ${email.toUpperCase()} `, password);
  expect(f.registration.getSnapshot()).toEqual({ status: 'check-email', error: null });
  const call = f.request.mock.calls[0]; const url = new URL(String(call[0]));
  expect(url.pathname).toBe('/auth/v1/signup');
  expect(url.searchParams.get('redirect_to')).toBe(`${REGISTRATION_REDIRECT_URL}?state=${pendingState()}`);
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ email, password, code_challenge_method: 's256' });
  expect(String(call[1]?.body)).not.toContain('synthetic-main-account');
  const record = values.get(CONFIRMATION_RECORD_KEY)!;
  expect(record).not.toContain(password); expect(record).not.toContain('access_token');
  expect(values.get('memy.auth.edbkuunyeyxnyenmmqud.v1.pointer')).toBe('synthetic-main-account');
  expect(f.factory).toHaveBeenCalledWith(settings.supabaseUrl, settings.publishableKey, expect.objectContaining({ auth: expect.objectContaining({
    storageKey: REGISTRATION_STORAGE_KEY, flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  }) }));
});

test('blocks a second pending signup without replacing the first verifier or sending another email', async () => {
  const f = fixture(); await f.registration.signUp(email, password);
  const record = values.get(CONFIRMATION_RECORD_KEY);
  await expect(f.registration.signUp('other@example.invalid', password)).rejects.toMatchObject({ kind: 'pending' });
  expect(f.request).toHaveBeenCalledTimes(1); expect(values.get(CONFIRMATION_RECORD_KEY)).toBe(record);
});

test('an old flow A link cannot consume a newer flow B verifier, and flow B still confirms successfully', async () => {
  const f = fixture(); await f.registration.signUp(email, password);
  const oldState = pendingState();
  await f.registration.cancel();
  await f.registration.signUp(email, password);
  const currentState = pendingState();
  const record = values.get(CONFIRMATION_RECORD_KEY);
  expect(currentState).not.toBe(oldState);
  await expect(f.registration.confirm({ code: 'old-flow-A-code', state: oldState })).rejects.toMatchObject({ kind: 'link' });
  expect(values.get(CONFIRMATION_RECORD_KEY)).toBe(record);
  expect(f.request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/auth/v1/token')).toHaveLength(0);
  expect(f.registration.getSnapshot()).toEqual({ status: 'check-email', error: 'link' });
  await f.registration.confirm({ code: 'current-flow-B-code', state: currentState });
  expect(f.registration.getSnapshot()).toEqual({ status: 'confirmed', error: null });
  expect(f.request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/auth/v1/token')).toHaveLength(1);
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test.each([undefined, '', 'not-a-valid-state', 'a'.repeat(63), 'A'.repeat(64)])('missing or malformed correlation state never clears the active pending flow (%#)', async state => {
  const f = fixture(); await f.registration.signUp(email, password);
  const record = values.get(CONFIRMATION_RECORD_KEY);
  await expect(f.registration.confirm({ code: 'synthetic-code', state: state as unknown as string })).rejects.toMatchObject({ kind: 'link' });
  expect(values.get(CONFIRMATION_RECORD_KEY)).toBe(record); expect(f.request).toHaveBeenCalledTimes(1);
});

test('confirmation survives a new service, verifies the expected user and cleans its temporary session before success', async () => {
  const first = fixture(); await first.registration.signUp(email, password); first.registration.dispose();
  values.set('unrelated-account', 'untouched');
  const next = fixture(); await next.registration.confirm({ code: 'synthetic-code', state: pendingState() });
  expect(next.registration.getSnapshot()).toEqual({ status: 'confirmed', error: null });
  expect(next.request.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/auth/v1/token', '/auth/v1/user', '/auth/v1/logout']);
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false); expect(values.get('unrelated-account')).toBe('untouched');
  await expect(next.registration.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'link' });
  expect(next.request).toHaveBeenCalledTimes(3);
});

test.each([
  ['wrong email', { ...session().user, email: 'other@example.invalid' }],
  ['anonymous user', { ...session().user, is_anonymous: true }],
  ['unconfirmed email', { ...session().user, email_confirmed_at: undefined }],
])('does not accept confirmation for %s', async (_label, user) => {
  const f = fixture(); await f.registration.signUp(email, password); f.setUser(user);
  await expect(f.registration.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'link' });
  expect(f.registration.getSnapshot().status).not.toBe('confirmed'); expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('immediate signup session is a configuration failure and is never accepted as login', async () => {
  const f = fixture(); f.signupSession();
  await expect(f.registration.signUp(email, password)).rejects.toMatchObject({ kind: 'configuration' });
  expect(f.registration.getSnapshot()).toEqual({ status: 'idle', error: 'configuration' });
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
  expect(f.request.mock.calls.some(([input]) => String(input).includes('/logout?scope=local'))).toBe(true);
});

test.each([
  ['weak_password', 400, 'weak-password'], ['email_address_invalid', 400, 'validation'],
  ['over_email_send_rate_limit', 429, 'rate-limit'],
] as const)('actual SDK maps %s into safe errors and performs no automatic email retry', async (code, status, expected) => {
  const f = fixture(); f.signupError(code, status);
  const failure: unknown = await f.registration.signUp(email, password).catch(error => error);
  expect(failure).toMatchObject({ kind: expected }); expect(String(failure)).not.toContain(password);
  expect(f.request).toHaveBeenCalledTimes(1); expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('an existing-account response uses the same check-email state', async () => {
  const f = fixture(); f.signupError('user_already_exists'); await f.registration.signUp(email, password);
  expect(f.registration.getSnapshot()).toEqual({ status: 'check-email', error: null });
});

test('invalid or missing PKCE link does not reach signup or exchange', async () => {
  const f = fixture();
  await expect(f.registration.confirm({ code: 'invalid code', state: pendingState() })).rejects.toMatchObject({ kind: 'link' });
  await expect(f.registration.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'link' });
  expect(f.request).not.toHaveBeenCalled();
});

test('expired or reused server codes are rejected and pending state is cleared', async () => {
  const f = fixture(); await f.registration.signUp(email, password); f.exchangeError('otp_expired');
  await expect(f.registration.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'link' });
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('cleanup failure blocks success and can be explicitly retried', async () => {
  const f = fixture(); await f.registration.signUp(email, password);
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('synthetic-private-native-error'));
  await expect(f.registration.confirm({ code: 'synthetic-code', state: pendingState() })).rejects.toMatchObject({ kind: 'cleanup' });
  expect(f.registration.getSnapshot()).toEqual({ status: 'blocked', error: 'cleanup' });
  await f.registration.cancel(); expect(f.registration.getSnapshot()).toEqual({ status: 'idle', error: null });
});

test.each(['cancel', 'dispose'] as const)('%s during crypto preflight prevents late client creation or signup', async action => {
  let finish!: (value: ArrayBuffer) => void;
  const provider: RegistrationCrypto = {
    getRandomValues: array => cryptoProvider.getRandomValues(array),
    subtle: { digest: () => new Promise(resolve => { finish = resolve; }) },
  };
  setCrypto(provider); const f = fixture(1000, provider);
  const pending = f.registration.signUp(email, password).catch(error => error);
  for (let step = 0; step < 10 && !finish; step++) await Promise.resolve();
  expect(finish).toBeDefined();
  if (action === 'cancel') await f.registration.cancel(); else f.registration.dispose();
  finish(await cryptoProvider.subtle.digest('SHA-256', new Uint8Array([97, 98, 99])));
  expect(await pending).toMatchObject({ kind: 'link' });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});

test('unsupported crypto fails before signup rather than using SDK plain PKCE fallback', async () => {
  setCrypto(undefined); const f = fixture();
  await expect(f.registration.signUp(email, password)).rejects.toMatchObject({ kind: 'configuration' });
  expect(f.request).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled();
});

test('cancel can remove a persisted pending record without creating an SDK client', async () => {
  const storage = createConfirmationStorage(); await storage.begin(email, pendingState()); storage.close();
  const f = fixture(); await f.registration.cancel();
  expect(f.factory).not.toHaveBeenCalled(); expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

async function until(check: () => boolean) {
  for (let count = 0; count < 100 && !check(); count++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

test.each(['request', 'body'] as const)('bounds a stalled %s and aborts without accepting a late signup result', async stage => {
  const f = fixture(300);
  f.request.mockImplementationOnce(() => stage === 'request' ? new Promise<Response>(() => {}) : Promise.resolve({
    ok: true, status: 200, text: () => new Promise<string>(() => {}),
  } as unknown as Response));
  const result = f.registration.signUp(email, password).catch(error => error);
  await until(() => f.request.mock.calls.length === 1);
  expect(await result).toMatchObject({ kind: 'timeout' });
  expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(f.registration.getSnapshot().status).not.toBe('check-email');
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('cancel during an in-flight signup fences the late response and removes only its own pending record', async () => {
  const f = fixture(); let finish!: (value: Response) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const result = f.registration.signUp(email, password).catch(error => error);
  await until(() => Boolean(finish));
  await f.registration.cancel();
  finish(new Response(JSON.stringify({ user: session().user }), { status: 200 }));
  await result;
  expect(f.registration.getSnapshot()).toEqual({ status: 'idle', error: null });
  expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('cancel while the real SDK initializes prevents any signup request after initialization settles', async () => {
  let finish!: (value: string | null) => void;
  const storage = createConfirmationStorage();
  const getItem = jest.fn((key: string) => key === REGISTRATION_STORAGE_KEY ? new Promise<string | null>(resolve => { finish = resolve; }) : storage.getItem(key));
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const registration = createRegistration(settings, { testHarness: {
    request, crypto: cryptoProvider, storageFactory: () => ({ ...storage, getItem }), timeoutMs: 1000,
  } });
  disposals.push(() => registration.dispose());
  const result = registration.signUp(email, password).catch(error => error);
  await until(() => Boolean(finish));
  const cleanup = registration.cancel(); finish(null); await cleanup; await result;
  expect(registration.getSnapshot()).toEqual({ status: 'idle', error: null });
  expect(request).not.toHaveBeenCalled(); expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
});

test('SDK construction failure is sanitized and cleans a partially created registration engine', async () => {
  const f = fixture(); f.factory.mockImplementationOnce(() => { throw new Error(password); });
  const failure: unknown = await f.registration.signUp(email, password).catch(error => error);
  expect(String(failure)).not.toContain(password); expect(failure).toMatchObject({ kind: 'failed' });
  expect(f.registration.getSnapshot().status).toBe('idle'); expect(f.request).not.toHaveBeenCalled();
});

test('actual SDK errors never reproduce passwords, response details or tokens in application logs', async () => {
  const f = fixture(); const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'error')];
  spies.forEach(spy => spy.mockImplementation(() => {}));
  try {
    f.request.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'weak_password', message: `${password} synthetic-access-token` }), { status: 400 }));
    await expect(f.registration.signUp(email, password)).rejects.toMatchObject({ kind: 'weak-password' });
    const logged = JSON.stringify([...warnings.mock.calls, ...spies.flatMap(spy => spy.mock.calls)]);
    expect(logged).not.toContain(password); expect(logged).not.toContain('synthetic-access-token');
    expect(JSON.stringify(f.registration.getSnapshot())).not.toContain(password);
  } finally { spies.forEach(spy => spy.mockRestore()); }
});
