import { act, render, screen, waitFor, cleanup } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import * as Crypto from 'expo-crypto';
import { GenerateStory } from '../src/generation/GenerateStory';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { GenerationActionsProvider } from '../src/generation/GenerationActions';
import { useAuth } from '../src/auth/AuthProvider';
import { listStoryDrafts, getStoryDraft, getStoryVerification, generateStoryDraft, StoryDraftsError,
  type StoryDraft, type StoryProjectVerification } from '../src/api/story-drafts';
import { StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';

jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  listStoryDrafts: jest.fn(), getStoryDraft: jest.fn(), getStoryVerification: jest.fn(), generateStoryDraft: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
const projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001';
const actionKey = '30000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const project = (changes: Partial<StoryProject> = {}): StoryProject => ({ id: projectId, title: 'Fictional test story',
  description: null, language: 'en', status: 'draft', created_at: stamp, updated_at: stamp, ...changes });
const draft = (changes: Partial<StoryDraft> = {}): StoryDraft => ({
  draft_id: draftId, project_id: projectId, status: 'ready_for_review', language: 'en', style: 'warm',
  version: 1, revision: 1, content: 'I grew up in Malmö.', original_content: 'I grew up in Malmö.', mode: 'mock',
  source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 2,
    source_message_id: '50000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
    evidence: 'I grew up in Malmö', corrected_value: null, year: null, slot: 'grew_up_location', sentence: 'I grew up in Malmö.' }],
  verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
    checked_revision: 1, checked_at: stamp, sources_current: true, reason: null },
  created_at: stamp, updated_at: stamp, ...changes,
});
const report = (value: StoryDraft | null = null): StoryProjectVerification => value
  ? { project_id: value.project_id, draft_id: value.draft_id, version: value.version, revision: value.revision, verification: value.verification }
  : { project_id: projectId, draft_id: null, version: null, revision: null, verification: { status: 'not_generated',
    unsupported_claims: [], method: 'none', checked_revision: null, checked_at: null, sources_current: false, reason: null } };
const token = jest.fn(async (_owner: string) => 'synthetic-user-access-token');
const back = jest.fn(), signOut = jest.fn(), review = jest.fn();
const props = () => ({ language: 'en' as const, user: { id: 'account-a', email: 'a@example.test' }, project: project(),
  getAccessToken: token, onBack: back, onSignOut: signOut, onReviewMemories: review });
