import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StoriesHome } from '../src/stories/StoriesHome';
import { readMobileApiConfig } from '../src/api/config';
import { readRealAiConfig, readRealAiRequested } from '../src/real-ai/config';
import * as projects from '../src/api/story-projects';
import * as api from '../src/real-ai/api';
import { usePdfPrivacy } from '../src/exports/PdfPrivacy';
import { createRecordingId } from '../src/audio/native-recorder';
import { realCopy } from '../src/real-ai/copy';
import { storiesCopy } from '../src/stories-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { rootNavigationCopy } from '../src/root-navigation-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { realDraft, realIds as ids } from './real-ai-fixtures';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/real-ai/config', () => ({ readRealAiConfig: jest.fn(), readRealAiRequested: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStoryProjects: jest.fn(), getStoryProject: jest.fn(), updateStoryProject: jest.fn(), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  getRealCapabilities: jest.fn(), getRealMessages: jest.fn(), getRealTranscripts: jest.fn(), getRealMemories: jest.fn(), getRealDrafts: jest.fn(),
  getRealDraftHistory: jest.fn(), getRealExports: jest.fn(), hashRealText: jest.fn(), sendRealTextMessage: jest.fn(), sendRealMessage: jest.fn(),
  transcribeRealRecording: jest.fn(), generateRealDraft: jest.fn(), editRealDraft: jest.fn(), exportRealDraft: jest.fn(), downloadRealExport: jest.fn(), createRealSpeech: jest.fn() }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createRecordingId: jest.fn() }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn(async () => {}) };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));

