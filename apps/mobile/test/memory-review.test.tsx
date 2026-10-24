import { getComponent, maybeComponent } from './component-probe';
import { act, render, waitFor, cleanup } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { MemoryReview, supportedMemory } from '../src/memories/MemoryReview';
import { MemoryReviewScreen } from '../src/memories/MemoryReviewScreen';
import { listMemoryReview, patchMemory, type MemoryFact, type MemoryClarification } from '../src/api/memory-review';
import { listConversationMessages, type ConversationMessage } from '../src/api/conversation-messages';
import { StoryProjectsError } from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';


function required<T>(value: T): NonNullable<T> {
  expect(value).not.toBeNull(); expect(value).not.toBeUndefined();
  if (value === null || value === undefined) throw new Error('Expected required test value.');
  return value;
}

jest.mock('../src/memories/MemoryReviewScreen', () => {
  const actual = jest.requireActual<typeof import('../src/memories/MemoryReviewScreen')>('../src/memories/MemoryReviewScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, MemoryReviewScreen: observeComponent(actual.MemoryReviewScreen) };
});

jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'),
  listMemoryReview: jest.fn(), patchMemory: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn(() => false) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const factId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const fact = (changes: Partial<MemoryFact> = {}): MemoryFact => ({ id: factId, project_id: projectId,
  session_id: sessionId, source_message_id: sourceId, fact_type: 'date', value: '1974',
  evidence: 'I moved in 1974', year: 1974, slot: null, uncertain: true, status: 'pending',
  corrected_value: null, version: 1, created_at: stamp, updated_at: stamp, ...changes });
const source = (changes: Partial<ConversationMessage> = {}): ConversationMessage => ({ id: sourceId,
  session_id: sessionId, role: 'user', text: 'Fictional: I moved in 1974.', language: 'en', sequence: 1, created_at: stamp, ...changes });
const question: MemoryClarification = { id: '50000000-0000-4000-8000-000000000001', fact_id: factId,
  session_id: sessionId, conflicts_with_fact_id: null, question: 'Which year?', status: 'open',
  resolution: null, created_at: stamp, resolved_at: null };
const token = jest.fn(async (_owner: string) => 'synthetic-user-token');
const back = jest.fn(); const signOut = jest.fn();
const props = () => ({ language: 'en' as const, title: 'Fictional test story', ownerId: 'account-a', projectId,
  sessionId, sessionLanguage: 'en' as const, baseUrl: 'http://192.168.20.30:8000', getAccessToken: token,
  onBack: back, onSignOut: signOut });
const presentation = () => getComponent(MemoryReviewScreen).props;
const ready = () => waitFor(() => expect(presentation().state.phase).toBe('ready'));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let appChange: (state: 'active' | 'inactive' | 'background') => void;
beforeEach(() => {
  jest.mocked(listMemoryReview).mockReset().mockResolvedValue({ memories: [fact()], clarifications: [question], complete: true });
  jest.mocked(listConversationMessages).mockReset().mockResolvedValue({ messages: [source()], complete: true });
  jest.mocked(patchMemory).mockReset().mockResolvedValue(fact({ status: 'confirmed', version: 2 }));
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  token.mockClear(); back.mockClear(); signOut.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appChange = listener; return { remove: jest.fn() };
  });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each(['en', 'sv'] as const)('loads owned source-supported current state with the saved session language in %s', async language => {
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [source({ language })], complete: true });
  await render(<MemoryReview {...props()} language={language} sessionLanguage={language} />); await ready();
  expect(presentation().state).toMatchObject({ memories: [fact()], clarifications: [question], complete: true });
  const options = jest.mocked(listMemoryReview).mock.calls[0][0];
  expect(options).toMatchObject({ projectId, sessionId, expectedLanguage: language });
  await options.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
  expect(patchMemory).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['confirmed', 'rejected'] as const)('saves an explicit %s choice only and reloads persisted state', async status => {
  await render(<MemoryReview {...props()} />); await ready();
  const saved = fact({ status, version: 2 });
  jest.mocked(patchMemory).mockResolvedValueOnce(saved);
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [saved], clarifications: [], complete: true });
  await act(() => presentation().onSave(fact(), status));
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(patchMemory).toHaveBeenCalledTimes(1);
  expect(jest.mocked(patchMemory).mock.calls[0][0].input).toEqual({ status, expected_version: 1 });
  expect(presentation().state.memories[0]).toEqual(saved);
  expect(presentation().state.sources[0]).toEqual(source());
  expect(presentation().state.clarifications).toEqual([]);
});

