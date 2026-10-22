import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AppState, BackHandler, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import {
  continueStoryProject, getStoryProject, listStoryProjects, listStorySessions,
  type StoryProject, type ConversationSession,
} from '../src/api/story-projects';
import { listStoryDrafts, getStoryDraft, getStoryVerification, generateStoryDraft,
  type StoryDraft, type StoryProjectVerification } from '../src/api/story-drafts';
import { listMemoryReview, patchMemory } from '../src/api/memory-review';
import { listConversationMessages } from '../src/api/conversation-messages';
import { listSessionTranscripts } from '../src/api/audio-transcripts';
import RootLayout from '../src/app/_layout';
import Entry from '../src/app/index';
import LanguageScreen from '../src/app/language';
import Introduction from '../src/app/introduction';
import Welcome from '../src/app/welcome';
import Login from '../src/app/login';
import Authenticated from '../src/app/authenticated';
import Register from '../src/app/register';
import Confirm from '../src/app/auth/confirm';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';
import { storiesCopy } from '../src/stories-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { conversationCopy } from '../src/conversation-copy';
import { copy, type Language } from '../src/i18n';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  listStoryDrafts: jest.fn(), getStoryDraft: jest.fn(), getStoryVerification: jest.fn(), generateStoryDraft: jest.fn() }));
jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'),
  listMemoryReview: jest.fn(), patchMemory: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn() }));
jest.mock('../src/api/audio-transcripts', () => ({ ...jest.requireActual('../src/api/audio-transcripts'),
  listSessionTranscripts: jest.fn() }));

const routes = { _layout: RootLayout, index: Entry, language: LanguageScreen, introduction: Introduction,
  welcome: Welcome, login: Login, authenticated: Authenticated, register: Register, 'auth/confirm': Confirm,
  outside: () => <Text>Another synthetic route</Text> };
const projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001';
const actionKey = '30000000-0000-4000-8000-000000000001';
const otherKey = '30000000-0000-4000-8000-000000000002';
const sessionId = '60000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const title = 'Fictional generation routing story';
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title,
  description: 'Synthetic development description.', language, status: 'draft', created_at: stamp, updated_at: stamp });
const session = (language: Language = 'en'): ConversationSession => ({ id: sessionId, project_id: projectId,
  language, status: 'active', created_at: stamp, updated_at: stamp, ended_at: null });
const draft = (language: Language = 'en'): StoryDraft => {
  const content = language === 'en' ? 'I grew up in Malmö.' : 'Jag växte upp i Malmö.';
  return {
    draft_id: draftId, project_id: projectId, status: 'ready_for_review', language, style: 'warm',
    version: 1, revision: 1, content, original_content: content, mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
      evidence: content.slice(0, -1), corrected_value: null, year: null, slot: 'grew_up_location', sentence: content }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
      checked_revision: 1, checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp,
  };
};
const report = (value: StoryDraft | null = null): StoryProjectVerification => value
  ? { project_id: value.project_id, draft_id: value.draft_id, version: value.version,
    revision: value.revision, verification: value.verification }
  : { project_id: projectId, draft_id: null, version: null, revision: null, verification: {
    status: 'not_generated', unsupported_claims: [], method: 'none', checked_revision: null,
    checked_at: null, sources_current: false, reason: null } };
let snapshot: AuthSnapshot;
let listeners: Set<() => void>;
let auth: MobileAuth;
const account = (id = 'account-a'): AuthSnapshot => ({ status: 'signed-in',
  user: { id, email: id + '@example.test' }, error: null });
function publish(next: AuthSnapshot) { snapshot = next; listeners.forEach(listener => listener()); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function saved(language: Language = 'en') {
  const value = draft(language);
  jest.mocked(listStoryDrafts).mockResolvedValue([value]);
  jest.mocked(getStoryDraft).mockResolvedValue(value);
  jest.mocked(getStoryVerification).mockResolvedValue(report(value));
  return value;
}
beforeEach(async () => {
  await AsyncStorage.clear();
  snapshot = account(); listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  auth = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: jest.fn(async () => {}),
    getAccessToken: jest.fn(async owner => snapshot.status === 'signed-in' && snapshot.user?.id === owner
      ? 'synthetic-token-' + owner : null),
    signIn: jest.fn(async () => publish(account())),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn(), dispose: jest.fn(),
  };
  jest.mocked(createMobileAuth).mockReturnValue(auth);
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co',
    publishableKey: 'sb_publishable_synthetic_test_key_only' });
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(listStoryProjects).mockResolvedValue([project()]);
  jest.mocked(getStoryProject).mockResolvedValue(project());
  jest.mocked(listStorySessions).mockResolvedValue([session()]);
  jest.mocked(listStoryDrafts).mockResolvedValue([]);
  jest.mocked(getStoryDraft).mockResolvedValue(draft());
  jest.mocked(getStoryVerification).mockResolvedValue(report());
  jest.mocked(generateStoryDraft).mockResolvedValue(draft());
  jest.mocked(listMemoryReview).mockResolvedValue({ memories: [], clarifications: [], complete: true });
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [], complete: true });
  jest.mocked(listSessionTranscripts).mockResolvedValue([]);
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValueOnce(actionKey).mockReturnValue(otherKey);
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
async function selectStory(language: Language = 'en') {
  await screen.findByText(title);
  fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].openStory + ': ' + title }));
  await screen.findByRole('button', { name: storyDetailsCopy[language].generate });
}
async function openGeneration(language: Language = 'en') {
  jest.mocked(listStoryProjects).mockResolvedValue([project(language)]);
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  jest.mocked(listStorySessions).mockResolvedValue([session(language)]);
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
  const view = renderRouter(routes, { initialUrl: '/' });
  await selectStory(language);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].generate }));
  await screen.findByRole('button', { name: storyGenerationCopy[language].generate });
  return view;
}
async function confirmGeneration(language: Language = 'en') {
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].generate }));
  await screen.findByRole('button', { name: storyGenerationCopy[language].confirm });
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].confirm }));
  await waitFor(() => expect(generateStoryDraft).toHaveBeenCalledTimes(1));
}
async function reopenGeneration(language: Language = 'en') {
  await selectStory(language);
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].generate }));
  await screen.findByRole('header', { name: storyGenerationCopy[language].title });
}