const presentation = () => screen.UNSAFE_getByType(StoryDraftScreen).props;
const ready = () => waitFor(() => expect(presentation().state.phase).toBe('ready'));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let appChange: (state: 'active' | 'inactive' | 'background') => void;
function verified(owner = 'account-a') {
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-in', user: { id: owner }, appActive: true } as ReturnType<typeof useAuth>);
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(actionKey); verified();
  jest.mocked(listStoryDrafts).mockReset().mockResolvedValue([]);
  jest.mocked(getStoryDraft).mockReset().mockResolvedValue(draft());
  jest.mocked(getStoryVerification).mockReset().mockResolvedValue(report());
  jest.mocked(generateStoryDraft).mockReset().mockResolvedValue(draft());
  token.mockClear(); back.mockClear(); signOut.mockClear(); review.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appChange = listener; return { remove: jest.fn() };
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
function saved(value = draft()) {
  jest.mocked(listStoryDrafts).mockResolvedValue([value]);
  jest.mocked(getStoryDraft).mockResolvedValue(value);
  jest.mocked(getStoryVerification).mockResolvedValue(report(value));
}

it('opening and refreshing are GET-only, with no UUID or generation before explicit action', async () => {
  render(<GenerateStory {...props()} />); await ready();
  expect(presentation().state.draft).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(Crypto.randomUUID).not.toHaveBeenCalled();
  act(() => presentation().onRefresh()); await ready();
  expect(listStoryDrafts).toHaveBeenCalledTimes(2); expect(generateStoryDraft).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(['en', 'sv'] as const)('uses immutable project language %s, dedicated UUID and verified-owner accessor', async language => {
  render(<GenerateStory {...props()} project={project({ language })} />); await ready();
  const value = draft({ language }); saved(value);
  jest.mocked(generateStoryDraft).mockResolvedValueOnce(value);
  act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(jest.mocked(generateStoryDraft).mock.calls[0][0]).toMatchObject({
    projectId, expectedLanguage: language, idempotencyKey: actionKey,
    input: { language, style: 'warm', confirm_generation: true },
  });
  await jest.mocked(generateStoryDraft).mock.calls[0][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith('account-a');
  expect(presentation().state.draft).toEqual(value); expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});
it('blocks duplicate generation synchronously before awaiting a request', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  render(<GenerateStory {...props()} />); await ready(); const generate = presentation().onGenerate;
  act(() => { generate(); generate(); generate(); });
  expect(generateStoryDraft).toHaveBeenCalledTimes(1); expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(presentation().state.phase).toBe('generating'); expect(presentation().state.notice).toBeUndefined();
});
it('reopens an actual saved draft without generating or losing later manual changes', async () => {
  const value = draft({ status: 'edited', revision: 3, content: 'Fictional manually edited text.',
    verification: { ...draft().verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 3 } });
  saved(value); render(<GenerateStory {...props()} />); await ready();
  expect(presentation().state.draft).toEqual(value); expect(generateStoryDraft).not.toHaveBeenCalled();
  act(() => presentation().onRefresh()); await ready();
  expect(presentation().state.draft.content).toBe(value.content); expect(generateStoryDraft).not.toHaveBeenCalled();
});
it('accepts older edited generation replay and never transfers newest generation verification', async () => {
  const older = draft({ status: 'edited', revision: 2, content: 'Fictional old edited draft.',
    verification: { ...draft().verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 2, sources_current: false } });
  const newer = draft({ draft_id: '20000000-0000-4000-8000-000000000002', version: 2 });
  render(<GenerateStory {...props()} />); await ready();
  jest.mocked(generateStoryDraft).mockResolvedValueOnce(older);
  jest.mocked(listStoryDrafts).mockResolvedValue([newer]);
  jest.mocked(getStoryVerification).mockResolvedValue(report(newer));
  jest.mocked(getStoryDraft).mockResolvedValue(older);
  act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(presentation().state.draft).toEqual(older); expect(presentation().state.verification).toBeNull();
  expect(generateStoryDraft).toHaveBeenCalledTimes(1);
});
it.each(['network', 'timeout', 'invalid-response', 'cancelled', 'unavailable'] as const)(
  'uncertain %s never retries automatically; reads first and reuses exact key/payload', async kind => {
    jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
    render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
    await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
    expect(presentation().state.canRetry).toBe(false); expect(generateStoryDraft).toHaveBeenCalledTimes(1);
    act(() => presentation().onRetry()); expect(generateStoryDraft).toHaveBeenCalledTimes(1);
    saved();
    act(() => presentation().onRefresh());
    await waitFor(() => expect(presentation().state.canRetry).toBe(true));
    expect(presentation().state.notice).not.toBe('saved'); // GET cannot identify action key.
    const reads = jest.mocked(listStoryDrafts).mock.calls.length;
    act(() => presentation().onRetry());
    await waitFor(() => expect(presentation().state.notice).toBe('saved'));
    expect(listStoryDrafts).toHaveBeenCalledTimes(reads + 2); // Before retry, then after confirmed POST.
    expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(actionKey);
    expect(jest.mocked(generateStoryDraft).mock.calls[1][0].input).toEqual(jest.mocked(generateStoryDraft).mock.calls[0][0].input);
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  });
it('never repeats write if retry reconciliation fails', async () => {
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
  act(() => presentation().onRefresh()); await waitFor(() => expect(presentation().state.canRetry).toBe(true));
  jest.mocked(listStoryDrafts).mockRejectedValueOnce(new StoryProjectsError('network'));
  act(() => presentation().onRetry());
  await waitFor(() => expect(presentation().state.error).toBe('network'));
  expect(generateStoryDraft).toHaveBeenCalledTimes(1); expect(presentation().state.canRetry).toBe(false);
});
it.each(['RATE_LIMITED', 'API_BUSY'] as const)('%s preserves the generation key through waiting and deliberate retry', async code => {
  const advice = { code, retryAfterSeconds: 60, retryAt: Date.now() + 60_000 };
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError('unavailable', code === 'RATE_LIMITED' ? 429 : 503, false, advice));
  render(<GenerateStory {...props()} />); await ready();
  act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
  expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  act(() => presentation().onRefresh());
  await waitFor(() => expect(presentation().state.canRetry).toBe(true));
  saved();
  act(() => presentation().onRetry());
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  const calls = jest.mocked(generateStoryDraft).mock.calls;
  expect(calls[1][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
  expect(calls[1][0].input).toEqual(calls[0][0].input);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});
it.each(['NO_CONFIRMED_MEMORIES', 'NO_SUPPORTED_MEMORIES', 'CLARIFICATION_REQUIRED', 'STORY_CONTEXT_CHANGED',
  'CONTEXT_LIMIT', 'DRAFT_VERIFICATION_FAILED'] as const)('shows backend-authoritative %s without a fabricated draft', async code => {
    jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryDraftsError(code === 'DRAFT_VERIFICATION_FAILED' ? 'validation' : 'conflict',
      code === 'DRAFT_VERIFICATION_FAILED' ? 422 : 409, false, code));
    render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
    await waitFor(() => expect(presentation().state.code).toBe(code));
    expect(presentation().state.draft).toBeNull(); expect(presentation().state.notice).not.toBe('saved');
    expect(generateStoryDraft).toHaveBeenCalledTimes(1);
    act(() => presentation().onReviewMemories()); expect(review).toHaveBeenCalledTimes(1);
  });
it('retains blocked idempotency action as an explicit error after read-only refresh', async () => {
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryDraftsError('conflict', 409, false, 'IDEMPOTENCY_CONFLICT'));
  render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.code).toBe('IDEMPOTENCY_CONFLICT'));
  act(() => presentation().onRefresh());
  await waitFor(() => expect(presentation().state.phase).toBe('error'));
  expect(presentation().state.code).toBe('IDEMPOTENCY_CONFLICT');
  act(() => { presentation().onGenerate(); presentation().onRetry(); });
  expect(generateStoryDraft).toHaveBeenCalledTimes(1); expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('access failure %s clears private drafts and blocks retry', async kind => {
  saved(); render(<GenerateStory {...props()} />); await ready();
  jest.mocked(generateStoryDraft).mockRejectedValueOnce(new StoryProjectsError(kind));
  act(() => presentation().onGenerate()); await waitFor(() => expect(presentation().state.error).toBe(kind));
  expect(presentation().state.draft).toBeNull();
  const reads = jest.mocked(listStoryDrafts).mock.calls.length;
  act(() => presentation().onRefresh()); expect(listStoryDrafts).toHaveBeenCalledTimes(reads);
});
it.each([false, true])('fails closed for unconfigured backend/sample preview=%s', async sample => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(sample);
  if (!sample) jest.mocked(readMobileApiConfig).mockReturnValue(null);
  render(<GenerateStory {...props()} />);
  await waitFor(() => expect(presentation().state.error).toBe('configuration'));
  act(() => presentation().onGenerate());
  expect(listStoryDrafts).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});
it('does not write when secure action UUID cannot be generated', async () => {
  jest.mocked(Crypto.randomUUID).mockImplementationOnce(() => { throw new Error('Private native exception'); });
  render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.error).toBe('configuration'));
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(JSON.stringify(presentation().state)).not.toContain('Private native exception');
});
it.each(['onBack', 'onSignOut', 'onReviewMemories', 'unmount'] as const)('cancels and ignores late POST after %s', async action => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  const view = render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  const signal = jest.mocked(generateStoryDraft).mock.calls[0][0].signal!;
  if (action === 'unmount') view.unmount(); else act(() => presentation()[action]());
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(draft()); });
  expect(listStoryDrafts).toHaveBeenCalledTimes(1);
  if (action !== 'unmount') expect(presentation().state.draft).toBeNull();
});
it.each(['account', 'project'] as const)('isolates %s changes and late replies', async change => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  const view = render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  const signal = jest.mocked(generateStoryDraft).mock.calls[0][0].signal!;
  const next = { ...props(), user: change === 'account' ? { id: 'account-b', email: 'b@example.test' } : props().user,
    project: change === 'project' ? project({ id: '10000000-0000-4000-8000-000000000002' }) : project() };
  view.rerender(<GenerateStory {...next} />); await ready();
  expect(signal.aborted).toBe(true); await act(async () => pending.resolve(draft()));
  expect(presentation().state.draft).toBeNull(); expect(presentation().state.notice).not.toBe('saved');
  await jest.mocked(listStoryDrafts).mock.calls[1][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith(next.user.id);
});
it('background cancels and hides data, foreground only reconciles retained action', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  render(<GenerateStory {...props()} />); await ready(); act(() => presentation().onGenerate());
  const signal = jest.mocked(generateStoryDraft).mock.calls[0][0].signal!;
  act(() => appChange('inactive')); expect(signal.aborted).toBe(true); expect(presentation().state.draft).toBeNull();
  act(() => appChange('active')); await waitFor(() => expect(presentation().state.canRetry).toBe(true));
  await act(async () => pending.resolve(draft()));
  expect(generateStoryDraft).toHaveBeenCalledTimes(1); expect(presentation().state.notice).toBe('uncertain');
});
it('provider retains UUID across private-view unmount/navigation while preserving GET-only reopen', async () => {
  const pending = deferred<StoryDraft>(); jest.mocked(generateStoryDraft).mockReturnValueOnce(pending.promise);
  function Harness({ show }: { show: boolean }) {
    return <GenerationActionsProvider>{show && <GenerateStory {...props()} />}</GenerationActionsProvider>;
  }
  const view = render(<Harness show />); await ready(); act(() => presentation().onGenerate());
  const key = jest.mocked(generateStoryDraft).mock.calls[0][0].idempotencyKey;
  view.rerender(<Harness show={false} />);
  jest.mocked(useAuth).mockReturnValue({ status: 'checking', user: null, appActive: false } as ReturnType<typeof useAuth>);
  view.rerender(<Harness show={false} />); verified();
  view.rerender(<Harness show />); await waitFor(() => expect(presentation().state.canRetry).toBe(true));
  expect(generateStoryDraft).toHaveBeenCalledTimes(1);
  saved(); act(() => presentation().onRetry());
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(jest.mocked(generateStoryDraft).mock.calls[1][0].idempotencyKey).toBe(key);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});
it('concurrent first draft arrival is reconciled with reads only', async () => {
  jest.mocked(listStoryDrafts).mockResolvedValueOnce([]).mockResolvedValue([draft()]);
  jest.mocked(getStoryVerification).mockResolvedValue(report(draft()));
  render(<GenerateStory {...props()} />); await ready();
  expect(presentation().state.draft).toEqual(draft()); expect(generateStoryDraft).not.toHaveBeenCalled();
});
it('an older post-save read is never reported as confirmed save', async () => {
  const value = draft({ status: 'edited', revision: 2, content: 'Fictional edited prose',
    verification: { ...draft().verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 2 } });
  render(<GenerateStory {...props()} />); await ready(); saved();
  jest.mocked(generateStoryDraft).mockResolvedValueOnce(value);
  act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
  expect(presentation().state.notice).not.toBe('saved');
});
it('does not apply a conflicting passed project report to an edited selected draft', async () => {
  const value = draft({ status: 'edited', revision: 2, content: 'Fictional manual prose',
    verification: { ...draft().verification, status: 'needs_review', method: 'manual_unverified', checked_revision: 2 } });
  saved(value);
  jest.mocked(getStoryVerification).mockResolvedValue({ ...report(value), verification: { ...draft().verification, checked_revision: 2 } });
  render(<GenerateStory {...props()} />); await ready();
  expect(presentation().state.verification).toBeNull();
  expect(presentation().state.draft.verification.status).toBe('needs_review');
});
it('hardware Back uses the existing story return and cancels work', async () => {
  let hardwareBack: (() => unknown) | undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, listener) => {
    hardwareBack = () => listener({ type: 'hardwareBackPress', timeStamp: 0 }); return { remove: jest.fn() };
  });
  render(<GenerateStory {...props()} />); await ready();
  act(() => hardwareBack?.()); expect(back).toHaveBeenCalledTimes(1);
  expect(presentation().state.draft).toBeNull();
});

it.each(['content', 'original_content', 'source_memories'] as const)('contradictory post-save %s is never reported saved', async field => {
  render(<GenerateStory {...props()} />); await ready();
  const actual = draft(field === 'content' ? { content: 'Contradictory fictional words.' }
    : field === 'original_content' ? { original_content: 'Different fictional original.' }
      : { source_memories: [{ ...draft().source_memories[0], evidence: 'Different fictional evidence' }] });
  saved(actual); act(() => presentation().onGenerate());
  await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
  expect(presentation().state.notice).not.toBe('saved');
});
