import { requireCallback } from './root-shell-helpers';
import { getComponent, maybeComponent } from './component-probe';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StoriesHome } from '../src/stories/StoriesHome';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { RootTabBar } from '../src/components/RootTabBar';
import { CreateStory } from '../src/stories/CreateStory';
import { StoryDetails } from '../src/stories/StoryDetails';
import { Conversation } from '../src/stories/Conversation';
import { GenerateStory } from '../src/generation/GenerateStory';
import { PreferenceLoading } from '../src/components/PreferenceLoading';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, getStoryProject, createStoryProject, updateStoryProject,
  continueStoryProject, type StoryProject } from '../src/api/story-projects';
import { generateStoryDraft } from '../src/api/story-drafts';
import { patchMemory } from '../src/api/memory-review';
import { usePdfPrivacy, type PdfPrivacyValue } from '../src/exports/PdfPrivacy';
import { rootNavigationCopy, type RootTab } from '../src/root-navigation-copy';
import { storiesCopy } from '../src/stories-copy';
import type { Language } from '../src/i18n';

jest.mock('../src/screens/HomeScreen', () => { const actual = jest.requireActual<typeof import('../src/screens/HomeScreen')>('../src/screens/HomeScreen'); return { ...actual, HomeScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.HomeScreen) }; });
jest.mock('../src/components/PreferenceLoading', () => { const actual = jest.requireActual<typeof import('../src/components/PreferenceLoading')>('../src/components/PreferenceLoading'); return { ...actual, PreferenceLoading: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.PreferenceLoading) }; });
jest.mock('../src/components/RootTabBar', () => { const actual = jest.requireActual<typeof import('../src/components/RootTabBar')>('../src/components/RootTabBar'); return { ...actual, RootTabBar: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.RootTabBar) }; });
jest.mock('../src/screens/SettingsScreen', () => { const actual = jest.requireActual<typeof import('../src/screens/SettingsScreen')>('../src/screens/SettingsScreen'); return { ...actual, SettingsScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.SettingsScreen) }; });
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), createStoryProject: jest.fn(),
  updateStoryProject: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'), generateStoryDraft: jest.fn() }));
jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'), patchMemory: jest.fn() }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
// Existing domain controller suites retain the real recording/editor/review guards.
// These boundaries isolate whether the root coordinator can bypass those controllers.
jest.mock('../src/stories/CreateStory', () => ({ CreateStory: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/stories/StoryDetails', () => ({ StoryDetails: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/stories/Conversation', () => ({ Conversation: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/generation/GenerateStory', () => ({ GenerateStory: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));

const ownerA = '16000000-0000-4000-8000-000000000001', ownerB = '16000000-0000-4000-8000-000000000002';
const projectId = '17000000-0000-4000-8000-000000000001', draftId = '18000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T10:00:00Z';
const project = (title = 'Owned fictional story', language: Language = 'en'): StoryProject => ({ id: projectId,
  title, description: null, language, status: 'draft', created_at: stamp, updated_at: stamp });
const token = jest.fn(async (_owner: string) => 'synthetic-development-user-token');
const signOut = jest.fn(), selectLanguage = jest.fn(), replay = jest.fn<boolean | void, []>();
const consume = jest.fn<ReturnType<PdfPrivacyValue['consumeReturn']>, Parameters<PdfPrivacyValue['consumeReturn']>>();
const focusCleanups = new Set<() => void>();
type BackCallback = Parameters<typeof BackHandler.addEventListener>[1];
let backCallbacks: Set<BackCallback>;
function useMockFocus(callback: () => void | (() => void)) {
  useEffect(() => { const close = callback(); if (close) focusCleanups.add(close);
    return () => { if (close) { focusCleanups.delete(close); close(); } }; }, [callback]);
}
const props = (language: Language = 'en', owner = ownerA) => ({ language, user: { id: owner, email: `${owner}@example.test` },
  getAccessToken: token, onSignOut: signOut, onSelectLanguage: selectLanguage, onReplayIntroduction: replay });
const tabs = () => getComponent(RootTabBar).props as { tab: RootTab; onSelectTab: (tab: RootTab) => void };
async function settle() { await act(async () => { await Promise.resolve(); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function noWrites() {
  expect(createStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(patchMemory).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
}
beforeEach(() => {
  focusCleanups.clear(); backCallbacks = new Set(); token.mockClear(); signOut.mockClear(); selectLanguage.mockClear(); replay.mockReset();
  consume.mockReset().mockReturnValue(null); jest.mocked(useFocusEffect).mockImplementation(useMockFocus);
  jest.mocked(usePdfPrivacy).mockReturnValue({ consumeReturn: consume } as unknown as PdfPrivacyValue);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockReset().mockResolvedValue([project()]);
  jest.mocked(getStoryProject).mockReset().mockResolvedValue(project());
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    backCallbacks.add(listener); return { remove: () => { backCallbacks.delete(listener); } };
  });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each<Language>(['en', 'sv'])('opens calm %s Home with no private project/token read', async language => {
  await render(<StoriesHome {...props(language)} />); await settle();
  expect(screen.getByRole('header', { name: rootNavigationCopy[language].homeTitle })).toBeOnTheScreen();
  expect(tabs().tab).toBe('home'); expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.queryByText(project().title)).toBeNull(); expect(screen.queryByText(`${ownerA}@example.test`)).toBeNull();
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(getStoryProject).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled(); noWrites();
});
it.each<Language>(['en', 'sv'])('uses the existing authenticated list after explicit %s navigation and ignores repeated tab taps', async language => {
  await render(<StoriesHome {...props(language)} />); await settle();
  await fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy[language].openStories }));
  await screen.findByText(project().title); expect(tabs().tab).toBe('stories'); expect(listStoryProjects).toHaveBeenCalledTimes(1);
  const current = tabs().onSelectTab; await act(() => { current('stories'); current('stories'); }); await settle();
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
  const request = jest.mocked(listStoryProjects).mock.calls[0][0]; await request.getAccessToken();
  expect(token).toHaveBeenLastCalledWith(ownerA); expect(request).not.toHaveProperty('userId'); noWrites();
});
it.each<Language>(['en', 'sv'])('keeps %s Settings functional without reading projects or mutating story language', async language => {
  const view = await render(<StoriesHome {...props(language)} />); await settle(); await act(() => tabs().onSelectTab('settings'));
  const settings = getComponent(SettingsScreen).props;
  expect(settings).toMatchObject({ user: { id: ownerA } }); expect(tabs().tab).toBe('settings');
  await act(() => settings.onSelectLanguage(language === 'en' ? 'sv' : 'en'));
  expect(selectLanguage).toHaveBeenCalledWith(language === 'en' ? 'sv' : 'en');
  await view.rerender(<StoriesHome {...props(language === 'en' ? 'sv' : 'en')} />); await settle();
  expect(tabs().tab).toBe('settings'); expect(listStoryProjects).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(project().language).toBe('en'); noWrites();
});
it.each<Language>(['en', 'sv'])('returns %s Create to a freshly read My Stories, with hidden tabs and no optimistic insertion', async language => {
  await render(<StoriesHome {...props(language)} />); await settle(); const oldTabs = tabs().onSelectTab;
  const home = getComponent(HomeScreen).props;
  await act(() => home.onCreateStory()); expect(maybeComponent(RootTabBar)).toBeNull();
  await act(() => { oldTabs('settings'); oldTabs('stories'); home.onOpenStories(); });
  expect(getComponent(CreateStory)).toBeDefined(); expect(listStoryProjects).not.toHaveBeenCalled();
  await act(() => getComponent(CreateStory).props.onBack()); await screen.findByText(project().title);
  expect(tabs().tab).toBe('stories'); expect(listStoryProjects).toHaveBeenCalledTimes(1); noWrites();
});
it.each<Language>(['en', 'sv'])('preserves %s nested details/recording/review/editor/generation boundaries against obsolete root actions', async language => {
  await render(<StoriesHome {...props(language)} />); await settle();
  const home = getComponent(HomeScreen).props, oldTabs = tabs().onSelectTab;
  await act(() => home.onOpenStories()); await screen.findByText(project().title);
  const listTabs = tabs().onSelectTab;
  await fireEvent.press(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: ${project().title}` }));
  const details = getComponent(StoryDetails).props;
  expect(maybeComponent(RootTabBar)).toBeNull();
  await act(() => { oldTabs('home'); listTabs('settings'); home.onCreateStory(); });
  expect(getComponent(StoryDetails)).toBeDefined();
  await act(() => requireCallback(details.onConversation)(project())); const conversation = getComponent(Conversation).props;
  await act(() => { oldTabs('home'); listTabs('stories'); home.onOpenStories(); details.onBack(); });
  expect(getComponent(Conversation)).toBeDefined(); expect(maybeComponent(RootTabBar)).toBeNull();
  await act(() => conversation.onBack()); await act(() => requireCallback(getComponent(StoryDetails).props.onGenerate)(project()));
  const generation = getComponent(GenerateStory).props;
  await act(() => { oldTabs('settings'); listTabs('home'); home.onCreateStory(); });
  expect(getComponent(GenerateStory)).toBeDefined(); expect(maybeComponent(RootTabBar)).toBeNull();
  await act(() => requireCallback(generation.onReviewMemories)(draftId)); expect(getComponent(Conversation).props.reviewOnOpen).toBe(true);
  await act(() => { oldTabs('home'); listTabs('settings'); generation.onBack(); });
  expect(getComponent(Conversation).props).not.toHaveProperty('returnDraftId');
  expect(getComponent(Conversation).props.backLabel).toBeDefined();
  await act(() => getComponent(Conversation).props.onBack());
  expect(getComponent(GenerateStory).props.initialDraftId).toBe(draftId); noWrites();
});
it.each<Language>(['en', 'sv'])('fences %s root callbacks immediately during same-tick navigation', async language => {
  await render(<StoriesHome {...props(language)} />); await settle(); const home = getComponent(HomeScreen).props;
  const old = tabs().onSelectTab; await act(() => { home.onCreateStory(); old('settings'); home.onOpenStories(); });
  expect(getComponent(CreateStory)).toBeDefined(); expect(maybeComponent(RootTabBar)).toBeNull();
  expect(listStoryProjects).not.toHaveBeenCalled(); noWrites();
});
it.each<Language>(['en', 'sv'])('opens %s workspace review read-only and preserves a selected older autobiography', async language => {
  await render(<StoriesHome {...props(language)} />); await settle(); const oldTabs = tabs().onSelectTab;
  await act(() => getComponent(HomeScreen).props.onOpenStories()); await screen.findByText(project().title);
  await fireEvent.press(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: ${project().title}` }));
  const firstDetails = getComponent(StoryDetails).props;
  await act(() => requireCallback(firstDetails.onGenerate)(project()));
  const generation = getComponent(GenerateStory).props;
  expect(generation.initialDraftId).toBeUndefined(); await act(() => requireCallback(generation.onSelectionChange)(draftId));
  await act(() => generation.onBack()); const details = getComponent(StoryDetails).props;
  await act(() => requireCallback(details.onReviewMemories)(project()));
  expect(maybeComponent(RootTabBar)).toBeNull();
  const review = getComponent(Conversation).props;
  expect(review.reviewOnOpen).toBe(true); expect(review.project).toEqual(project());
  await act(() => { oldTabs('settings'); details.onBack(); requireCallback(firstDetails.onConversation)(project()); requireCallback(generation.onContinueStory)(draftId); });
  expect(getComponent(Conversation).props.reviewOnOpen).toBe(true);
  await act(() => review.onBack()); await act(() => requireCallback(getComponent(StoryDetails).props.onGenerate)(project()));
  expect(getComponent(GenerateStory).props.initialDraftId).toBe(draftId);
  expect(maybeComponent(RootTabBar)).toBeNull(); noWrites();
});
it.each<Language>(['en', 'sv'])('fences %s obsolete root actions when replay begins before native blur', async language => {
  replay.mockReturnValue(true); await render(<StoriesHome {...props(language)} />); await settle();
  await act(() => tabs().onSelectTab('settings')); const old = tabs().onSelectTab;
  const settings = getComponent(SettingsScreen).props;
  await act(() => { settings.onReplayIntroduction(); old('stories'); settings.onSelectLanguage('sv'); settings.onSignOut(); });
  expect(replay).toHaveBeenCalledTimes(1); expect(selectLanguage).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  expect(listStoryProjects).not.toHaveBeenCalled(); noWrites();
});
it.each<Language>(['en', 'sv'])('ignores %s private results from a previous account and requires deliberate account B entry', async language => {
  const pending = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  const view = await render(<StoriesHome {...props(language)} />); await settle(); await act(() => tabs().onSelectTab('stories'));
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await view.rerender(<StoriesHome {...props(language, ownerB)} />); await settle();
  expect(signal.aborted).toBe(true); expect(tabs().tab).toBe('home');
  await act(async () => pending.resolve([project('Account A private story')]));
  expect(screen.queryByText('Account A private story')).toBeNull(); expect(listStoryProjects).toHaveBeenCalledTimes(1);
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Account B fictional story')]);
  await act(() => tabs().onSelectTab('stories')); await screen.findByText('Account B fictional story');
  await jest.mocked(listStoryProjects).mock.calls[1][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith(ownerB); noWrites();
});
it.each<Language>(['en', 'sv'])('Android Back from %s root destinations goes Home and never wins in a nested workflow', async language => {
  await render(<StoriesHome {...props(language)} />); await settle(); expect(backCallbacks.size).toBe(0);
  for (const destination of ['settings', 'stories'] as const) {
    await act(() => tabs().onSelectTab(destination)); const callbacks = [...backCallbacks]; expect(callbacks).toHaveLength(1);
    await act(() => { expect(callbacks[0]({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true); });
    expect(tabs().tab).toBe('home'); expect(backCallbacks.size).toBe(0);
    await act(() => { expect(callbacks[0]({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(false); });
  }
  await act(() => getComponent(HomeScreen).props.onCreateStory());
  expect(backCallbacks.size).toBe(0); expect(maybeComponent(RootTabBar)).toBeNull(); noWrites();
});
it('route blur drops private roots, cancels pending reads, and invalidates captured tab callbacks', async () => {
  const pending = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  await render(<StoriesHome {...props()} />); await settle(); await act(() => tabs().onSelectTab('stories')); const old = tabs().onSelectTab;
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await act(() => [...focusCleanups].forEach(close => close()));
  expect(signal.aborted).toBe(true); expect(maybeComponent(RootTabBar)).toBeNull();
  await act(() => { old('home'); old('settings'); }); await act(async () => pending.resolve([project('Blurred private story')]));
  expect(getComponent(PreferenceLoading)).toBeDefined(); expect(screen.queryByText('Blurred private story')).toBeNull(); noWrites();
});
it('Sign Out immediately fences Settings callbacks even before the outer auth tree unmounts', async () => {
  await render(<StoriesHome {...props()} />); await settle(); await act(() => tabs().onSelectTab('settings'));
  const old = tabs().onSelectTab, settings = getComponent(SettingsScreen).props;
  await act(() => { settings.onSignOut(); old('stories'); settings.onReplayIntroduction(); settings.onSelectLanguage('sv'); });
  expect(signOut).toHaveBeenCalledTimes(1); expect(listStoryProjects).not.toHaveBeenCalled(); expect(replay).not.toHaveBeenCalled();
  expect(selectLanguage).not.toHaveBeenCalled(); noWrites();
});
it('does not accept malformed programmatic tab targets', async () => {
  await render(<StoriesHome {...props()} />); await settle(); await act(() => tabs().onSelectTab('editor' as RootTab));
  expect(tabs().tab).toBe('home'); expect(listStoryProjects).not.toHaveBeenCalled(); noWrites();
});
it('a superseded PDF return cannot overwrite a newer intentional root transition', async () => {
  // RNTL 14 awaits mount effects. Inject the deliberate newer root intent at
  // the hint-read boundary while its original restoration epoch is captured.
  consume.mockImplementationOnce(() => {
    tabs().onSelectTab('settings');
    return { projectId, draftId };
  });
  await render(<StoriesHome {...props()} />); await settle();
  expect(tabs().tab).toBe('settings'); expect(getStoryProject).not.toHaveBeenCalled();
  expect(maybeComponent(GenerateStory)).toBeNull(); noWrites();
});
