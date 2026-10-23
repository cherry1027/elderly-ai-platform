import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import * as Crypto from 'expo-crypto';
import { StoryExports, type StoryExportsProps } from '../src/exports/StoryExports';
import { StoryExportsScreen, type StoryExportsScreenProps } from '../src/exports/StoryExportsScreen';
import { usePdfPrivacy, type PdfPrivacyValue } from '../src/exports/PdfPrivacy';
import { NativePdfError, type PrivatePdfHandle, type PrivatePdfStore } from '../src/exports/native-pdf';
import { getStoryDraft, generateStoryDraft, editStoryDraft, type StoryDraft } from '../src/api/story-drafts';
import { getStoryProject, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { downloadStoryPdf, exportStoryPdf, listStoryExports, StoryExportsError, type StoryExport, type StoryPdf } from '../src/api/story-exports';
import { patchMemory } from '../src/api/memory-review';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';

jest.mock('../src/exports/StoryExportsScreen', () => ({ StoryExportsScreen: jest.fn(() => null) }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
jest.mock('../src/exports/native-pdf', () => ({
  NativePdfError: jest.requireActual('../src/exports/native-pdf').NativePdfError,
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  getStoryDraft: jest.fn(), generateStoryDraft: jest.fn(), editStoryDraft: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), getStoryProject: jest.fn() }));
jest.mock('../src/api/story-exports', () => ({ ...jest.requireActual('../src/api/story-exports'),
  exportStoryPdf: jest.fn(), downloadStoryPdf: jest.fn(), listStoryExports: jest.fn() }));
jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'), patchMemory: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));

const projectId = '10000000-0000-4000-8000-000000000001', draftId = '20000000-0000-4000-8000-000000000001';
const exportId = '30000000-0000-4000-8000-000000000001', stamp = '2026-01-01T00:00:00Z';
const hash = 'a'.repeat(64), title = 'Fictional Malmö memories', original = 'I grew up in Malmö.';
const filename = 'memy-fictional-malmo-memories-v1-r1.pdf';
const handle: PrivatePdfHandle = Object.freeze({ id: '60000000-0000-4000-8000-000000000001' });
function draft(changes: Partial<StoryDraft> = {}): StoryDraft {
  return { draft_id: draftId, project_id: projectId, language: 'en', status: 'ready_for_review', style: 'warm',
    version: 1, revision: 1, content: original, original_content: original, mode: 'mock',
    source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
      source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö', evidence: original,
      corrected_value: null, year: null, slot: 'grew_up_location', sentence: original }],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
      checked_at: stamp, sources_current: true, reason: null }, created_at: stamp, updated_at: stamp, ...changes };
}
function project(changes: Partial<StoryProject> = {}): StoryProject {
  return { id: projectId, title, description: null, language: 'en', status: 'draft', created_at: stamp, updated_at: stamp, ...changes };
}
function audit(changes: Partial<StoryExport> = {}): StoryExport {
  return { export_id: exportId, project_id: projectId, draft_id: draftId, draft_version: 1, draft_revision: 1,
    language: 'en', title, format: 'pdf', include_title_page: true, include_page_numbers: true, renderer_version: 'memy_pdf_v1',
    filename, content_sha256: hash, byte_size: pdf().bytes.length, page_count: 2, created_at: stamp, ...changes };
}
function pdf(changes: Partial<StoryPdf> = {}): StoryPdf {
  return { exportId, draftVersion: 1, draftRevision: 1, pageCount: 2, filename,
    bytes: Uint8Array.from(Array.from('%PDF-1.4\nFictional test content\n%%EOF\n', character => character.charCodeAt(0))), ...changes };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const token = jest.fn(async (_owner: string): Promise<string | null> => 'synthetic-user-access-token');
const back = jest.fn(), signOut = jest.fn();
const cache: PrivatePdfStore = { save: jest.fn(async () => handle), share: jest.fn(async () => {}),
  discard: jest.fn(async () => {}), revoke: jest.fn(async () => {}) };
const privacy: PdfPrivacyValue = { ready: true, failed: false, createStore: jest.fn(() => cache),
  release: jest.fn(), reportFailure: jest.fn(), retry: jest.fn(),
  rememberReturn: jest.fn(), consumeReturn: jest.fn(() => null), clearReturn: jest.fn() };
function props(changes: Partial<StoryExportsProps> = {}): StoryExportsProps {
  return { language: 'en', storyLanguage: 'en', title, ownerId: 'account-a', projectId, draftId,
    baseUrl: 'http://192.168.20.30:8000', getAccessToken: token, onBack: back, onSignOut: signOut, ...changes };
}
const ui = (): StoryExportsScreenProps => jest.mocked(StoryExportsScreen).mock.calls.at(-1)![0];
async function ready() { await waitFor(() => expect(ui().state.phase).toBe('ready')); }
async function prepared() { await waitFor(() => expect(ui().state.fileReady).toBe(true)); }
async function flush() { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); }
let appChange: (state: 'active' | 'inactive' | 'background') => void;
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  privacy.ready = true; privacy.failed = false;
  jest.mocked(usePdfPrivacy).mockReturnValue(privacy);
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(getStoryDraft).mockReset().mockResolvedValue(draft());
  jest.mocked(getStoryProject).mockReset().mockResolvedValue(project());
  jest.mocked(exportStoryPdf).mockReset().mockImplementation(async () => pdf());
  jest.mocked(downloadStoryPdf).mockReset().mockImplementation(async options => pdf({ exportId: options.metadata.export_id,
    draftVersion: options.metadata.draft_version, draftRevision: options.metadata.draft_revision, filename: options.metadata.filename }));
  jest.mocked(listStoryExports).mockReset().mockImplementation(async () => ({ items: jest.mocked(exportStoryPdf).mock.calls.length ? [audit()] : [], hasMore: false }));
  jest.mocked(cache.save).mockReset().mockResolvedValue(handle); jest.mocked(cache.share).mockReset().mockResolvedValue(undefined);
  jest.mocked(cache.discard).mockReset().mockResolvedValue(undefined); jest.mocked(cache.revoke).mockReset().mockResolvedValue(undefined);
  jest.mocked(Crypto.digestStringAsync).mockReset().mockResolvedValue(hash);
  token.mockReset().mockResolvedValue('synthetic-user-access-token');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { appChange = listener; return { remove: jest.fn() }; });
});
afterEach(() => {
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(editStoryDraft).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled(); cleanup(); jest.restoreAllMocks();
});

