import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { MemoryReview } from '../src/memories/MemoryReview';
import { MemoryReviewScreen } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { listMemoryReview, patchMemory, type MemoryFact } from '../src/api/memory-review';
import { listConversationMessages } from '../src/api/conversation-messages';
import { StoryProjectsError } from '../src/api/story-projects';
import type { Language } from '../src/i18n';

jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'),
  listMemoryReview: jest.fn(), patchMemory: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: () => false }));
let mockWaiting = false;
jest.mock('../src/api/ApiBackoff', () => ({ useApiBackoff: () => ({ waiting: mockWaiting }), ApiBackoffBanner: () => null }));

const projectId = '10000000-0000-4000-8000-000000000001', sessionId = '20000000-0000-4000-8000-000000000001';
const memoryId = '30000000-0000-4000-8000-000000000001', sourceId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const words = (language: Language) => language === 'sv' ? 'Jag flyttade år 1974' : 'I moved in 1974';
const fact = (language: Language, changes: Partial<MemoryFact> = {}): MemoryFact => ({ id: memoryId, project_id: projectId,
  session_id: sessionId, source_message_id: sourceId, fact_type: 'date', value: '1974', evidence: words(language), year: 1974,
  slot: null, uncertain: true, status: 'pending', corrected_value: null, version: 1, created_at: stamp, updated_at: stamp, ...changes });
const saved = (language: Language, changes: Partial<MemoryFact> = {}) => fact(language,
  { status: 'confirmed', corrected_value: '1975', version: 2, ...changes });
const review = (memories: MemoryFact[]) => ({ memories, clarifications: [], complete: true });
const token = jest.fn(async (_owner: string) => 'synthetic-user-token'), back = jest.fn(), signOut = jest.fn();
const props = (language: Language) => ({ language, title: 'Fictional story', ownerId: 'account-a', projectId, sessionId,
  sessionLanguage: language, baseUrl: 'http://192.168.20.30:8000', getAccessToken: token, onBack: back, onSignOut: signOut });
const ui = () => screen.UNSAFE_getByType(MemoryReviewScreen).props;
const cases = (['en', 'sv'] as const).flatMap(language => (['RATE_LIMITED', 'API_BUSY'] as const).map(code => ({ language, code })));
function backoff(code: 'RATE_LIMITED' | 'API_BUSY') {
  mockWaiting = true;
  return new StoryProjectsError('unavailable', code === 'RATE_LIMITED' ? 429 : 503, false,
    { code, retryAfterSeconds: code === 'RATE_LIMITED' ? 60 : 1, retryAt: Date.now() + 60_000 });
}
let appChange: (state: 'active' | 'inactive' | 'background') => void;
beforeEach(() => {
  mockWaiting = false; AppState.currentState = 'active';
  jest.mocked(listMemoryReview).mockReset(); jest.mocked(patchMemory).mockReset(); jest.mocked(listConversationMessages).mockReset();
  token.mockClear(); back.mockClear(); signOut.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { appChange = listener; return { remove: jest.fn() }; });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });
async function open(language: Language) {
  jest.mocked(listMemoryReview).mockResolvedValue(review([fact(language)]));
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [{ id: sourceId, session_id: sessionId,
    role: 'user', sequence: 1, language, text: words(language), created_at: stamp }], complete: true });
  const view = render(<MemoryReview {...props(language)} />);
  await waitFor(() => expect(ui().state.phase).toBe('ready'));
  return view;
}
function correct(language: Language, correction = '1975') {
  fireEvent.press(screen.getByRole('radio', { name: memoryReviewCopy[language].correct }));
  fireEvent.changeText(screen.getByLabelText(memoryReviewCopy[language].correctionLabel), correction);
  fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy[language].save }));
}
async function rejected(language: Language, code: 'RATE_LIMITED' | 'API_BUSY', correction = '1975') {
  const view = await open(language);
  jest.mocked(patchMemory).mockImplementationOnce(async () => { throw backoff(code); });
  correct(language, correction);
  await waitFor(() => expect(ui().state.error).toBe('unavailable'));
  return view;
}
function expire(view: ReturnType<typeof render>, language: Language) {
  mockWaiting = false; view.rerender(<MemoryReview {...props(language)} />);
}
async function refresh(language: Language) {
  fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy[language].refresh }));
  await waitFor(() => expect(ui().state.phase).not.toBe('loading'));
}
const field = (language: Language) => screen.getByLabelText(memoryReviewCopy[language].correctionLabel);

