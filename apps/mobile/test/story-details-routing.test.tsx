import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { readMobileApiConfig } from '../src/api/config';
import { getStoryProject, updateStoryProject, listStoryProjects, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
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
import { storyDetailsCopy } from '../src/story-details-copy';
import { copy, type Language as Locale } from '../src/i18n';
import { AuthError } from '../src/auth/errors';
import { authCopy } from '../src/auth-copy';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), updateStoryProject: jest.fn() }));
const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm,
  outside: () => <Text>Another test route</Text> };
const id = '10000000-0000-4000-8000-000000000001';
const project = (overrides: Partial<StoryProject> = {}): StoryProject => ({ id, title: 'Fresh selected title',
  description: 'Private selected description', language: 'en', status: 'draft',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides });
let snapshot: AuthSnapshot; let listeners: Set<() => void>; let auth: MobileAuth;
const account = (id = 'account-a'): AuthSnapshot => ({ status: 'signed-in', user: { id, email: `${id}@example.test` }, error: null });
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
beforeEach(async () => {
  await AsyncStorage.clear(); snapshot = account(); listeners = new Set();
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
  jest.mocked(listStoryProjects).mockResolvedValue([project({ title: 'Cached list title' })]);
  jest.mocked(getStoryProject).mockResolvedValue(project());
  jest.mocked(updateStoryProject).mockResolvedValue(project({ title: 'Confirmed update', description: 'Updated description' }));
});
async function openDetails(language: Locale = 'en') {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = renderRouter(routes, { initialUrl: '/' });
  await screen.findByText('Cached list title');
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: Cached list title` }));
  await screen.findByText('Fresh selected title');
  return flow;
}
async function editAndSave(title = 'Draft corrected title') {
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), title);
  fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.descriptionLabel), 'Private pending draft');
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.save }));
  await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
}

it.each<Locale>(['en', 'sv'])('opens only fresh selected metadata in %s and returns to a newly fetched list', async language => {
  await openDetails(language);
  expect(screen.queryByText('Cached list title')).toBeNull();
  expect(screen.getByText('Private selected description')).toBeOnTheScreen();
  expect(getStoryProject).toHaveBeenCalledTimes(1);
  const call = jest.mocked(getStoryProject).mock.calls[0][0];
  expect(call.projectId).toBe(id); await call.getAccessToken();
  expect(auth.getAccessToken).toHaveBeenCalledWith('account-a');
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].back }));
  await screen.findByText('Cached list title'); expect(listStoryProjects).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Private selected description')).toBeNull();
  expect(updateStoryProject).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['checking', 'signed-out', 'busy', 'blocked'] as const)('cannot enter details, edit or request metadata for %s authentication', async status => {
  snapshot = { status, user: null, error: null };
  renderRouter(routes, { initialUrl: `/authenticated?projectId=${id}&edit=true` });
  await waitFor(() => expect(auth.restore).toHaveBeenCalled());
  expect(getStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(auth.getAccessToken).not.toHaveBeenCalled();
  expect(screen.queryByRole('header', { name: storyDetailsCopy.en.title })).toBeNull();
});

it('does not trust URL parameters to select metadata or trigger editing', async () => {
  renderRouter(routes, { initialUrl: `/authenticated?projectId=${id}&edit=true&title=Injected` });
  await screen.findByText('Cached list title');
  expect(getStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(storyDetailsCopy.en.titleLabel)).toBeNull();
});

it('ignores a malformed list selection before any detail request', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project({ id: '../private', title: 'Malformed synthetic row' })]);
  renderRouter(routes, { initialUrl: '/' }); await screen.findByText('Malformed synthetic row');
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: Malformed synthetic row` }));
  expect(getStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(screen.getByText('Malformed synthetic row')).toBeOnTheScreen();
});

