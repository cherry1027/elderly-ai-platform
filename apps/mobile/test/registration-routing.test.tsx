import { openSettings } from './root-shell-helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AppState, BackHandler, type AppStateStatus } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { createRegistration, type Registration, type RegistrationSnapshot } from '../src/auth/registration';
import { clearConfirmationLink, takeConfirmationLink } from '../src/auth/confirmation-link';
import RootLayout from '../src/app/_layout';
import Entry from '../src/app/index';
import Language from '../src/app/language';
import Introduction from '../src/app/introduction';
import Welcome from '../src/app/welcome';
import Login from '../src/app/login';
import Authenticated from '../src/app/authenticated';
import Register from '../src/app/register';
import Confirm from '../src/app/auth/confirm';
import { redirectSystemPath } from '../src/app/+native-intent';
import { registrationCopy } from '../src/registration-copy';
import { authCopy } from '../src/auth-copy';
import { introCopy } from '../src/intro-copy';
import { copy, type Language as Locale } from '../src/i18n';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/auth/registration', () => ({ createRegistration: jest.fn() }));
const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm };
const callbackState = 'a'.repeat(64);
const callback = (code: string) => `memy-foundation://auth/confirm?state=${callbackState}&code=${code}`;
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
let auth: MobileAuth;
let registration: Registration;
let regSnapshot: RegistrationSnapshot;
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); clearConfirmationLink();
  snapshot = { status: 'signed-out', user: null, error: null }; listeners = new Set();
  auth = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}),
    getAccessToken: jest.fn(async () => null),
    signIn: jest.fn(async email => publish({ status: 'signed-in', user: { id: 'verified', email }, error: null })),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(), dispose: jest.fn(),
  };
  regSnapshot = { status: 'idle', error: null };
  registration = {
    getSnapshot: () => regSnapshot, subscribe: () => () => {},
    signUp: jest.fn(async () => {}),
    confirm: jest.fn(async () => { throw { kind: 'unavailable' }; }),
    cancel: jest.fn(async () => {}), dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only' });
  jest.mocked(createRegistration).mockReturnValue(registration);
});
afterEach(() => { clearConfirmationLink(); });
async function returning(language: Locale = 'en', path = '/') {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = renderRouter(routes, { initialUrl: path });
  await screen.findByRole('header', { name: copy[language].welcomeTitle });
  return flow;
}
async function openRegister(language: Locale = 'en') {
  const flow = await returning(language);
  fireEvent.press(screen.getByRole('button', { name: introCopy[language].register }));
  await screen.findByRole('header', { name: registrationCopy[language].title });
  return flow;
}