const ownerA = '80000000-0000-4000-8000-000000000001', ownerB = '80000000-0000-4000-8000-000000000002';
const project: projects.StoryProject = { id: ids.project, title: 'Fresh owned story', description: 'Owned description', language: 'en', status: 'draft',
  created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T12:00:00Z' };
const session = { id: ids.session, project_id: ids.project, language: 'en' as const, status: 'active' as const,
  created_at: project.created_at, updated_at: project.updated_at, ended_at: null };
const caps = { contract: 'real-v2' as const, mode: 'real' as const, enabled: true, transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' };
const token = jest.fn(async (owner: string) => `synthetic-token-${owner}`), signOut = jest.fn();
const privacy = { consumeReturn: jest.fn<ReturnType<ReturnType<typeof usePdfPrivacy>['consumeReturn']>, Parameters<ReturnType<typeof usePdfPrivacy>['consumeReturn']>>(),
  ready: true, failed: false, release: jest.fn(), rememberReturn: jest.fn(), createStore: jest.fn() };
const props = (owner = ownerA, language: 'en' | 'sv' = 'en') => ({ language, user: { id: owner, email: `${owner}@example.test` },
  getAccessToken: token, onSignOut: signOut, onSelectLanguage: jest.fn(), onReplayIntroduction: jest.fn(), initialRootTab: 'stories' as const });
let enterFocus: (() => void | (() => void)) | undefined, leaveFocus: (() => void) | undefined;
let reads: string[] = [];
function useMockFocus(callback: () => void | (() => void)) {
  useEffect(() => { enterFocus = callback; const close = callback(); leaveFocus = close || undefined; return close; }, [callback]);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function press(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); await act(async () => {}); }
async function listReady(language: 'en' | 'sv' = 'en') { await screen.findByRole('button', { name: `${storiesCopy[language].openStory}: Cached list story` }); }
async function openStory(language: 'en' | 'sv' = 'en') { await press(`${storiesCopy[language].openStory}: Cached list story`); }
async function talkReady(language: 'en' | 'sv' = 'en') { await waitFor(() => expect(screen.getByLabelText(realCopy[language].input)).toBeEnabled()); }
function noPaidCalls() {
  expect(api.sendRealTextMessage).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
}
beforeEach(() => {
  reads = []; enterFocus = undefined; leaveFocus = undefined; AppState.currentState = 'active'; token.mockClear(); signOut.mockClear();
  privacy.consumeReturn.mockReset().mockReturnValue(null);
  jest.mocked(usePdfPrivacy).mockReturnValue(privacy as unknown as ReturnType<typeof usePdfPrivacy>);
  jest.mocked(useFocusEffect).mockImplementation(useMockFocus);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.40:8000' });
  jest.mocked(readRealAiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' });
  jest.mocked(readRealAiRequested).mockReturnValue(true);
  jest.mocked(projects.listStoryProjects).mockReset().mockImplementation(async options => { reads.push('list'); await options.getAccessToken(); return [{ ...project, title: 'Cached list story' }]; });
  jest.mocked(projects.getStoryProject).mockReset().mockImplementation(async options => { reads.push('project'); await options.getAccessToken(); return project; });
  jest.mocked(projects.updateStoryProject).mockReset().mockResolvedValue({ ...project, title: 'Updated owned story' });
  jest.mocked(projects.listStorySessions).mockReset().mockImplementation(async () => { reads.push('sessions'); return [session]; });
  jest.mocked(projects.continueStoryProject).mockReset().mockResolvedValue({ project_id: ids.project, language: 'en', session, session_created: true, latest_draft: null, generation_triggered: false });
  jest.mocked(api.getRealCapabilities).mockReset().mockImplementation(async () => { reads.push('capabilities'); return caps; });
  jest.mocked(api.getRealMessages).mockReset().mockImplementation(async () => { reads.push('messages'); return []; });
  jest.mocked(api.getRealTranscripts).mockReset().mockImplementation(async () => { reads.push('transcripts'); return []; });
  jest.mocked(api.getRealMemories).mockReset().mockImplementation(async () => { reads.push('memories'); return []; });
  jest.mocked(api.getRealDrafts).mockReset().mockImplementation(async () => { reads.push('drafts'); return []; });
  jest.mocked(api.getRealDraftHistory).mockReset().mockResolvedValue([]); jest.mocked(api.getRealExports).mockReset().mockResolvedValue([]);
  jest.mocked(api.sendRealTextMessage).mockReset(); jest.mocked(api.hashRealText).mockReset().mockResolvedValue('a'.repeat(64));
  jest.mocked(createRecordingId).mockReturnValue(ids.key);
});
afterEach(async () => {
  await cleanup(); await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active';
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('opens a story directly on Talk in %s with the existing one project plus four workspace reads', async language => {
  const pending = deferred<projects.StoryProject>();
  jest.mocked(projects.getStoryProject).mockImplementationOnce(async options => { reads.push('project'); await options.getAccessToken(); return pending.promise; });
  await render(<StoriesHome {...props(ownerA, language)} />); await listReady(language); await openStory(language);
  expect(screen.getByText(storyDetailsCopy[language].loading)).toBeOnTheScreen(); expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
  expect(screen.queryByText(storyDetailsCopy[language].introduction)).toBeNull();
  expect(screen.queryByRole('button', { name: storyDetailsCopy[language].conversation })).toBeNull();
  expect(api.getRealCapabilities).not.toHaveBeenCalled();
  await act(async () => pending.resolve(project)); await talkReady(language);
  expect(screen.getByText(project.title)).toBeOnTheScreen(); expect(screen.queryByText('Cached list story')).toBeNull();
  expect(screen.getByRole('tab', { name: realCopy[language].chat }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('story-top-back').props.accessibilityLabel).toBe((language === 'sv' ? 'Gå tillbaka: ' : 'Go back: ') + realCopy[language].back);
  expect(screen.queryByRole('button', { name: storyDetailsCopy[language].conversation })).toBeNull();
  expect(reads).toEqual(['list', 'project', 'capabilities', 'sessions', 'messages', 'transcripts']);
  expect(projects.continueStoryProject).not.toHaveBeenCalled(); expect(token).toHaveBeenCalledWith(ownerA);
  await fireEvent.press(screen.getByTestId('story-top-back')); await listReady(language);
  expect(reads.filter(item => item === 'list')).toHaveLength(1); expect(projects.getStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('tab', { name: realCopy[language].chat })).toBeNull(); noPaidCalls();
});
it('reopens the same selected story without another list read or duplicated workspace startup', async () => {
  await render(<StoriesHome {...props()} />); await listReady(); await openStory(); await talkReady();
  await fireEvent.press(screen.getByTestId('story-top-back')); await listReady(); await openStory(); await talkReady();
  expect(projects.listStoryProjects).toHaveBeenCalledTimes(1); expect(projects.getStoryProject).toHaveBeenCalledTimes(2);
  for (const read of [api.getRealCapabilities, projects.listStorySessions, api.getRealMessages, api.getRealTranscripts]) expect(read).toHaveBeenCalledTimes(2);
  expect(api.getRealMemories).not.toHaveBeenCalled(); expect(api.getRealDrafts).not.toHaveBeenCalled(); noPaidCalls();
});
it('cancels a delayed project read when Back is selected and ignores its late success', async () => {
  const pending = deferred<projects.StoryProject>(); jest.mocked(projects.getStoryProject).mockReturnValueOnce(pending.promise);
  await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  const signal = jest.mocked(projects.getStoryProject).mock.calls[0][0].signal!;
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(signal.aborted).toBe(true); await listReady();
  await act(async () => pending.resolve(project)); expect(screen.queryByText(project.title)).toBeNull(); expect(api.getRealCapabilities).not.toHaveBeenCalled();
  expect(projects.listStoryProjects).toHaveBeenCalledTimes(1); noPaidCalls();
});
it('does not enter a previous owner’s Talk from a delayed project result', async () => {
  const pending = deferred<projects.StoryProject>(); jest.mocked(projects.getStoryProject).mockReturnValueOnce(pending.promise);
  const view = await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  const signal = jest.mocked(projects.getStoryProject).mock.calls[0][0].signal!;
  await view.rerender(<StoriesHome {...props(ownerB)} />); await listReady(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ ...project, title: 'Private owner A title' }));
  expect(screen.queryByText('Private owner A title')).toBeNull(); expect(api.getRealCapabilities).not.toHaveBeenCalled();
  await openStory(); await talkReady(); await jest.mocked(projects.getStoryProject).mock.calls[1][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith(ownerB); expect(projects.listStoryProjects).toHaveBeenCalledTimes(2); noPaidCalls();
});
it('route blur cancels project opening and prevents a late response from reopening private content', async () => {
  const pending = deferred<projects.StoryProject>(); jest.mocked(projects.getStoryProject).mockReturnValueOnce(pending.promise);
  await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  const signal = jest.mocked(projects.getStoryProject).mock.calls[0][0].signal!;
  await act(() => leaveFocus?.()); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(project)); expect(api.getRealCapabilities).not.toHaveBeenCalled();
  await act(() => { enterFocus?.(); });
  await fireEvent.press(screen.getByRole('tab', { name: rootNavigationCopy.en.tabs.stories })); await listReady();
  expect(projects.listStoryProjects).toHaveBeenCalledTimes(2); noPaidCalls();
});
it('retains existing project-error recovery without starting workspace requests or retaining an invalid owner cache', async () => {
  jest.mocked(projects.getStoryProject).mockRejectedValueOnce(new projects.StoryProjectsError('authentication'));
  await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  await screen.findByText(storyDetailsCopy.en.errors.authentication); expect(api.getRealCapabilities).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('story-top-back')); await screen.findByText(storiesCopy.en.errors.authentication);
  expect(screen.queryByText('Cached list story')).toBeNull(); expect(projects.listStoryProjects).toHaveBeenCalledTimes(1); noPaidCalls();
});
it('rejects invalid story selection before a metadata request or workspace startup', async () => {
  jest.mocked(projects.listStoryProjects).mockResolvedValueOnce([{ ...project, id: '../private', title: 'Invalid row' }]);
  await render(<StoriesHome {...props()} />); await screen.findByText('Invalid row'); await press(`${storiesCopy.en.openStory}: Invalid row`);
  expect(projects.getStoryProject).not.toHaveBeenCalled(); expect(api.getRealCapabilities).not.toHaveBeenCalled(); noPaidCalls();
});
it('uses only the existing canonical Continue operation when a selected story has no active session', async () => {
  jest.mocked(projects.listStorySessions).mockResolvedValueOnce([]);
  await render(<StoriesHome {...props()} />); await listReady(); await openStory(); await talkReady();
  expect(projects.continueStoryProject).toHaveBeenCalledTimes(1);
  expect(projects.continueStoryProject).toHaveBeenCalledWith(expect.objectContaining({ projectId: project.id, expectedLanguage: project.language }));
  expect(api.getRealMessages).toHaveBeenCalledTimes(1); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1); noPaidCalls();
});
it('keeps the original dirty-words warning on Back and returns to the warm list only after confirmed leave', async () => {
  await render(<StoriesHome {...props()} />); await listReady(); await openStory(); await talkReady();
  await fireEvent.changeText(screen.getByLabelText(realCopy.en.input), 'Private unfinished words');
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen();
  await press(leaveCopy.en.keep); expect(screen.getByLabelText(realCopy.en.input)).toHaveDisplayValue('Private unfinished words');
  await fireEvent.press(screen.getByTestId('story-top-back')); await press(leaveCopy.en.discard); await listReady();
  expect(projects.listStoryProjects).toHaveBeenCalledTimes(1); expect(projects.getStoryProject).toHaveBeenCalledTimes(1); noPaidCalls();
});
it('keeps uncertain typed-write recovery on Back without an automatic retry', async () => {
  jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
  await render(<StoriesHome {...props()} />); await listReady(); await openStory(); await talkReady();
  await fireEvent.changeText(screen.getByLabelText(realCopy.en.input), 'Uncertain saved words'); await press(realCopy.en.send);
  await screen.findByText(realCopy.en.uncertain); await fireEvent.press(screen.getByTestId('story-top-back'));
  expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); await press(leaveCopy.en.keep);
  expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(projects.listStoryProjects).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('story-top-back')); await press(leaveCopy.en.leave); await listReady();
  expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(projects.listStoryProjects).toHaveBeenCalledTimes(1);
});
it('keeps optional metadata editing reachable without restoring the normal landing step', async () => {
  await render(<StoriesHome {...props()} />); await listReady(); await openStory(); await talkReady();
  await press(realCopy.en.moreActions); await press(realCopy.en.storyDetails);
  await screen.findByRole('button', { name: storyDetailsCopy.en.conversation }); expect(projects.getStoryProject).toHaveBeenCalledTimes(2);
  await press(storyDetailsCopy.en.more); await press(storyDetailsCopy.en.edit);
  await fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Changed name'); await press(storyDetailsCopy.en.save);
  await screen.findByText(storyDetailsCopy.en.saved); expect(projects.updateStoryProject).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('story-top-back')); await listReady(); expect(projects.listStoryProjects).toHaveBeenCalledTimes(2); noPaidCalls();
});
it('preserves an owned PDF return to My Story and returns from that workspace to My Stories', async () => {
  privacy.consumeReturn.mockReturnValueOnce({ projectId: ids.project, draftId: ids.draft });
  jest.mocked(api.getRealDrafts).mockResolvedValueOnce([realDraft()]);
  await render(<StoriesHome {...props()} />); await screen.findByText(realDraft().content);
  expect(screen.getByRole('tab', { name: realCopy.en.book }).props.accessibilityState.selected).toBe(true);
  expect(api.getRealMessages).not.toHaveBeenCalled(); expect(api.getRealTranscripts).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('story-top-back')); await listReady();
  expect(projects.getStoryProject).toHaveBeenCalledTimes(1); noPaidCalls();
});
it('preserves the separate legacy landing route when the real-AI contract is not configured', async () => {
  jest.mocked(readRealAiConfig).mockReturnValue(null); jest.mocked(readRealAiRequested).mockReturnValue(false);
  await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  await screen.findByRole('button', { name: storyDetailsCopy.en.conversation }); expect(api.getRealCapabilities).not.toHaveBeenCalled(); noPaidCalls();
});
it('enters Talk after an explicit project-read retry without retrying automatically', async () => {
  jest.mocked(projects.getStoryProject).mockRejectedValueOnce(new projects.StoryProjectsError('network'));
  await render(<StoriesHome {...props()} />); await listReady(); await openStory();
  await screen.findByText(storyDetailsCopy.en.errors.network);
  expect(projects.getStoryProject).toHaveBeenCalledTimes(1); expect(api.getRealCapabilities).not.toHaveBeenCalled();
  await press(storyDetailsCopy.en.refresh); await talkReady();
  expect(projects.getStoryProject).toHaveBeenCalledTimes(2); expect(api.getRealCapabilities).toHaveBeenCalledTimes(1);
  expect(projects.listStoryProjects).toHaveBeenCalledTimes(1); noPaidCalls();
});