it('sends normalized correction separately and preserves original year, evidence, and source', async () => {
  await render(<MemoryReview {...props()} />); await ready();
  const saved = fact({ status: 'confirmed', corrected_value: '1975', version: 2 });
  jest.mocked(patchMemory).mockResolvedValueOnce(saved);
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [saved], clarifications: [], complete: true });
  await act(() => presentation().onSave(fact(), 'confirmed', ' 1975 '));
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(jest.mocked(patchMemory).mock.calls[0][0].input).toEqual({ status: 'confirmed', expected_version: 1, corrected_value: '1975' });
  expect(presentation().state.memories[0]).toMatchObject({ value: '1974', evidence: 'I moved in 1974',
    year: 1974, corrected_value: '1975', source_message_id: sourceId });
});

it('locks repeat Save taps synchronously and never reports optimistic success', async () => {
  const pending = deferred<MemoryFact>();
  jest.mocked(patchMemory).mockReturnValueOnce(pending.promise);
  await render(<MemoryReview {...props()} />); await ready(); const save = presentation().onSave;
  await act(() => { save(fact(), 'confirmed'); save(fact(), 'confirmed'); save(fact(), 'rejected'); });
  expect(patchMemory).toHaveBeenCalledTimes(1);
  expect(presentation().state.phase).toBe('saving'); expect(presentation().state.notice).toBeUndefined();
});

it('reloads a 409 and requires explicit re-review without another PATCH', async () => {
  jest.mocked(patchMemory).mockRejectedValueOnce(new StoryProjectsError('conflict', 409));
  await render(<MemoryReview {...props()} />); await ready();
  const revised = fact({ status: 'confirmed', corrected_value: '1976', version: 3 });
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [revised], clarifications: [], complete: true });
  await act(() => presentation().onSave(fact(), 'confirmed', '1975'));
  await waitFor(() => expect(presentation().state.notice).toBe('conflict'));
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(presentation().state.memories[0]).toEqual(revised);
  await act(() => presentation().onSave(fact(), 'confirmed', '1977'));
  expect(patchMemory).toHaveBeenCalledTimes(1); // Old version callback is not reusable.
  await act(() => required(presentation().onReviewLatest)()); // Explicitly discard the old review; no automatic rebase.
  jest.mocked(patchMemory).mockResolvedValueOnce(fact({ status: 'confirmed', corrected_value: '1977', version: 4 }));
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [fact({ status: 'confirmed', corrected_value: '1977', version: 4 })],
    clarifications: [], complete: true });
  await act(() => presentation().onSave(revised, 'confirmed', '1977'));
  await waitFor(() => expect(presentation().state.notice).toBe('saved'));
  expect(jest.mocked(patchMemory).mock.calls[1][0].input.expected_version).toBe(3);
});

it.each(['network', 'timeout', 'invalid-response', 'unavailable'] as const)(
  'never automatically retries uncertain %s writes; explicit reload restores authoritative state', async kind => {
    jest.mocked(patchMemory).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
    await render(<MemoryReview {...props()} />); await ready();
    await act(() => presentation().onSave(fact(), 'confirmed'));
    await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
    expect(presentation().state.retainedReview).toMatchObject({ memoryId: factId, expectedVersion: 1, canRetry: false });
    expect(patchMemory).toHaveBeenCalledTimes(1); expect(listMemoryReview).toHaveBeenCalledTimes(1);
    await act(() => presentation().onRefresh()); await ready();
    expect(listMemoryReview).toHaveBeenCalledTimes(2); expect(patchMemory).toHaveBeenCalledTimes(1);
    expect(presentation().state.notice).toBe('uncertain');
  });

