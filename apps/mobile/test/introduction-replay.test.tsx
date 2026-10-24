import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, BackHandler, Text, View } from 'react-native';
import { createIntroductionReplaySource, finishIntroductionReplay, readIntroductionReplay, INTRODUCTION_REPLAY_TTL_MS } from '../src/navigation/IntroductionReplay';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { useAuth } from '../src/auth/AuthProvider';
import RootLayout from '../src/app/_layout';
import IntroductionRoute from '../src/app/introduction';
import { IntroductionScreen } from '../src/screens/IntroductionScreen';
import { LargeButton } from '../src/components/LargeButton';
import { useLanguage } from '../src/language';
import { introCopy } from '../src/intro-copy';
import { type Language } from '../src/i18n';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn(() => ({
  supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only',
})) }));
const a = { id: 'fictional-owner-a', email: 'a@example.test' };
const b = { id: 'fictional-owner-b', email: 'b@example.test' };
const signedIn = { status: 'signed-in' as const, user: a, error: null, appActive: true };
const sources: ReturnType<typeof createIntroductionReplaySource>[] = [];
function source() { const value = createIntroductionReplaySource(); sources.push(value); return value; }
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
function SettingsFixture() {
  const auth = useAuth();
  const { language } = useLanguage();
  const [intent] = useState(source);
  const [returned, setReturned] = useState(false);
  intent.sync(auth);
  useEffect(() => { intent.sync(auth); return () => intent.dispose(); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { if (intent.consumeReturn(auth)) setReturned(true); }, [intent, auth]));
  if (auth.status === 'checking' || auth.status === 'busy' || !auth.appActive) return null;
  if (auth.status !== 'signed-in' || !auth.user) return <Redirect href="/welcome" />;
  return <View><Text accessibilityRole="header">Settings {language}</Text>
    {returned && <Text>Returned directly</Text>}
    <Text>{auth.user.id}</Text>
    <LargeButton language={language} label={introCopy[language].replay} onPress={() => {
      if (intent.begin(auth)) router.navigate({ pathname: '/introduction', params: { scene: '0' } });
    }} />
  </View>;
}
function EntryFixture() { return <Redirect href="/authenticated" />; }
function WelcomeFixture() { return <Text accessibilityRole="header">Public Welcome</Text>; }
function UnusedPublicFixture() { return <Text>Unused public route fixture</Text>; }
const routes = { _layout: RootLayout, index: EntryFixture, authenticated: SettingsFixture,
  introduction: IntroductionRoute, welcome: WelcomeFixture, language: UnusedPublicFixture,
  login: UnusedPublicFixture, register: UnusedPublicFixture, 'auth/confirm': UnusedPublicFixture };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  snapshot = { status: 'signed-in', user: a, error: null };
  listeners = new Set();
  const auth: MobileAuth = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}), getAccessToken: jest.fn(async () => null),
    signIn: jest.fn(async () => {}), signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(), dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
});
afterEach(() => { sources.splice(0).forEach(value => value.dispose()); jest.restoreAllMocks(); });

async function replay(language: Language) {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = renderRouter(routes, { initialUrl: '/authenticated' });
  fireEvent.press(await screen.findByRole('button', { name: introCopy[language].replay }));
  await screen.findByRole('header', { name: introCopy[language].scenes[0].title });
  return flow;
}

