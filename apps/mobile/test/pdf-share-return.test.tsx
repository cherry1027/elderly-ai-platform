import { getComponent, maybeComponent } from './component-probe';
import { HomeScreen } from '../src/screens/HomeScreen';
import { useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import { StoriesHome } from '../src/stories/StoriesHome';
import { StoryDashboard } from '../src/stories/StoryDashboard';
import { GenerateStory } from '../src/generation/GenerateStory';
import { PreferenceLoading } from '../src/components/PreferenceLoading';
import { usePdfPrivacy, type PdfPrivacyValue } from '../src/exports/PdfPrivacy';
import { readMobileApiConfig } from '../src/api/config';
import { getStoryProject, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';

jest.mock('../src/screens/HomeScreen', () => { const actual = jest.requireActual<typeof import('../src/screens/HomeScreen')>('../src/screens/HomeScreen'); return { ...actual, HomeScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.HomeScreen) }; });
jest.mock('../src/components/PreferenceLoading', () => { const actual = jest.requireActual<typeof import('../src/components/PreferenceLoading')>('../src/components/PreferenceLoading'); return { ...actual, PreferenceLoading: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.PreferenceLoading) }; });
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), getStoryProject: jest.fn() }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
jest.mock('../src/generation/GenerateStory', () => ({ GenerateStory: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/stories/StoryDashboard', () => ({ StoryDashboard: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/stories/StoryDetails', () => ({ StoryDetails: jest.fn(() => null) }));
jest.mock('../src/stories/CreateStory', () => ({ CreateStory: jest.fn(() => null) }));
jest.mock('../src/stories/Conversation', () => ({ Conversation: jest.fn(() => null) }));

const ownerA = '16000000-0000-4000-8000-000000000001', ownerB = '16000000-0000-4000-8000-000000000002';
const projectId = '17000000-0000-4000-8000-000000000001', draftId = '18000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T10:00:00Z';
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title: language === 'sv' ? 'Fiktiva minnen från Malmö' : 'Fictional memories',
  description: null, language, status: 'draft', created_at: stamp, updated_at: stamp });
