import { requireCallback } from './root-shell-helpers';
import { getComponent, maybeComponent } from './component-probe';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, BackHandler } from 'react-native';
import * as Crypto from 'expo-crypto';
import { GenerateStory } from '../src/generation/GenerateStory';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { StoryExports } from '../src/exports/StoryExports';
import { listStoryDrafts, getStoryDraft, getStoryVerification, generateStoryDraft, editStoryDraft,
  listDraftHistory, type StoryDraft, type StoryProjectVerification } from '../src/api/story-drafts';
import { StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import type { Language } from '../src/i18n';

jest.mock('../src/generation/DraftEditorScreen', () => { const actual = jest.requireActual<typeof import('../src/generation/DraftEditorScreen')>('../src/generation/DraftEditorScreen'); return { ...actual, DraftEditorScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.DraftEditorScreen) }; });
jest.mock('../src/generation/StoryDraftScreen', () => { const actual = jest.requireActual<typeof import('../src/generation/StoryDraftScreen')>('../src/generation/StoryDraftScreen'); return { ...actual, StoryDraftScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.StoryDraftScreen) }; });
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  listStoryDrafts: jest.fn(), getStoryDraft: jest.fn(), getStoryVerification: jest.fn(),
  generateStoryDraft: jest.fn(), editStoryDraft: jest.fn(), listDraftHistory: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
// The actual generation/editor controllers are exercised. Export I/O has its own
// controller tests; this boundary probe checks navigation without native files.
jest.mock('../src/exports/StoryExports', () => ({ StoryExports: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));

const projectId = '11000000-0000-4000-8000-000000000001';
const draftId = '21000000-0000-4000-8000-000000000001';
const actionKey = '31000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const localWording = 'I grew up in Malmö. Unsaved fictional correction.';
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title: 'Fictional PDF routing story',
  description: null, language, status: 'draft', created_at: stamp, updated_at: stamp });
