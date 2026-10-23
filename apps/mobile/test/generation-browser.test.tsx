import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import { GenerationBrowser, type GenerationBrowserProps } from '../src/generation/GenerationBrowser';
import { GenerationBrowserScreen, type GenerationBrowserScreenProps } from '../src/generation/GenerationBrowserScreen';
import { getStoryDraft, listStoryDraftsPage, generateStoryDraft, editStoryDraft, getStoryVerification,
  type StoryDraft } from '../src/api/story-drafts';
import { StoryProjectsError } from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';

jest.mock('../src/generation/GenerationBrowserScreen', () => ({ GenerationBrowserScreen: jest.fn(() => null) }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  getStoryDraft: jest.fn(), listStoryDraftsPage: jest.fn(), generateStoryDraft: jest.fn(), editStoryDraft: jest.fn(), getStoryVerification: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
const projectId = '10000000-0000-4000-8000-000000000001', stamp = '2026-01-01T00:00:00Z';
function draft(version: number, changes: Partial<StoryDraft> = {}): StoryDraft {
  const content = 'I grew up in Malmö.';
  return { draft_id: `20000000-0000-4000-8000-${version.toString().padStart(12, '0')}`, project_id: projectId,
    language: 'en', status: 'ready_for_review', style: 'warm', version, revision: 1, content, original_content: content, mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö', evidence: content,
      corrected_value: null, year: null, slot: 'grew_up_location', sentence: content }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
      checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp, ...changes };
}
function sequence(start: number, count: number) { return Array.from({ length: count }, (_, index) => draft(start - index)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
const select = jest.fn(), back = jest.fn(), signOut = jest.fn(), token = jest.fn(async (_owner: string) => 'synthetic-user-token');
function props(changes: Partial<GenerationBrowserProps> = {}): GenerationBrowserProps {
  return { language: 'en', storyLanguage: 'en', title: 'Fictional memories', ownerId: 'account-a', projectId,
    selectedDraftId: draft(1).draft_id, baseUrl: 'http://192.168.20.30:8000', getAccessToken: token,
    onSelect: select, onBack: back, onSignOut: signOut, ...changes };
}
const ui = (): GenerationBrowserScreenProps => jest.mocked(GenerationBrowserScreen).mock.calls.at(-1)![0];
async function ready() { await waitFor(() => expect(ui().state.phase).toBe('ready')); }
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
let appChange: (state: 'active' | 'inactive' | 'background') => void;
beforeEach(() => {
  jest.clearAllMocks(); AppState.currentState = 'active';
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(listStoryDraftsPage).mockReset().mockResolvedValue({ items: [draft(3), draft(1)], hasMore: false });
  jest.mocked(getStoryDraft).mockReset().mockImplementation(async options => draft(Number(options.draftId.slice(-12))));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { appChange = listener; return { remove: jest.fn() }; });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => {
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled();
  expect(getStoryVerification).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  cleanup(); jest.restoreAllMocks();
});
it.each(['en', 'sv'] as const)('loads owned %s records with bounded pagination and no mutation or implicit selection', async language => {
  render(<GenerationBrowser {...props({ language, storyLanguage: language })} />); await ready();
  expect(listStoryDraftsPage).toHaveBeenCalledWith(expect.objectContaining({ projectId, expectedLanguage: language, limit: 20, offset: 0 }));
  await jest.mocked(listStoryDraftsPage).mock.calls[0][0].getAccessToken(); expect(token).toHaveBeenCalledWith('account-a');
  expect(ui().selectedDraftId).toBe(draft(1).draft_id); expect(select).not.toHaveBeenCalled(); expect(getStoryDraft).not.toHaveBeenCalled();
});
it('verifies the exact older selection by authenticated typed read and uses its own report', async () => {
  const original = draft(1), edited = draft(1, { content: 'My personal manual wording.', revision: 2, status: 'edited',
    verification: { ...original.verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 2 } });
  jest.mocked(getStoryDraft).mockResolvedValue(edited);
  render(<GenerationBrowser {...props()} />); await ready(); act(() => { ui().onOpen(original.draft_id); ui().onOpen(original.draft_id); });
  await waitFor(() => expect(select).toHaveBeenCalledTimes(1)); expect(select).toHaveBeenCalledWith(edited);
  expect(getStoryDraft).toHaveBeenCalledTimes(1);
  expect(getStoryDraft).toHaveBeenCalledWith(expect.objectContaining({ projectId, draftId: original.draft_id }));
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(3);
});
it('ignores attempts to select a record not in the actual loaded list', async () => {
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onOpen(draft(99).draft_id));
  expect(getStoryDraft).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
it('appends one ordered page only after stable head checks, preserving selected generation identity', async () => {
  const first = sequence(30, 20), second = sequence(10, 10);
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => ({ items: options.offset ? second : first, hasMore: !options.offset }));
  render(<GenerationBrowser {...props()} />); await ready(); act(() => { ui().onLoadMore(); ui().onLoadMore(); }); await ready();
  expect(ui().state.items).toEqual(first.concat(second)); expect(ui().state.hasMore).toBe(false);
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(4); expect(ui().selectedDraftId).toBe(draft(1).draft_id);
  expect(select).not.toHaveBeenCalled();
});
it.each(['duplicate', 'order'] as const)('rejects a cross-page %s without retaining an actionable stale list', async bad => {
  const first = sequence(30, 20), second = bad === 'duplicate' ? [draft(11)] : [draft(31)];
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => ({ items: options.offset ? second : first, hasMore: !options.offset }));
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onLoadMore());
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(ui().state.items).toEqual([]);
  act(() => ui().onOpen(draft(11).draft_id)); expect(select).not.toHaveBeenCalled();
});
it('detects a changed deeper page before offset paging can silently skip a deleted generation', async () => {
  let changed = false;
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => {
    const offset = options.offset ?? 0;
    return { items: sequence(60 - offset - (changed && offset > 0 ? 1 : 0), 20), hasMore: true };
  });
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onLoadMore()); await ready();
  expect(ui().state.items).toHaveLength(40); changed = true; act(() => ui().onLoadMore());
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(ui().state.items).toEqual([]);
  expect(jest.mocked(listStoryDraftsPage).mock.calls.some(([options]) => options.offset === 40)).toBe(false);
});
it('rechecks the selected older page instead of trusting only a stable newest page', async () => {
  let changed = false;
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => ({
    items: sequence(60 - (options.offset ?? 0) - (changed && options.offset ? 1 : 0), 20), hasMore: true,
  }));
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onLoadMore()); await ready();
  changed = true; act(() => ui().onOpen(draft(30).draft_id));
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(getStoryDraft).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
it.each(['before-append', 'after-append', 'before-select', 'after-select'] as const)('requires deliberate refresh if the head changes %s', async timing => {
  const first = sequence(30, 20), changed = sequence(31, 20); let heads = 0;
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => {
    if (options.offset) return { items: sequence(10, 10), hasMore: false };
    heads++; const changeAt = timing.startsWith('before') ? 2 : 3;
    return { items: heads >= changeAt ? changed : first, hasMore: true };
  });
  render(<GenerationBrowser {...props()} />); await ready();
  act(() => timing.endsWith('append') ? ui().onLoadMore() : ui().onOpen(first[0].draft_id));
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(ui().state.items).toEqual([]);
  expect(select).not.toHaveBeenCalled();
  const reads = jest.mocked(listStoryDraftsPage).mock.calls.map(([options]) => options.offset ?? 0);
  expect(reads.filter(offset => offset === 0)).toHaveLength(timing.startsWith('before') ? 2 : 3);
  expect(reads.filter(offset => offset > 0)).toEqual(timing === 'after-append' ? [20] : []);
  act(() => ui().onRefresh()); await ready(); expect(ui().state.items).toEqual(changed); expect(select).not.toHaveBeenCalled();
});
it.each(['changed-original', 'older-revision'] as const)('rejects %s on the freshly read selected generation', async change => {
  const original = draft(1);
  jest.mocked(getStoryDraft).mockResolvedValue(change === 'changed-original' ? draft(1, { created_at: '2026-01-02T00:00:00Z' })
    : draft(1, { revision: 0 }));
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onOpen(original.draft_id));
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(select).not.toHaveBeenCalled();
});
it('stops at 200 actual records and honestly reports that older generations may exist', async () => {
  jest.mocked(listStoryDraftsPage).mockImplementation(async options => ({ items: sequence(300 - (options.offset ?? 0), 20), hasMore: true }));
  render(<GenerationBrowser {...props()} />); await ready();
  for (let page = 1; page < 10; page++) { act(() => ui().onLoadMore()); await ready(); }
  expect(ui().state.items).toHaveLength(200); expect(ui().state.bounded).toBe(true); expect(ui().state.hasMore).toBe(false);
  const calls = jest.mocked(listStoryDraftsPage).mock.calls.length; act(() => ui().onLoadMore());
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(calls); expect(select).not.toHaveBeenCalled();
});
it.each(['authentication', 'forbidden', 'not-found', 'network', 'timeout', 'invalid-response', 'unavailable'] as const)('handles %s without stale selection or private server messages', async kind => {
  jest.mocked(getStoryDraft).mockRejectedValue(new StoryProjectsError(kind));
  render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onOpen(draft(1).draft_id));
  await waitFor(() => expect(ui().state.error).toBe(kind)); expect(ui().state.items).toEqual([]); expect(select).not.toHaveBeenCalled();
});
it.each(['missing-url', 'sample-preview'] as const)('makes no request in %s mode', async condition => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(condition === 'sample-preview');
  render(<GenerationBrowser {...props({ baseUrl: condition === 'missing-url' ? null : props().baseUrl })} />);
  await waitFor(() => expect(ui().state.error).toBe('configuration')); expect(listStoryDraftsPage).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});