describe('bounded owner-scoped Introduction replay intent', () => {
  it('requires current verification, is single-use and ignores forged ticket values', () => {
    const value = source();
    expect(value.begin(signedIn)).toBe(false);
    value.sync(signedIn);
    expect(value.begin({ ...signedIn, appActive: false })).toBe(false);
    expect(value.begin(signedIn)).toBe(true);
    expect(value.begin(signedIn)).toBe(false);
    const ticket = readIntroductionReplay(signedIn)!;
    expect(finishIntroductionReplay({ identity: ticket.identity }, signedIn)).toBe(false);
    expect(value.hasReturn(signedIn)).toBe(false);
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(true);
    expect(value.hasReturn(signedIn)).toBe(true);
    expect(value.hasReturn(signedIn)).toBe(true);
    expect(value.consumeReturn(signedIn)).toBe(true);
    expect(value.consumeReturn(signedIn)).toBe(false);
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(false);
  });
  it.each(['signed-out', 'blocked', 'busy'] as const)('revokes a captured ticket for %s', status => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const ticket = readIntroductionReplay(signedIn)!;
    value.sync({ status, user: null, appActive: true });
    value.sync(signedIn);
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(false);
    expect(value.hasReturn(signedIn)).toBe(false);
  });
  it('cannot transfer intent across owners or revive an old callback after returning to the old owner', () => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const ticket = readIntroductionReplay(signedIn)!;
    value.sync({ ...signedIn, user: b }); value.sync(signedIn);
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(false);
    expect(value.consumeReturn(signedIn)).toBe(false);
  });
  it('an old ticket cannot cancel a newer same-owner replay', () => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const old = readIntroductionReplay(signedIn)!;
    value.dispose(); value.sync(signedIn); value.begin(signedIn);
    const current = readIntroductionReplay(signedIn)!;
    expect(finishIntroductionReplay(old, { ...signedIn, user: b })).toBe(false);
    expect(readIntroductionReplay(signedIn)).toBe(current);
    expect(finishIntroductionReplay(current, signedIn)).toBe(true);
  });
  it('retains only safe intent during checking/background without authorizing actions', () => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const ticket = readIntroductionReplay(signedIn)!;
    const checking = { status: 'checking' as const, user: null, appActive: false };
    value.sync(checking);
    expect(readIntroductionReplay(checking)).toBeNull();
    expect(finishIntroductionReplay(ticket, checking)).toBe(false);
    expect(value.hasReturn(checking)).toBe(false);
    value.sync(signedIn);
    expect(readIntroductionReplay(signedIn)).toBe(ticket);
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(true);
    expect(value.consumeReturn(checking)).toBe(false);
    expect(value.consumeReturn(signedIn)).toBe(true);
  });
  it('preserves provider-shaped background intent but never authorizes a background return', () => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const ticket = readIntroductionReplay(signedIn)!;
    const background = { ...signedIn, user: null, appActive: false };
    value.sync(background);
    expect(readIntroductionReplay(background)).toBeNull();
    expect(finishIntroductionReplay(ticket, background)).toBe(false);
    value.sync(signedIn);
    expect(readIntroductionReplay(signedIn)).toBe(ticket);
  });
  it('expires a playing lease without timers or requests and rejects old callbacks', () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const ticket = readIntroductionReplay(signedIn)!;
    clock.mockReturnValue(now + INTRODUCTION_REPLAY_TTL_MS);
    expect(readIntroductionReplay(signedIn)).toBeNull();
    expect(finishIntroductionReplay(ticket, signedIn)).toBe(false);
    expect(value.consumeReturn(signedIn)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('a pure return peek cannot expose an expired intent and consumption fails', () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    finishIntroductionReplay(readIntroductionReplay(signedIn)!, signedIn);
    clock.mockReturnValue(now + INTRODUCTION_REPLAY_TTL_MS);
    expect(value.hasReturn(signedIn)).toBe(false);
    expect(value.hasReturn(signedIn)).toBe(false);
    expect(value.consumeReturn(signedIn)).toBe(false);
  });
  it('disposal revokes intent; StrictMode setup can safely create a new lease', () => {
    const value = source(); value.sync(signedIn); value.begin(signedIn);
    const old = readIntroductionReplay(signedIn)!;
    value.dispose();
    expect(value.begin(signedIn)).toBe(false);
    value.sync(signedIn);
    expect(value.begin(signedIn)).toBe(true);
    expect(finishIntroductionReplay(old, signedIn)).toBe(false);
    expect(finishIntroductionReplay(readIntroductionReplay(signedIn)!, signedIn)).toBe(true);
  });
});

