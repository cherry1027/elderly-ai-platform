import { useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text, Platform } from 'react-native';
import Constants from 'expo-constants';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import { createMobileAuth, type MobileAuth } from '../src/auth/client';
import { DEVELOPMENT_SUPABASE_URL } from '../src/auth/config';
import type { StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';
import { storiesCopy } from '../src/stories-copy';
import { StoryDashboard } from '../src/stories/StoryDashboard';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

// All HTTP below is synthetic: the real SDK uses the injected auth transport,
// and the real projects adapter uses setup.ts's blocked-network Jest function.
const baseUrl = 'http://172.20.10.3:8000';
const key = 'sb_publishable_synthetic_development_key_only';
const password = 'synthetic-password-not-a-real-account';
const fetchMock = jest.mocked(globalThis.fetch);
const disposals: (() => Promise<void>)[] = [];
let restoreConfig: () => void;

function session(id = 'synthetic-a', revision = 'initial'): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const claims = { iss: `${DEVELOPMENT_SUPABASE_URL}/auth/v1`, sub: id,
    role: 'authenticated', exp: expiresAt, revision };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return { access_token: `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${Buffer.from('synthetic-signature').toString('base64url')}`,
    refresh_token: `synthetic-refresh-${id}-${revision}`, expires_in: 3600, expires_at: expiresAt, token_type: 'bearer',
    user: { id, email: `${id}@example.invalid`, is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' } as User };
}

function row(title = 'An English fictional story', language: 'en' | 'sv' = 'en', index = 1): StoryProject {
  return { id: `${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, title,
    description: null, language, status: 'draft', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

function fixture() {
  let current = session();
  let saved: string | null = null;
  const closeClients: (() => Promise<void>)[] = [];
  // The actual secure native adapter is tested separately. This fixture stores
  // synthetic sessions in memory only and gives each retired engine its fence.
  const authRequest = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async input => {
    const url = new URL(String(input));
    if (url.origin !== DEVELOPMENT_SUPABASE_URL) throw new Error('Unexpected synthetic auth origin.');
    if (url.pathname === '/auth/v1/token') return json(current);
    if (url.pathname === '/auth/v1/user') return json(current.user);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error('Unexpected synthetic auth request.');
  });
  const auth = createMobileAuth({ supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: key }, {
    clientFactory: (...args) => {
      const client = createClient(...args);
      closeClients.push(() => client.auth.dispose());
      return client;
    },
    request: authRequest,
    storageFactory: () => {
      let closed = false;
      return { getItem: async () => closed ? null : saved,
        setItem: async (_name, value) => { if (closed) throw new Error('Retired synthetic storage.'); saved = value; },
        removeItem: async () => { if (!closed) saved = null; },
        close: () => { closed = true; }, clear: async () => { saved = null; } };
    },
  });
  disposals.push(async () => {
    auth.dispose();
    // The real SDK owns additional realm-level resources (BroadcastChannel and
    // subscriptions). Await its documented teardown in this Node test realm.
    await Promise.all(closeClients.map(close => close()));
  });
  return { auth, authRequest, get session() { return current; },
    signIn: async () => { await auth.restore(); await auth.signIn(current.user.email!, password); },
    rotate: async (next = session(current.user.id, 'rotated')) => {
      auth.setForeground(false); current = next; saved = JSON.stringify(next);
      auth.setForeground(true); await auth.restore();
    },
    changeAccount: (next: Session) => { current = next; },
  };
}

/** The same verified-state/key boundary as the actual authenticated route. */
function VerifiedDashboard({ auth, language = 'en' }: { auth: MobileAuth; language?: Language }) {
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  if (state.status !== 'signed-in' || !state.user) return <Text>No verified account</Text>;
  return <StoryDashboard key={state.user.id} language={language} user={state.user}
    getAccessToken={auth.getAccessToken} onCreateStory={() => {}}
    onSignOut={() => { void auth.signOut(); }} />;
}

beforeEach(() => {
  const previous = Constants.expoConfig;
  const platform = jest.replaceProperty(Platform, 'OS', 'ios');
  Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: {
    extra: { memyStoryPreviewEnabled: false, memyDevelopmentApi: { enabled: true, baseUrl } },
  } });
  restoreConfig = () => {
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous }); platform.restore();
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => { throw new Error('Unexpected synthetic project request.'); });
});
afterEach(async () => {
  await Promise.all(disposals.splice(0).map(dispose => dispose()));
  restoreConfig(); jest.restoreAllMocks();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => { throw new Error('Network access is blocked in mobile foundation tests.'); });
});

describe('verified native session -> real project-list adapter -> dashboard, mocked HTTP only', () => {
  it.each<Language>(['en', 'sv'])('uses the latest verified user token and displays/refreshes the plain array in %s', async language => {
    const f = fixture(); await f.signIn(); await f.rotate();
    fetchMock.mockResolvedValueOnce(json([row(), row('En svensk påhittad berättelse', 'sv', 2)]));
    await render(<VerifiedDashboard auth={f.auth} language={language} />);
    await screen.findByText('An English fictional story');
    expect(screen.getByText('En svensk påhittad berättelse')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/story-projects?limit=50&offset=0`, expect.objectContaining({
      method: 'GET', headers: { Authorization: `Bearer ${f.session.access_token}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(key);
    fetchMock.mockResolvedValueOnce(json([row('Server refresh result')]));
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].refresh }));
    await screen.findByText('Server refresh result');
    expect(screen.queryByText('An English fictional story')).toBeNull();
    expect(screen.queryByText('En svensk påhittad berättelse')).toBeNull();
    expect(screen.getAllByText('Server refresh result')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });

  it('sends no project request before verified login, then loads after normal sign-in', async () => {
    const f = fixture(); await render(<VerifiedDashboard auth={f.auth} />);
    expect(screen.getByText('No verified account')).toBeOnTheScreen(); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json([]));
    await act(async () => { await f.signIn(); });
    await screen.findByText(storiesCopy.en.empty);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(f.authRequest.mock.calls.some(([input]) => new URL(String(input)).pathname === '/auth/v1/user')).toBe(true);
  });

  it('does not acquire a token or send HTTP without configured backend settings', async () => {
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: {} } });
    const f = fixture(); await f.signIn(); const token = jest.spyOn(f.auth, 'getAccessToken');
    await render(<VerifiedDashboard auth={f.auth} />);
    await screen.findByText(storiesCopy.en.errors.configuration);
    expect(token).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(storiesCopy.en.empty)).toBeNull();
  });

  it('rejects an expired cached token and hides the dashboard during foreground revalidation', async () => {
    const f = fixture(); await f.signIn();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(f.session.expires_at! * 1000);
    let expiredToken: Promise<string | null>;
    // getAccessToken checks synchronously before returning its promise. Restore
    // the real clock before yielding: SDK refresh deadlines must never see an
    // artificial one-hour forward jump followed by a backwards clock change.
    try { expiredToken = f.auth.getAccessToken(f.session.user.id); }
    finally { clock.mockRestore(); }
    await expect(expiredToken).resolves.toBeNull();
    f.auth.setForeground(false);
    await render(<VerifiedDashboard auth={f.auth} />);
    expect(screen.getByText('No verified account')).toBeOnTheScreen();
    // Model rejected session revalidation separately, through real SDK HTTP
    // handling, without changing system time during asynchronous SDK work.
    f.authRequest.mockResolvedValueOnce(json({ code: 'session_not_found', message: 'Synthetic expired session.' }, 401));
    await act(async () => { f.auth.setForeground(true); await f.auth.restore(); });
    await waitFor(() => expect(f.auth.getSnapshot().status).toBe('signed-out'));
    expect(screen.getByText('No verified account')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes old projects after a real adapter 401 and retains a safe sign-out path', async () => {
    const f = fixture(); await f.signIn(); fetchMock.mockResolvedValueOnce(json([row()]));
    await render(<VerifiedDashboard auth={f.auth} />); await screen.findByText('An English fictional story');
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'synthetic-private-detail' } }, 401));
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
    await screen.findByText(storiesCopy.en.errors.authentication);
    expect(screen.queryByText('An English fictional story')).toBeNull();
    expect(screen.queryByText('synthetic-private-detail')).toBeNull();
    expect(screen.getByRole('button', { name: storiesCopy.en.refresh })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
    await screen.findByText('No verified account');
  });

  it.each(['html', 'malformed-json', 'network'] as const)('shows a safe %s failure instead of a fictional success', async kind => {
    const f = fixture(); await f.signIn();
    if (kind === 'network') fetchMock.mockRejectedValueOnce(new Error('synthetic-private-network-detail'));
    else fetchMock.mockResolvedValueOnce(new Response('synthetic-private-response', {
      headers: { 'Content-Type': kind === 'html' ? 'text/html' : 'application/json' },
    }));
    await render(<VerifiedDashboard auth={f.auth} />);
    await screen.findByText(storiesCopy.en.errors[kind === 'network' ? 'network' : 'invalid-response']);
    expect(screen.queryByText(/synthetic-private-/)).toBeNull();
    expect(screen.queryByText(storiesCopy.en.empty)).toBeNull();
  });

  it('aborts a real adapter request on sign-out and ignores its late body', async () => {
    const f = fixture(); await f.signIn(); let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(<VerifiedDashboard auth={f.auth} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
    await screen.findByText('No verified account'); expect(signal.aborted).toBe(true);
    const body = jest.fn(async () => JSON.stringify([row('Late private account A')]));
    await act(async () => { finish({ status: 200, ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), text: body } as unknown as Response); });
    expect(body).not.toHaveBeenCalled(); expect(screen.queryByText('Late private account A')).toBeNull();
  });

  it('cannot publish account A late results or token into a newly verified account B', async () => {
    const f = fixture(); await f.signIn(); let finishA!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    await render(<VerifiedDashboard auth={f.auth} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signalA = fetchMock.mock.calls[0][1]!.signal!;
    await act(async () => { await f.auth.signOut(); });
    f.changeAccount(session('synthetic-b'));
    fetchMock.mockResolvedValueOnce(json([row('Only account B')]));
    await act(async () => { await f.auth.signIn(f.session.user.email!, password); });
    await screen.findByText('Only account B'); expect(signalA.aborted).toBe(true);
    await act(async () => { finishA(json([row('Late private account A')])); });
    expect(screen.queryByText('Late private account A')).toBeNull();
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: `Bearer ${f.session.access_token}`, Accept: 'application/json' });
    await expect(f.auth.getAccessToken('synthetic-a')).resolves.toBeNull();
  });
});