it.each<Language>(['en', 'sv'])('requires intentional navigation and explicit confirmation in %s, then reopens only backend data', async language => {
  await openGeneration(language);
  expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
  expect(listStoryDrafts).toHaveBeenCalledTimes(1);
  const first = jest.mocked(listStoryDrafts).mock.calls[0][0];
  expect(first).toMatchObject({ projectId, expectedLanguage: language });
  await first.getAccessToken(); expect(auth.getAccessToken).toHaveBeenLastCalledWith('account-a');

  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].generate }));
  await screen.findByRole('button', { name: storyGenerationCopy[language].confirm });
  expect(generateStoryDraft).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].cancel }));
  expect(generateStoryDraft).not.toHaveBeenCalled();
  const value = saved(language);
  jest.mocked(generateStoryDraft).mockResolvedValue(value);
  await confirmGeneration(language);
  await screen.findByText(storyGenerationCopy[language].saved);
  expect(screen.getByText(value.content)).toBeOnTheScreen();
  expect(screen.getByText(storyGenerationCopy[language].simulation)).toBeOnTheScreen();
  expect(jest.mocked(generateStoryDraft).mock.calls[0][0]).toMatchObject({
    projectId, expectedLanguage: language, idempotencyKey: actionKey,
    input: { language, style: 'warm', confirm_generation: true },
  });
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].refresh }));
  await screen.findByText(value.content);
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].back }));
  await screen.findByRole('button', { name: storyDetailsCopy[language].generate });
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[language].generate }));
  await screen.findByText(value.content);
  expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(continueStoryProject).not.toHaveBeenCalled();
  expect(await AsyncStorage.getAllKeys()).toEqual([PREFERENCES_KEY]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('opens existing %s memory review through read-only session retrieval', async language => {
  await openGeneration(language);
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].review }));
  await screen.findByRole('header', { name: memoryReviewCopy[language].title });
  await screen.findByText(memoryReviewCopy[language].empty);
  expect(listStorySessions).toHaveBeenCalledTimes(1);
  expect(listMemoryReview).toHaveBeenCalledWith(expect.objectContaining({ projectId, sessionId, expectedLanguage: language }));
  expect(listConversationMessages).toHaveBeenCalledWith(expect.objectContaining({ sessionId, expectedLanguage: language }));
  expect(continueStoryProject).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
  expect(listSessionTranscripts).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].back }));
  await screen.findByRole('button', { name: storyDetailsCopy[language].generate });
  expect(listSessionTranscripts).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
});

it('does not create a session when generation review navigation finds none', async () => {
  await openGeneration();
  jest.mocked(listStorySessions).mockResolvedValue([]);
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.review }));
  await screen.findByText(conversationCopy.en.errors['not-found']);
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(listMemoryReview).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('sign-out aborts pending generation, clears private data and ignores the late result', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  await openGeneration(); await confirmGeneration();
  const signal = jest.mocked(generateStoryDraft).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.signOut }));
  await screen.findByRole('header', { name: copy.en.welcomeTitle });
  expect(signal.aborted).toBe(true); expect(auth.signOut).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(draft()));
  expect(screen.queryByText(draft().content)).toBeNull();
  expect(screen.queryByText(storyGenerationCopy.en.saved)).toBeNull();
  expect(listStoryDrafts).toHaveBeenCalledTimes(1);
});

