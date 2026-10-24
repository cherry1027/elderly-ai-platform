import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, getStoryProject, createStoryProject, updateStoryProject, type StoryProject } from '../src/api/story-projects';
import RootLayout from '../src/app/_layout';
import Entry from '../src/app/index';
import LanguageRoute from '../src/app/language';
import Introduction from '../src/app/introduction';
import Welcome from '../src/app/welcome';
import Login from '../src/app/login';
import Register from '../src/app/register';
import Confirm from '../src/app/auth/confirm';
import Authenticated from '../src/app/authenticated';
import { HomeScreen } from '../src/screens/HomeScreen';
import { RootTabBar } from '../src/components/RootTabBar';
import { CreateStory } from '../src/stories/CreateStory';
import { StoryDashboard } from '../src/stories/StoryDashboard';
import { MyStoriesScreen } from '../src/screens/MyStoriesScreen';
import { rootNavigationCopy, type RootTab } from '../src/root-navigation-copy';
import { createStoryCopy } from '../src/create-story-copy';
import type { Language } from '../src/i18n';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn(() => ({
  supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only',
})) }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), createStoryProject: jest.fn(), updateStoryProject: jest.fn() }));

const ownerA = { id: '16000000-0000-4000-8000-000000000001', email: 'a@example.test' };
const ownerB = { id: '16000000-0000-4000-8000-000000000002', email: 'b@example.test' };
const privateTitle = 'Fictional unsaved account A wording';
const routes = { _layout: RootLayout, index: Entry, language: LanguageRoute, introduction: Introduction,
  welcome: Welcome, login: Login, register: Register, 'auth/confirm': Confirm, authenticated: Authenticated };
let snapshot: AuthSnapshot;
let auth: MobileAuth;
let listeners: Set<() => void>;
let appListeners: Set<(state: AppStateStatus) => void>;
function publish(next: AuthSnapshot) { snapshot = next; [...listeners].forEach(listener => listener()); }
function appState(state: AppStateStatus) { [...appListeners].forEach(listener => listener(state)); }
function project(title: string, language: Language): StoryProject {
  return { id: '17000000-0000-4000-8000-000000000001', title, description: null, language, status: 'draft',
    created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:00:00Z' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const tabs = () => screen.UNSAFE_getByType(RootTabBar).props as { tab: RootTab; onSelectTab: (tab: RootTab) => void };
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function open(language: Language) {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = renderRouter(routes, { initialUrl: '/authenticated' });
  await screen.findByRole('header', { name: rootNavigationCopy[language].homeTitle });
  return flow;
}
function noWritesOrLiveNetwork() {
  expect(createStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(getStoryProject).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
  expect(globalThis.WebSocket).not.toHaveBeenCalled();
}
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  listeners = new Set(); appListeners = new Set();
  snapshot = { status: 'signed-in', user: ownerA, error: null };
  let foreground = true;
  auth = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}),
    getAccessToken: jest.fn(async expectedOwner => snapshot.status === 'signed-in' &&
      snapshot.user?.id === expectedOwner ? 'synthetic-verified-access-token' : null),
    signIn: jest.fn(async () => {}),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(active => {
      if (active === foreground) return;
      foreground = active;
      // Faithfully model the existing service's privacy/revalidation boundary.
      // No Supabase SDK or real verification request is exercised in this test.
      publish({ status: 'checking', user: null, error: null });
    }),
    dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockReset().mockResolvedValue([]);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    const changed = listener as (state: AppStateStatus) => void;
    appListeners.add(changed);
    return { remove: () => { appListeners.delete(changed); } };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

it.each<Language>(['en', 'sv'])('clears unfinished %s story wording on background and returns the same owner to Home only after verification', async language => {
  const flow = await open(language);
  const oldHome = screen.UNSAFE_getByType(HomeScreen).props;
  const oldTabs = tabs().onSelectTab;
  fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[language].createStory }));
  fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), privateTitle);
  const oldBack = screen.UNSAFE_getByType(CreateStory).props.onBack;
  act(() => appState('inactive'));
  expect(screen.queryByLabelText(createStoryCopy[language].titleLabel)).toBeNull();
  expect(screen.UNSAFE_queryByType(RootTabBar)).toBeNull();
  act(() => { oldBack(); oldTabs('stories'); oldHome.onCreateStory(); oldHome.onOpenStories(); });
  expect(listStoryProjects).not.toHaveBeenCalled();
  act(() => appState('active'));
  expect(screen.queryByRole('header', { name: rootNavigationCopy[language].homeTitle })).toBeNull();
  expect(screen.UNSAFE_queryByType(RootTabBar)).toBeNull();
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(auth.getAccessToken).not.toHaveBeenCalled();
  act(() => publish({ status: 'signed-in', user: ownerA, error: null }));
  await screen.findByRole('header', { name: rootNavigationCopy[language].homeTitle });
  expect(flow.getPathname()).toBe('/authenticated'); expect(tabs().tab).toBe('home');
  act(() => { oldBack(); oldTabs('stories'); oldHome.onCreateStory(); oldHome.onOpenStories(); });
  await settle();
  expect(tabs().tab).toBe('home'); expect(listStoryProjects).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[language].createStory }));
  expect(screen.getByLabelText(createStoryCopy[language].titleLabel).props.value).toBe('');
  expect(screen.queryByText(privateTitle)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language, completed: true });
  expect(JSON.stringify(jest.mocked(AsyncStorage.setItem).mock.calls)).not.toContain(privateTitle);
  expect(auth.signIn).not.toHaveBeenCalled(); expect(auth.signOut).not.toHaveBeenCalled();
  noWritesOrLiveNetwork();
});

