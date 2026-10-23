import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, BackHandler } from 'react-native';
import * as Crypto from 'expo-crypto';
import { GenerateStory } from '../src/generation/GenerateStory';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { DraftHistoryScreen } from '../src/generation/DraftHistoryScreen';
import { listStoryDrafts, getStoryDraft, getStoryVerification, generateStoryDraft, editStoryDraft,
  listDraftHistory, type StoryDraft, type StoryEdit, type StoryProjectVerification } from '../src/api/story-drafts';
import { StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import type { Language } from '../src/i18n';

jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  listStoryDrafts: jest.fn(), getStoryDraft: jest.fn(), getStoryVerification: jest.fn(),
  generateStoryDraft: jest.fn(), editStoryDraft: jest.fn(), listDraftHistory: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));

const projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001';
const actionKey = '30000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const original = 'I grew up in Malmö.';
const initialWording = 'I grew up in Malmö. My fictional edited wording.';
const localWording = 'I grew up in Malmö. My separate fictional manual correction.';
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title: 'Fictional draft routing story',
  description: null, language, status: 'draft', created_at: stamp, updated_at: stamp });
const draft = (changes: Partial<StoryDraft> = {}): StoryDraft => {
  const language = changes.language ?? 'en';
  const generated = language === 'sv' ? 'Jag växte upp i Malmö.' : original;
  const wording = language === 'sv' ? generated + ' Min påhittade redigerade formulering.' : initialWording;
  return {
    draft_id: draftId, project_id: projectId, status: 'edited', language, style: 'warm',
    version: 1, revision: 2, content: wording, original_content: generated, mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
      evidence: generated.slice(0, -1), corrected_value: null, year: null, slot: 'grew_up_location', sentence: generated }],
    verification: { status: 'needs_review', unsupported_claims: [], method: 'manual_unverified',
      checked_revision: 2, checked_at: stamp, sources_current: true, reason: null },
    created_at: stamp, updated_at: stamp, ...changes,
  };
};
const history = (value: StoryDraft): StoryEdit => ({
  id: '60000000-0000-4000-8000-000000000001', draft_id: value.draft_id, revision: 2,
  previous_content: value.original_content, content: value.content, created_at: stamp,
});
const report = (value: StoryDraft): StoryProjectVerification => ({ project_id: value.project_id,
  draft_id: value.draft_id, version: value.version, revision: value.revision, verification: value.verification });
const token = jest.fn(async (_owner: string) => 'synthetic-development-user-access-token');
const back = jest.fn(), signOut = jest.fn(), review = jest.fn();
const props = (language: Language = 'en') => ({ language, user: { id: 'account-a', email: 'account-a@example.test' }, project: project(language),
  getAccessToken: token, onBack: back, onSignOut: signOut, onReviewMemories: review });
function saved(value = draft()) {
  jest.mocked(listStoryDrafts).mockResolvedValue([value]);
  jest.mocked(getStoryDraft).mockResolvedValue(value);
  jest.mocked(getStoryVerification).mockResolvedValue(report(value));
  jest.mocked(listDraftHistory).mockResolvedValue({ items: [history(value)], hasMore: false });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type BackCallback = Parameters<typeof BackHandler.addEventListener>[1];
let backCallbacks: Set<BackCallback>;
beforeEach(() => {
  backCallbacks = new Set();
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(listStoryDrafts).mockReset();
  jest.mocked(getStoryDraft).mockReset();
  jest.mocked(getStoryVerification).mockReset();
  jest.mocked(generateStoryDraft).mockReset();
  jest.mocked(editStoryDraft).mockReset();
  jest.mocked(listDraftHistory).mockReset();
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(actionKey);
  token.mockClear(); back.mockClear(); signOut.mockClear(); review.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    backCallbacks.add(callback); return { remove: () => { backCallbacks.delete(callback); } };
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  saved();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
const draftView = () => screen.UNSAFE_getByType(StoryDraftScreen).props;
async function ready() { await waitFor(() => expect(draftView().state.phase).toBe('ready')); }
async function openEditor(language: Language = 'en') {
  const view = render(<GenerateStory {...props(language)} />);
  await ready();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].edit }));
  await waitFor(() => expect(screen.UNSAFE_getByType(DraftEditorScreen).props.state.phase).toBe('editing'));
  return view;
}
function dismissWarning(keepEditing: boolean) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const button = buttons?.find(item => item.style === (keepEditing ? 'cancel' : 'destructive'));
  expect(button?.onPress).toBeDefined();
  act(() => { button!.onPress!(); });
}

