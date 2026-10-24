import { getComponent } from './component-probe';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { GenerateStory } from '../src/generation/GenerateStory';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { GenerationBrowser } from '../src/generation/GenerationBrowser';
import { DraftEditing } from '../src/generation/DraftEditing';
import { StoryExports } from '../src/exports/StoryExports';
import { GenerationActionsProvider } from '../src/generation/GenerationActions';
import { useAuth } from '../src/auth/AuthProvider';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { generateStoryDraft, getStoryDraft, getStoryVerification, listStoryDrafts,
  StoryDraftsError, type StoryDraft } from '../src/api/story-drafts';
import { StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';


function required<T>(value: T): NonNullable<T> {
  expect(value).not.toBeNull(); expect(value).not.toBeUndefined();
  if (value === null || value === undefined) throw new Error('Expected required test value.');
  return value;
}

jest.mock('../src/generation/StoryDraftScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/StoryDraftScreen')>('../src/generation/StoryDraftScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, StoryDraftScreen: observeComponent(actual.StoryDraftScreen) };
});

jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  generateStoryDraft: jest.fn(), getStoryDraft: jest.fn(), getStoryVerification: jest.fn(), listStoryDrafts: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/generation/GenerationBrowser', () => ({ GenerationBrowser: jest.fn(() => null) }));
jest.mock('../src/generation/DraftEditing', () => ({ DraftEditing: jest.fn(() => null) }));
jest.mock('../src/exports/StoryExports', () => ({ StoryExports: jest.fn(() => null) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const oldId = '20000000-0000-4000-8000-000000000001';
const newId = '20000000-0000-4000-8000-000000000002';
const stamp = '2026-10-23T10:00:00Z';
const project: StoryProject = { id: projectId, title: 'Fictional story', description: null, language: 'en',
  status: 'draft', created_at: stamp, updated_at: stamp };
function draft(id = oldId, version = 1): StoryDraft {
  return { draft_id: id, project_id: projectId, status: 'edited', language: 'en', style: 'warm', version, revision: 2,
    content: 'I grew up in Malmö. My own fictional wording.', original_content: 'I grew up in Malmö.', mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
      evidence: 'I grew up in Malmö', corrected_value: null, year: null, slot: 'grew_up_location', sentence: 'I grew up in Malmö.' }],
    verification: { status: 'needs_review', unsupported_claims: [], method: 'manual_unverified', checked_revision: 2,
      checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp };
}
let latest: StoryDraft;
let records: Map<string, StoryDraft>;
const token = jest.fn(async (_owner: string) => 'synthetic-token');
const back = jest.fn(), signOut = jest.fn(), review = jest.fn(), proceed = jest.fn();
function props(language: 'en' | 'sv' = 'en') { return { language, user: { id: 'account-a', email: 'a@example.test' }, project: { ...project, language },
  getAccessToken: token, onBack: back, onSignOut: signOut, onReviewMemories: review, onContinueStory: proceed }; }
const panel = () => getComponent(StoryDraftScreen).props;
const ready = () => waitFor(() => expect(panel().state.phase).toBe('ready'));
const child = <T,>(fn: (props: T) => unknown): T => jest.mocked(fn).mock.calls.at(-1)![0];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
beforeEach(() => {
  latest = draft(); records = new Map([[oldId, latest]]);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-in', user: { id: 'account-a' }, appActive: true } as ReturnType<typeof useAuth>);
  jest.mocked(Crypto.randomUUID).mockReturnValue('30000000-0000-4000-8000-000000000001');
  jest.mocked(listStoryDrafts).mockReset().mockImplementation(async () => [latest]);
  jest.mocked(getStoryDraft).mockReset().mockImplementation(async ({ draftId }) => {
    const value = records.get(draftId); if (!value) throw new StoryProjectsError('not-found'); return value;
  });
  jest.mocked(getStoryVerification).mockReset().mockImplementation(async () => ({ project_id: projectId,
    draft_id: latest.draft_id, version: latest.version, revision: latest.revision, verification: latest.verification }));
  jest.mocked(generateStoryDraft).mockReset().mockImplementation(async () => latest);
  for (const fn of [back, signOut, review, proceed, token, GenerationBrowser, DraftEditing, StoryExports]) jest.mocked(fn).mockClear();
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each(['en', 'sv'] as const)('keeps %s generation explicit and explains preservation without promising version+1', async language => {
  latest = { ...draft(), language }; records.set(oldId, latest);
  await render(<GenerateStory {...props(language)} />); await ready(); const text = storyGenerationCopy[language];
  expect(screen.getByText(text.generation + ': 1')).toBeTruthy();
  expect(screen.getByText(text.revision + ': 2')).toBeTruthy();
  expect(generateStoryDraft).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.generateAgain }));
  expect(screen.getByText(text.confirmation)).toBeTruthy(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: text.continueStory })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.confirm }));
  await waitFor(() => expect(panel().state.notice).toBe('saved'));
  expect(required(panel().state.draft).version).toBe(1); expect(required(panel().state.draft).content).toBe(latest.content);
  expect(jest.mocked(generateStoryDraft).mock.calls[0][0].input).toEqual({ language, style: 'warm', confirm_generation: true });
});
it('shows actual returned newer generation and provides a GET-only switch to the earlier edited draft', async () => {
  const old = draft(), snapshot = JSON.stringify(old);
  await render(<GenerateStory {...props()} />); await ready();
  const next = { ...draft(newId, 2), content: 'I felt happy.', original_content: 'I felt happy.' };
  records.set(newId, next); jest.mocked(generateStoryDraft).mockImplementationOnce(async () => { latest = next; return next; });
  await act(() => panel().onGenerate()); await waitFor(() => expect(panel().state.notice).toBe('saved'));
  expect(required(panel().state.draft).draft_id).toBe(newId);
  expect(panel().state.previousGeneration).toEqual({ draftId: oldId, version: 1 });
  await fireEvent.press(screen.getByRole('button', { name: storyGenerationCopy.en.openPreviousGeneration })); await ready();
  expect(panel().state.draft).toEqual(old); expect(panel().state.verification).toBeNull();
  expect(panel().state.previousGeneration).toEqual({ draftId: newId, version: 2 });
  expect(JSON.stringify(old)).toBe(snapshot); expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  await act(() => required(panel().onExport)()); expect(child(StoryExports)).toMatchObject({ draftId: oldId, ownerId: 'account-a' });
});
it('pins the first displayed generation across refresh/latest changes and a selected-memory review round trip', async () => {
  await render(<GenerateStory {...props()} />); await ready();
  latest = draft(newId, 7); records.set(newId, latest);
  await act(() => panel().onRefresh()); await ready();
  expect(required(panel().state.draft).draft_id).toBe(oldId); expect(panel().state.verification).toBeNull();
  await act(() => panel().onReviewMemories()); expect(review).toHaveBeenCalledWith(oldId);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});