it.each<Language>(['en', 'sv'])('aborts pending %s account A rows on background and never restores them or their callbacks for account B', async language => {
  const pending = deferred<StoryProject[]>();
  jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  await open(language);
  fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[language].openStories }));
  await waitFor(() => expect(listStoryProjects).toHaveBeenCalledTimes(1));
  const oldTabs = tabs().onSelectTab;
  const oldSignOut = screen.UNSAFE_getByType(StoryDashboard).props.onSignOut;
  const oldRefresh = screen.UNSAFE_getByType(MyStoriesScreen).props.onRefresh;
  const request = jest.mocked(listStoryProjects).mock.calls[0][0];
  await request.getAccessToken(); expect(auth.getAccessToken).toHaveBeenLastCalledWith(ownerA.id);
  act(() => appState('background'));
  expect(request.signal?.aborted).toBe(true); expect(screen.UNSAFE_queryByType(RootTabBar)).toBeNull();
  act(() => appState('active'));
  act(() => { oldTabs('stories'); oldSignOut(); oldRefresh(); });
  expect(listStoryProjects).toHaveBeenCalledTimes(1); expect(auth.signOut).not.toHaveBeenCalled();
  act(() => publish({ status: 'signed-in', user: ownerB, error: null }));
  await screen.findByRole('header', { name: rootNavigationCopy[language].homeTitle });
  await act(async () => pending.resolve([project('Account A fictional private row', language)]));
  act(() => { oldTabs('stories'); oldSignOut(); oldRefresh(); });
  await settle();
  expect(tabs().tab).toBe('home'); expect(listStoryProjects).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Account A fictional private row')).toBeNull(); expect(auth.signOut).not.toHaveBeenCalled();
  expect(await request.getAccessToken()).toBeNull();
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Account B fictional story', language)]);
  fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[language].openStories }));
  await screen.findByText('Account B fictional story');
  expect(screen.queryByText('Account A fictional private row')).toBeNull();
  await jest.mocked(listStoryProjects).mock.calls[1][0].getAccessToken();
  expect(auth.getAccessToken).toHaveBeenLastCalledWith(ownerB.id);
  expect(JSON.stringify(jest.mocked(AsyncStorage.setItem).mock.calls)).not.toContain('Account A fictional private row');
  noWritesOrLiveNetwork();
});