const token = jest.fn(async (_owner: string) => 'synthetic-development-user-token'), signOut = jest.fn();
const consume = jest.fn<ReturnType<PdfPrivacyValue['consumeReturn']>, Parameters<PdfPrivacyValue['consumeReturn']>>(), focusCleanups = new Set<() => void>();
function props(language: Language = 'en', owner = ownerA) { return { language, user: { id: owner, email: 'fictional@example.test' }, getAccessToken: token, onSignOut: signOut, onSelectLanguage: jest.fn(), onReplayIntroduction: jest.fn() }; }
function useMockFocus(callback: () => void | (() => void)) {
  useEffect(() => {
    const close = callback(); if (close) focusCleanups.add(close);
    return () => { if (close) { focusCleanups.delete(close); close(); } };
  }, [callback]);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function settle() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  focusCleanups.clear(); token.mockClear(); signOut.mockClear();
  jest.mocked(useFocusEffect).mockImplementation(useMockFocus);
  consume.mockReset().mockReturnValue(null);
  jest.mocked(usePdfPrivacy).mockReturnValue({ consumeReturn: consume } as unknown as PdfPrivacyValue);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(getStoryProject).mockReset().mockResolvedValue(project());
  jest.mocked(GenerateStory).mockClear(); jest.mocked(StoryDashboard).mockClear();
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each<Language>(['en', 'sv'])('restores the exact selected %s draft only after a fresh authenticated owned-project read', async language => {
  const saved = project(language); consume.mockReturnValueOnce({ projectId, draftId });
  jest.mocked(getStoryProject).mockResolvedValueOnce(saved);
  await render(<StoriesHome {...props(language)} />);
  await waitFor(() => expect(getComponent(GenerateStory).props.initialDraftId).toBe(draftId));
  const request = jest.mocked(getStoryProject).mock.calls[0][0];
  expect(request).toMatchObject({ baseUrl: 'http://192.168.20.30:8000', projectId });
  expect(request).not.toHaveProperty('userId'); await request.getAccessToken(); expect(token).toHaveBeenLastCalledWith(ownerA);
  expect(consume).toHaveBeenCalledWith(ownerA); expect(getStoryProject).toHaveBeenCalledTimes(1);
  expect(getComponent(GenerateStory).props).toMatchObject({ language, user: { id: ownerA }, project: saved, initialDraftId: draftId });
  expect(getComponent(GenerateStory).props).not.toHaveProperty('content');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('has the ordinary Home with no private return hint and makes no extra project request', async () => {
  await render(<StoriesHome {...props()} />); await settle();
  expect(getComponent(HomeScreen)).toBeDefined(); expect(maybeComponent(GenerateStory)).toBeNull();
  expect(getStoryProject).not.toHaveBeenCalled(); expect(consume).toHaveBeenCalledTimes(1);
});

it('does not invent a backend address or restore a draft when local API configuration is absent', async () => {
  consume.mockReturnValueOnce({ projectId, draftId }); jest.mocked(readMobileApiConfig).mockReturnValue(null);
  await render(<StoriesHome {...props()} />); await settle();
  expect(getComponent(HomeScreen)).toBeDefined(); expect(getStoryProject).not.toHaveBeenCalled();
  expect(maybeComponent(GenerateStory)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('does not expose a draft while its fresh project ownership check remains unresolved', async () => {
  consume.mockReturnValueOnce({ projectId, draftId }); const pending = deferred<StoryProject>();
  jest.mocked(getStoryProject).mockReturnValueOnce(pending.promise); await render(<StoriesHome {...props()} />);
  await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  expect(getComponent(PreferenceLoading)).toBeDefined(); expect(maybeComponent(GenerateStory)).toBeNull();
  expect(maybeComponent(StoryDashboard)).toBeNull(); await act(async () => pending.resolve(project()));
  await waitFor(() => expect(getComponent(GenerateStory).props.initialDraftId).toBe(draftId));
});

it.each(['authentication', 'forbidden', 'not-found', 'network', 'timeout', 'invalid-response'] as const)('does not fake a restored story after %s read failure', async kind => {
  consume.mockReturnValueOnce({ projectId, draftId }); jest.mocked(getStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind));
  await render(<StoriesHome {...props()} />); await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getComponent(HomeScreen)).toBeDefined());
  expect(maybeComponent(GenerateStory)).toBeNull(); expect(screen.queryByText(project().title)).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('unmounting for sign-out aborts the restore read and ignores its late private response', async () => {
  consume.mockReturnValueOnce({ projectId, draftId }); const pending = deferred<StoryProject>();
  jest.mocked(getStoryProject).mockReturnValueOnce(pending.promise);
  const view = await render(<StoriesHome {...props()} />); await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(getStoryProject).mock.calls[0][0].signal!; await view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(project()));
  // RNTL 14 rejects post-unmount snapshots instead of returning null.
  expect(maybeComponent(GenerateStory)).toBeNull(); expect(maybeComponent(PreferenceLoading)).toBeNull();
  expect(() => view.toJSON()).toThrow(/unmounted/); expect(GenerateStory).not.toHaveBeenCalled();
});

it('an account switch aborts account A restoration and leaves account B on its own Home', async () => {
  consume.mockImplementation(owner => owner === ownerA ? { projectId, draftId } : null);
  const pending = deferred<StoryProject>(); jest.mocked(getStoryProject).mockReturnValueOnce(pending.promise);
  const view = await render(<StoriesHome {...props()} />); await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(getStoryProject).mock.calls[0][0].signal!;
  await view.rerender(<StoriesHome {...props('sv', ownerB)} />); await settle(); expect(signal.aborted).toBe(true);
  expect(consume).toHaveBeenLastCalledWith(ownerB); expect(getComponent(HomeScreen).props.language).toBe('sv');
  await act(async () => pending.resolve(project())); expect(maybeComponent(GenerateStory)).toBeNull();
  expect(getStoryProject).toHaveBeenCalledTimes(1); expect(getComponent(HomeScreen).props.language).toBe('sv');
});

it('losing route focus cannot resurrect the generation screen when the pending project read finishes', async () => {
  consume.mockReturnValueOnce({ projectId, draftId }); const pending = deferred<StoryProject>();
  jest.mocked(getStoryProject).mockReturnValueOnce(pending.promise); await render(<StoriesHome {...props()} />);
  await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  await act(() => { for (const close of [...focusCleanups]) close(); });
  await act(async () => pending.resolve(project())); expect(maybeComponent(GenerateStory)).toBeNull();
  expect(getComponent(PreferenceLoading)).toBeDefined();
});

it('passes working Sign Out through the restored saved-draft view without another story mutation', async () => {
  consume.mockReturnValueOnce({ projectId, draftId }); await render(<StoriesHome {...props()} />);
  await waitFor(() => expect(getComponent(GenerateStory).props.initialDraftId).toBe(draftId));
  await act(() => getComponent(GenerateStory).props.onSignOut()); expect(signOut).toHaveBeenCalledTimes(1);
  expect(getStoryProject).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
});