it('accepts reuse of ANY older generation and keeps the later selected edit accessible', async () => {
  const older = draft(), later = draft(newId, 8); records.set(newId, later); latest = later;
  await render(<GenerateStory {...props()} />); await ready();
  jest.mocked(generateStoryDraft).mockResolvedValueOnce(older);
  await act(() => panel().onGenerate()); await waitFor(() => expect(panel().state.notice).toBe('saved'));
  expect(required(panel().state.draft).version).toBe(1); expect(required(panel().state.draft).revision).toBe(2);
  expect(panel().state.verification).toBeNull();
  expect(panel().state.previousGeneration).toEqual({ draftId: newId, version: 8 });
  await act(() => required(panel().onPreviousGeneration)()); await ready();
  expect(required(panel().state.draft).draft_id).toBe(newId); expect(generateStoryDraft).toHaveBeenCalledTimes(1);
});
it('retains stable action and previous-selection metadata across uncertainty and a same-owner remount', async () => {
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  const tree = () => <GenerationActionsProvider><GenerateStory {...props()} /></GenerationActionsProvider>;
  const view = await render(tree()); await ready(); await act(() => panel().onGenerate());
  await waitFor(() => expect(panel().state.phase).toBe('uncertain'));
  const action = jest.mocked(generateStoryDraft).mock.calls[0][0];
  const next = draft(newId, 2); records.set(newId, next); latest = next;
  await view.rerender(<GenerationActionsProvider>{null}</GenerationActionsProvider>); await view.rerender(tree());
  await waitFor(() => expect(panel().state.canRetry).toBe(true));
  expect(panel().state.notice).not.toBe('saved'); expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  await act(() => panel().onRetry()); await waitFor(() => expect(panel().state.notice).toBe('saved'));
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0]).toMatchObject({ idempotencyKey: action.idempotencyKey, input: action.input });
  expect(panel().state.previousGeneration).toEqual({ draftId: oldId, version: 1 });
});
it('restores only the selected generation UUID after private views unmount for same-owner revalidation', async () => {
  const tree = () => <GenerationActionsProvider><GenerateStory {...props()} /></GenerationActionsProvider>;
  const view = await render(tree()); await ready();
  latest = draft(newId, 5); records.set(newId, latest);
  jest.mocked(useAuth).mockReturnValue({ status: 'checking', user: null, appActive: false } as ReturnType<typeof useAuth>);
  await view.rerender(<GenerationActionsProvider>{null}</GenerationActionsProvider>);
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-in', user: { id: 'account-a' }, appActive: true } as ReturnType<typeof useAuth>);
  await view.rerender(tree()); await ready();
  expect(required(panel().state.draft).draft_id).toBe(oldId); expect(panel().state.verification).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled();
});
it.each(['CLARIFICATION_REQUIRED', 'STORY_CONTEXT_CHANGED', 'NO_SUPPORTED_MEMORIES'] as const)
  ('preserves earlier wording after %s and returns review to the selected identity', async code => {
    await render(<GenerateStory {...props()} />); await ready();
    jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryDraftsError('conflict', 409, false, code));
    await act(() => panel().onGenerate()); await waitFor(() => expect(panel().state.code).toBe(code));
    expect(records.get(oldId)?.content).toBe(draft().content);
    await act(() => panel().onReviewMemories()); expect(review).toHaveBeenCalledWith(oldId);
    expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  });
