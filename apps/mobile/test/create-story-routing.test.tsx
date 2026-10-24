import { openMyStories, openSettings } from './root-shell-helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { BackHandler, Text } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { readMobileApiConfig } from '../src/api/config';
import { createStoryProject, listStoryProjects, type StoryProject } from '../src/api/story-projects';
import RootLayout from '../src/app/_layout';
import Entry from '../src/app/index';
import Language from '../src/app/language';
import Introduction from '../src/app/introduction';
import Welcome from '../src/app/welcome';
import Login from '../src/app/login';
import Authenticated from '../src/app/authenticated';
import Register from '../src/app/register';
import Confirm from '../src/app/auth/confirm';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';
import { storiesCopy } from '../src/stories-copy';
import { createStoryCopy } from '../src/create-story-copy';
import { authCopy } from '../src/auth-copy';
import { copy, type Language as Locale } from '../src/i18n';
import { AuthError } from '../src/auth/errors';
import { leaveCopy } from '../src/navigation/useGuardedLeave';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), createStoryProject: jest.fn() }));
const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm,
  outside: () => <Text>Another test route</Text> };
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
let auth: MobileAuth;
const account = (id = 'account-a'): AuthSnapshot => ({ status: 'signed-in', user: { id, email: `${id}@example.test` }, error: null });
const project = (title = 'Synthetic created story'): StoryProject => ({ id: '10000000-0000-4000-8000-000000000001', title,
  description: null, language: 'en', status: 'draft', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' });
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
beforeEach(async () => {
  await AsyncStorage.clear(); listeners = new Set(); snapshot = account();
  auth = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}),
    getAccessToken: jest.fn(async id => snapshot.status === 'signed-in' && snapshot.user?.id === id ? `synthetic-token-${id}` : null),
    signIn: jest.fn(async () => publish(account())),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(), dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only' });
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockResolvedValue([]);
  jest.mocked(createStoryProject).mockResolvedValue(project());
});
async function openCreate(language: Locale = 'en') {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = await renderRouter(routes, { initialUrl: '/' });
  await openMyStories(language);
  await screen.findByRole('header', { name: storiesCopy[language].title });
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].createStory }));
  await screen.findByRole('header', { name: createStoryCopy[language].title });
  return flow;
}
async function save(title = 'Synthetic created story', language: Locale = 'en') {
  await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), title);
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy[language].create }));
}
it.each<Locale>(['en', 'sv'])('navigates intentionally from My Stories to native Create and back in %s', async language => {
  await openCreate(language);
  expect(screen.getByRole('radio', { name: createStoryCopy[language][language === 'sv' ? 'swedish' : 'english'] }).props.accessibilityState.checked).toBe(true);
  expect(createStoryProject).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), 'Unsaved private title');
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy[language].back }));
  expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen();
  expect(createStoryProject).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].keep }));
  expect(screen.getByLabelText(createStoryCopy[language].titleLabel).props.value).toBe('Unsaved private title');
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy[language].back }));
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].discard }));
  await screen.findByRole('header', { name: storiesCopy[language].title });
  expect(screen.queryByText('Unsaved private title')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].createStory }));
  expect(screen.getByLabelText(createStoryCopy[language].titleLabel).props.value).toBe('');
});
it.each(['checking', 'signed-out', 'blocked', 'busy'] as const)('never exposes creation or makes a POST for %s authentication', async status => {
  snapshot = { status, user: null, error: null };
  await renderRouter(routes, { initialUrl: '/authenticated?create=true' });
  await waitFor(() => expect(auth.restore).toHaveBeenCalled());
  expect(screen.queryByRole('header', { name: createStoryCopy.en.title })).toBeNull();
  expect(createStoryProject).not.toHaveBeenCalled(); expect(auth.getAccessToken).not.toHaveBeenCalled();
});
it('ignores URL claims that try to open or submit a creation form', async () => {
  await renderRouter(routes, { initialUrl: '/authenticated?create=true&title=Injected&language=en' });
  await openMyStories();
  await screen.findByRole('header', { name: storiesCopy.en.title });
  expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull(); expect(createStoryProject).not.toHaveBeenCalled();
});
it('keeps the unconfigured live preview honest and never invents saved data', async () => {
  jest.mocked(readMobileApiConfig).mockReturnValue(null);
  await openCreate(); await save();
  await screen.findByText(createStoryCopy.en.errors.configuration);
  expect(createStoryProject).not.toHaveBeenCalled(); expect(auth.getAccessToken).not.toHaveBeenCalled();
  expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.back }));
  expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  await screen.findByRole('header', { name: storiesCopy.en.title });
  expect(screen.queryByText('Synthetic created story')).toBeNull(); expect(listStoryProjects).not.toHaveBeenCalled();
});
it('shows only a confirmed creation and then reloads the server list instead of inserting the response', async () => {
  await openCreate(); await save(); await screen.findByText(createStoryCopy.en.success);
  const call = jest.mocked(createStoryProject).mock.calls[0][0];
  await expect(call.getAccessToken()).resolves.toBe('synthetic-token-account-a');
  expect(auth.getAccessToken).toHaveBeenCalledWith('account-a');
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.back }));
  await screen.findByText(storiesCopy.en.empty);
  expect(listStoryProjects).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Synthetic created story')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language: 'en', completed: true });
  expect(await AsyncStorage.getAllKeys()).toEqual([PREFERENCES_KEY]); expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('cancels a pending save and ignores success after Sign Out', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openCreate(); await save(); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.signOut }));
  expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); expect(signal.aborted).toBe(false);
  expect(auth.signOut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.leave }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle }); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project('Private late story')); });
  expect(screen.queryByText('Private late story')).toBeNull(); expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
});
it('cannot carry an account A title or late response into account B', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openCreate(); await save('Account A private title'); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  await act(() => publish(account('account-b')));
  await openSettings(); await screen.findByText('account-b@example.test'); await openMyStories(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project('Account A private response')); });
  expect(screen.queryByText('Account A private response')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  expect(screen.getByLabelText(createStoryCopy.en.titleLabel).props.value).toBe('');
});
it('drops the form and in-flight request during session revalidation rather than resubmitting', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openCreate(); await save(); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  await act(() => publish({ status: 'checking', user: null, error: null }));
  expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull(); expect(signal.aborted).toBe(true);
  await act(() => publish(account())); await openMyStories(); await screen.findByRole('header', { name: storiesCopy.en.title });
  await act(async () => { finish(project('Stale created response')); });
  expect(screen.queryByText('Stale created response')).toBeNull(); expect(createStoryProject).toHaveBeenCalledTimes(1);
});
it('cancels saving when the native route loses focus without unmounting its stack entry', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openCreate(); await save(); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  await act(() => router.push('/outside' as '/'));
  await screen.findByText('Another test route'); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project('Private unfocused response')); });
  await act(() => router.back()); await openMyStories(); await screen.findByRole('header', { name: storiesCopy.en.title });
  expect(screen.queryByText('Private unfocused response')).toBeNull(); expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
});
it('returns to My Stories and cancels on Android hardware Back', async () => {
  const original = BackHandler.addEventListener;
  let hardwareBack: (() => boolean | null | undefined) | undefined;
  BackHandler.addEventListener = jest.fn((event, listener) => {
    if (event === 'hardwareBackPress') hardwareBack = () => listener({ type: 'hardwareBackPress', timeStamp: 0 });
    return original(event, listener);
  });
  try {
    await openCreate(); await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Unsaved private title');
    await act(() => { expect(hardwareBack?.()).toBe(true); });
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.keep }));
    expect(screen.getByLabelText(createStoryCopy.en.titleLabel).props.value).toBe('Unsaved private title');
    await act(() => { expect(hardwareBack?.()).toBe(true); });
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
    await screen.findByRole('header', { name: storiesCopy.en.title }); expect(createStoryProject).not.toHaveBeenCalled();
  } finally { BackHandler.addEventListener = original; }
});
it('preserves secure cleanup failure handling when signing out from Create', async () => {
  await openCreate(); await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Private draft');
  jest.mocked(auth.signOut).mockImplementationOnce(async () => {
    publish({ status: 'blocked', user: null, error: 'cleanup' }); throw new AuthError('cleanup');
  });
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.signOut }));
  expect(auth.signOut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  await screen.findByText(authCopy.en.errors.cleanup);
  expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull(); expect(screen.queryByText('Private draft')).toBeNull();
});
