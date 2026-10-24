import { openMyStories, openSettings } from './root-shell-helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AppState, BackHandler, type AppStateStatus } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { AuthError } from '../src/auth/errors';
import { authCopy } from '../src/auth-copy';
import RootLayout from '../src/app/_layout';
import Entry from '../src/app/index';
import Language from '../src/app/language';
import Introduction from '../src/app/introduction';
import Welcome from '../src/app/welcome';
import Login from '../src/app/login';
import Authenticated from '../src/app/authenticated';
import Register from '../src/app/register';
import Confirm from '../src/app/auth/confirm';
import { introCopy } from '../src/intro-copy';
import { copy, type Language as Locale } from '../src/i18n';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';
import { redirectSystemPath } from '../src/app/+native-intent';
import { createStoryCopy } from '../src/create-story-copy';
import { storiesCopy } from '../src/stories-copy';
import { rootNavigationCopy } from '../src/root-navigation-copy';
import { StoriesHome } from '../src/stories/StoriesHome';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm };
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
let auth: MobileAuth;
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach((listener) => listener()); }
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  snapshot = { status: 'signed-out', user: null, error: null }; listeners = new Set();
  auth = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}),
    getAccessToken: jest.fn(async () => null),
    signIn: jest.fn(async (email) => publish({ status: 'signed-in', user: { id: email, email }, error: null })),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(), dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only' });
});
async function openWelcome(language: Locale = 'en') {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const view = renderRouter(routes, { initialUrl: '/' });
  await screen.findByRole('header', { name: copy[language].welcomeTitle });
  return view;
}
async function openLogin(language: Locale = 'en') {
  fireEvent.press(screen.getByRole('button', { name: introCopy[language].login }));
  await screen.findByRole('header', { name: authCopy[language].title });
}
function fill(language: Locale = 'en', email = 'a@example.test') {
  fireEvent.changeText(screen.getByLabelText(authCopy[language].email), email);
  fireEvent.changeText(screen.getByLabelText(authCopy[language].password), 'synthetic-password');
  fireEvent.press(screen.getByRole('button', { name: authCopy[language].signIn }));
}
function appStack(flow: ReturnType<typeof renderRouter>) {
  const root = flow.getRouterState()!;
  // Expo Router's test container wraps the actual application stack in __root.
  return root.routes[0]?.name === '__root' && root.routes[0].state ? root.routes[0].state : root;
}