it.each(cases)('retains action/raw correction/version and exact explicit retry: $language $code', async ({ language, code }) => {
  const view = await rejected(language, code, ' 1975 '), text = memoryReviewCopy[language];
  expect(field(language)).toHaveProp('value', ' 1975 ');
  expect(field(language)).toHaveProp('editable', false);
  expect(screen.getByRole('radio', { name: text.correct }).props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  expect(ui().state.retainedReview).toMatchObject({ memoryId, action: 'correct', expectedVersion: 1, canRetry: false });
  fireEvent.press(screen.getByRole('button', { name: text.refresh }));
  fireEvent.press(screen.getByRole('button', { name: text.save }));
  expect(listMemoryReview).toHaveBeenCalledTimes(1); expect(patchMemory).toHaveBeenCalledTimes(1);
  expire(view, language);
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled(); // Expiry alone cannot authorize a retry.
  expect(listMemoryReview).toHaveBeenCalledTimes(1); expect(patchMemory).toHaveBeenCalledTimes(1);
  await refresh(language);
  expect(ui().state.retainedReview.canRetry).toBe(true);
  expect(field(language)).toHaveProp('value', ' 1975 ');
  fireEvent.changeText(field(language), 'wrong late edit');
  expect(field(language)).toHaveProp('value', ' 1975 ');
  jest.mocked(patchMemory).mockImplementationOnce(async () => {
    jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language)])); return saved(language);
  });
  const retryButton = screen.getByRole('button', { name: text.save });
  fireEvent.press(retryButton); fireEvent.press(retryButton);
  expect(ui().state.retainedReview).toBeDefined();
  await waitFor(() => expect(ui().state.notice).toBe('saved'));
  expect(patchMemory).toHaveBeenCalledTimes(2);
  const calls = jest.mocked(patchMemory).mock.calls;
  expect(calls[1][0].input).toEqual(calls[0][0].input);
  expect(calls[1][0].input).toEqual({ status: 'confirmed', corrected_value: '1975', expected_version: 1 });
  expect(listMemoryReview).toHaveBeenCalledTimes(4); // Initial, explicit refresh, pre-retry, post-PATCH.
  expect(calls[1][0].memory).toMatchObject({ value: '1974', year: 1974, version: 1 });
  expect(calls[1][0].expectedLanguage).toBe(language);
  await calls[1][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
});

it.each(cases)('changed versions require explicit re-review: $language $code', async ({ language, code }) => {
  const view = await rejected(language, code), text = memoryReviewCopy[language]; expire(view, language);
  const newer = saved(language, { corrected_value: '1976' });
  jest.mocked(listMemoryReview).mockResolvedValue(review([newer]));
  await refresh(language);
  expect(ui().state.notice).toBe('conflict'); expect(field(language)).toHaveProp('value', '1975');
  expect(screen.getByText('1976')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  act(() => ui().onSave(fact(language), 'confirmed', '1975'));
  expect(patchMemory).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: text.reviewLatest }));
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText(text.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  act(() => ui().onSave(fact(language), 'confirmed', '1975')); expect(patchMemory).toHaveBeenCalledTimes(1);
  jest.mocked(patchMemory).mockImplementationOnce(async () => {
    const next = saved(language, { corrected_value: '1977', version: 3 });
    jest.mocked(listMemoryReview).mockResolvedValue(review([next])); return next;
  });
  correct(language, '1977'); await waitFor(() => expect(ui().state.notice).toBe('saved'));
  expect(jest.mocked(patchMemory).mock.calls[1][0].input.expected_version).toBe(2);
});

