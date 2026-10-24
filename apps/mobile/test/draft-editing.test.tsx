import { getComponent } from './component-probe';
import { act, render, waitFor, cleanup } from '@testing-library/react-native';
import { Alert, AppState, BackHandler } from 'react-native';
import { DraftEditing, coherentHistory, type DraftEditingProps } from '../src/generation/DraftEditing';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { DraftHistoryScreen } from '../src/generation/DraftHistoryScreen';
import { editStoryDraft, getStoryDraft, listDraftHistory, type StoryDraft, type StoryEdit } from '../src/api/story-drafts';
import { StoryProjectsError } from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';


function required<T>(value: T): NonNullable<T> {
  expect(value).not.toBeNull(); expect(value).not.toBeUndefined();
  if (value === null || value === undefined) throw new Error('Expected required test value.');
  return value;
}

jest.mock('../src/generation/DraftEditorScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/DraftEditorScreen')>('../src/generation/DraftEditorScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, DraftEditorScreen: observeComponent(actual.DraftEditorScreen) };
});

jest.mock('../src/generation/DraftHistoryScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/DraftHistoryScreen')>('../src/generation/DraftHistoryScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, DraftHistoryScreen: observeComponent(actual.DraftHistoryScreen) };
});

jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  editStoryDraft: jest.fn(), getStoryDraft: jest.fn(), listDraftHistory: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
const projectId = '10000000-0000-4000-8000-000000000001', draftId = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const original = 'I grew up in Malmö.';
function draft(revision = 1, content = original, language: 'en' | 'sv' = 'en'): StoryDraft {
  const first = language === 'sv' ? 'Jag växte upp i Malmö.' : original;
  return { draft_id: draftId, project_id: projectId, language, status: revision === 1 ? 'ready_for_review' : 'edited',
    style: 'warm', version: 1, revision, content: revision === 1 ? first : content, original_content: first, mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
      evidence: first, corrected_value: null, year: null, slot: 'grew_up_location', sentence: first }],
    verification: { status: revision === 1 ? 'passed' : 'needs_review', unsupported_claims: [],
      method: revision === 1 ? 'deterministic_mock_v1' : 'manual_unverified', checked_revision: revision,
      checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp };
}
function row(revision: number, content: string, previous_content: string): StoryEdit {
  return { id: '60000000-0000-4000-8000-' + String(revision).padStart(12, '0'), draft_id: draftId,
    revision, content, previous_content, created_at: stamp };
}
const token = jest.fn(async (_owner: string) => 'synthetic-token'), back = jest.fn(), signOut = jest.fn();
function props(changes: Partial<DraftEditingProps> = {}): DraftEditingProps {
  return { mode: 'edit', language: 'en', storyLanguage: 'en', title: 'Fictional test', ownerId: 'account-a', projectId, draftId,
    baseUrl: 'http://192.168.20.30:8000', getAccessToken: token, onBack: back, onSignOut: signOut, ...changes };
}
const editor = () => getComponent(DraftEditorScreen).props;
const history = () => getComponent(DraftHistoryScreen).props;
async function ready() { await waitFor(() => expect(editor().state.phase).toBe('editing')); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
let appChange: (state: 'active' | 'inactive' | 'background') => void;
beforeEach(() => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(getStoryDraft).mockReset().mockResolvedValue(draft());
  jest.mocked(editStoryDraft).mockReset().mockResolvedValue(draft(2, 'My fictional edit.'));
  jest.mocked(listDraftHistory).mockReset().mockResolvedValue({ items: [], hasMore: false });
  token.mockClear(); back.mockClear(); signOut.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { appChange = listener; return { remove: jest.fn() }; });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each(['en', 'sv'] as const)('loads actual saved %s draft GET-only through current-owner accessor', async language => {
  jest.mocked(getStoryDraft).mockResolvedValue(draft(1, original, language));
  await render(<DraftEditing {...props({ language, storyLanguage: language })} />); await ready();
  expect(editor().state.text).toBe(draft(1, original, language).content);
  expect(editStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  const options = jest.mocked(getStoryDraft).mock.calls[0][0];
  expect(options).toMatchObject({ projectId, draftId, expectedLanguage: language });
  await options.getAccessToken(); expect(token).toHaveBeenCalledWith('account-a');
});
it.each(['', ' ', '\t\n', '\u0085', '\u200b\u2060', '\u2800', 'x'.repeat(20_001), '\0', '\ud800'])(
  'invalid text never reaches PATCH (%j)', async value => {
    await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText(value)); await act(() => editor().onSave());
    expect(editor().state.validation).toBeDefined(); expect(editStoryDraft).not.toHaveBeenCalled();
  });
it.each(['A fictional English edit.', 'En påhittad berättelse om Åsa.', 'First paragraph.\n\nSecond paragraph.'])(
  'explicit save freezes normalized valid wording and expected revision: %s', async content => {
    jest.mocked(editStoryDraft).mockResolvedValueOnce(draft(2, content));
    await render(<DraftEditing {...props()} />); await ready();
    await act(() => editor().onChangeText(' \u0085' + content + ' \n')); await act(() => editor().onSave());
    await waitFor(() => expect(editor().state.phase).toBe('saved'));
    expect(jest.mocked(editStoryDraft).mock.calls[0][0]).toMatchObject({ baseline: draft(), input: { content, expected_revision: 1 } });
    expect(editor().state.text).toBe(content); expect(editor().state.dirty).toBe(false);
    expect(required(editor().state.draft).original_content).toBe(original); expect(required(editor().state.draft).verification.status).toBe('needs_review');
  });
it('duplicate saves lock synchronously and preserve the first frozen text', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(editStoryDraft).mockReturnValueOnce(pending.promise);
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('First wording.'));
  const save = editor().onSave; await act(() => { save(); save(); editor().onChangeText('Wrong later wording.'); save(); });
  expect(editStoryDraft).toHaveBeenCalledTimes(1); expect(editor().state.text).toBe('First wording.');
  await act(async () => pending.resolve(draft(2, 'First wording.')));
});
it('unchanged normalized save does not claim a new manual revision', async () => {
  jest.mocked(editStoryDraft).mockResolvedValueOnce(draft());
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText(' ' + original + ' ')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('saved'));
  expect(required(editor().state.draft).revision).toBe(1); expect(required(editor().state.draft).verification.status).toBe('passed');
});
it.each(['network', 'timeout', 'invalid-response', 'unavailable'] as const)('%s performs GET reconciliation before any same-payload retry', async kind => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.canRetry).toBe(true));
  expect(getStoryDraft).toHaveBeenCalledTimes(2); expect(editStoryDraft).toHaveBeenCalledTimes(1);
  await act(() => editor().onChangeText('Different write blocked.')); expect(editor().state.text).toBe('My fictional edit.');
  await act(() => editor().onRetry()); await waitFor(() => expect(editor().state.phase).toBe('saved'));
  expect(getStoryDraft).toHaveBeenCalledTimes(3); expect(editStoryDraft).toHaveBeenCalledTimes(2);
  expect(jest.mocked(editStoryDraft).mock.calls[1][0].input).toEqual(jest.mocked(editStoryDraft).mock.calls[0][0].input);
});
it('completed immediately previous save is confirmed by GET without a second PATCH', async () => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockResolvedValue(draft(2, 'My fictional edit.'));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('saved'));
  expect(editStoryDraft).toHaveBeenCalledTimes(1); expect(editor().state.dirty).toBe(false);
});
it.each(['RATE_LIMITED', 'API_BUSY'] as const)('%s retains wording/revision and waits for explicit reconciliation', async code => {
  const advice = { code, retryAfterSeconds: 60, retryAt: Date.now() + 60_000 };
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('unavailable', code === 'RATE_LIMITED' ? 429 : 503, false, advice));
  await render(<DraftEditing {...props()} />); await ready();
  await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('uncertain'));
  expect(editor().state.text).toBe('My fictional edit.');
  expect(getStoryDraft).toHaveBeenCalledTimes(1); // No automatic reconciliation.
  expect(editor().state.canRetry).toBe(false);
  await act(() => editor().onCheck());
  await waitFor(() => expect(editor().state.canRetry).toBe(true));
  await act(() => editor().onRetry());
  await waitFor(() => expect(editor().state.phase).toBe('saved'));
  expect(jest.mocked(editStoryDraft).mock.calls[1][0].input).toEqual(jest.mocked(editStoryDraft).mock.calls[0][0].input);
  expect(jest.mocked(editStoryDraft).mock.calls[1][0].input.expected_revision).toBe(1);
});
it('later equal text is a conflict, not proof of this exact completed edit', async () => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockResolvedValue(draft(4, 'My fictional edit.'));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('conflict')); expect(editStoryDraft).toHaveBeenCalledTimes(1);
});
it.each(['useLatest', 'keepMine'])('409 keeps both texts and %s is deliberate and never writes automatically', async choice => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('conflict', 409));
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockResolvedValue(draft(2, 'Other saved edit.'));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('conflict'));
  expect(editor().state.text).toBe('My fictional edit.'); expect(required(editor().state.compare).content).toBe('Other saved edit.');
  await act(() => choice === 'useLatest' ? editor().onUseLatest() : editor().onKeepMine());
  expect(editor().state.text).toBe(choice === 'useLatest' ? 'Other saved edit.' : 'My fictional edit.');
  expect(editStoryDraft).toHaveBeenCalledTimes(1);
  if (choice === 'keepMine') {
    jest.mocked(editStoryDraft).mockResolvedValueOnce(draft(3, 'My fictional edit.'));
    await act(() => editor().onSave()); await waitFor(() => expect(editor().state.phase).toBe('saved'));
    expect(jest.mocked(editStoryDraft).mock.calls[1][0].input.expected_revision).toBe(2);
  }
});
it('failed reconciliation stays uncertain and later Check recovers before any write', async () => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('network', undefined, true));
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockRejectedValueOnce(new StoryProjectsError('network')).mockResolvedValue(draft());
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('uncertain'));
  expect(editor().state.canRetry).toBe(false); await act(() => editor().onRetry()); expect(editStoryDraft).toHaveBeenCalledTimes(1);
  await act(() => editor().onCheck()); await waitFor(() => expect(editor().state.canRetry).toBe(true));
});
it('a transient read failure immediately before retry remains recoverable with frozen payload', async () => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.canRetry).toBe(true));
  jest.mocked(getStoryDraft).mockRejectedValueOnce(new StoryProjectsError('network'));
  await act(() => editor().onRetry()); await waitFor(() => expect(editor().state.error).toBe('network'));
  expect(editor().state.phase).toBe('uncertain'); await act(() => editor().onCheck());
  await waitFor(() => expect(editor().state.canRetry).toBe(true)); expect(editStoryDraft).toHaveBeenCalledTimes(1);
});
it.each(['validation', 'unavailable'] as const)('definite %s rejection keeps wording editable', async kind => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.error).toBe(kind)); expect(editor().state.phase).toBe('editing');
  await act(() => editor().onChangeText('Corrected fictional edit.')); expect(editor().state.text).toBe('Corrected fictional edit.');
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('%s immediately clears all private editor data and blocks further requests', async kind => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind));
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('Private fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.error).toBe(kind)); expect(editor().state.text).toBe(''); expect(editor().state.draft).toBeNull();
  await act(() => { editor().onSave(); editor().onCheck(); editor().onRetry(); }); expect(editStoryDraft).toHaveBeenCalledTimes(1);
  expect(getStoryDraft).toHaveBeenCalledTimes(1);
});
it.each([false, true])('unconfigured/sample=%s cannot call a backend or acquire a token', async sample => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(sample);
  await render(<DraftEditing {...props({ baseUrl: sample ? props().baseUrl : null })} />);
  await waitFor(() => expect(editor().state.error).toBe('configuration'));
  expect(getStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});