describe('native registration routes, mocked services only', () => {
  it.each<Locale>(['en', 'sv'])('opens the gated native form and returns to Welcome in %s', async language => {
    const flow = await openRegister(language);
    expect(flow.getPathname()).toBe('/register');
    expect(screen.getByText(registrationCopy[language].gate)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: registrationCopy[language].back }));
    await screen.findByRole('header', { name: copy[language].welcomeTitle });
    expect(registration.cancel).toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: introCopy[language].guest })).toBeDisabled();
  });
  it('checks details locally without attempting signup or showing an email-sent result', async () => {
    await openRegister();
    fireEvent.changeText(screen.getByLabelText(registrationCopy.en.email), 'person@example.test');
    fireEvent.changeText(screen.getByLabelText(registrationCopy.en.password), 'synthetic-password');
    fireEvent.changeText(screen.getByLabelText(registrationCopy.en.confirmation), 'synthetic-password');
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.checkDetails }));
    expect(screen.getByText(registrationCopy.en.checked)).toBeOnTheScreen();
    expect(screen.queryByText(registrationCopy.en.sent)).toBeNull();
    expect(registration.signUp).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('allows intentional normal login from the registration form only after temporary cleanup', async () => {
    await openRegister();
    let finish!: () => void;
    jest.mocked(registration.cancel).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.login }));
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
    await act(async () => { finish(); });
    await screen.findByRole('header', { name: authCopy.en.title });
    expect(auth.signIn).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText(authCopy.en.email), 'person@example.test');
    fireEvent.changeText(screen.getByLabelText(authCopy.en.password), 'synthetic-password');
    fireEvent.press(screen.getByRole('button', { name: authCopy.en.signIn }));
    await openSettings(); await screen.findByText('person@example.test');
  });
  it('does not leave registration for Login if temporary cleanup fails', async () => {
    await openRegister();
    jest.mocked(registration.cancel).mockRejectedValueOnce({ kind: 'cleanup' });
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.login }));
    await act(async () => {});
    expect(screen.getByRole('header', { name: registrationCopy.en.title })).toBeOnTheScreen();
    expect(screen.getByText(registrationCopy.en.errors.cleanup)).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it.each(['/register', '/register?registrationRequested=true'])('never grants registration intent from cold %s', async path => {
    const flow = await returning('en', path);
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByLabelText(registrationCopy.en.confirmation)).toBeNull();
  });
  it('keeps first-use preferences and animated introduction in the existing order', async () => {
    const flow = renderRouter(routes, { initialUrl: '/register' });
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(flow.getPathname()).toBe('/language');
    expect(auth.signIn).not.toHaveBeenCalled();
  });
  it('preserves a legitimate signed-in account at direct registration entry', async () => {
    snapshot = { status: 'signed-in', user: { id: 'existing', email: 'existing@example.test' }, error: null };
    renderRouter(routes, { initialUrl: '/register' });
    await openSettings(); await screen.findByText('existing@example.test');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(registration.signUp).not.toHaveBeenCalled();
  });
  it('does not restore registration intent across a router remount', async () => {
    const first = await openRegister(); first.unmount();
    await returning('en', '/register');
    expect(screen.queryByLabelText(registrationCopy.en.confirmation)).toBeNull();
  });
  it('preserves Replay and language after returning from registration', async () => {
    await openRegister('sv');
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.sv.back }));
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.replay }));
    await screen.findByRole('header', { name: introCopy.sv.scenes[0].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.skip }));
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
  });
  it('preserves the provider check-email phase when backgrounding remounts the form', async () => {
    regSnapshot = { status: 'check-email', error: null };
    await withAppState(async changes => {
      const view = await openRegister();
      try {
        expect(screen.getByText(registrationCopy.en.sent)).toBeOnTheScreen();
        act(() => changes('background'));
        expect(screen.queryByLabelText(registrationCopy.en.password)).toBeNull();
        act(() => changes('active'));
        await screen.findByText(registrationCopy.en.sent);
        expect(screen.queryByLabelText(registrationCopy.en.password)).toBeNull();
        expect(registration.signUp).not.toHaveBeenCalled();
      } finally { view.unmount(); }
    });
  });
  it('handles Android hardware Back without signing out the main account', async () => {
    const original = BackHandler.addEventListener;
    let back: (() => unknown) | undefined;
    BackHandler.addEventListener = jest.fn((event, listener) => {
      if (event === 'hardwareBackPress') back = () => listener({ type: 'hardwareBackPress', timeStamp: 0 });
      return original(event, listener);
    });
    try {
      await openRegister(); act(() => { back?.(); });
      await screen.findByRole('header', { name: copy.en.welcomeTitle });
      expect(auth.signOut).not.toHaveBeenCalled();
    } finally { BackHandler.addEventListener = original; }
  });
});

async function withAppState(check: (change: (state: AppStateStatus) => void) => Promise<void>) {
  const original = AppState.addEventListener;
  const listeners = new Set<(state: AppStateStatus) => void>();
  AppState.addEventListener = (event, listener) => {
    const handler = listener as (state: AppStateStatus) => void;
    if (event === 'change') listeners.add(handler);
    const subscription = original(event, listener);
    return { remove: () => { listeners.delete(handler); subscription.remove(); } };
  };
  try { await check(state => [...listeners].forEach(listener => listener(state))); }
  finally { AppState.addEventListener = original; }
}