describe('actual Introduction router with verified Settings intent and mocked authentication', () => {
  it.each<Language>(['en', 'sv'])('shows all three scenes and returns directly to Settings in %s', async language => {
    const flow = await replay(language);
    for (const scene of [1, 2] as const) {
      fireEvent.press(screen.getByRole('button', { name: introCopy[language].next }));
      await screen.findByRole('header', { name: introCopy[language].scenes[scene].title });
    }
    fireEvent.press(screen.getByRole('button', { name: introCopy[language].enter }));
    await screen.findByText('Returned directly');
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByText('Public Welcome')).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language, completed: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
  });
  it.each((['en', 'sv'] as const).flatMap(language => ['back', 'skip'].map(action => ({ language, action }))))(
    '$action returns directly to Settings without changing completion in $language', async ({ language, action }) => {
      const flow = await replay(language);
      fireEvent.press(screen.getByRole('button', { name: action === 'back' ? introCopy[language].back : introCopy[language].skip }));
      await screen.findByText('Returned directly');
      expect(flow.getPathname()).toBe('/authenticated');
      expect(screen.queryByText('Public Welcome')).toBeNull();
      expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language, completed: true });
    });
  it.each<Language>(['en', 'sv'])('Android Back returns the initial Replay scene to Settings in %s', async language => {
    const original = BackHandler.addEventListener;
    let back: (() => boolean | null | undefined) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'hardwareBackPress') back = () => handler({ type: 'hardwareBackPress', timeStamp: 0 });
      return original(event, handler);
    });
    const flow = await replay(language);
    act(() => { expect(back?.()).toBe(true); });
    await screen.findByText('Returned directly');
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByText('Public Welcome')).toBeNull();
  });
  it('uses local scene Back before returning and never writes completion for authenticated replay', async () => {
    await replay('en');
    jest.mocked(AsyncStorage.setItem).mockClear();
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.next }));
    await screen.findByRole('header', { name: introCopy.en.scenes[1].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
    await screen.findByRole('header', { name: introCopy.en.scenes[0].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.skip }));
    await screen.findByText('Returned directly');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('hides replay while checking and resumes the same-owner scenes safely', async () => {
    await replay('sv');
    const captured = screen.UNSAFE_getByType(IntroductionScreen).props.onSkip;
    act(() => publish({ status: 'checking', user: null, error: null }));
    await waitFor(() => expect(screen.queryByRole('button', { name: introCopy.sv.skip })).toBeNull());
    act(() => captured());
    expect(screen.queryByText('Returned directly')).toBeNull();
    act(() => publish({ status: 'signed-in', user: a, error: null }));
    await screen.findByRole('header', { name: introCopy.sv.scenes[0].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.skip }));
    await screen.findByText('Returned directly');
  });
  it.each(['signed-out', 'blocked'] as const)('revokes replay on %s and rejects its captured return action', async status => {
    const flow = await replay('en');
    const captured = screen.UNSAFE_getByType(IntroductionScreen).props.onSkip;
    act(() => publish({ status, user: null, error: status === 'blocked' ? 'cleanup' : null }));
    await screen.findByRole('header', { name: 'Public Welcome' });
    act(() => captured());
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByText('Returned directly')).toBeNull();
  });
  it('does not restore the old Settings intent to a different verified account', async () => {
    const flow = await replay('en');
    const captured = screen.UNSAFE_getByType(IntroductionScreen).props.onSkip;
    act(() => publish({ status: 'signed-in', user: b, error: null }));
    await screen.findByText(b.id);
    act(() => captured());
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByText('Returned directly')).toBeNull();
    expect(screen.queryByText(a.id)).toBeNull();
  });
  it('an expired idle Replay returns through entry on the next explicit action', async () => {
    const flow = await replay('sv');
    // renderRouter installs its own fake clock, replacing a preceding Date spy.
    // Change that clock after mounting; elapsed time alone must not navigate.
    jest.setSystemTime(Date.now() + INTRODUCTION_REPLAY_TTL_MS);
    expect(screen.getByRole('header', { name: introCopy.sv.scenes[0].title })).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.skip }));
    await screen.findByRole('header', { name: 'Settings sv' });
    expect(flow.getPathname()).toBe('/authenticated');
    expect(screen.queryByText('Returned directly')).toBeNull();
    expect(screen.queryByText('Public Welcome')).toBeNull();
  });
  it('does not trust a forged Settings return query as replay authority', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    const flow = renderRouter(routes, { initialUrl: '/introduction?scene=0&returnTo=settings&ownerId=fictional-owner-a' });
    fireEvent.press(await screen.findByRole('button', { name: introCopy.en.skip }));
    await screen.findByRole('header', { name: 'Public Welcome' });
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByText('Returned directly')).toBeNull();
  });
});