it.each(['authentication', 'forbidden', 'not-found'] as const)('clears private state and blocks reads after %s', async kind => {
  await render(<MemoryReview {...props()} />); await ready();
  jest.mocked(patchMemory).mockRejectedValueOnce(new StoryProjectsError(kind));
  await act(() => presentation().onSave(fact(), 'confirmed'));
  await waitFor(() => expect(presentation().state.error).toBe(kind));
  expect(presentation().state.memories).toEqual([]); expect(presentation().state.sources).toEqual([]);
  await act(() => presentation().onRefresh()); expect(listMemoryReview).toHaveBeenCalledTimes(1);
});

it.each(['configuration', 'network', 'timeout', 'unavailable', 'invalid-response', 'validation'] as const)(
  'shows sanitized initial %s failure with no write', async kind => {
    jest.mocked(listMemoryReview).mockRejectedValueOnce(new StoryProjectsError(kind));
    await render(<MemoryReview {...props()} />);
    await waitFor(() => expect(presentation().state.error).toBe(kind));
    expect(presentation().state.memories).toEqual([]); expect(patchMemory).not.toHaveBeenCalled();
  });

it.each([false, true])('makes no API or token calls for unavailable setup (sample=%s)', async sample => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(sample);
  await render(<MemoryReview {...props()} baseUrl={sample ? props().baseUrl : null} />);
  await waitFor(() => expect(presentation().state.error).toBe('configuration'));
  expect(listMemoryReview).not.toHaveBeenCalled(); expect(listConversationMessages).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
});

it('blocks mutations if either bounded read is incomplete', async () => {
  jest.mocked(listConversationMessages).mockResolvedValueOnce({ messages: [source()], complete: false });
  await render(<MemoryReview {...props()} />); await ready();
  await act(() => presentation().onSave(fact(), 'confirmed')); expect(patchMemory).not.toHaveBeenCalled();
  expect(presentation().state.complete).toBe(false);
});

it.each([source({ role: 'assistant' }), source({ text: 'Different fictional account facts' }),
  source({ session_id: '20000000-0000-4000-8000-000000000002' })])(
  'fails closed for mismatched source provenance %#', async message => {
    jest.mocked(listConversationMessages).mockResolvedValueOnce({ messages: [message], complete: true });
    await render(<MemoryReview {...props()} />);
    await waitFor(() => expect(presentation().state.error).toBe('invalid-response'));
    await act(() => presentation().onSave(fact(), 'confirmed')); expect(patchMemory).not.toHaveBeenCalled();
  });

it.each(['', ' ', '\\u0085', '\\u200b'])('invalid correction never reaches PATCH (%s)', async input => {
  await render(<MemoryReview {...props()} />); await ready();
  await act(() => presentation().onSave(fact(), 'confirmed', input.replace('\\u0085', '\u0085').replace('\\u200b', '\u200b')));
  expect(patchMemory).not.toHaveBeenCalled();
});

it.each(['back', 'signOut', 'unmount'] as const)('cancels and ignores late write after %s', async action => {
  const pending = deferred<MemoryFact>(); jest.mocked(patchMemory).mockReturnValueOnce(pending.promise);
  const view = await render(<MemoryReview {...props()} />); await ready();
  await act(() => presentation().onSave(fact(), 'confirmed'));
  const signal = jest.mocked(patchMemory).mock.calls[0][0].signal!;
  if (action === 'unmount') await view.unmount();
  else await act(() => presentation()[action === 'back' ? 'onBack' : 'onSignOut']());
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(fact({ status: 'confirmed', version: 2 })); });
  expect(listMemoryReview).toHaveBeenCalledTimes(1);
  if (action === 'unmount') expect(maybeComponent(MemoryReviewScreen)).toBeNull();
  else expect(presentation().state.memories).toEqual([]);
});