describe('confirmation callback route without live requests', () => {
  it('does not accept a raw router parameter as proof of confirmation', async () => {
    renderRouter(routes, { initialUrl: '/auth/confirm?code=synthetic-untrusted-code' });
    await screen.findByText(registrationCopy.en.confirmationInvalid);
    expect(registration.confirm).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
  });
  it('receives a sanitized cold native callback but reports the closed live gate', async () => {
    const target = await redirectSystemPath({ path: callback('synthetic-code'), initial: true });
    expect(target).toBe('/auth/confirm');
    const flow = renderRouter(routes, { initialUrl: target });
    await screen.findByText(registrationCopy.en.confirmationUnavailable);
    expect(flow.getPathname()).toBe('/auth/confirm');
    expect(registration.confirm).toHaveBeenCalledWith({ code: 'synthetic-code', state: callbackState });
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: authCopy.en.signOut })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('offers normal explicit login only after mocked server-confirmed cleanup, without auto-authentication', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    jest.mocked(registration.confirm).mockResolvedValueOnce();
    await redirectSystemPath({ path: callback('synthetic-confirmed-code'), initial: true });
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await screen.findByText(registrationCopy.en.confirmationConfirmed);
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText(authCopy.en.signedIn)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.login }));
    await screen.findByRole('header', { name: authCopy.en.title });
    expect(auth.signIn).not.toHaveBeenCalled();
  });
  it('preserves account A while a confirmation callback is handled separately', async () => {
    snapshot = { status: 'signed-in', user: { id: 'account-a', email: 'a@example.test' }, error: null };
    await redirectSystemPath({ path: callback('synthetic-account-b-code'), initial: true });
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await screen.findByText(registrationCopy.en.confirmationUnavailable);
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.back }));
    await openSettings(); await screen.findByText('a@example.test');
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it('does not clear pending verification material merely by navigating to the callback', async () => {
    await openRegister();
    const target = await redirectSystemPath({ path: callback('synthetic-code'), initial: false });
    act(() => router.navigate(target as '/auth/confirm'));
    await screen.findByText(registrationCopy.en.confirmationUnavailable);
    expect(registration.cancel).not.toHaveBeenCalled();
  });
  it('consumes later warm links while the confirmation route is already mounted', async () => {
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await screen.findByText(registrationCopy.en.confirmationInvalid);
    await act(async () => { await redirectSystemPath({ path: callback('synthetic-warm-code'), initial: false }); });
    await screen.findByText(registrationCopy.en.confirmationUnavailable);
    expect(registration.confirm).toHaveBeenCalledTimes(1);
  });
  it('keeps a verified confirmation result across native background and foreground', async () => {
    await withAppState(async changes => {
      jest.mocked(registration.confirm).mockResolvedValueOnce();
      await redirectSystemPath({ path: callback('synthetic-code'), initial: true });
      const view = renderRouter(routes, { initialUrl: '/auth/confirm' });
      try {
        await screen.findByText(registrationCopy.en.confirmationConfirmed);
        act(() => changes('background'));
        expect(screen.queryByText(registrationCopy.en.confirmationConfirmed)).toBeNull();
        act(() => changes('active'));
        await screen.findByText(registrationCopy.en.confirmationConfirmed);
        expect(registration.confirm).toHaveBeenCalledTimes(1);
        expect(auth.signIn).not.toHaveBeenCalled();
      } finally { view.unmount(); }
    });
  });
  it('drains duplicate callback delivery received during an in-flight confirmation', async () => {
    let finish!: () => void;
    jest.mocked(registration.confirm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await redirectSystemPath({ path: callback('synthetic-code'), initial: true });
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => {
      await redirectSystemPath({ path: callback('synthetic-code'), initial: false });
      finish();
    });
    await screen.findByText(registrationCopy.en.confirmationConfirmed);
    expect(takeConfirmationLink()).toBeNull();
    expect(registration.confirm).toHaveBeenCalledTimes(1);
  });
  it.each(['link', 'cleanup'])('fails closed for mocked confirmation failure %s', async kind => {
    jest.mocked(registration.confirm).mockRejectedValueOnce({ kind, message: 'private-synthetic-detail' });
    await redirectSystemPath({ path: callback('synthetic-code'), initial: true });
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await screen.findByText(kind === 'cleanup' ? registrationCopy.en.confirmationBlocked : registrationCopy.en.confirmationInvalid);
    expect(screen.queryByText(/private-synthetic-detail/)).toBeNull();
    expect(screen.queryByRole('button', { name: registrationCopy.en.login })).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
  });
  it('does not navigate to Login when confirmation cleanup fails', async () => {
    jest.mocked(registration.confirm).mockResolvedValueOnce();
    await redirectSystemPath({ path: callback('synthetic-code'), initial: true });
    renderRouter(routes, { initialUrl: '/auth/confirm' });
    await screen.findByText(registrationCopy.en.confirmationConfirmed);
    jest.mocked(registration.cancel).mockRejectedValueOnce({ kind: 'cleanup' });
    fireEvent.press(screen.getByRole('button', { name: registrationCopy.en.login }));
    await screen.findByText(registrationCopy.en.confirmationBlocked);
    await waitFor(() => expect(screen.queryByRole('header', { name: authCopy.en.title })).toBeNull());
  });
});