const draft = (changes: Partial<StoryDraft> = {}): StoryDraft => {
  const language = changes.language ?? 'en';
  const original = language === 'sv' ? 'Jag växte upp i Malmö.' : 'I grew up in Malmö.';
  return { draft_id: draftId, project_id: projectId, status: 'edited', language, style: 'warm', version: 2, revision: 2,
    content: original + (language === 'sv' ? ' Mina egna fiktiva ord.' : ' My own fictional wording.'),
    original_content: original, mode: 'mock',
    source_memories: [{ memory_id: '41000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '51000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
      evidence: original.slice(0, -1), corrected_value: null, year: null, slot: 'grew_up_location', sentence: original }],
    verification: { status: 'needs_review', unsupported_claims: [], method: 'manual_unverified', checked_revision: 2,
      checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp, ...changes };
};
const report = (value: StoryDraft): StoryProjectVerification => ({ project_id: value.project_id, draft_id: value.draft_id,
  version: value.version, revision: value.revision, verification: value.verification });
const token = jest.fn(async (_owner: string) => 'synthetic-development-user-access-token');
const back = jest.fn(), signOut = jest.fn(), review = jest.fn();
const props = (language: Language = 'en') => ({ language, user: { id: 'account-a', email: 'account-a@example.test' },
  project: project(language), getAccessToken: token, onBack: back, onSignOut: signOut, onReviewMemories: review });
function saved(value = draft()) {
  jest.mocked(listStoryDrafts).mockResolvedValue([value]); jest.mocked(getStoryDraft).mockResolvedValue(value);
  jest.mocked(getStoryVerification).mockResolvedValue(report(value));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const draftView = () => getComponent(StoryDraftScreen).props;
const exportView = () => getComponent(StoryExports).props;
async function ready() { await waitFor(() => expect(draftView().state.phase).toBe('ready')); }
async function enter(language: Language = 'en') {
  const view = await render(<GenerateStory {...props(language)} />); await ready(); return view;
}
async function dismissWarning(keep: boolean) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const button = buttons?.find(item => item.style === (keep ? 'cancel' : 'destructive'));
  expect(button?.onPress).toBeDefined(); await act(() => { button!.onPress!(); });
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(listStoryDrafts).mockReset(); jest.mocked(getStoryDraft).mockReset(); jest.mocked(getStoryVerification).mockReset();
  jest.mocked(generateStoryDraft).mockReset(); jest.mocked(editStoryDraft).mockReset(); jest.mocked(listDraftHistory).mockReset();
  jest.mocked(StoryExports).mockClear();
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(actionKey);
  token.mockClear(); back.mockClear(); signOut.mockClear(); review.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {}); saved();
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each<Language>(['en', 'sv'])('offers explicit PDF export only from the actual ready saved %s draft', async language => {
  const value = draft({ language }); saved(value); await enter(language);
  const label = storyGenerationCopy[language].export;
  expect(screen.getByRole('button', { name: label })).toBeOnTheScreen(); expect(StoryExports).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(exportView()).toMatchObject({ language, storyLanguage: language, title: project(language).title,
    ownerId: 'account-a', projectId, draftId, baseUrl: 'http://192.168.20.30:8000' });
  expect(exportView().getAccessToken).toBe(token);
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  const read = jest.mocked(getStoryDraft).mock.calls[0][0];
  await read.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
});

it('does not expose PDF export or navigate through a stale callback before the saved draft loads', async () => {
  const pending = deferred<StoryDraft[]>(); jest.mocked(listStoryDrafts).mockReturnValueOnce(pending.promise);
  await render(<GenerateStory {...props()} />); const stale = requireCallback(draftView().onExport);
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.export })).toBeNull(); await act(() => stale());
  expect(StoryExports).not.toHaveBeenCalled(); await act(async () => pending.resolve([draft()])); await ready();
  expect(StoryExports).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('does not offer an export when no saved autobiography exists', async () => {
  jest.mocked(listStoryDrafts).mockResolvedValue([]);
  jest.mocked(getStoryVerification).mockResolvedValue({ project_id: projectId, draft_id: null, version: null, revision: null,
    verification: { status: 'not_generated', unsupported_claims: [], method: 'none', checked_revision: null,
      checked_at: null, sources_current: true, reason: null } });
  await enter(); expect(screen.queryByRole('button', { name: storyGenerationCopy.en.export })).toBeNull();
  await act(() => requireCallback(draftView().onExport)()); expect(StoryExports).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('cannot export synthetic SAMPLE STORIES data or bypass missing development configuration', async () => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(true); await render(<GenerateStory {...props()} />);
  await waitFor(() => expect(draftView().state.error).toBe('configuration'));
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.export })).toBeNull(); await act(() => requireCallback(draftView().onExport)());
  expect(StoryExports).not.toHaveBeenCalled(); expect(getStoryDraft).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('blocks stale export callbacks while generation has an uncertain outcome', async () => {
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await enter(); const stale = requireCallback(draftView().onExport); await act(() => requireCallback(draftView().onGenerate)());
  await waitFor(() => expect(draftView().state.phase).toBe('uncertain'));
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.export })).toBeNull(); await act(() => stale());
  expect(StoryExports).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('cannot bypass dirty editor navigation through captured Export, Generate or Refresh callbacks', async () => {
  await enter(); const old = draftView(); await act(() => requireCallback(old.onEdit)());
  await waitFor(() => expect(getComponent(DraftEditorScreen).props.state.phase).toBe('editing'));
  await fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  const reads = jest.mocked(getStoryDraft).mock.calls.length;
  await act(() => { requireCallback(old.onExport)(); requireCallback(old.onGenerate)(); old.onRefresh(); requireCallback(old.onHistory)(); });
  expect(StoryExports).not.toHaveBeenCalled(); expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(localWording);
  expect(getStoryDraft).toHaveBeenCalledTimes(reads); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(Crypto.randomUUID).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.back }));
  expect(Alert.alert).toHaveBeenCalledTimes(1); await dismissWarning(true);
  expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(localWording); expect(StoryExports).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.back })); await dismissWarning(false); await ready();
  expect(screen.queryByLabelText(draftEditingCopy.en.field)).toBeNull(); await act(() => requireCallback(draftView().onExport)());
  expect(exportView().draftId).toBe(draftId); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('prevents same-tick duplicate navigation from replacing the selected export with an editor', async () => {
  await enter(); const old = draftView(); await act(() => { requireCallback(old.onExport)(); requireCallback(old.onEdit)(); requireCallback(old.onHistory)(); requireCallback(old.onGenerate)(); });
  expect(getComponent(StoryExports)).toBeDefined(); expect(maybeComponent(DraftEditorScreen)).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('returning from PDF export rereads the selected saved draft rather than generating or inserting content', async () => {
  await enter(); await act(() => requireCallback(draftView().onExport)());
  const revised = draft({ revision: 3, content: 'The actually saved fictional revision.',
    verification: { ...draft().verification, checked_revision: 3 } }); saved(revised);
  await act(() => exportView().onBack()); await ready();
  expect(screen.getByText(revised.content)).toBeOnTheScreen();
  expect(jest.mocked(getStoryDraft).mock.calls.at(-1)![0]).toMatchObject({ draftId, projectId, expectedLanguage: 'en' });
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
});

it('an account change unmounts the export view and cannot reuse its private selection', async () => {
  const view = await enter(); await act(() => requireCallback(draftView().onExport)()); expect(exportView().ownerId).toBe('account-a');
  const other = draft({ draft_id: '21000000-0000-4000-8000-000000000002', content: 'Account B fictional saved story.' }); saved(other);
  await view.rerender(<GenerateStory {...props()} user={{ id: 'account-b', email: 'account-b@example.test' }} />); await ready();
  expect(maybeComponent(StoryExports)).toBeNull(); expect(screen.getByText(other.content)).toBeOnTheScreen();
  await act(() => requireCallback(draftView().onExport)()); expect(exportView()).toMatchObject({ ownerId: 'account-b', draftId: other.draft_id });
  const read = jest.mocked(getStoryDraft).mock.calls.at(-1)![0]; await read.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-b');
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});

it('signing out from the export view clears the private parent preview immediately', async () => {
  await enter(); await act(() => requireCallback(draftView().onExport)()); await act(() => exportView().onSignOut());
  expect(signOut).toHaveBeenCalledTimes(1); expect(screen.queryByText(draft().content)).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('requires a real confirmed editor save and fresh preview before exporting the saved revision', async () => {
  await enter(); await act(() => requireCallback(draftView().onEdit)());
  await waitFor(() => expect(getComponent(DraftEditorScreen).props.state.phase).toBe('editing'));
  await fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), localWording);
  const revised = draft({ revision: 3, content: localWording,
    verification: { ...draft().verification, checked_revision: 3 } });
  jest.mocked(editStoryDraft).mockResolvedValueOnce(revised);
  await fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.save }));
  await screen.findByText(draftEditingCopy.en.saved); saved(revised);
  await fireEvent.press(screen.getByRole('button', { name: draftEditingCopy.en.back })); await ready();
  expect(draftView().state.draft).toMatchObject({ revision: 3, content: localWording });
  expect(screen.queryByRole('button', { name: storyGenerationCopy.en.export })).not.toBeNull();
  await act(() => requireCallback(draftView().onExport)()); expect(exportView()).toMatchObject({ draftId, ownerId: 'account-a' });
  expect(exportView()).not.toHaveProperty('content'); expect(exportView()).not.toHaveProperty('text');
  expect(editStoryDraft).toHaveBeenCalledTimes(1); expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('restores an explicitly selected older saved generation after sharing even when the latest list is newer', async () => {
  const older = draft({ version: 1, revision: 2, content: 'The selected earlier fictional generation.' });
  const newer = draft({ draft_id: '21000000-0000-4000-8000-000000000009', version: 3, revision: 1,
    status: 'ready_for_review', content: 'The newer fictional generation.', original_content: 'The newer fictional generation.',
    verification: { ...draft().verification, status: 'passed', method: 'deterministic_mock_v1', checked_revision: 1 } });
  jest.mocked(listStoryDrafts).mockResolvedValue([newer]); jest.mocked(getStoryDraft).mockResolvedValue(older);
  jest.mocked(getStoryVerification).mockResolvedValue(report(newer));
  await render(<GenerateStory {...props()} initialDraftId={older.draft_id} />); await ready();
  expect(screen.getByText(older.content)).toBeOnTheScreen(); expect(screen.queryByText(newer.content)).toBeNull();
  for (const [options] of jest.mocked(getStoryDraft).mock.calls) expect(options.draftId).toBe(older.draft_id);
  expect(draftView().state.draft).toMatchObject({ draft_id: older.draft_id, version: 1, revision: 2 });
  await act(() => requireCallback(draftView().onExport)()); expect(exportView().draftId).toBe(older.draft_id);
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
});