it.each(['en', 'sv'] as const)('%s dirty Cancel requires deliberate discard and Keep editing retains words', async language => {
  await render(<DraftEditing {...props({ language })} />); await ready(); await act(() => editor().onChangeText('Unsaved fictional words.'));
  await act(() => editor().onBack()); expect(back).not.toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!; expect(buttons[0].text).toBe(draftEditingCopy[language].stay);
  await act(() => buttons[0].onPress?.()); expect(editor().state.text).toBe('Unsaved fictional words.');
  await act(() => editor().onBack()); await act(() => jest.mocked(Alert.alert).mock.calls[1][2]![1].onPress?.());
  expect(back).toHaveBeenCalledTimes(1); expect(editor().state.text).toBe(''); expect(editStoryDraft).not.toHaveBeenCalled();
});
it('Android back uses the same dirty guard', async () => {
  let hardware!: Parameters<typeof BackHandler.addEventListener>[1];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => { hardware = callback; return { remove: jest.fn() }; });
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('Unsaved words.'));
  await act(() => expect(hardware({} as Parameters<typeof hardware>[0])).toBe(true)); expect(Alert.alert).toHaveBeenCalledTimes(1); expect(back).not.toHaveBeenCalled();
});
it.each(['signout', 'background', 'unmount', 'account', 'draft'] as const)('%s cancels a pending save and hides late private data', async change => {
  const pending = deferred<StoryDraft>(); jest.mocked(editStoryDraft).mockReturnValueOnce(pending.promise);
  const view = await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('Private fictional edit.')); await act(() => editor().onSave());
  const signal = jest.mocked(editStoryDraft).mock.calls[0][0].signal!;
  if (change === 'unmount') await view.unmount();
  else if (change === 'signout') await act(() => editor().onSignOut());
  else if (change === 'background') await act(() => appChange('inactive'));
  else {
    jest.mocked(getStoryDraft).mockResolvedValue(draft());
    await view.rerender(<DraftEditing {...props(change === 'account' ? { ownerId: 'account-b' } : { draftId: '20000000-0000-4000-8000-000000000002' })} />);
    await ready();
  }
  expect(signal.aborted).toBe(true); await act(async () => pending.resolve(draft(2, 'Private fictional edit.')));
  if (change !== 'unmount') expect(editor().state.text).not.toBe('Private fictional edit.');
  if (change === 'signout') expect(signOut).toHaveBeenCalledTimes(1);
});
it('foreground re-reads saved baseline without restoring private unsaved words or reissuing PATCH', async () => {
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('Unsaved words.'));
  await act(() => appChange('background')); expect(editor().state.text).toBe(''); await act(() => appChange('active')); await ready();
  expect(editor().state.text).toBe(original); expect(editStoryDraft).not.toHaveBeenCalled();
});
it('history reads actual immutable original and coherent ordered rows with two-row pagination', async () => {
  const current = draft(4, 'Fourth'); jest.mocked(getStoryDraft).mockResolvedValue(current);
  jest.mocked(listDraftHistory).mockResolvedValueOnce({ items: [row(4, 'Fourth', 'Third'), row(3, 'Third', 'Second')], hasMore: true })
    .mockResolvedValueOnce({ items: [row(2, 'Second', original)], hasMore: false });
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.phase).toBe('ready'));
  expect(history().state.items.map((item: StoryEdit) => item.revision)).toEqual([4, 3]);
  await act(() => history().onLoadMore()); await waitFor(() => expect(history().state.items).toHaveLength(3));
  expect(jest.mocked(listDraftHistory).mock.calls[1][0]).toMatchObject({ limit: 2, offset: 2 });
  expect(history().state.hasMore).toBe(false); expect(required(history().state.draft).original_content).toBe(original);
  expect(editStoryDraft).not.toHaveBeenCalled();
});
it('history refresh resets pagination and never mutates', async () => {
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.phase).toBe('ready'));
  await act(() => history().onRefresh()); await waitFor(() => expect(listDraftHistory).toHaveBeenCalledTimes(2));
  expect(jest.mocked(listDraftHistory).mock.calls[1][0].offset).toBe(0); expect(editStoryDraft).not.toHaveBeenCalled();
});
it('history detects an edit during reads and discards mixed data', async () => {
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockResolvedValue(draft(2, 'Concurrent'));
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.error).toBe('conflict'));
  expect(history().state.items).toEqual([]); expect(history().state.draft).toBeNull();
});
it.each(['authentication', 'forbidden', 'not-found', 'network', 'timeout', 'invalid-response'] as const)('history %s fails without invented rows', async kind => {
  jest.mocked(listDraftHistory).mockRejectedValue(new StoryProjectsError(kind));
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.error).toBe(kind));
  expect(history().state.items).toEqual([]); expect(history().state.draft).toBeNull(); expect(editStoryDraft).not.toHaveBeenCalled();
});
it('history sign-out cancels late rows', async () => {
  const pending = deferred<{ items: StoryEdit[]; hasMore: boolean }>(); jest.mocked(listDraftHistory).mockReturnValueOnce(pending.promise);
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(listDraftHistory).toHaveBeenCalled());
  const signal = jest.mocked(listDraftHistory).mock.calls[0][0].signal!; await act(() => history().onSignOut());
  await act(async () => pending.resolve({ items: [], hasMore: false })); expect(signal.aborted).toBe(true); expect(history().state.draft).toBeNull();
});
it('coherence rejects missing, reordered, duplicated, wrong-scope or fabricated history links', () => {
  const current = draft(3, 'Third'), rows = [row(3, 'Third', 'Second'), row(2, 'Second', original)];
  expect(coherentHistory(current, rows, false)).toBe(true);
  for (const invalid of [[], rows.slice().reverse(), [rows[0], rows[0]], [row(3, 'Third', 'Wrong'), rows[1]],
    [{ ...rows[0], draft_id: projectId }, rows[1]], [rows[0], row(2, 'Second', 'Wrong original')]]) {
    expect(coherentHistory(current, invalid, false)).toBe(false);
  }
});
it('inconsistent history row content is never shown as a verified saved revision', async () => {
  jest.mocked(getStoryDraft).mockResolvedValue(draft(2, 'Actual'));
  jest.mocked(listDraftHistory).mockResolvedValue({ items: [row(2, 'Fabricated', original)], hasMore: false });
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.error).toBe('invalid-response'));
  expect(history().state.items).toEqual([]);
});

