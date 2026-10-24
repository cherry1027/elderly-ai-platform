import { openMyStories, openSettings } from './root-shell-helpers';
import { listSessionTranscripts } from '../src/api/audio-transcripts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AppState, Text } from 'react-native';
import * as nativeRecorder from '../src/audio/native-recorder';
import type { RecordingDriver } from '../src/audio/native-recorder';
import { audioCopy } from '../src/audio/audio-copy';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { readMobileApiConfig } from '../src/api/config';
import {
  continueStoryProject, getStoryProject, listStoryProjects, listStorySessions, StoryProjectsError,
  type ConversationSession, type StoryContinuation, type StoryProject,
} from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
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
import { conversationCopy } from '../src/conversation-copy';
import { copy, type Language as Locale } from '../src/i18n';

jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn(async () => ({ messages: [], complete: true })) }));

jest.mock('../src/api/audio-transcripts', () => ({ ...jest.requireActual('../src/api/audio-transcripts'),
  listSessionTranscripts: jest.fn(async () => []) }));

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));

const routes = { _layout: RootLayout, index: Entry, language: Language, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm,
  outside: () => <Text>Another test route</Text> };
const id = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-20T12:00:00Z';
const project = (language: Locale = 'en'): StoryProject => ({ id, title: 'Fictional selected story',
  description: 'A fictional development description.', language, status: 'draft', created_at: timestamp, updated_at: timestamp });
const session = (language: Locale = 'en'): ConversationSession => ({ id: sessionId, project_id: id,
  language, status: 'active', created_at: timestamp, updated_at: timestamp, ended_at: null });
const continuation = (language: Locale = 'en'): StoryContinuation => ({ project_id: id, language,
  session: session(language), session_created: true, latest_draft: null, generation_triggered: false });
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
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_test_key_only' });
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockResolvedValue([project()]);
  jest.mocked(getStoryProject).mockResolvedValue(project());
  jest.mocked(listStorySessions).mockResolvedValue([]);
  jest.mocked(continueStoryProject).mockResolvedValue(continuation());
});

async function openDetails(language: Locale = 'en') {
  jest.mocked(listStoryProjects).mockResolvedValue([project(language)]);
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  jest.mocked(continueStoryProject).mockResolvedValue(continuation(language));
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const flow = renderRouter(routes, { initialUrl: '/' });
  await openMyStories(language);
  await screen.findByText('Fictional selected story');
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: Fictional selected story` }));
  await screen.findByRole('button', { name: storyDetailsCopy[language].conversation });
  return flow;
}
async function openConversation(language: Locale = 'en') {
  const flow = await openDetails(language);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].conversation }));
  return flow;
}

it.each<Locale>(['en', 'sv'])('requires an intentional details action before opening the %s session landing', async language => {
  await openDetails(language);
  expect(listStorySessions).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(listSessionTranscripts).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].conversation }));
  await screen.findByText(conversationCopy[language].ready);
  expect(screen.getByRole('header', { name: conversationCopy[language].title })).toBeOnTheScreen();
  expect(screen.getByText(conversationCopy[language].started)).toBeOnTheScreen();
  expect(screen.getByText(conversationCopy[language].scope)).toBeOnTheScreen();
  expect(continueStoryProject).toHaveBeenCalledTimes(1); expect(listStorySessions).toHaveBeenCalledTimes(1);
  expect(listSessionTranscripts).toHaveBeenCalledWith(expect.objectContaining({ sessionId, expectedLanguage: language }));
  const call = jest.mocked(continueStoryProject).mock.calls[0][0];
  expect(call.projectId).toBe(id); expect(call.expectedLanguage).toBe(language);
  await call.getAccessToken(); expect(auth.getAccessToken).toHaveBeenCalledWith('account-a');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each<Locale>(['en', 'sv'])('returns to fresh details then resumes the same %s session without another POST', async language => {
  await openConversation(language); await screen.findByText(conversationCopy[language].ready);
  jest.mocked(listStorySessions).mockResolvedValue([session(language)]);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy[language].back }));
  await screen.findByRole('button', { name: storyDetailsCopy[language].conversation });
  expect(getStoryProject).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].conversation }));
  await screen.findByText(conversationCopy[language].resumed);
  expect(continueStoryProject).toHaveBeenCalledTimes(1); expect(listStorySessions).toHaveBeenCalledTimes(2);
  expect(await AsyncStorage.getAllKeys()).toEqual([PREFERENCES_KEY]);
});

it('reconciles an ambiguous start through a read and resumes the saved session without repeating POST', async () => {
  jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await openConversation(); await screen.findByText(conversationCopy.en.uncertain);
  jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.check }));
  await screen.findByText(conversationCopy.en.resumed);
  expect(continueStoryProject).toHaveBeenCalledTimes(1); expect(listStorySessions).toHaveBeenCalledTimes(2);
});

it('cancels an in-flight continuation on Sign Out and ignores its late private result', async () => {
  let finish!: (value: StoryContinuation) => void;
  jest.mocked(continueStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openConversation(); await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.signOut }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle }); expect(signal.aborted).toBe(true);
  await act(async () => { finish(continuation()); });
  expect(screen.queryByText(conversationCopy.en.ready)).toBeNull();
  expect(screen.queryByText('Fictional selected story')).toBeNull();
});

it('drops a ready session when accounts change and requires account B to select its own story', async () => {
  await openConversation(); await screen.findByText(conversationCopy.en.ready);
  act(() => publish(account('account-b')));
  await openSettings(); await screen.findByText('account-b@example.test'); await openMyStories();
  expect(screen.queryByText(conversationCopy.en.ready)).toBeNull();
  expect(continueStoryProject).toHaveBeenCalledTimes(1); expect(listStorySessions).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: Fictional selected story` }));
  await screen.findByRole('button', { name: storyDetailsCopy.en.conversation });
  jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.conversation }));
  await screen.findByText(conversationCopy.en.resumed);
  const call = jest.mocked(listStorySessions).mock.calls[1][0];
  await call.getAccessToken(); expect(auth.getAccessToken).toHaveBeenLastCalledWith('account-b');
});

