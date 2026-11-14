import { consumeWebRecoveryLink, createWebPasswordSetup } from '../src/auth/web-password-setup';
import { readWebStaging } from '../src/web-staging';
jest.mock('../src/web-staging', () => ({ readWebStaging: jest.fn(() => ({ webOrigin: 'https://memy-web.example.test', apiOrigin: 'https://memy-api.example.test' })) }));
jest.mock('../src/auth/config.web', () => ({ DEVELOPMENT_SUPABASE_URL: 'https://mrfzmlckmvgxweiiugmr.supabase.co',
  readMobileAuthConfig: () => ({ supabaseUrl: 'https://mrfzmlckmvgxweiiugmr.supabase.co', publishableKey: 'sb_publishable_synthetic_value_1234567890' }) }));
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeAll(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: jest.fn(), removeEventListener: jest.fn() } }));
afterAll(() => { if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); });
const subject = '10000000-0000-4000-8000-000000000001', base = 'https://memy-web.example.test/auth/callback';
const supabase = 'https://mrfzmlckmvgxweiiugmr.supabase.co';
const claims = () => ({ sub: subject, iss: `${supabase}/auth/v1`, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
const token = (patch = {}) => `synthetic.${btoa(JSON.stringify({ ...claims(), ...patch })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
function fixture(type = 'recovery') {
  const location = { href: `${base}#access_token=${token()}&refresh_token=synthetic-refresh&token_type=bearer&type=${type}&expires_in=3600` };
  const history = { replaceState: jest.fn() };
  const user = { id: subject, email: 'synthetic@example.test', is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' };
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async (_url, init) =>
    init?.method === 'POST' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(user), { status: 200 }));
  return { location, history, request, user };
}
const services: ReturnType<typeof createWebPasswordSetup>[] = [];
function setup(f = fixture()) { const service = createWebPasswordSetup(f.location, f.history, f.request); services.push(service); return { ...f, service }; }
function previewCodeFixture() {
  const preview = 'https://memy-visual-redesign-preview.onrender.com';
  jest.mocked(readWebStaging).mockReturnValue({ webOrigin: preview, apiOrigin: 'https://memy-api.example.test' });
  const f = fixture();
  f.location.href = preview + '/auth/callback';
  f.request.mockImplementation(async (url, init) => {
    if (url === supabase + '/auth/v1/verify') {
      return new Response(JSON.stringify({ access_token: token(), token_type: 'bearer' }));
    }
    return init?.method === 'POST' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(f.user));
  });
  return f;
}
afterEach(() => { services.splice(0).forEach(service => service.dispose()); jest.useRealTimers(); jest.mocked(readWebStaging).mockReturnValue({ webOrigin: 'https://memy-web.example.test', apiOrigin: 'https://memy-api.example.test' }); });
it.each(['invite', 'recovery'])('scrubs %s credentials before verification and makes no app/AI request', async type => {
  const f = setup(fixture(type)); expect(f.history.replaceState).toHaveBeenCalledWith(null, '', '/auth/callback');
  expect(f.request).not.toHaveBeenCalled(); await f.service.verify(); await f.service.verify(); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenCalledWith(`${supabase}/auth/v1/user`, expect.objectContaining({ method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store' }));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(['?code=pkce', '#error=access_denied&error_description=private-value', '#access_token=bad', '#access_token=x&type=signup',
  '#access_token=x&type=recovery&type=invite'])('scrubs and rejects malformed/incompatible links %s', suffix => {
  const f = fixture(); f.location.href = base + suffix;
  expect(() => consumeWebRecoveryLink(f.location, f.history)).toThrow('Password setup could not be completed.');
  expect(f.history.replaceState).toHaveBeenCalledTimes(1); expect(f.request).not.toHaveBeenCalled();
});
it.each([{ iss: 'https://wrong.supabase.co/auth/v1' }, { iss: 'https://edbkuunyeyxnyenmmqud.supabase.co/auth/v1' },
  { role: 'anon' }, { sub: 'not-a-user' }, { exp: 1 }])('rejects wrong project/role/subject/expiry %#', patch => {
  const f = fixture(); f.location.href = f.location.href.replace(token(), token(patch));
  expect(() => consumeWebRecoveryLink(f.location, f.history)).toThrow();
});
it('rejects a different callback origin/path and a failed URL scrub', () => {
  for (const href of [fixture().location.href.replace('memy-web', 'other'), fixture().location.href.replace('/auth/callback', '/login')]) {
    expect(() => consumeWebRecoveryLink({ href }, { replaceState: jest.fn() })).toThrow();
  }
  expect(() => consumeWebRecoveryLink(fixture().location, { replaceState: () => { throw new Error('synthetic'); } })).toThrow();
});
it('verifies ownership, saves only on explicit action, revokes callback session and prevents reuse', async () => {
  const f = setup(); await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'failed' });
  await f.service.verify(); await f.service.save('Synthetic password 123');
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(f.request.mock.calls.map(call => call[1]?.method)).toEqual(['GET', 'PUT', 'POST']);
  expect(f.request.mock.calls[1][1]?.body).toBe(JSON.stringify({ password: 'Synthetic password 123' }));
  expect(f.request.mock.calls[2][0]).toBe(`${supabase}/auth/v1/logout?scope=local`);
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' });
});
it('verifies a manually entered recovery code before offering a password write on the preview', async () => {
  const f = setup(previewCodeFixture());
  expect(f.request).not.toHaveBeenCalled();
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' });
  await f.service.submitCode?.(' Synthetic@Example.Test ', '01234567');
  expect(f.request.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET']);
  expect(f.request.mock.calls[0][0]).toBe(supabase + '/auth/v1/verify');
  expect(f.request.mock.calls[0][1]?.body).toBe(JSON.stringify({ email: 'synthetic@example.test', token: '01234567', type: 'recovery' }));
  expect(new Headers(f.request.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  expect(new Headers(f.request.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer ' + token());
  await f.service.save('Synthetic password 123');
  expect(f.request.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET', 'PUT', 'POST']);
  expect(f.request.mock.calls[3][0]).toBe(supabase + '/auth/v1/logout?scope=local');
});
it('rejects malformed input and an expired code without retrying or making a password request', async () => {
  const f = setup(previewCodeFixture());
  await expect(f.service.submitCode?.('synthetic@example.test', '12 456')).rejects.toMatchObject({ kind: 'invalid-link' });
  await expect(f.service.submitCode?.('synthetic@example.test', '012345')).rejects.toMatchObject({ kind: 'invalid-link' });
  await expect(f.service.submitCode?.('synthetic@example.test', '0123456')).rejects.toMatchObject({ kind: 'invalid-link' });
  expect(f.request).not.toHaveBeenCalled();
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({ error_code: 'otp_expired' }), { status: 403 }));
  await expect(f.service.submitCode?.('synthetic@example.test', '01234567')).rejects.toMatchObject({ kind: 'invalid-link' });
  expect(f.request).toHaveBeenCalledTimes(1);
});
it('refuses password writes for a code response that belongs to a different account', async () => {
  const f = previewCodeFixture();
  f.user.email = 'other@example.test';
  const s = setup(f);
  await expect(s.service.submitCode?.('synthetic@example.test', '01234567')).rejects.toMatchObject({ kind: 'invalid-link' });
  await expect(s.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' });
  expect(s.request).toHaveBeenCalledTimes(2);
});
it('keeps code entry on the bare, approved preview callback only', () => {
  const normal = fixture();
  expect(setup(normal).service.submitCode).toBeUndefined();
  const preview = previewCodeFixture();
  preview.location.href += '#error=access_denied';
  expect(() => setup(preview)).toThrow();
});
it.each([{ id: '20000000-0000-4000-8000-000000000001' }, { is_anonymous: true }, { email_confirmed_at: null }])('denies unverified/other account %#', patch => {
  const f = fixture(); f.request.mockResolvedValue(new Response(JSON.stringify({ ...f.user, ...patch })));
  const s = setup(f); return expect(s.service.verify()).rejects.toMatchObject({ kind: 'invalid-link' });
});
it('does not retry a rate limited or weak password response and hides server detail', async () => {
  const f = setup(); await f.service.verify();
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'weak_password', message: 'private detail' }), { status: 422 }));
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'weak-password', message: 'Password setup could not be completed.' });
  expect(f.request).toHaveBeenCalledTimes(2);
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'private detail' }), { status: 429 }));
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'rate-limit' }); expect(f.request).toHaveBeenCalledTimes(3);
});
it('bounds never-ending verification and preserves no token after disposal', async () => {
  jest.useFakeTimers(); const f = fixture(); f.request.mockImplementation(() => new Promise(() => {})); const s = setup(f);
  const verification = s.service.verify(); const result = expect(verification).rejects.toMatchObject({ kind: 'network' });
  await jest.advanceTimersByTimeAsync(10_001); await result; expect(f.request).toHaveBeenCalledTimes(1);
  s.service.dispose(); expect(() => s.service.verify()).toThrow(); expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('keeps a proven password save successful when logout fails and blocks another write', async () => {
  const f = setup(); await f.service.verify();
  f.request.mockImplementationOnce(async () => new Response(JSON.stringify(f.user)))
    .mockImplementationOnce(async () => { throw new TypeError('synthetic failure'); });
  await expect(f.service.save('Synthetic password 123')).resolves.toEqual({ cleanup: 'unknown' });
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' });
  expect(f.request.mock.calls.map(call => call[1]?.method)).toEqual(['GET', 'PUT', 'POST']);
});
it('never repeats a password write after a timeout with an unknown outcome', async () => {
  jest.useFakeTimers(); const f = setup(); await f.service.verify();
  f.request.mockImplementationOnce(() => new Promise(() => {}));
  const save = f.service.save('Synthetic password 123'); const result = expect(save).rejects.toMatchObject({ kind: 'check-sign-in' });
  await jest.advanceTimersByTimeAsync(10_001); await result;
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' }); expect(f.request).toHaveBeenCalledTimes(2);
});
it('expires after five minutes and refuses a changed web origin before saving', async () => {
  jest.useFakeTimers(); const f = setup(); await f.service.verify(); await jest.advanceTimersByTimeAsync(300_001);
  await expect(f.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'expired' }); expect(f.request).toHaveBeenCalledTimes(1);
  const other = setup(); await other.service.verify(); jest.mocked(readWebStaging).mockReturnValue(null);
  await expect(other.service.save('Synthetic password 123')).rejects.toMatchObject({ kind: 'invalid-link' }); expect(other.request).toHaveBeenCalledTimes(1);
});
