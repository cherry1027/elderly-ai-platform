import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import { getComponent } from './component-probe';
import { StoriesHome } from '../src/stories/StoriesHome';
import { StoryDetails } from '../src/stories/StoryDetails';
import { CreateStory } from '../src/stories/CreateStory';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { usePdfPrivacy } from '../src/exports/PdfPrivacy';
import { storiesCopy } from '../src/stories-copy';
import { rootNavigationCopy, type RootTab } from '../src/root-navigation-copy';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStoryProjects: jest.fn() }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
jest.mock('../src/stories/StoryDetails', () => ({ StoryDetails: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
jest.mock('../src/stories/CreateStory', () => ({ CreateStory: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));

const ownerA = '16000000-0000-4000-8000-000000000001', ownerB = '16000000-0000-4000-8000-000000000002';
const projectId = '17000000-0000-4000-8000-000000000001';
const project = (title = 'Saved story'): StoryProject => ({ id: projectId, title, description: null, language: 'en',
  status: 'draft', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' });
const token = jest.fn(async (_owner: string) => 'synthetic-test-token'), signOut = jest.fn(), consumeReturn = jest.fn(() => null);
const props = (owner = ownerA) => ({ language: 'en' as const, user: { id: owner, email: `${owner}@example.test` },
  getAccessToken: token, onSignOut: signOut, onSelectLanguage: jest.fn(), onReplayIntroduction: jest.fn() });
let enterFocus: (() => void | (() => void)) | undefined, leaveFocus: (() => void) | undefined;
function useMockFocus(callback: () => void | (() => void)) {
  useEffect(() => { enterFocus = callback; const close = callback(); leaveFocus = close || undefined; return close; }, [callback]);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function tab(value: RootTab) { await fireEvent.press(screen.getByRole('tab', { name: rootNavigationCopy.en.tabs[value] })); }
async function openStory() { await fireEvent.press(screen.getByRole('button', { name: `${storiesCopy.en.openStory}: Saved story` })); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  token.mockClear(); signOut.mockClear(); consumeReturn.mockClear(); enterFocus = undefined; leaveFocus = undefined;
  jest.mocked(useFocusEffect).mockImplementation(useMockFocus);
  jest.mocked(usePdfPrivacy).mockReturnValue({ consumeReturn } as unknown as ReturnType<typeof usePdfPrivacy>);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockReset().mockImplementation(async options => { await options.getAccessToken(); return [project()]; });
});
afterEach(async () => { await cleanup(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it('loads once on first My Stories entry and reuses rows across root tabs and harmless rerenders', async () => {
  const view = await render(<StoriesHome {...props()} />); await settle();
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  await tab('stories'); await screen.findByText('Saved story');
  expect(listStoryProjects).toHaveBeenCalledTimes(1); expect(token).toHaveBeenCalledTimes(1); expect(token).toHaveBeenCalledWith(ownerA);
  for (const other of ['home', 'settings', 'home'] as const) {
    await tab(other); await tab('stories'); expect(screen.getByText('Saved story')).toBeOnTheScreen();
  }
  await tab('stories'); await view.rerender(<StoriesHome {...props()} />); await settle();
  expect(listStoryProjects).toHaveBeenCalledTimes(1); expect(token).toHaveBeenCalledTimes(1);
});
it('deduplicates a pending first load while My Stories is temporarily unmounted by root tabs', async () => {
  const pending = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await settle();
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await tab('home'); await tab('stories'); await tab('settings'); await tab('stories');
  expect(listStoryProjects).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false);
  await act(async () => pending.resolve([project()])); expect(screen.getByText('Saved story')).toBeOnTheScreen();
});
it.each(['en', 'sv'] as const)('retains useful rows during explicit refresh and reports refresh failure in %s', async language => {
  await render(<StoriesHome {...props()} language={language} initialRootTab="stories" />); await screen.findByText('Saved story');
  const pending = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  expect(screen.queryByRole('button', { name: storiesCopy[language].refresh })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].listOptions }));
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].refresh }));
  expect(screen.getByText('Saved story')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: Saved story` })).toBeEnabled();
  const refresh = screen.getByRole('button', { name: storiesCopy[language].refresh });
  expect(refresh).toBeDisabled(); expect(refresh.props.accessibilityState.busy).toBe(true);
  await fireEvent.press(refresh); expect(listStoryProjects).toHaveBeenCalledTimes(2);
  await act(async () => pending.reject(new StoryProjectsError('network')));
  expect(screen.getByText('Saved story')).toBeOnTheScreen();
  expect(screen.getByRole('alert')).toHaveTextContent(storiesCopy[language].errors.network);
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].refresh }));
  expect(listStoryProjects).toHaveBeenCalledTimes(3); expect(screen.queryByRole('alert')).toBeNull();
});
it('clears cached rows on authentication failure and does not quietly reload or reuse them', async () => {
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await screen.findByText('Saved story');
  jest.mocked(listStoryProjects).mockRejectedValueOnce(new StoryProjectsError('authentication'));
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.listOptions }));
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
  expect(screen.queryByText('Saved story')).toBeNull();
  expect(screen.getByRole('button', { name: storiesCopy.en.refresh })).toBeDisabled();
  await tab('home'); await tab('stories'); expect(screen.queryByText('Saved story')).toBeNull();
  expect(listStoryProjects).toHaveBeenCalledTimes(2);
});
it.each(['pending', 'ready'] as const)('discards account A %s work immediately when account B replaces the owner', async phase => {
  const old = deferred<StoryProject[]>(), replacement = deferred<StoryProject[]>();
  jest.mocked(listStoryProjects).mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
  const view = await render(<StoriesHome {...props()} initialRootTab="stories" />); await settle();
  const oldSignal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  if (phase === 'ready') await act(async () => old.resolve([project('Account A private story')]));
  await view.rerender(<StoriesHome {...props(ownerB)} initialRootTab="stories" />); await settle();
  if (phase === 'pending') expect(oldSignal.aborted).toBe(true);
  expect(screen.queryByText('Account A private story')).toBeNull();
  await act(async () => old.resolve([project('Account A private story')]));
  expect(screen.queryByText('Account A private story')).toBeNull();
  await act(async () => replacement.resolve([project('Account B saved story')]));
  expect(screen.getByText('Account B saved story')).toBeOnTheScreen();
  await jest.mocked(listStoryProjects).mock.calls[1][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith(ownerB);
});
it('returns from unchanged Story Details without fetching the list again', async () => {
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await screen.findByText('Saved story');
  await openStory(); await act(() => getComponent(StoryDetails).props.onBack());
  expect(screen.getByText('Saved story')).toBeOnTheScreen(); expect(listStoryProjects).toHaveBeenCalledTimes(1);
});
it('refreshes the real list after a possible project change or after Create without inserting a write response', async () => {
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await screen.findByText('Saved story');
  await openStory(); await act(() => getComponent(StoryDetails).props.onProjectChanged?.());
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Server refreshed title')]);
  await act(() => getComponent(StoryDetails).props.onBack()); await screen.findByText('Server refreshed title');
  expect(listStoryProjects).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Verified list after Create')]);
  await act(() => getComponent(CreateStory).props.onBack()); await screen.findByText('Verified list after Create');
  expect(listStoryProjects).toHaveBeenCalledTimes(3);
});
it('clears the owner list when a nested story reports authentication failure', async () => {
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await screen.findByText('Saved story'); await openStory();
  const details = getComponent(StoryDetails).props;
  await act(() => details.onAuthenticationFailure?.()); await act(() => details.onBack());
  expect(screen.queryByText('Saved story')).toBeNull(); expect(screen.getByText(storiesCopy.en.errors.authentication)).toBeOnTheScreen();
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
});
it('route blur aborts pending list work and a later focused entry cannot restore the old private result', async () => {
  const old = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(old.promise);
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await settle();
  const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  await act(() => leaveFocus?.()); expect(signal.aborted).toBe(true);
  await act(async () => old.resolve([project('Blurred private response')]));
  await act(() => { enterFocus?.(); }); await tab('stories'); await screen.findByText('Saved story');
  expect(screen.queryByText('Blurred private response')).toBeNull(); expect(listStoryProjects).toHaveBeenCalledTimes(2);
});
it('retains no project cache after the authenticated owner scope is unmounted', async () => {
  const view = await render(<StoriesHome {...props()} initialRootTab="stories" />); await screen.findByText('Saved story');
  await tab('settings'); await fireEvent.press(screen.getByRole('button', { name: rootNavigationCopy.en.signOut }));
  expect(signOut).toHaveBeenCalledTimes(1); await view.unmount();
  const pending = deferred<StoryProject[]>(); jest.mocked(listStoryProjects).mockReturnValueOnce(pending.promise);
  await render(<StoriesHome {...props()} initialRootTab="stories" />); await settle();
  expect(screen.queryByText('Saved story')).toBeNull(); expect(listStoryProjects).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve([project('Freshly verified story')]));
});