it('cannot accept changed immutable evidence during uncertain reconciliation', async () => {
  jest.mocked(editStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  const changed = draft(2, 'My fictional edit.'); changed.source_memories[0].evidence = 'Different evidence';
  jest.mocked(getStoryDraft).mockResolvedValueOnce(draft()).mockResolvedValue(changed);
  await render(<DraftEditing {...props()} />); await ready(); await act(() => editor().onChangeText('My fictional edit.')); await act(() => editor().onSave());
  await waitFor(() => expect(editor().state.phase).toBe('uncertain'));
  expect(editor().state.error).toBe('invalid-response'); expect(editor().state.canRetry).toBe(false);
  expect(required(editor().state.draft).revision).toBe(1); expect(editStoryDraft).toHaveBeenCalledTimes(1);
});
it('full last history page still validates the original and does not invent another page', async () => {
  jest.mocked(getStoryDraft).mockResolvedValue(draft(3, 'Third'));
  jest.mocked(listDraftHistory).mockResolvedValue({ items: [row(3, 'Third', 'Second'), row(2, 'Second', original)], hasMore: true });
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.phase).toBe('ready'));
  expect(history().state.hasMore).toBe(false); expect(history().state.bounded).toBe(false);
  await act(() => history().onLoadMore()); expect(listDraftHistory).toHaveBeenCalledTimes(1);
  expect(coherentHistory(draft(3, 'Third'), [row(3, 'Third', 'Second'), row(2, 'Second', 'Wrong')], true)).toBe(false);
});
it('large history stops at 200 retained rows and marks the list incomplete', async () => {
  const total = 250;
  jest.mocked(getStoryDraft).mockResolvedValue(draft(total, 'Revision ' + total));
  jest.mocked(listDraftHistory).mockImplementation(async options => {
    const revision = total - (options.offset ?? 0);
    return { items: [row(revision, 'Revision ' + revision, 'Revision ' + (revision - 1)),
      row(revision - 1, 'Revision ' + (revision - 1), 'Revision ' + (revision - 2))], hasMore: true };
  });
  await render(<DraftEditing {...props({ mode: 'history' })} />); await waitFor(() => expect(history().state.phase).toBe('ready'));
  for (let page = 1; page < 100; page++) {
    await act(async () => { history().onLoadMore(); });
  }
  expect(history().state.items).toHaveLength(200); expect(history().state.bounded).toBe(true);
  expect(history().state.hasMore).toBe(false); await act(() => history().onLoadMore());
  expect(listDraftHistory).toHaveBeenCalledTimes(100); expect(editStoryDraft).not.toHaveBeenCalled();
}, 30_000);