it.each<Language>(['en', 'sv'])('enters the saved %s editor with GET only and correct owner/draft scope', async language => {
  const value = draft({ language }); saved(value);
  await openEditor(language);
  expect(screen.getByLabelText(draftEditingCopy[language].field).props.value).toBe(value.content);
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
  const call = jest.mocked(getStoryDraft).mock.calls.at(-1)![0];
  expect(call).toMatchObject({ projectId, draftId, expectedLanguage: language });
  await call.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy[language].back }));
  await ready();
  expect(Alert.alert).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(screen.getByText(value.content)).toBeOnTheScreen();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('opens and closes actual saved %s revision history without editing or generating', async language => {
  const value = draft({ language }); saved(value);
  render(<GenerateStory {...props(language)} />); await ready();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy[language].history }));
  await waitFor(() => expect(screen.UNSAFE_getByType(DraftHistoryScreen).props.state.phase).toBe('ready'));
  expect(listDraftHistory).toHaveBeenCalledWith(expect.objectContaining({
    projectId, draftId, expectedLanguage: language, offset: 0,
  }));
  expect(screen.getByText(value.original_content)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy[language].back }));
  await ready();
  expect(screen.getByText(value.content)).toBeOnTheScreen();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('returns from a confirmed manual save to freshly read backend preview without generation', async () => {
  await openEditor();
  const value = draft({ revision: 3, content: localWording,
    verification: { ...draft().verification, checked_revision: 3 } });
  jest.mocked(editStoryDraft).mockResolvedValue(value);
  fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.save }));
  await screen.findByText(draftEditingCopy.en.saved);
  expect(jest.mocked(editStoryDraft).mock.calls[0][0]).toMatchObject({
    projectId, expectedLanguage: 'en', baseline: { draft_id: draftId, revision: 2 },
    input: { content: localWording, expected_revision: 2 },
  });
  saved(value);
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.back }));
  await ready();
  expect(screen.getByText(localWording)).toBeOnTheScreen();
  expect(screen.getByText(storyGenerationCopy.en.statuses.needs_review)).toBeOnTheScreen();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).toHaveBeenCalledTimes(1);
});

it('an uncertain generation cannot enter editor or history even through stale presentation callbacks', async () => {
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  render(<GenerateStory {...props()} />); await ready();
  const oldEdit = draftView().onEdit, oldHistory = draftView().onHistory;
  act(() => draftView().onGenerate());
  await waitFor(() => expect(draftView().state.phase).toBe('uncertain'));
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.history })).toBeNull();
  act(() => { oldEdit(); oldHistory(); });
  expect(screen.UNSAFE_queryByType(DraftEditorScreen)).toBeNull();
  expect(screen.UNSAFE_queryByType(DraftHistoryScreen)).toBeNull();
  expect(listDraftHistory).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('parent Android Back handler cannot bypass the child unsaved-wording warning', async () => {
  await openEditor();
  fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  act(() => {
    for (const callback of [...backCallbacks].reverse()) if (callback({} as Parameters<BackCallback>[0])) break;
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1); expect(back).not.toHaveBeenCalled();
  expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(localWording);
  dismissWarning(true);
  expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(localWording);
  act(() => {
    for (const callback of [...backCallbacks].reverse()) if (callback({} as Parameters<BackCallback>[0])) break;
  });
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  dismissWarning(false); await ready();
  expect(screen.UNSAFE_queryByType(DraftEditorScreen)).toBeNull();
  expect(screen.getByText(initialWording)).toBeOnTheScreen();
  expect(back).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('sign-out cancels pending manual save and cannot show its late content', async () => {
  const pending = deferred<StoryDraft>();
  jest.mocked(editStoryDraft).mockReturnValueOnce(pending.promise);
  await openEditor();
  fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.save }));
  await waitFor(() => expect(editStoryDraft).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(editStoryDraft).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.signOut }));
  expect(signOut).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
  expect(screen.queryByLabelText(draftEditingCopy.en.field)).toBeNull();
  await act(async () => pending.resolve(draft({ content: localWording })));
  expect(screen.queryByText(localWording)).toBeNull();
  expect(screen.queryByText(draftEditingCopy.en.saved)).toBeNull();
});

it('unmount cancels selected editor GET and never publishes its late prose', async () => {
  const view = render(<GenerateStory {...props()} />); await ready();
  const pending = deferred<StoryDraft>();
  let pendingSignal: AbortSignal | undefined;
  jest.mocked(getStoryDraft).mockImplementationOnce(options => {
    pendingSignal = options.signal; return pending.promise;
  });
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.edit }));
  await waitFor(() => expect(pendingSignal).toBeDefined());
  expect(screen.UNSAFE_getByType(DraftEditorScreen).props.state.phase).toBe('loading');
  const signal = pendingSignal!;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(draft({ content: 'Late account A fictional prose.' })));
  expect(view.toJSON()).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('owner changes unmount the editor, cancel pending PATCH and re-scope all subsequent reads', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(editStoryDraft).mockReturnValueOnce(pending.promise);
  const view = await openEditor();
  fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.save }));
  await waitFor(() => expect(editStoryDraft).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(editStoryDraft).mock.calls[0][0].signal!;
  const other = draft({ draft_id: '20000000-0000-4000-8000-000000000002',
    content: 'Account B fictional saved wording.' });
  saved(other);
  view.rerender(<GenerateStory {...props()} user={{ id: 'account-b', email: 'account-b@example.test' }} />);
  await ready(); expect(signal.aborted).toBe(true);
  expect(screen.queryByLabelText(draftEditingCopy.en.field)).toBeNull();
  await act(async () => pending.resolve(draft({ content: localWording })));
  expect(screen.queryByText(localWording)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.edit }));
  await waitFor(() => expect(screen.UNSAFE_getByType(DraftEditorScreen).props.state.phase).toBe('editing'));
  const read = jest.mocked(getStoryDraft).mock.calls.at(-1)![0];
  expect(read.draftId).toBe(other.draft_id);
  await read.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-b');
  expect(generateStoryDraft).not.toHaveBeenCalled();
});