it('removes an in-flight session when foreground authentication needs verification again', async () => {
  let finish!: (value: StoryContinuation) => void;
  jest.mocked(continueStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openConversation(); await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  act(() => publish({ status: 'checking', user: null, error: null }));
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(continuation()); });
  expect(screen.queryByText(conversationCopy.en.ready)).toBeNull();
  act(() => publish(account())); await openMyStories(); await screen.findByText('Fictional selected story');
  expect(screen.queryByRole('header', { name: conversationCopy.en.title })).toBeNull();
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
});

it('cancels the session on native route blur and returns to the dashboard without replaying POST', async () => {
  let finish!: (value: StoryContinuation) => void;
  jest.mocked(continueStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openConversation(); await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  act(() => router.push('/outside' as '/')); await screen.findByText('Another test route');
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(continuation()); });
  act(() => router.back()); await openMyStories(); await screen.findByText('Fictional selected story');
  expect(screen.queryByText(conversationCopy.en.ready)).toBeNull();
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
});

it.each(['checking', 'signed-out', 'busy', 'blocked'] as const)('cannot trigger continuation through URL parameters for %s authentication', async status => {
  snapshot = { status, user: null, error: null };
  renderRouter(routes, { initialUrl: `/authenticated?projectId=${id}&sessionId=${sessionId}&continue=true` });
  await waitFor(() => expect(auth.restore).toHaveBeenCalled());
  expect(getStoryProject).not.toHaveBeenCalled(); expect(listStorySessions).not.toHaveBeenCalled();
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(auth.getAccessToken).not.toHaveBeenCalled();
});

it('does not treat restored-route or URL parameters as conversation intent for a verified account', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
  renderRouter(routes, { initialUrl: `/authenticated?projectId=${id}&sessionId=${sessionId}&continue=true` });
  await openMyStories(); await screen.findByText('Fictional selected story');
  expect(getStoryProject).not.toHaveBeenCalled(); expect(listStorySessions).not.toHaveBeenCalled();
  expect(continueStoryProject).not.toHaveBeenCalled();
});

it('keeps SAMPLE STORIES navigation separate from real authentication and continuation endpoints', async () => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(true);
  render(<RootLayout />);
  expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'View sample stories' }));
  fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: A made-up summer memory` }));
  await screen.findByRole('header', { name: storyDetailsCopy.en.title });
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.conversation })).toBeNull();
  expect(createMobileAuth).not.toHaveBeenCalled(); expect(getStoryProject).not.toHaveBeenCalled();
  expect(listStorySessions).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('preserves auth/onboarding while a first iOS permission popup unmounts the conversation, then records on a fresh explicit attempt', async () => {
  const activeListeners = new Set<(value: string) => void>();
  const originalState = AppState.currentState;
  const changes = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    const listener = callback as (value: string) => void;
    if (event === 'change') activeListeners.add(listener);
    return { remove: () => { activeListeners.delete(listener); } };
  });
  const publishState = (value: 'active' | 'inactive') => {
    AppState.currentState = value;
    act(() => { [...activeListeners].forEach(listener => listener(value)); });
  };
  let grant!: (value: boolean) => void;
  const permission = new Promise<boolean>(resolve => { grant = resolve; });
  const first: RecordingDriver = {
    requestPermission: jest.fn(() => permission), start: jest.fn(async () => {}),
    stop: jest.fn(async () => { throw new Error('Synthetic test does not stop a file.'); }),
    getStatus: () => ({ isRecording: true, durationMs: 1000, interrupted: false }),
    discard: jest.fn(async () => {}), dispose: jest.fn(async () => {}),
  };
  const next: RecordingDriver = { ...first, requestPermission: jest.fn(async () => true),
    start: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
  const create = jest.spyOn(nativeRecorder, 'createNativeRecorder').mockReturnValueOnce(first).mockReturnValue(next);
  try {
    AppState.currentState = 'active';
    await openConversation(); await screen.findByText(conversationCopy.en.ready);
    const preferencesBefore = await AsyncStorage.getItem(PREFERENCES_KEY);
    fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await waitFor(() => expect(first.requestPermission).toHaveBeenCalledTimes(1));
    expect(first.start).not.toHaveBeenCalled();
    publishState('inactive');
    expect(first.dispose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: audioCopy.en.stop })).toBeNull();
    await act(async () => grant(true));
    expect(first.start).not.toHaveBeenCalled();
    jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
    publishState('active');
    await openMyStories();
    await screen.findByText('Fictional selected story');
    expect(next.start).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.openStory + ': Fictional selected story' }));
    await screen.findByRole('button', { name: storyDetailsCopy.en.conversation });
    fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.conversation }));
    await screen.findByText(conversationCopy.en.resumed);
    fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await screen.findByRole('button', { name: audioCopy.en.stop });
    expect(first.start).not.toHaveBeenCalled(); expect(next.start).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBe(preferencesBefore);
    expect(continueStoryProject).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    changes.mockRestore(); create.mockRestore(); AppState.currentState = originalState;
  }
});