it.each(['ownerId', 'sessionId', 'projectId'] as const)('isolates scope change %s and fences late replies', async field => {
  const pending = deferred<Awaited<ReturnType<typeof listMemoryReview>>>();
  jest.mocked(listMemoryReview).mockReturnValueOnce(pending.promise);
  const view = await render(<MemoryReview {...props()} />);
  await waitFor(() => expect(listMemoryReview).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(listMemoryReview).mock.calls[0][0].signal!;
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [], clarifications: [], complete: true });
  const next = { ...props(), [field]: field === 'ownerId' ? 'account-b' : '60000000-0000-4000-8000-000000000001' };
  await view.rerender(<MemoryReview {...next} />); await ready();
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve({ memories: [fact()], clarifications: [question], complete: true }); });
  expect(presentation().state.memories).toEqual([]);
  const options = jest.mocked(listMemoryReview).mock.calls[1][0]; await options.getAccessToken();
  expect(token).toHaveBeenLastCalledWith(next.ownerId);
});

it('background clears private state, cancels a save and foreground reloads without retrying it', async () => {
  const pending = deferred<MemoryFact>(); jest.mocked(patchMemory).mockReturnValueOnce(pending.promise);
  await render(<MemoryReview {...props()} />); await ready();
  await act(() => presentation().onSave(fact(), 'confirmed'));
  const signal = jest.mocked(patchMemory).mock.calls[0][0].signal!;
  await act(() => appChange('inactive')); expect(signal.aborted).toBe(true);
  expect(presentation().state.memories).toEqual([]);
  await act(() => appChange('active')); await ready();
  await act(async () => { pending.resolve(fact({ status: 'confirmed', version: 2 })); });
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(listMemoryReview).toHaveBeenCalledTimes(2);
  expect(presentation().state.notice).toBe('uncertain');
});

it('does not display saved when post-save reload is older than the confirmed PATCH', async () => {
  await render(<MemoryReview {...props()} />); await ready();
  await act(() => presentation().onSave(fact(), 'confirmed'));
  await waitFor(() => expect(presentation().state.phase).toBe('uncertain'));
  expect(presentation().state.notice).not.toBe('saved');
});

it('newer edits found after save are shown as changed instead of overwriting them', async () => {
  await render(<MemoryReview {...props()} />); await ready();
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [fact({ status: 'rejected', version: 3 })], clarifications: [], complete: true });
  await act(() => presentation().onSave(fact(), 'confirmed'));
  await waitFor(() => expect(presentation().state.notice).toBe('conflict'));
  expect(presentation().state.memories[0].status).toBe('rejected');
});

it('source support never treats corrected text as a replacement for extracted evidence', () => {
  expect(supportedMemory(fact({ corrected_value: '1975', status: 'confirmed' }), [source()])).toBe(true);
  expect(supportedMemory(fact({ year: 1975 }), [source()])).toBe(false);
});

it('reloads after a read-only foreground return without inventing a pending-save warning', async () => {
  await render(<MemoryReview {...props()} />); await ready();
  await act(() => appChange('background')); await act(() => appChange('active')); await ready();
  expect(presentation().state.notice).toBeUndefined(); expect(patchMemory).not.toHaveBeenCalled();
});
it('stops before source pagination when memory retrieval fails', async () => {
  jest.mocked(listMemoryReview).mockRejectedValueOnce(new StoryProjectsError('authentication'));
  await render(<MemoryReview {...props()} />);
  await waitFor(() => expect(presentation().state.error).toBe('authentication'));
  expect(listConversationMessages).not.toHaveBeenCalled();
});