it.each(cases)('revalidates again immediately before retry: $language $code', async ({ language, code }) => {
  const view = await rejected(language, code); expire(view, language); await refresh(language);
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language, { corrected_value: '1976' })]));
  fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy[language].save }));
  await waitFor(() => expect(ui().state.notice).toBe('conflict'));
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(field(language)).toHaveProp('value', '1975');
});

it.each(cases)('keeps acknowledged PATCH uncertain through backoff and older rereads: $language $code', async ({ language, code }) => {
  const view = await open(language), text = memoryReviewCopy[language];
  jest.mocked(patchMemory).mockResolvedValueOnce(saved(language));
  jest.mocked(listMemoryReview).mockImplementationOnce(async () => { throw backoff(code); });
  correct(language);
  await waitFor(() => expect(ui().state.phase).toBe('uncertain'));
  expect(field(language)).toHaveProp('value', '1975'); expect(ui().state.retainedReview.canRetry).toBe(false);
  expire(view, language); await refresh(language); // Server read older than acknowledged version 2.
  expect(ui().state.phase).toBe('uncertain'); expect(ui().state.notice).not.toBe('saved');
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled(); expect(patchMemory).toHaveBeenCalledTimes(1);
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language)]));
  await refresh(language); expect(ui().state.notice).toBe('saved');
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(ui().state.retainedReview).toBeUndefined();
});

it.each(cases)('failed conflict reread cannot discard a correction as latest: $language $code', async ({ language, code }) => {
  const view = await open(language), text = memoryReviewCopy[language];
  jest.mocked(patchMemory).mockRejectedValueOnce(new StoryProjectsError('conflict', 409));
  jest.mocked(listMemoryReview).mockImplementationOnce(async () => { throw backoff(code); });
  correct(language); await waitFor(() => expect(ui().state.error).toBe('unavailable'));
  expect(field(language)).toHaveProp('value', '1975');
  expect(screen.getByRole('button', { name: text.reviewLatest })).toBeDisabled();
  expect(screen.queryByText(text.latestValue)).toBeNull(); // A failed read must not label the old snapshot as latest.
  act(() => ui().onReviewLatest()); expect(ui().state.retainedReview).toBeDefined();
  expire(view, language); expect(screen.getByRole('button', { name: text.reviewLatest })).toBeDisabled();
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language, { corrected_value: '1976' })]));
  await refresh(language); expect(screen.getByRole('button', { name: text.reviewLatest })).toBeEnabled();
  expect(field(language)).toHaveProp('value', '1975'); expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(cases)('incomplete and repeated-backoff reconciliation retains the correction: $language $code', async ({ language, code }) => {
  const view = await rejected(language, code), text = memoryReviewCopy[language]; expire(view, language);
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ ...review([fact(language)]), complete: false });
  await refresh(language); expect(ui().state.retainedReview.canRetry).toBe(false);
  expect(field(language)).toHaveProp('value', '1975'); expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  jest.mocked(listMemoryReview).mockImplementationOnce(async () => { throw backoff(code); });
  await refresh(language); expect(field(language)).toHaveProp('value', '1975'); expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('retains selected UUID through reordered results in %s', async language => {
  const view = await open(language), text = memoryReviewCopy[language];
  const second = fact(language, { id: '30000000-0000-4000-8000-000000000002' });
  jest.mocked(listMemoryReview).mockResolvedValue(review([fact(language), second])); await refresh(language);
  fireEvent.press(screen.getByRole('button', { name: text.next }));
  jest.mocked(patchMemory).mockImplementationOnce(async () => { throw backoff('RATE_LIMITED'); });
  correct(language); await waitFor(() => expect(ui().state.error).toBe('unavailable'));
  expire(view, language); jest.mocked(listMemoryReview).mockResolvedValue(review([second, fact(language)])); await refresh(language);
  expect(ui().state.retainedReview.memoryId).toBe(second.id); expect(field(language)).toHaveProp('value', '1975');
  expect(screen.getByRole('button', { name: text.next })).toBeDisabled();
  expect(screen.getByText(`${text.memory} 1 ${text.of} 2`)).toBeOnTheScreen();
});