it.each(['en', 'sv'] as const)('enters with authenticated GET-only reads of the selected saved %s revision', async language => {
  jest.mocked(getStoryDraft).mockResolvedValue(draft({ language })); jest.mocked(getStoryProject).mockResolvedValue(project({ language }));
  render(<StoryExports {...props({ language, storyLanguage: language })} />); await ready();
  expect(ui().state.draft?.language).toBe(language); expect(ui().title).toBe(title);
  expect(getStoryDraft).toHaveBeenCalledTimes(1); expect(getStoryProject).toHaveBeenCalledTimes(1);
  expect(listStoryExports).toHaveBeenCalledWith(expect.objectContaining({ projectId, draftId, expectedLanguage: language, limit: 20, offset: 0 }));
  expect(privacy.createStore).toHaveBeenCalledWith('account-a');
  await jest.mocked(getStoryDraft).mock.calls[0][0].getAccessToken(); expect(token).toHaveBeenCalledWith('account-a');
  expect(exportStoryPdf).not.toHaveBeenCalled(); expect(cache.save).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled();
});
it.each(['RATE_LIMITED', 'API_BUSY'] as const)('%s preserves the export snapshot without automatic reconciliation or sharing', async code => {
  const advice = { code, retryAfterSeconds: 60, retryAt: Date.now() + 60_000 };
  jest.mocked(exportStoryPdf).mockRejectedValueOnce(new StoryProjectsError('unavailable', code === 'RATE_LIMITED' ? 429 : 503, false, advice));
  jest.mocked(listStoryExports).mockResolvedValue({ items: [], hasMore: false });
  render(<StoryExports {...props()} />); await ready();
  act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.phase).toBe('uncertain'));
  const reads = jest.mocked(listStoryExports).mock.calls.length;
  await act(async () => { await flush(); });
  expect(listStoryExports).toHaveBeenCalledTimes(reads);
  expect(exportStoryPdf).toHaveBeenCalledTimes(1);
  expect(cache.save).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled();
  act(() => ui().onRefresh());
  await waitFor(() => expect(ui().state.notice).toBe('uncertain'));
  expect(exportStoryPdf).toHaveBeenCalledTimes(1);
  expect(cache.share).not.toHaveBeenCalled();
});
it('explicit preparation rechecks saved wording/title, POSTs the captured baseline and matches persisted audit before saving bytes', async () => {
  const snapshot = draft(), bytes = pdf(); jest.mocked(exportStoryPdf).mockResolvedValueOnce(bytes);
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  expect(getStoryDraft).toHaveBeenCalledTimes(2); expect(getStoryProject).toHaveBeenCalledTimes(2);
  expect(Crypto.digestStringAsync).toHaveBeenCalledWith(Crypto.CryptoDigestAlgorithm.SHA256, original);
  expect(exportStoryPdf).toHaveBeenCalledWith(expect.objectContaining({ baseline: snapshot, title, projectId, draftId, expectedLanguage: 'en' }));
  expect(jest.mocked(listStoryExports).mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(jest.mocked(listStoryExports).mock.invocationCallOrder.at(-1)!).toBeLessThan(jest.mocked(cache.save).mock.invocationCallOrder[0]);
  expect(cache.save).toHaveBeenCalledTimes(1); expect(cache.share).not.toHaveBeenCalled();
  expect(ui().state.prepared).toEqual(audit()); expect(ui().state.preparedPageCount).toBe(2);
  expect(Array.from(bytes.bytes)).toEqual(Array(bytes.bytes.length).fill(0));
  expect(snapshot).toEqual(draft());
});
it.each(['revision', 'content', 'title', 'original'] as const)('a changed %s reloads the saved selection without exporting another version', async changed => {
  render(<StoryExports {...props()} />); await ready();
  if (changed === 'revision') jest.mocked(getStoryDraft).mockResolvedValue(draft({ revision: 2 }));
  if (changed === 'content') jest.mocked(getStoryDraft).mockResolvedValue(draft({ content: 'Concurrent fictional edit.' }));
  if (changed === 'original') jest.mocked(getStoryDraft).mockResolvedValue(draft({ original_content: 'Changed original source.' }));
  if (changed === 'title') jest.mocked(getStoryProject).mockResolvedValue(project({ title: 'Updated fictional title' }));
  act(() => ui().onPrepare()); await waitFor(() => expect(ui().state.notice).toBe('source-changed'));
  expect(ui().state.error).toBe('conflict'); expect(exportStoryPdf).not.toHaveBeenCalled(); expect(cache.save).not.toHaveBeenCalled();
});
it('reuses an exactly matching existing audit through authenticated GET download rather than another POST', async () => {
  jest.mocked(listStoryExports).mockResolvedValue({ items: [audit()], hasMore: false });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  expect(exportStoryPdf).not.toHaveBeenCalled(); expect(downloadStoryPdf).toHaveBeenCalledWith(expect.objectContaining({ metadata: audit() }));
  expect(ui().state.items).toHaveLength(1); expect(cache.save).toHaveBeenCalledTimes(1);
});
it.each(['content_sha256', 'title', 'draft_revision', 'draft_version', 'draft_id'] as const)(
  'mismatched persisted %s is never offered as the created saved version', async key => {
    const mismatched = audit({ [key]: key === 'draft_revision' || key === 'draft_version' ? 2 : key === 'content_sha256' ? 'b'.repeat(64) : key === 'draft_id' ? projectId : 'different' });
    jest.mocked(listStoryExports).mockImplementation(async () => ({ items: jest.mocked(exportStoryPdf).mock.calls.length ? [mismatched] : [], hasMore: false }));
    render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
    await waitFor(() => expect(ui().state.notice).toBe('uncertain'));
    expect(cache.save).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled(); expect(ui().state.fileReady).toBe(false);
    expect(exportStoryPdf).toHaveBeenCalledTimes(1);
  });
it('missing persisted audit after returned binary is uncertain and never fabricates successful preparation', async () => {
  jest.mocked(listStoryExports).mockResolvedValue({ items: [], hasMore: false });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.notice).toBe('uncertain'));
  expect(ui().state.fileReady).toBe(false); expect(ui().state.prepared).toBeUndefined(); expect(cache.save).not.toHaveBeenCalled();
});
it('repeat taps while a POST is running dispatch only one export', async () => {
  const pending = deferred<StoryPdf>(); jest.mocked(exportStoryPdf).mockReturnValueOnce(pending.promise);
  render(<StoryExports {...props()} />); await ready(); const prepare = ui().onPrepare;
  act(() => { prepare(); prepare(); prepare(); }); await waitFor(() => expect(exportStoryPdf).toHaveBeenCalledTimes(1));
  act(() => ui().onPrepare()); expect(exportStoryPdf).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(pdf())); await prepared();
});
it('historical download preserves the original saved generation/revision/title instead of current editor state', async () => {
  const old = audit({ export_id: '30000000-0000-4000-8000-000000000002', draft_version: 1, draft_revision: 1, title: 'Earlier title' });
  jest.mocked(getStoryDraft).mockResolvedValue(draft({ version: 2, revision: 4, content: 'New saved wording.' }));
  jest.mocked(listStoryExports).mockResolvedValue({ items: [old], hasMore: false });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onDownload(old.export_id)); await prepared();
  expect(downloadStoryPdf).toHaveBeenCalledWith(expect.objectContaining({ metadata: old }));
  expect(ui().state.prepared).toEqual(old); expect(ui().state.draft?.revision).toBe(4); expect(exportStoryPdf).not.toHaveBeenCalled();
});
it('an unknown historical ID cannot trigger a download or export', async () => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onDownload('not-a-listed-export'));
  expect(downloadStoryPdf).not.toHaveBeenCalled(); expect(exportStoryPdf).not.toHaveBeenCalled();
});
it('refresh performs only fresh saved-resource and metadata reads, discarding a prepared private copy', async () => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  act(() => ui().onRefresh()); await ready();
  expect(cache.discard).toHaveBeenCalledWith(handle); expect(ui().state.fileReady).toBe(false);
  expect(exportStoryPdf).toHaveBeenCalledTimes(1); expect(getStoryDraft).toHaveBeenCalledTimes(3);
});
it.each(['network', 'timeout', 'invalid-response', 'unavailable'] as const)('uncertain %s reconciles persisted metadata without automatic repeat POST', async kind => {
  jest.mocked(exportStoryPdf).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  expect(exportStoryPdf).toHaveBeenCalledTimes(1); expect(downloadStoryPdf).toHaveBeenCalledTimes(1);
  expect(jest.mocked(listStoryExports).mock.invocationCallOrder.at(-1)!).toBeGreaterThan(jest.mocked(exportStoryPdf).mock.invocationCallOrder[0]);
  expect(ui().state.prepared).toEqual(audit());
});
it('a complete negative reconciliation requires another explicit action and GET recheck before repeating POST', async () => {
  jest.mocked(exportStoryPdf).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  jest.mocked(listStoryExports).mockResolvedValue({ items: [], hasMore: false });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.notice).toBe('uncertain')); await ready();
  expect(exportStoryPdf).toHaveBeenCalledTimes(1); expect(cache.share).not.toHaveBeenCalled();
  jest.mocked(listStoryExports).mockImplementation(async () => ({ items: jest.mocked(exportStoryPdf).mock.calls.length >= 2 ? [audit()] : [], hasMore: false }));
  const before = jest.mocked(listStoryExports).mock.calls.length;
  act(() => ui().onPrepare()); await prepared();
  expect(exportStoryPdf).toHaveBeenCalledTimes(2); expect(jest.mocked(listStoryExports).mock.calls.length).toBeGreaterThanOrEqual(before + 2);
  const secondPost = jest.mocked(exportStoryPdf).mock.invocationCallOrder[1];
  expect(jest.mocked(listStoryExports).mock.invocationCallOrder[before]).toBeLessThan(secondPost);
  expect(jest.mocked(exportStoryPdf).mock.calls[1][0].baseline).toEqual(jest.mocked(exportStoryPdf).mock.calls[0][0].baseline);
});
it('bounded negative metadata search never permits a POST or pretends the audit history is complete', async () => {
  jest.mocked(listStoryExports).mockImplementation(async options => ({ hasMore: true, items: Array.from({ length: 20 }, (_, index) => audit({
    export_id: '30000000-0000-4000-8000-' + String((options.offset ?? 0) + index + 1).padStart(12, '0'), content_sha256: 'b'.repeat(64),
  })) }));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.phase).toBe('uncertain'));
  expect(ui().state.bounded).toBe(true); expect(ui().state.items).toHaveLength(200);
  act(() => ui().onPrepare()); expect(exportStoryPdf).not.toHaveBeenCalled(); expect(cache.save).not.toHaveBeenCalled();
});
it('duplicate audit IDs across history pages fail without silently merging or writing', async () => {
  jest.mocked(listStoryExports).mockResolvedValue({ items: [audit({ content_sha256: 'b'.repeat(64) })], hasMore: true });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onLoadMore());
  await waitFor(() => expect(ui().state.error).toBe('conflict')); expect(exportStoryPdf).not.toHaveBeenCalled();
});
it('history pagination uses retained offset and never exports merely by browsing', async () => {
  const next = audit({ export_id: '30000000-0000-4000-8000-000000000002' });
  jest.mocked(listStoryExports).mockResolvedValueOnce({ items: [audit()], hasMore: true }).mockResolvedValue({ items: [next], hasMore: false });
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onLoadMore()); await waitFor(() => expect(ui().state.items).toHaveLength(2));
  expect(jest.mocked(listStoryExports).mock.calls[1][0]).toMatchObject({ limit: 20, offset: 1 });
  expect(exportStoryPdf).not.toHaveBeenCalled(); expect(downloadStoryPdf).not.toHaveBeenCalled();
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('%s clears private draft/history and blocks preparation after access failure', async kind => {
  render(<StoryExports {...props()} />); await ready();
  jest.mocked(listStoryExports).mockRejectedValueOnce(new StoryProjectsError(kind)); act(() => ui().onRefresh());
  await waitFor(() => expect(ui().state.error).toBe(kind));
  expect(ui().state.draft).toBeNull(); expect(ui().state.items).toEqual([]); expect(ui().state.fileReady).toBe(false);
  act(() => { ui().onPrepare(); ui().onShare(); ui().onRefresh(); });
  expect(exportStoryPdf).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled(); expect(privacy.release).toHaveBeenCalledWith(cache);
});
it.each(['validation', 'conflict', 'unavailable'] as const)('%s returns a safe error without prepared-file or shared success', async kind => {
  jest.mocked(exportStoryPdf).mockRejectedValueOnce(new StoryProjectsError(kind));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.error).toBe(kind));
  expect(ui().state.fileReady).toBe(false); expect(cache.save).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled();
});
it('backend source-changed failure reloads the saved resource without retrying or updating the draft', async () => {
  jest.mocked(exportStoryPdf).mockRejectedValueOnce(new StoryExportsError('conflict', 409, false, 'EXPORT_SOURCE_CHANGED'));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.notice).toBe('source-changed'));
  expect(ui().state.error).toBe('conflict'); expect(getStoryDraft).toHaveBeenCalledTimes(3);
  expect(exportStoryPdf).toHaveBeenCalledTimes(1); expect(cache.save).not.toHaveBeenCalled();
});
it.each(['storage', 'invalid', 'cleanup'] as const)('native %s failure never fabricates a shareable file', async kind => {
  jest.mocked(cache.save).mockRejectedValueOnce(new NativePdfError(kind));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(ui().state.phase).toBe('error'));
  expect(ui().state.fileReady).toBe(false); expect(ui().state.prepared).toBeUndefined(); expect(cache.share).not.toHaveBeenCalled();
  if (kind === 'cleanup') expect(privacy.reportFailure).toHaveBeenCalled();
});
it('sharing requires explicit action and a freshly rechecked current-owner access token', async () => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  expect(cache.share).not.toHaveBeenCalled(); token.mockClear(); act(() => ui().onShare());
  await waitFor(() => expect(ui().state.notice).toBe('shared'));
  expect(token).toHaveBeenCalledWith('account-a'); expect(cache.share).toHaveBeenCalledWith(handle);
  expect(token.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(cache.share).mock.invocationCallOrder[0]);
  await waitFor(() => expect(cache.discard).toHaveBeenCalledWith(handle)); expect(ui().state.fileReady).toBe(false);
});
it('expired authentication immediately before sharing clears private state and never opens the sheet', async () => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  token.mockResolvedValueOnce(null); act(() => ui().onShare());
  await waitFor(() => expect(ui().state.error).toBe('authentication'));
  expect(cache.share).not.toHaveBeenCalled(); expect(ui().state.draft).toBeNull(); expect(ui().state.items).toEqual([]);
  await waitFor(() => expect(cache.discard).toHaveBeenCalledWith(handle));
});
it.each(['sb_publishable_synthetic', 'sb_secret_synthetic'])('an API key cannot substitute for a user token before disclosure: %s', async invalid => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  token.mockResolvedValueOnce(invalid); act(() => ui().onShare());
  await waitFor(() => expect(ui().state.error).toBe('authentication')); expect(cache.share).not.toHaveBeenCalled();
});
it('late token retrieval after navigation cannot open a native sheet', async () => {
  const pending = deferred<string | null>();
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  token.mockReturnValueOnce(pending.promise); act(() => ui().onShare());
  await waitFor(() => expect(token).toHaveBeenCalledWith('account-a')); act(() => ui().onBack());
  await act(async () => pending.resolve('synthetic-user-access-token'));
  expect(cache.share).not.toHaveBeenCalled(); await waitFor(() => expect(cache.discard).toHaveBeenCalledWith(handle));
});
it('repeat share taps open only one sheet and discard its private handle when it settles', async () => {
  const pending = deferred<void>(); jest.mocked(cache.share).mockReturnValueOnce(pending.promise);
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  const share = ui().onShare; act(() => { share(); share(); share(); });
  await waitFor(() => expect(cache.share).toHaveBeenCalledTimes(1)); expect(ui().state.phase).toBe('sharing');
  expect(cache.discard).not.toHaveBeenCalled(); await act(async () => pending.resolve());
  await waitFor(() => expect(cache.discard).toHaveBeenCalledWith(handle)); expect(ui().state.notice).toBe('shared');
});
it('native sharing failures provide no false saved/shared success and still discard the file', async () => {
  jest.mocked(cache.share).mockRejectedValueOnce(new NativePdfError('unavailable'));
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared(); act(() => ui().onShare());
  await waitFor(() => expect(ui().state.error).toBe('unavailable')); expect(ui().state.notice).not.toBe('shared');
  await waitFor(() => expect(cache.discard).toHaveBeenCalledWith(handle));
});
it('cleanup rejection after an unmounted native sheet remains reported to the privacy gate', async () => {
  const pending = deferred<void>(); jest.mocked(cache.share).mockReturnValueOnce(pending.promise);
  const view = render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared(); act(() => ui().onShare());
  await waitFor(() => expect(cache.share).toHaveBeenCalledTimes(1)); view.unmount();
  jest.mocked(cache.discard).mockRejectedValueOnce(new NativePdfError('cleanup'));
  await act(async () => pending.resolve()); await waitFor(() => expect(privacy.reportFailure).toHaveBeenCalled());
  expect(privacy.release).toHaveBeenCalledWith(cache); expect(cache.discard).toHaveBeenCalledWith(handle);
});
it.each(['signout', 'back', 'background', 'unmount', 'account', 'draft'] as const)('%s cancels pending export and ignores late private PDF bytes', async change => {
  const pending = deferred<StoryPdf>(); jest.mocked(exportStoryPdf).mockReturnValueOnce(pending.promise);
  const view = render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare());
  await waitFor(() => expect(exportStoryPdf).toHaveBeenCalledTimes(1)); const signal = jest.mocked(exportStoryPdf).mock.calls[0][0].signal!;
  if (change === 'unmount') view.unmount();
  else if (change === 'signout') act(() => ui().onSignOut());
  else if (change === 'back') act(() => ui().onBack());
  else if (change === 'background') act(() => appChange('inactive'));
  else { view.rerender(<StoryExports {...props(change === 'account' ? { ownerId: 'account-b' } : { draftId: '20000000-0000-4000-8000-000000000002' })} />); await ready(); }
  expect(signal.aborted).toBe(true); expect(privacy.release).toHaveBeenCalledWith(cache);
  const late = pdf(); await act(async () => pending.resolve(late));
  expect(cache.save).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled();
  expect(Array.from(late.bytes)).toEqual(Array(late.bytes.length).fill(0));
  if (change === 'signout') expect(signOut).toHaveBeenCalledTimes(1);
  if (change === 'back') expect(back).toHaveBeenCalledTimes(1);
});
it('an authenticated account switch obtains tokens only through the new scoped owner accessor', async () => {
  const view = render(<StoryExports {...props()} />); await ready();
  jest.mocked(listStoryExports).mockResolvedValue({ items: [], hasMore: false });
  view.rerender(<StoryExports {...props({ ownerId: 'account-b' })} />); await ready();
  const latestOptions = jest.mocked(getStoryDraft).mock.calls.at(-1)![0]; await latestOptions.getAccessToken();
  expect(token).toHaveBeenLastCalledWith('account-b'); expect(ui().state.items).toEqual([]); expect(ui().state.fileReady).toBe(false);
});
it('foreground reopens with GET reads and never restores old PDF handles or repeats exports', async () => {
  render(<StoryExports {...props()} />); await ready(); act(() => ui().onPrepare()); await prepared();
  act(() => appChange('background')); expect(ui().state.draft).toBeNull(); expect(ui().state.fileReady).toBe(false);
  act(() => appChange('active')); await ready(); expect(exportStoryPdf).toHaveBeenCalledTimes(1);
  expect(ui().state.fileReady).toBe(false); expect(privacy.createStore).toHaveBeenCalledTimes(2);
});
it('Android hardware back cancels private work and returns to the saved draft', async () => {
  type HardwareListener = Parameters<typeof BackHandler.addEventListener>[1];
  let hardware: HardwareListener = () => false;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, listener) => { hardware = listener; return { remove: jest.fn() }; });
  render(<StoryExports {...props()} />); await ready();
  act(() => expect(hardware({} as Parameters<HardwareListener>[0])).toBe(true));
  expect(back).toHaveBeenCalledTimes(1); expect(privacy.release).toHaveBeenCalledWith(cache); expect(exportStoryPdf).not.toHaveBeenCalled();
});
it.each(['configuration', 'sample'] as const)('%s guard blocks every backend/PDF request', async mode => {
  if (mode === 'sample') jest.mocked(readStoryPreviewEnabled).mockReturnValue(true);
  render(<StoryExports {...props(mode === 'configuration' ? { baseUrl: null } : {})} />);
  await waitFor(() => expect(ui().state.error).toBe('configuration'));
  act(() => { ui().onPrepare(); ui().onShare(); ui().onDownload(exportId); });
  expect(getStoryDraft).not.toHaveBeenCalled(); expect(getStoryProject).not.toHaveBeenCalled(); expect(listStoryExports).not.toHaveBeenCalled();
  expect(exportStoryPdf).not.toHaveBeenCalled(); expect(downloadStoryPdf).not.toHaveBeenCalled(); expect(cache.save).not.toHaveBeenCalled();
});
it.each(['startup', 'failure'] as const)('privacy %s gates all PDF operations before authentication/resource reads', async gate => {
  privacy.ready = false; privacy.failed = gate === 'failure';
  render(<StoryExports {...props()} />); await act(async () => flush());
  act(() => { ui().onPrepare(); ui().onShare(); ui().onRefresh(); });
  expect(privacy.createStore).not.toHaveBeenCalled(); expect(getStoryDraft).not.toHaveBeenCalled(); expect(exportStoryPdf).not.toHaveBeenCalled();
  if (gate === 'failure') expect(ui().state.notice).toBe('cleanup-failed');
});
it.each(['wrong-project', 'wrong-language', 'bad-hash'] as const)('invalid selected resource %s cannot lead to an export', async invalid => {
  if (invalid === 'wrong-project') jest.mocked(getStoryProject).mockResolvedValue(project({ id: draftId }));
  if (invalid === 'wrong-language') jest.mocked(getStoryProject).mockResolvedValue(project({ language: 'sv' }));
  if (invalid === 'bad-hash') jest.mocked(Crypto.digestStringAsync).mockResolvedValue('private raw native details');
  render(<StoryExports {...props()} />); await waitFor(() => expect(ui().state.error).toBe('invalid-response'));
  expect(ui().state.fileReady).toBe(false); expect(exportStoryPdf).not.toHaveBeenCalled(); expect(cache.share).not.toHaveBeenCalled();
});