it('revalidates the selected resource and locks repeat Continue taps without a parent continuation or generation POST', async () => {
  await render(<GenerateStory {...props()} />); await ready();
  const pending = deferred<StoryDraft>(); jest.mocked(getStoryDraft).mockReturnValueOnce(pending.promise);
  const go = required(panel().onContinueStory);
  await act(() => { go(); go(); go(); });
  expect(proceed).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  await act(async () => pending.resolve(draft()));
  expect(proceed).toHaveBeenCalledTimes(1); expect(proceed).toHaveBeenCalledWith(oldId);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(['authentication', 'forbidden', 'not-found', 'network'] as const)('does not continue after a failed selected-draft check: %s', async kind => {
  await render(<GenerateStory {...props()} />); await ready();
  jest.mocked(getStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind));
  await act(() => required(panel().onContinueStory)()); await waitFor(() => expect(panel().state.error).toBe(kind));
  expect(proceed).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
});
it('blocks stale parent actions while the unsaved editor owns navigation', async () => {
  await render(<GenerateStory {...props()} />); await ready(); const oldPanel = panel();
  await act(() => required(oldPanel.onEdit)()); const editor = child(DraftEditing);
  await act(() => { required(oldPanel.onContinueStory)(); required(oldPanel.onGenerations)(); oldPanel.onReviewMemories(); oldPanel.onGenerate(); });
  expect(proceed).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
  expect(GenerationBrowser).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(editor).toMatchObject({ draftId: oldId, mode: 'edit' });
});
it('browses and freshly loads the deliberate older selection before editing/history/export, never selecting latest implicitly', async () => {
  latest = draft(newId, 9); records.set(newId, latest);
  await render(<GenerateStory {...props()} />); await ready();
  await act(() => required(panel().onGenerations)()); const browser = child(GenerationBrowser);
  expect(browser).toMatchObject({ ownerId: 'account-a', selectedDraftId: newId });
  await act(() => browser.onSelect(draft())); await ready();
  expect(required(panel().state.draft).draft_id).toBe(oldId); expect(panel().state.verification).toBeNull();
  await act(() => required(panel().onHistory)()); const history = child(DraftEditing); expect(history).toMatchObject({ mode: 'history', draftId: oldId });
  await act(() => history.onBack()); await ready();
  await act(() => required(panel().onEdit)()); const editor = child(DraftEditing); expect(editor.draftId).toBe(oldId);
  await act(() => editor.onBack()); await ready();
  await act(() => required(panel().onExport)()); const pdf = child(StoryExports); expect(pdf.draftId).toBe(oldId);
  await act(() => pdf.onBack()); await ready();
  expect(required(panel().state.draft).draft_id).toBe(oldId); expect(generateStoryDraft).not.toHaveBeenCalled();
});
it('ignores an obsolete browser callback after it closes or a dirty editor opens', async () => {
  await render(<GenerateStory {...props()} />); await ready();
  await act(() => required(panel().onGenerations)()); const stale = child(GenerationBrowser);
  await act(() => stale.onBack()); await ready(); await act(() => required(panel().onEdit)());
  await act(() => { stale.onSelect(draft(newId, 2)); stale.onBack(); stale.onSignOut(); });
  expect(child(DraftEditing).draftId).toBe(oldId); expect(signOut).not.toHaveBeenCalled();
});
it('does not navigate on a selected-resource response after sign-out/unmount or account change', async () => {
  const view = await render(<GenerateStory {...props()} />); await ready();
  const pending = deferred<StoryDraft>(); jest.mocked(getStoryDraft).mockReturnValueOnce(pending.promise);
  await act(() => required(panel().onContinueStory)()); await act(async () => {});
  const signal = jest.mocked(getStoryDraft).mock.calls.at(-1)![0].signal!;
  await view.rerender(<GenerateStory {...props()} user={{ id: 'account-b', email: 'b@example.test' }} />);
  await ready(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(draft())); expect(proceed).not.toHaveBeenCalled();
});
it('cancels and ignores continuation checks on background without changing a saved draft', async () => {
  let change!: (value: 'active' | 'background') => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { change = listener; return { remove: jest.fn() }; });
  await render(<GenerateStory {...props()} />); await ready();
  const staleReview = panel().onReviewMemories;
  const pending = deferred<StoryDraft>(); jest.mocked(getStoryDraft).mockReturnValueOnce(pending.promise);
  await act(() => required(panel().onContinueStory)()); await act(async () => {});
  await act(() => change('background')); await act(async () => pending.resolve(draft()));
  await act(() => staleReview()); expect(review).not.toHaveBeenCalled();
  expect(proceed).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  await act(() => change('active')); await ready(); expect(required(panel().state.draft).content).toBe(draft().content);
});
