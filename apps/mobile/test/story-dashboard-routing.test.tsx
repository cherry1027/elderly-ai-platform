import { openMyStories, openSettings } from './root-shell-helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
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
import { copy } from '../src/i18n';
import { authCopy } from '../src/auth-copy';
import { AuthError } from '../src/auth/errors';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStoryProjects: jest.fn() }));
const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm };
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
let auth: MobileAuth;
const account = (id = 'account-a'): AuthSnapshot => ({ status: 'signed-in', user: { id, email: `${id}@example.test` }, error: null });
const project = (title: string): StoryProject => ({ id: '10000000-0000-4000-8000-000000000001', title,
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
});
it.each(['signed-out', 'checking', 'blocked', 'busy'] as const)('does not create a dashboard or issue requests for %s authentication', async status => {
  snapshot = { status, user: null, error: null };
  await renderRouter(routes, { initialUrl: '/authenticated' });
  await waitFor(() => expect(auth.restore).toHaveBeenCalled());
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(auth.getAccessToken).not.toHaveBeenCalled();
  expect(screen.queryByRole('header', { name: storiesCopy.en.title })).toBeNull();
});
it('reaches the dashboard only after verified login and passes the current account to the token service', async () => {
  snapshot = { status: 'signed-out', user: null, error: null };
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByRole('header', { name: copy.en.welcomeTitle });
  expect(listStoryProjects).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByLabelText(authCopy.en.email);
  await fireEvent.changeText(screen.getByLabelText(authCopy.en.email), 'account-a@example.test');
  await fireEvent.changeText(screen.getByLabelText(authCopy.en.password), 'synthetic-password');
  await fireEvent.press(screen.getByRole('button', { name: authCopy.en.signIn }));
  await openMyStories();
  await screen.findByRole('header', { name: storiesCopy.en.title });
  await waitFor(() => expect(listStoryProjects).toHaveBeenCalledTimes(1));
  await expect(jest.mocked(listStoryProjects).mock.calls[0][0].getAccessToken()).resolves.toBe('synthetic-token-account-a');
  expect(auth.getAccessToken).toHaveBeenCalledWith('account-a');
});
it('aborts a pending request and ignores its late success after Sign Out', async () => {
  let finish!: (rows: StoryProject[]) => void;
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await renderRouter(routes, { initialUrl: '/' }); await openMyStories(); await screen.findByRole('header', { name: storiesCopy.en.title });
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await openSettings();
  await fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle });
  expect(signal.aborted).toBe(true);
  await act(async () => { finish([project('Private old story')]); });
  expect(screen.queryByText('Private old story')).toBeNull();
});
it('never carries completed rows or late work into another verified account', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Account A story')]);
  await renderRouter(routes, { initialUrl: '/' }); await openMyStories(); await screen.findByText('Account A story');
  let finish!: (rows: StoryProject[]) => void;
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
  const signal = jest.mocked(listStoryProjects).mock.calls[1][0].signal!;
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Account B story')]);
  await act(() => publish(account('account-b')));
  await openMyStories(); await screen.findByText('Account B story'); expect(signal.aborted).toBe(true);
  await act(async () => { finish([project('Late account A story')]); });
  expect(screen.queryByText('Late account A story')).toBeNull(); expect(screen.queryByText('Account A story')).toBeNull();
  await jest.mocked(listStoryProjects).mock.calls[2][0].getAccessToken();
  expect(auth.getAccessToken).toHaveBeenLastCalledWith('account-b');
});
it('hides projects and cancels loading while account verification is pending again', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Private story')]);
  await renderRouter(routes, { initialUrl: '/' }); await openMyStories(); await screen.findByText('Private story');
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await act(() => publish({ status: 'checking', user: null, error: null }));
  expect(screen.queryByText('Private story')).toBeNull(); expect(signal.aborted).toBe(true);
});
it('preserves secure sign-out cleanup failure handling without retaining private rows', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Private story')]);
  await renderRouter(routes, { initialUrl: '/' }); await openMyStories(); await screen.findByText('Private story');
  jest.mocked(auth.signOut).mockImplementationOnce(async () => {
    publish({ status: 'blocked', user: null, error: 'cleanup' }); throw new AuthError('cleanup');
  });
  await openSettings();
  await fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
  await screen.findByText(authCopy.en.errors.cleanup);
  expect(screen.queryByText('Private story')).toBeNull(); expect(screen.queryByText('account-a@example.test')).toBeNull();
});
it('clears prior rows on a rejected refresh and requires normal sign-in after a 401', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Private story')]);
  await renderRouter(routes, { initialUrl: '/' }); await openMyStories(); await screen.findByText('Private story');
  jest.mocked(listStoryProjects).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
  await screen.findByText(storiesCopy.en.errors.authentication);
  expect(screen.queryByText('Private story')).toBeNull();
  expect(screen.getByRole('button', { name: storiesCopy.en.refresh })).toBeDisabled();
  await openSettings();
  await fireEvent.press(screen.getByRole('button', { name: authCopy.en.signOut }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