it('shows only confirmed PATCH metadata and reloads the server list without optimistic insertion', async () => {
  await openDetails(); await editAndSave(); await screen.findByText(storyDetailsCopy.en.saved);
  expect(screen.getByText('Confirmed update')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.back }));
  await screen.findByText('Cached list title');
  expect(listStoryProjects).toHaveBeenCalledTimes(2); expect(screen.queryByText('Confirmed update')).toBeNull();
  expect(await AsyncStorage.getAllKeys()).toEqual([PREFERENCES_KEY]);
});

it('drops private drafts and cancels a pending PATCH immediately on Sign Out', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openDetails(); await editAndSave(); const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.signOut }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle }); expect(signal.aborted).toBe(true);
  expect(screen.queryByLabelText(storyDetailsCopy.en.titleLabel)).toBeNull();
  await act(async () => { finish(project({ title: 'Late private update' })); });
  expect(screen.queryByText('Late private update')).toBeNull(); expect(screen.queryByText(storyDetailsCopy.en.saved)).toBeNull();
});

it('cannot expose account A details or a late PATCH to account B', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openDetails(); await editAndSave(); const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  act(() => publish(account('account-b')));
  await screen.findByText('account-b@example.test'); expect(signal.aborted).toBe(true);
  expect(screen.queryByLabelText(storyDetailsCopy.en.titleLabel)).toBeNull();
  await act(async () => { finish(project({ title: 'Account A late update' })); });
  expect(screen.queryByText('Account A late update')).toBeNull();
  await screen.findByText('Cached list title');
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: Cached list title` }));
  await screen.findByText('Fresh selected title');
  await jest.mocked(getStoryProject).mock.calls[1][0].getAccessToken(); expect(auth.getAccessToken).toHaveBeenLastCalledWith('account-b');
});

it('cancels a pending GET and ignores private data when the session needs verification again', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(getStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  renderRouter(routes, { initialUrl: '/' }); await screen.findByText('Cached list title');
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: Cached list title` }));
  await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(getStoryProject).mock.calls[0][0].signal!;
  act(() => publish({ status: 'checking', user: null, error: null })); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project({ title: 'Late GET private metadata' })); });
  act(() => publish(account())); await screen.findByText('Cached list title');
  expect(screen.queryByText('Late GET private metadata')).toBeNull(); expect(updateStoryProject).not.toHaveBeenCalled();
});

it('cancels editing on native route blur and returns to a fresh list without replaying PATCH', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openDetails(); await editAndSave(); const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  act(() => router.push('/outside' as '/')); await screen.findByText('Another test route'); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project({ title: 'Unfocused late metadata' })); });
  act(() => router.back()); await screen.findByText('Cached list title');
  expect(screen.queryByText('Unfocused late metadata')).toBeNull(); expect(screen.queryByLabelText(storyDetailsCopy.en.titleLabel)).toBeNull();
  expect(updateStoryProject).toHaveBeenCalledTimes(1); expect(listStoryProjects).toHaveBeenCalledTimes(2);
});

it('reconciles an uncertain PATCH only through explicit cancellation and a fresh GET', async () => {
  jest.mocked(updateStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await openDetails(); await editAndSave(); await screen.findByText(storyDetailsCopy.en.uncertain);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.save })); expect(updateStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.cancel }));
  await screen.findByText('Fresh selected title'); expect(getStoryProject).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(storyDetailsCopy.en.saved)).toBeNull();
});

it('preserves cleanup-failure handling without showing the prior account or draft', async () => {
  await openDetails(); fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Private unfinished draft');
  jest.mocked(auth.signOut).mockImplementationOnce(async () => { publish({ status: 'blocked', user: null, error: 'cleanup' }); throw new AuthError('cleanup'); });
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.signOut })); await screen.findByText(authCopy.en.errors.cleanup);
  expect(screen.queryByLabelText(storyDetailsCopy.en.titleLabel)).toBeNull(); expect(screen.queryByText('Private selected description')).toBeNull();
});
