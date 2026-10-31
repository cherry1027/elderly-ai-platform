import { getComponent } from './component-probe';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { DraftEditing, type DraftEditingProps } from '../src/generation/DraftEditing';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { editStoryDraft, getStoryDraft, type StoryDraft } from '../src/api/story-drafts';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';

jest.mock('../src/generation/DraftEditorScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/DraftEditorScreen')>('../src/generation/DraftEditorScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, DraftEditorScreen: observeComponent(actual.DraftEditorScreen) };
});
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  getStoryDraft: jest.fn(), editStoryDraft: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));

const original = 'A fictional childhood.';
const saved: StoryDraft = { draft_id: '20000000-0000-4000-8000-000000000001', project_id: '10000000-0000-4000-8000-000000000001',
  version: 1, revision: 1, content: original, original_content: original, status: 'ready_for_review', language: 'en', style: 'warm', mode: 'mock',
  source_memories: [], verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
    checked_at: '2026-10-24T10:00:00Z', sources_current: true, reason: null }, created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:00:00Z' };
const back = jest.fn(), signOut = jest.fn(), token = jest.fn(async () => 'synthetic-token');
let appChange: (state: 'active' | 'inactive' | 'background') => void;
const editor = () => getComponent(DraftEditorScreen).props;
const ready = () => waitFor(() => expect(editor().state.phase).toBe('editing'));
function props(language: 'en' | 'sv', ownerId = 'account-a'): DraftEditingProps {
  return { mode: 'edit', language, storyLanguage: 'en', title: 'Fictional story', ownerId,
    projectId: saved.project_id, draftId: saved.draft_id, baseUrl: 'http://192.168.20.30:8000',
    getAccessToken: token, onBack: back, onSignOut: signOut };
}
function warning(index: number) {
  const buttons = jest.mocked(Alert.alert).mock.calls[index]?.[2];
  if (!buttons?.[0]?.onPress || !buttons[1]?.onPress) throw new Error('Expected an actual pending native leave warning.');
  return { stay: buttons[0].onPress, discard: buttons[1].onPress };
}
async function open(language: 'en' | 'sv') {
  const view = await render(<DraftEditing {...props(language)} />); await ready();
  await act(() => editor().onChangeText('First unsaved fictional wording.'));
  return view;
}
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(getStoryDraft).mockReset().mockResolvedValue(saved);
  jest.mocked(editStoryDraft).mockReset();
  back.mockClear(); signOut.mockClear(); token.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') appChange = listener;
    return { remove: jest.fn() };
  });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(['en', 'sv'] as const)('B4 %s canceled warning cannot discard a later edit or retire a newer warning', async language => {
  await open(language); await act(() => editor().onBack()); const first = warning(0);
  await act(() => first.stay());
  await act(() => editor().onChangeText('Later unsaved fictional wording.'));
  await act(() => editor().onBack()); const second = warning(1);
  await act(() => { first.discard(); first.stay(); });
  expect(back).not.toHaveBeenCalled(); expect(editor().state.text).toBe('Later unsaved fictional wording.');
  await act(() => second.discard());
  expect(back).toHaveBeenCalledTimes(1); expect(editor().state.text).toBe('');
  await act(() => { first.discard(); second.discard(); });
  expect(back).toHaveBeenCalledTimes(1); expect(editStoryDraft).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 %s changed wording invalidates an unresolved old warning', async language => {
  await open(language); await act(() => editor().onBack()); const first = warning(0);
  await act(() => editor().onChangeText('Changed while an old callback was pending.'));
  await act(() => first.discard());
  expect(back).not.toHaveBeenCalled(); expect(editor().state.text).toBe('Changed while an old callback was pending.');
  await act(() => editor().onBack()); await act(() => warning(1).discard());
  expect(back).toHaveBeenCalledTimes(1); expect(editStoryDraft).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 %s foreground revalidation does not revive a pre-background discard intent', async language => {
  await open(language); await act(() => editor().onBack()); const first = warning(0);
  await act(() => appChange('background'));
  expect(editor().state.text).toBe('');
  await act(() => appChange('active')); await ready();
  await act(() => editor().onChangeText('New fictional wording after revalidation.'));
  await act(() => editor().onBack()); const second = warning(1);
  await act(() => { first.discard(); first.stay(); });
  expect(back).not.toHaveBeenCalled(); expect(editor().state.text).toBe('New fictional wording after revalidation.');
  await act(() => second.discard()); expect(back).toHaveBeenCalledTimes(1);
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(getStoryDraft).toHaveBeenCalledTimes(2);
});

it.each(['en', 'sv'] as const)('B4 %s completed save retires its warning without authorizing a later unsaved discard', async language => {
  let complete!: (value: StoryDraft) => void;
  jest.mocked(editStoryDraft).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await open(language); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('saving'));
  await act(() => editor().onBack()); const first = warning(0);
  const edited: StoryDraft = { ...saved, revision: 2, content: 'First unsaved fictional wording.', status: 'edited',
    verification: { ...saved.verification, checked_revision: 2, status: 'needs_review', method: 'manual_unverified' } };
  await act(() => complete(edited)); await waitFor(() => expect(editor().state.phase).toBe('saved'));
  expect(back).not.toHaveBeenCalled();
  await act(() => editor().onChangeText('Further unsaved fictional wording.'));
  await act(() => first.discard());
  expect(back).not.toHaveBeenCalled(); expect(editor().state.text).toBe('Further unsaved fictional wording.');
  await act(() => editor().onBack()); await act(() => warning(1).discard());
  expect(back).toHaveBeenCalledTimes(1); expect(editStoryDraft).toHaveBeenCalledTimes(1);
  expect(jest.mocked(editStoryDraft).mock.calls[0][0].input).toEqual({ content: 'First unsaved fictional wording.', expected_revision: 1 });
});

it.each(['en', 'sv'] as const)('B4 %s replacement owner cannot be affected by old warning or Back callbacks', async language => {
  const view = await open(language); const oldBack = editor().onBack;
  await act(() => oldBack()); const first = warning(0);
  await view.rerender(<DraftEditing {...props(language, 'account-b')} />); await ready();
  await act(() => editor().onChangeText('Replacement-owner fictional wording.'));
  await act(() => { first.discard(); first.stay(); oldBack(); });
  expect(back).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(editor().state.text).toBe('Replacement-owner fictional wording.');
  expect(editStoryDraft).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 %s unmounted warning cannot navigate or open a new native warning', async language => {
  const view = await open(language); const oldBack = editor().onBack;
  await act(() => oldBack()); const first = warning(0); await view.unmount();
  await act(() => { first.discard(); first.stay(); oldBack(); });
  expect(back).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(editStoryDraft).not.toHaveBeenCalled();
});