describe('actual native login routes with mocked auth services', () => {
  it.each<Locale>(['en', 'sv'])('persists Settings language and returns real authenticated Replay to Settings in %s', async language => {
    const flow = await openWelcome(language); await openLogin(language); fill(language);
    await screen.findByRole('header', { name: rootNavigationCopy[language].homeTitle });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    await openSettings(language);
    const next = language === 'en' ? 'sv' : 'en';
    fireEvent.press(screen.getByRole('radio', { name: next === 'sv' ? 'Svenska' : 'English' }));
    await screen.findByRole('header', { name: rootNavigationCopy[next].settingsTitle });
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!))
      .toEqual({ version: 1, language: next, completed: true }));
    fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[next].replay }));
    for (const scene of [0, 1, 2] as const) {
      await screen.findByRole('header', { name: introCopy[next].scenes[scene].title });
      fireEvent.press(screen.getByRole('button', { name: scene === 2 ? introCopy[next].enter : introCopy[next].next }));
    }
    await screen.findByRole('header', { name: rootNavigationCopy[next].settingsTitle });
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByRole('header', { name: copy[next].welcomeTitle })).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language: next, completed: true });
    expect(auth.getAccessToken).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 15_000);
  it('rejects the previous account’s captured Replay callback after account replacement', async () => {
    await openWelcome(); await openLogin(); fill();
    await screen.findByRole('header', { name: rootNavigationCopy.en.homeTitle });
    const previous = screen.UNSAFE_getByType(StoriesHome).props.onReplayIntroduction;
    act(() => publish({ status: 'signed-in', user: { id: 'b@example.test', email: 'b@example.test' }, error: null }));
    await openSettings(); await screen.findByText('b@example.test');
    act(() => { expect(previous()).toBe(false); });
    expect(screen.getByRole('header', { name: rootNavigationCopy.en.settingsTitle })).toBeOnTheScreen();
    expect(screen.queryByText('a@example.test')).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each<Locale>(['en', 'sv'])('logs in and signs out through the existing entrance in %s', async (language) => {
    await openWelcome(language);
    expect(screen.getByRole('button', { name: introCopy[language].register })).toBeEnabled();
    expect(screen.getByRole('button', { name: introCopy[language].guest })).toBeDisabled();
    await openLogin(language); fill(language);
    await openSettings(language); await screen.findByText('a@example.test');
    fireEvent.press(screen.getByRole('button', { name: authCopy[language].signOut }));
    await screen.findByRole('header', { name: copy[language].welcomeTitle });
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language, completed: true });
  });
  it('guards direct authenticated entry when there is no verified user', async () => {
    renderRouter(routes, { initialUrl: '/authenticated' });
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(screen.queryByText(authCopy.en.signedIn)).toBeNull();
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
  });
  it('restores only a verified service account at application entry', async () => {
    snapshot = { status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null };
    renderRouter(routes, { initialUrl: '/' });
    await openSettings(); await screen.findByText('a@example.test');
    expect(screen.getByRole('button', { name: authCopy.en.signOut })).toBeEnabled();
  });
  it('removes account details and offers cleanup retry after failed sign-out', async () => {
    await openWelcome(); await openLogin(); fill(); await openSettings(); await screen.findByText('a@example.test');
    jest.mocked(auth.signOut).mockImplementationOnce(async () => {
      publish({ status: 'blocked', user: null, error: 'cleanup' }); throw new AuthError('cleanup');
    });
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
    await screen.findByText(authCopy.en.errors.cleanup);
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(screen.getByRole('button', { name: introCopy.en.login })).toBeDisabled();
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.retryCleanup }));
    await waitFor(() => expect(screen.getByRole('button', { name: introCopy.en.login })).toBeEnabled());
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
  });
  it('does not retain a previous account after sign-out and another sign-in', async () => {
    await openWelcome(); await openLogin(); fill(); await openSettings(); await screen.findByText('a@example.test');
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    await openLogin();
    expect(screen.getByLabelText(authCopy.en.email).props.value).toBe('');
    expect(screen.getByLabelText(authCopy.en.password).props.value).toBe('');
    fill('en', 'b@example.test'); await openSettings(); await screen.findByText('b@example.test');
    expect(screen.queryByText('a@example.test')).toBeNull();
  });
  it('cancels pending login when Back returns to Welcome', async () => {
    await openWelcome(); await openLogin();
    let finish!: () => void;
    jest.mocked(auth.signIn).mockImplementationOnce(() => {
      publish({ status: 'busy', user: null, error: null });
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    fill(); fireEvent.press(screen.getByRole('button', { name: authCopy.en.back }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(screen.queryByText('a@example.test')).toBeNull();
  });

  it('cancels pending login through Android hardware Back too', async () => {
    const original = BackHandler.addEventListener;
    let hardwareBack: (() => boolean | null | undefined) | undefined;
    BackHandler.addEventListener = jest.fn((event, listener) => {
      if (event === 'hardwareBackPress') hardwareBack = () => listener({ type: 'hardwareBackPress', timeStamp: 0 });
      return original(event, listener);
    });
    try {
      await openWelcome(); await openLogin();
      let finish!: () => void;
      jest.mocked(auth.signIn).mockImplementationOnce(() => {
        publish({ status: 'busy', user: null, error: null });
        return new Promise<void>((resolve) => { finish = resolve; });
      });
      fill();
      act(() => { expect(hardwareBack?.()).toBe(true); });
      await screen.findByRole('header', { name: copy.en.welcomeTitle });
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      await act(async () => { finish(); });
      expect(screen.queryByText('a@example.test')).toBeNull();
    } finally { BackHandler.addEventListener = original; }
  });
});

describe('canonical entrance and in-memory login intent', () => {
  const coldPaths = ['/login', '/authenticated', '/welcome'] as const;

  it.each(coldPaths)('opens first-use language selection from cold %s', async (path) => {
    const flow = renderRouter(routes, { initialUrl: path });
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(flow.getPathname()).toBe('/language');
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each(coldPaths)('opens Welcome for a returning signed-out visitor from cold %s', async (path) => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'sv', completed: true }));
    const flow = renderRouter(routes, { initialUrl: path });
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByRole('header', { name: authCopy.sv.title })).toBeNull();
    expect(screen.getByRole('button', { name: introCopy.sv.replay })).toBeEnabled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each(coldPaths)('opens the authenticated screen for a verified session from cold %s', async (path) => {
    snapshot = { status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null };
    const flow = renderRouter(routes, { initialUrl: path });
    await openSettings(); await screen.findByText('a@example.test');
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('returns to Welcome after sign-out from a verified account with no saved onboarding preferences', async () => {
    snapshot = { status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null };
    const flow = renderRouter(routes, { initialUrl: '/' });
    await openSettings(); await screen.findByText('a@example.test');
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(flow.getPathname()).toBe('/welcome');
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('returns to Welcome after displayed account verification is lost without inventing onboarding completion', async () => {
    snapshot = { status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null };
    const flow = renderRouter(routes, { initialUrl: '/' });
    await openSettings(); await screen.findByText('a@example.test');
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    act(() => publish({ status: 'signed-out', user: null, error: 'session' }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(flow.getPathname()).toBe('/welcome');
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it.each(coldPaths)('waits for delayed restoration at %s without false sign-out or a login flash', async (path) => {
    snapshot = { status: 'checking', user: null, error: null };
    let finish!: () => void;
    jest.mocked(auth.restore).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderRouter(routes, { initialUrl: path });
    await waitFor(() => expect(auth.restore).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    await act(async () => {
      publish({ status: 'signed-in', user: { id: 'restored-a', email: 'restored@example.test' }, error: null });
      finish();
    });
    await openSettings(); await screen.findByText('restored@example.test');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each(['/login?loginRequested=true', '/login?intent=login', '/login?from=welcome'])('never accepts a URL claim as Welcome login intent: %s', async (path) => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    renderRouter(routes, { initialUrl: path });
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('does not persist Welcome login intent or input values across a router remount', async () => {
    const first = await openWelcome(); await openLogin();
    fireEvent.changeText(screen.getByLabelText(authCopy.en.email), 'typed@example.test');
    fireEvent.changeText(screen.getByLabelText(authCopy.en.password), 'synthetic-unsent-password');
    first.unmount();
    const relaunched = renderRouter(routes, { initialUrl: '/login' });
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(relaunched.getPathname()).toBe('/welcome');
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    await openLogin();
    expect(screen.getByLabelText(authCopy.en.email).props.value).toBe('');
    expect(screen.getByLabelText(authCopy.en.password).props.value).toBe('');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('requires another Welcome button press after leaving Login with Back', async () => {
    await openWelcome(); await openLogin();
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.back }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    act(() => router.navigate('/login'));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    await openLogin();
    expect(screen.getByLabelText(authCopy.en.password)).toBeOnTheScreen();
  });

  it('does not expose a stale Login through stack Back after success or sign-out', async () => {
    const flow = await openWelcome(); await openLogin(); fill(); await openSettings(); await screen.findByText('a@example.test');
    await waitFor(() => expect(appStack(flow).routes.map(route => route.name)).toEqual(['authenticated']));
    expect(router.canGoBack()).toBe(false);
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    await waitFor(() => expect(appStack(flow).routes.map(route => route.name)).toEqual(['welcome']));
    expect(router.canGoBack()).toBe(false);
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it.each(['/', ...coldPaths])('keeps cold session-recovery entry %s on Welcome without inventing preferences', async path => {
    snapshot = { status: 'signed-out', user: null, error: 'session' };
    const flow = renderRouter(routes, { initialUrl: path });
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(flow.getPathname()).toBe('/welcome');
    expect(router.canGoBack()).toBe(false);
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled(); expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
  });

  it('offers cleanup retry at cold Welcome even without saved preferences', async () => {
    snapshot = { status: 'blocked', user: null, error: 'cleanup' };
    const flow = renderRouter(routes, { initialUrl: '/' });
    await screen.findByText(authCopy.en.errors.cleanup);
    expect(flow.getPathname()).toBe('/welcome'); expect(router.canGoBack()).toBe(false);
    expect(screen.getByRole('button', { name: introCopy.en.login })).toBeDisabled();
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.retryCleanup }));
    await waitFor(() => expect(screen.getByRole('button', { name: introCopy.en.login })).toBeEnabled());
    expect(flow.getPathname()).toBe('/welcome');
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
  });

  it.each(['checking', 'busy'] as const)('retains history while %s, then resets only the verified focused route without replacing its key', async status => {
    const flow = await openWelcome();
    act(() => { publish({ status, user: null, error: null }); router.push('/authenticated'); });
    await waitFor(() => expect(flow.getPathname()).toBe('/authenticated'));
    const before = appStack(flow);
    const key = before.routes[before.index ?? 0].key;
    expect(before.routes.length).toBeGreaterThan(1);
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    act(() => publish({ status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null }));
    await openSettings(); await screen.findByText('a@example.test');
    await waitFor(() => expect(appStack(flow).routes.map(route => route.name)).toEqual(['authenticated']));
    expect(appStack(flow).routes[0].key).toBe(key);
    expect(auth.signOut).not.toHaveBeenCalled(); expect(auth.signIn).not.toHaveBeenCalled();
  });

  it.each(['checking', 'busy'] as const)('does not clear public history until Welcome is eligible and auth is no longer %s', async status => {
    const flow = await openWelcome();
    act(() => router.push('/language'));
    act(() => { publish({ status, user: null, error: null }); router.push('/welcome'); });
    await waitFor(() => expect(flow.getPathname()).toBe('/welcome'));
    const before = appStack(flow);
    const key = before.routes[before.index ?? 0].key;
    expect(before.routes.length).toBeGreaterThan(1);
    act(() => publish({ status: 'signed-out', user: null, error: null }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    await waitFor(() => expect(appStack(flow).routes.map(route => route.name)).toEqual(['welcome']));
    expect(appStack(flow).routes[0].key).toBe(key);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('defers authenticated history cleanup while backgrounded and preserves the verified route on foreground', async () => {
    const original = AppState.addEventListener;
    const changes = new Set<(state: AppStateStatus) => void>();
    AppState.addEventListener = (event, listener) => {
      const changed = listener as (state: AppStateStatus) => void;
      if (event === 'change') changes.add(changed);
      const subscription = original(event, listener);
      return { remove: () => { changes.delete(changed); subscription.remove(); } };
    };
    let flow: Awaited<ReturnType<typeof openWelcome>> | undefined;
    try {
      flow = await openWelcome();
      act(() => {
        [...changes].forEach(listener => listener('background'));
        publish({ status: 'signed-in', user: { id: 'verified-a', email: 'a@example.test' }, error: null });
        router.push('/authenticated');
      });
      await waitFor(() => expect(flow!.getPathname()).toBe('/authenticated'));
      const before = appStack(flow);
      const key = before.routes[before.index ?? 0].key;
      expect(before.routes.length).toBeGreaterThan(1);
      expect(screen.queryByText('a@example.test')).toBeNull();
      expect(auth.signOut).not.toHaveBeenCalled();
      act(() => [...changes].forEach(listener => listener('active')));
      await openSettings(); await screen.findByText('a@example.test');
      await waitFor(() => expect(appStack(flow!).routes.map(route => route.name)).toEqual(['authenticated']));
      expect(appStack(flow).routes[0].key).toBe(key);
      expect(auth.signOut).not.toHaveBeenCalled(); expect(auth.signIn).not.toHaveBeenCalled();
    } finally { flow?.unmount(); AppState.addEventListener = original; }
  });

  it('removes an in-memory private draft on session expiry and never reveals it to the next account', async () => {
    await openWelcome(); await openLogin(); fill(); await openSettings(); await screen.findByText('a@example.test');
    await openMyStories();
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    await screen.findByLabelText(createStoryCopy.en.titleLabel);
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Private account A draft');
    act(() => publish({ status: 'checking', user: null, error: null }));
    expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull();
    act(() => publish({ status: 'signed-out', user: null, error: 'session' }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    await openLogin(); fill('en', 'b@example.test'); await openSettings(); await screen.findByText('b@example.test');
    await openMyStories();
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    await screen.findByLabelText(createStoryCopy.en.titleLabel);
    expect(screen.getByLabelText(createStoryCopy.en.titleLabel).props.value).toBe('');
    expect(screen.queryByText('Private account A draft')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('preserves Replay after returning from Login without changing the saved language or completion', async () => {
    await openWelcome('sv'); await openLogin('sv');
    fireEvent.press(screen.getByRole('button', { name: authCopy.sv.back }));
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.replay }));
    await screen.findByRole('header', { name: introCopy.sv.scenes[0].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.skip }));
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
    expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language: 'sv', completed: true });
  });

  it('maps a warm native link through the root decision without retaining Login intent (adapter test)', async () => {
    await openWelcome(); await openLogin();
    const target = await redirectSystemPath({ path: 'exp://192.168.1.25:8083/--/login?from=welcome', initial: false });
    expect(target).toBe('/');
    act(() => router.navigate(target as '/'));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    act(() => router.navigate('/login'));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
    // This drives the exported native-intent adapter and actual route guards;
    // it does not launch Expo Go or prove physical QR handling.
  });

  it('preserves intentional Login across ordinary native background and foreground events', async () => {
    const original = AppState.addEventListener;
    const changes = new Set<(state: AppStateStatus) => void>();
    AppState.addEventListener = (event, listener) => {
      const changed = listener as (state: AppStateStatus) => void;
      if (event === 'change') changes.add(changed);
      const subscription = original(event, listener);
      return { remove: () => { changes.delete(changed); subscription.remove(); } };
    };
    let view: Awaited<ReturnType<typeof openWelcome>> | undefined;
    try {
      view = await openWelcome(); await openLogin();
      fireEvent.changeText(screen.getByLabelText(authCopy.en.password), 'synthetic-unsent-password');
      act(() => [...changes].forEach((listener) => listener('background')));
      expect(screen.queryByLabelText(authCopy.en.password)).toBeNull();
      act(() => [...changes].forEach((listener) => listener('active')));
      await screen.findByRole('header', { name: authCopy.en.title });
      expect(screen.getByLabelText(authCopy.en.password).props.value).toBe('');
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(auth.signIn).not.toHaveBeenCalled();
    } finally { view?.unmount(); AppState.addEventListener = original; }
  });
});