it.each(['back', 'sign-out', 'hardware-back', 'unmount', 'background'] as const)('aborts selection and ignores late private responses after %s', async departure => {
  const pending = deferred<StoryDraft>(); jest.mocked(getStoryDraft).mockReturnValue(pending.promise);
  const view = render(<GenerationBrowser {...props()} />); await ready(); act(() => ui().onOpen(draft(1).draft_id));
  await waitFor(() => expect(getStoryDraft).toHaveBeenCalledTimes(1));
  let hardware: Parameters<typeof BackHandler.addEventListener>[1] | undefined;
  if (departure === 'hardware-back') {
    const calls = jest.mocked(BackHandler.addEventListener).mock.calls; hardware = calls.at(-1)?.[1];
  }
  act(() => {
    if (departure === 'back') ui().onBack(); else if (departure === 'sign-out') ui().onSignOut();
    else if (departure === 'hardware-back') hardware?.({ type: 'hardwareBackPress', timeStamp: 0 });
    else if (departure === 'unmount') view.unmount(); else appChange('background');
  });
  expect(jest.mocked(getStoryDraft).mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(draft(1)); await flush(); }); expect(select).not.toHaveBeenCalled();
});
it('starts a clean authenticated scope on account change and ignores the earlier owner’s list', async () => {
  const pending = deferred<{ items: StoryDraft[]; hasMore: boolean }>();
  jest.mocked(listStoryDraftsPage).mockReturnValueOnce(pending.promise);
  const view = render(<GenerationBrowser {...props()} />); await waitFor(() => expect(listStoryDraftsPage).toHaveBeenCalledTimes(1));
  const firstOptions = jest.mocked(listStoryDraftsPage).mock.calls[0][0];
  const priorListener = appChange, priorSubscription = jest.mocked(AppState.addEventListener).mock.results[0].value;
  view.rerender(<GenerationBrowser {...props({ ownerId: 'account-b' })} />); await ready();
  expect(priorSubscription.remove).toHaveBeenCalledTimes(1);
  const calls = jest.mocked(listStoryDraftsPage).mock.calls.length;
  await act(async () => { priorListener('background'); priorListener('active'); await flush(); });
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(calls);
  expect(ui().state.items.map(item => item.version)).toEqual([3, 1]);
  await act(async () => { pending.resolve({ items: [draft(99)], hasMore: false }); await flush(); });
  expect(firstOptions.signal?.aborted).toBe(true); expect(ui().state.items.map(item => item.version)).toEqual([3, 1]);
  await jest.mocked(listStoryDraftsPage).mock.calls[1][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-b');
});
it('removes its AppState subscription on unmount and ignores any already-queued old event', async () => {
  const view = render(<GenerationBrowser {...props()} />); await ready();
  const listener = appChange, subscription = jest.mocked(AppState.addEventListener).mock.results[0].value;
  const calls = jest.mocked(listStoryDraftsPage).mock.calls.length;
  view.unmount(); expect(subscription.remove).toHaveBeenCalledTimes(1);
  await act(async () => { listener('inactive'); listener('active'); await flush(); });
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(calls); expect(select).not.toHaveBeenCalled();
});
it('clears private rows on background and only refreshes reads when returning', async () => {
  render(<GenerationBrowser {...props()} />); await ready(); act(() => appChange('inactive'));
  expect(ui().state.items).toEqual([]); act(() => appChange('active')); await ready();
  expect(listStoryDraftsPage).toHaveBeenCalledTimes(2); expect(select).not.toHaveBeenCalled();
});