it('account B cannot receive account A pending draft or reuse its generation action', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  await openGeneration(); await confirmGeneration();
  const signal = jest.mocked(generateStoryDraft).mock.calls[0][0].signal!;
  act(() => publish(account('account-b')));
  await screen.findByText('account-b@example.test'); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(draft()));
  expect(screen.queryByText(draft().content)).toBeNull();
  await reopenGeneration();
  await screen.findByRole('button', { name: storyGenerationCopy.en.generate });
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.retry })).toBeNull();
  saved(); jest.mocked(generateStoryDraft).mockResolvedValue(draft());
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.generate }));
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.confirm }));
  await screen.findByText(storyGenerationCopy.en.saved);
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(otherKey);
  await jest.mocked(generateStoryDraft).mock.calls[1][0].getAccessToken();
  expect(auth.getAccessToken).toHaveBeenLastCalledWith('account-b');
});

it('same-account authentication revalidation hides private view but retains exact pending UUID through RootLayout', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  await openGeneration(); await confirmGeneration();
  const original = jest.mocked(generateStoryDraft).mock.calls[0][0];
  act(() => publish({ status: 'checking', user: null, error: null }));
  expect(original.signal!.aborted).toBe(true);
  expect(screen.queryByRole('header', { name: storyGenerationCopy.en.title })).toBeNull();
  act(() => publish(account())); await reopenGeneration();
  await screen.findByRole('button', { name: storyGenerationCopy.en.retry });
  expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(storyGenerationCopy.en.saved)).toBeNull();
  saved();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.retry }));
  await screen.findByText(storyGenerationCopy.en.saved);
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(original.idempotencyKey);
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0].input).toEqual(original.input);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(draft()));
});

it('native route blur cancels a pending write and reopens through GET before same-action retry', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  await openGeneration(); await confirmGeneration();
  const original = jest.mocked(generateStoryDraft).mock.calls[0][0];
  act(() => router.push('/outside' as '/')); await screen.findByText('Another synthetic route');
  expect(original.signal!.aborted).toBe(true);
  await act(async () => pending.resolve(draft()));
  act(() => router.back()); await reopenGeneration();
  await screen.findByRole('button', { name: storyGenerationCopy.en.retry });
  expect(generateStoryDraft).toHaveBeenCalledTimes(1); saved();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.retry }));
  await screen.findByText(storyGenerationCopy.en.saved);
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(original.idempotencyKey);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});

it('actual AuthProvider background unmount retains metadata and foreground never automatically regenerates', async () => {
  const callbacks = new Set<(value: string) => void>();
  const previous = AppState.currentState;
  const change = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    const callback = listener as (value: string) => void;
    if (event === 'change') callbacks.add(callback);
    return { remove: () => { callbacks.delete(callback); } };
  });
  const state = (value: 'active' | 'inactive') => {
    AppState.currentState = value; act(() => [...callbacks].forEach(callback => callback(value)));
  };
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  try {
    AppState.currentState = 'active'; await openGeneration(); await confirmGeneration();
    const original = jest.mocked(generateStoryDraft).mock.calls[0][0];
    state('inactive'); expect(original.signal!.aborted).toBe(true);
    expect(screen.queryByRole('header', { name: storyGenerationCopy.en.title })).toBeNull();
    state('active'); await reopenGeneration();
    await screen.findByRole('button', { name: storyGenerationCopy.en.retry });
    expect(generateStoryDraft).toHaveBeenCalledTimes(1); expect(auth.signOut).not.toHaveBeenCalled();
    saved(); fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.retry }));
    await screen.findByText(storyGenerationCopy.en.saved);
    expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(original.idempotencyKey);
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(draft()));
  } finally { cleanup(); change.mockRestore(); AppState.currentState = previous; }
});

it.each(['checking', 'signed-out', 'busy', 'blocked'] as const)('cannot enter generation from URL parameters while %s', async status => {
  snapshot = { status, user: null, error: null };
  renderRouter(routes, { initialUrl: '/authenticated?projectId=' + projectId + '&generate=true&confirm_generation=true' });
  await waitFor(() => expect(auth.restore).toHaveBeenCalled());
  expect(listStoryDrafts).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(getStoryProject).not.toHaveBeenCalled(); expect(Crypto.randomUUID).not.toHaveBeenCalled();
});

it('verified restored URL parameters cannot select a story or approve generation', async () => {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
  renderRouter(routes, { initialUrl: '/authenticated?projectId=' + projectId + '&generate=true&confirm_generation=true' });
  await screen.findByText(title);
  expect(getStoryProject).not.toHaveBeenCalled(); expect(listStoryDrafts).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(Crypto.randomUUID).not.toHaveBeenCalled();
});

it('SAMPLE STORIES cannot enter saved draft generation or create authentication services', async () => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(true);
  render(<RootLayout />);
  expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'View sample stories' }));
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.openStory + ': A made-up summer memory' }));
  await screen.findByRole('header', { name: storyDetailsCopy.en.title });
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.generate })).toBeNull();
  expect(createMobileAuth).not.toHaveBeenCalled(); expect(listStoryDrafts).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