it.each(['en', 'sv'] as const)('does not infer success from another changed version with equal correction in %s', async language => {
  const view = await open(language);
  jest.mocked(patchMemory).mockRejectedValueOnce(new StoryProjectsError('unavailable', 503, true));
  correct(language); await waitFor(() => expect(ui().state.phase).toBe('uncertain'));
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language)]));
  await refresh(language); expect(ui().state.notice).toBe('conflict'); expect(field(language)).toHaveProp('value', '1975');
  expect(patchMemory).toHaveBeenCalledTimes(1); view.unmount();
});

it.each(['en', 'sv'] as const)('keeps acknowledged but superseded review for explicit re-review in %s', async language => {
  const view = await open(language);
  jest.mocked(patchMemory).mockResolvedValueOnce(saved(language));
  jest.mocked(listMemoryReview).mockImplementationOnce(async () => { throw backoff('API_BUSY'); });
  correct(language); await waitFor(() => expect(ui().state.phase).toBe('uncertain')); expire(view, language);
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language, { version: 3 })]));
  await refresh(language); expect(ui().state.notice).toBe('conflict');
  expect(field(language)).toHaveProp('value', '1975'); expect(ui().state.retainedReview.canRetry).toBe(false);
  expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('does not silently retry against a changed same-version review in %s', async language => {
  const view = await rejected(language, 'RATE_LIMITED'); expire(view, language);
  jest.mocked(listMemoryReview).mockResolvedValue(review([saved(language, { version: 1, corrected_value: '1976' })]));
  await refresh(language); expect(ui().state.notice).toBe('conflict');
  expect(screen.getByRole('button', { name: memoryReviewCopy[language].save })).toBeDisabled();
  expect(field(language)).toHaveProp('value', '1975'); expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('keeps a missing selected memory read-only with a clear safe exit in %s', async language => {
  const view = await rejected(language, 'API_BUSY'), text = memoryReviewCopy[language]; expire(view, language);
  jest.mocked(listMemoryReview).mockResolvedValue(review([])); await refresh(language);
  expect(screen.getByText(text.missingReviewMemory)).toBeOnTheScreen();
  expect(field(language)).toHaveProp('value', '1975');
  expect(screen.getByRole('button', { name: text.reviewLatest })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.back })).toBeEnabled(); expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['background', 'owner', 'project', 'session', 'signOut', 'back'] as const)('clears private retained text on %s', async action => {
  const view = await rejected('en', 'RATE_LIMITED');
  expect(field('en')).toHaveProp('value', '1975');
  jest.mocked(listMemoryReview).mockResolvedValue(review([])); jest.mocked(listConversationMessages).mockResolvedValue({ messages: [], complete: true });
  if (action === 'background') act(() => appChange('inactive'));
  else if (action === 'back' || action === 'signOut') act(() => ui()[action === 'back' ? 'onBack' : 'onSignOut']());
  else {
    const change = action === 'owner' ? { ownerId: 'account-b' } : action === 'project'
      ? { projectId: '50000000-0000-4000-8000-000000000001' } : { sessionId: '60000000-0000-4000-8000-000000000001' };
    view.rerender(<MemoryReview {...props('en')} {...change} />);
    await waitFor(() => expect(ui().state.phase).toBe('ready'));
  }
  expect(ui().state.retainedReview).toBeUndefined(); expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('clears the retained correction on %s during reconciliation', async kind => {
  const view = await rejected('sv', 'API_BUSY'); expire(view, 'sv');
  jest.mocked(listMemoryReview).mockRejectedValueOnce(new StoryProjectsError(kind)); await refresh('sv');
  expect(ui().state.retainedReview).toBeUndefined(); expect(ui().state.memories).toEqual([]); expect(ui().state.sources).toEqual([]);
  expect(screen.queryByLabelText(memoryReviewCopy.sv.correctionLabel)).toBeNull(); expect(patchMemory).toHaveBeenCalledTimes(1);
});
