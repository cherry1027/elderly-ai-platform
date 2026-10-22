import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { Conversation } from '../src/stories/Conversation';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { readMobileApiConfig } from '../src/api/config';
import {
  continueStoryProject, listStorySessions, StoryProjectsError,
  type ConversationSession, type StoryContinuation, type StoryProject,
} from '../src/api/story-projects';
import { conversationCopy } from '../src/conversation-copy';
import { MemoryReview } from '../src/memories/MemoryReview';
jest.mock('../src/memories/MemoryReview', () => ({ MemoryReview: jest.fn(() => null) }));


jest.mock('../src/audio/SessionRecording', () => ({ SessionRecording: () => null }));

jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));

const id = '10000000-0000-4000-8000-000000000001';
const nextId = '10000000-0000-4000-8000-000000000002';
const sessionId = '20000000-0000-4000-8000-000000000001';
const nextSessionId = '20000000-0000-4000-8000-000000000002';
const user = { id: 'account-a', email: 'a@example.test' };
const token = jest.fn(async (_owner: string) => 'synthetic-account-access-token');
const onBack = jest.fn(); const onSignOut = jest.fn();
const text = conversationCopy.en;
const project = (overrides: Partial<StoryProject> = {}): StoryProject => ({ id, title: 'A fictional memory',
  description: null, language: 'en', status: 'draft', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', ...overrides });
const session = (overrides: Partial<ConversationSession> = {}): ConversationSession => ({
  id: sessionId, project_id: id, language: 'en', status: 'active',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ended_at: null, ...overrides,
});
const continued = (overrides: Partial<StoryContinuation> = {}): StoryContinuation => ({
  project_id: id, language: 'en', session: session(), session_created: true,
  latest_draft: null, generation_triggered: false, ...overrides,
});
const open = (props: Partial<React.ComponentProps<typeof Conversation>> = {}) => render(<Conversation
  language="en" user={user} project={project()} getAccessToken={token} onBack={onBack} onSignOut={onSignOut} {...props} />);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function currentState() { return screen.UNSAFE_getByType(ConversationScreen).props.state; }

beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReset().mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStorySessions).mockReset().mockResolvedValue([]);
  jest.mocked(continueStoryProject).mockReset().mockResolvedValue(continued());
  token.mockReset().mockResolvedValue('synthetic-account-access-token');
  onBack.mockClear(); onSignOut.mockClear(); jest.mocked(MemoryReview).mockClear();
});

it.each(['en', 'sv'] as const)('reconciles before starting a session with the current owner and story language in %s', async language => {
  jest.mocked(continueStoryProject).mockResolvedValueOnce(continued({ language, session: session({ language }) }));
  open({ language, project: project({ language }) });
  await screen.findByText(conversationCopy[language].started);
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).toHaveBeenCalledTimes(1);
  expect(jest.mocked(listStorySessions).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(continueStoryProject).mock.invocationCallOrder[0]);
  for (const call of [jest.mocked(listStorySessions).mock.calls[0][0], jest.mocked(continueStoryProject).mock.calls[0][0]]) {
    expect(call).toMatchObject({ projectId: id, expectedLanguage: language, baseUrl: 'http://192.168.20.30:8000' });
    await expect(call.getAccessToken()).resolves.toBe('synthetic-account-access-token');
    expect(token).toHaveBeenLastCalledWith(user.id);
  }
  expect(currentState()).toMatchObject({ status: 'ready', resumed: false, session: { id: sessionId, language } });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('reopens the existing active session without another write', async () => {
  jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
  open(); await screen.findByText(text.resumed);
  expect(continueStoryProject).not.toHaveBeenCalled();
  expect(currentState()).toMatchObject({ status: 'ready', resumed: true, session: { id: sessionId } });
});

it('does not repeat requests when equivalent project metadata is replaced by a parent render', async () => {
  const view = open(); await screen.findByText(text.started);
  view.rerender(<Conversation language="en" user={user} project={project({ description: 'Changed metadata only' })}
    getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(text.started)).toBeOnTheScreen();
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).toHaveBeenCalledTimes(1);
});

it('uses the canonical continue endpoint when the read page contains only completed sessions', async () => {
  jest.mocked(listStorySessions).mockResolvedValueOnce([session({ status: 'completed', ended_at: '2026-01-02T00:00:00Z' })]);
  jest.mocked(continueStoryProject).mockResolvedValueOnce(continued({ session_created: false,
    session: session({ id: nextSessionId }) }));
  open(); await screen.findByText(text.resumed);
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
  expect(currentState()).toMatchObject({ resumed: true, session: { id: nextSessionId } });
});

it.each(['network', 'timeout', 'unavailable', 'invalid-response'] as const)(
  'waits for explicit retry after an uncertain %s POST and reconciles an existing session without a second POST', async kind => {
    jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
    open(); await screen.findByText(text.uncertain);
    expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); });
    expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).toHaveBeenCalledTimes(1);
    jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
    fireEvent.press(screen.getByRole('button', { name: text.check }));
    await screen.findByText(text.resumed);
    expect(listStorySessions).toHaveBeenCalledTimes(2); expect(continueStoryProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(text.uncertain)).toBeNull();
  });

it('reconciles again before an explicit second POST when no active session can be read', async () => {
  jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  open(); await screen.findByText(text.uncertain);
  fireEvent.press(screen.getByRole('button', { name: text.check }));
  await screen.findByText(text.started);
  expect(listStorySessions).toHaveBeenCalledTimes(2); expect(continueStoryProject).toHaveBeenCalledTimes(2);
  expect(jest.mocked(listStorySessions).mock.invocationCallOrder[1]).toBeLessThan(
    jest.mocked(continueStoryProject).mock.invocationCallOrder[1]);
});

it('keeps uncertainty visible and never writes when a retry reconciliation GET fails', async () => {
  jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  open(); await screen.findByText(text.uncertain);
  jest.mocked(listStorySessions).mockRejectedValueOnce(new StoryProjectsError('network'));
  fireEvent.press(screen.getByRole('button', { name: text.check }));
  await screen.findByText(text.errors.network);
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
});

it('blocks duplicate retry taps while the reconciliation read is running', async () => {
  jest.mocked(listStorySessions).mockRejectedValueOnce(new StoryProjectsError('network'));
  open(); await screen.findByText(text.errors.network);
  const pending = deferred<ConversationSession[]>();
  jest.mocked(listStorySessions).mockReturnValueOnce(pending.promise);
  const retry = screen.UNSAFE_getByType(ConversationScreen).props.onCheck;
  act(() => { retry(); retry(); retry(); });
  await waitFor(() => expect(listStorySessions).toHaveBeenCalledTimes(2));
  expect(continueStoryProject).not.toHaveBeenCalled();
  await act(async () => { pending.resolve([session()]); });
  await screen.findByText(text.resumed);
  expect(listStorySessions).toHaveBeenCalledTimes(2); expect(continueStoryProject).not.toHaveBeenCalled();
});

it.each(['authentication', 'forbidden', 'not-found', 'validation'] as const)('blocks retry after a definitive %s read failure', async kind => {
  jest.mocked(listStorySessions).mockRejectedValueOnce(new StoryProjectsError(kind, kind === 'authentication' ? 401 : undefined));
  open(); await screen.findByText(text.errors[kind]);
  expect(screen.queryByRole('button', { name: text.check })).toBeNull();
  const retry = screen.UNSAFE_getByType(ConversationScreen).props.onCheck;
  act(() => retry());
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: text.signOut }));
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

it('blocks retry after a rejected authenticated POST without silently retrying the session', async () => {
  jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  open(); await screen.findByText(text.errors.authentication);
  expect(screen.queryByRole('button', { name: text.check })).toBeNull();
  act(() => screen.UNSAFE_getByType(ConversationScreen).props.onCheck());
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).toHaveBeenCalledTimes(1);
});

it('makes no token or API operation when development API configuration is missing', () => {
  jest.mocked(readMobileApiConfig).mockReturnValue(null); open();
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.configuration);
  expect(listStorySessions).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(text.ready)).toBeNull();
});

it.each(['back', 'signOut', 'unmount'] as const)('aborts a pending read on %s and never starts a session afterward', async action => {
  const pending = deferred<ConversationSession[]>();
  jest.mocked(listStorySessions).mockReturnValueOnce(pending.promise);
  const view = open(); await waitFor(() => expect(listStorySessions).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(listStorySessions).mock.calls[0][0].signal!;
  if (action === 'unmount') view.unmount();
  else fireEvent.press(screen.getByRole('button', { name: text[action] }));
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve([]); });
  expect(continueStoryProject).not.toHaveBeenCalled();
  if (action === 'unmount') expect(view.toJSON()).toBeNull();
  else {
    expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(text.ready)).toBeNull();
    act(() => screen.UNSAFE_getByType(ConversationScreen).props.onCheck());
    expect(listStorySessions).toHaveBeenCalledTimes(1);
  }
});

it.each(['back', 'signOut', 'unmount'] as const)('ignores a late successful POST after %s without publishing session data', async action => {
  const pending = deferred<StoryContinuation>();
  jest.mocked(continueStoryProject).mockReturnValueOnce(pending.promise);
  const view = open(); await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  if (action === 'unmount') view.unmount();
  else fireEvent.press(screen.getByRole('button', { name: text[action] }));
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(continued()); });
  if (action === 'unmount') expect(view.toJSON()).toBeNull();
  else {
    expect(screen.queryByText(text.ready)).toBeNull(); expect(screen.queryByText('A fictional memory')).toBeNull();
    expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
  }
});

it.each(['account', 'project'] as const)('fences a late result after a selected %s change', async change => {
  const pending = deferred<StoryContinuation>();
  jest.mocked(continueStoryProject).mockReturnValueOnce(pending.promise);
  const view = open(); await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  const nextUser = change === 'account' ? { id: 'account-b', email: 'b@example.test' } : user;
  const selected = change === 'project' ? nextId : id;
  jest.mocked(listStorySessions).mockResolvedValueOnce([session({ id: nextSessionId, project_id: selected })]);
  view.rerender(<Conversation language="en" user={nextUser} project={project({ id: selected, title: 'Next selected story' })}
    getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  expect(screen.queryByText('A fictional memory')).toBeNull();
  await screen.findByText('Next selected story'); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(continued()); });
  expect(currentState()).toMatchObject({ status: 'ready', session: { id: nextSessionId } });
  expect(screen.queryByText('A fictional memory')).toBeNull();
  await jest.mocked(listStorySessions).mock.calls[1][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith(nextUser.id);
});

it('rejects an old retry callback captured before an account change', async () => {
  jest.mocked(listStorySessions).mockRejectedValueOnce(new StoryProjectsError('network'));
  const view = open(); await screen.findByText(text.errors.network);
  const oldRetry = screen.UNSAFE_getByType(ConversationScreen).props.onCheck;
  jest.mocked(listStorySessions).mockResolvedValueOnce([session({ id: nextSessionId })]);
  view.rerender(<Conversation language="en" user={{ id: 'account-b', email: 'b@example.test' }}
    project={project({ title: 'Account B story' })} getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  await screen.findByText('Account B story');
  act(() => oldRetry());
  expect(listStorySessions).toHaveBeenCalledTimes(2); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(currentState()).toMatchObject({ status: 'ready', session: { id: nextSessionId } });
});

it('cancels pending work and returns to the story on Android hardware Back', async () => {
  let hardwareBack: (() => boolean | null | undefined) | undefined;
  const original = BackHandler.addEventListener;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'hardwareBackPress') hardwareBack = () => listener({ type: 'hardwareBackPress', timeStamp: 0 });
    return { remove: jest.fn() };
  });
  try {
    const pending = deferred<ConversationSession[]>();
    jest.mocked(listStorySessions).mockReturnValueOnce(pending.promise);
    open(); await waitFor(() => expect(listStorySessions).toHaveBeenCalledTimes(1));
    const signal = jest.mocked(listStorySessions).mock.calls[0][0].signal!;
    act(() => { expect(hardwareBack?.()).toBe(true); });
    expect(signal.aborted).toBe(true); expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve([]); });
    expect(continueStoryProject).not.toHaveBeenCalled(); expect(screen.queryByText(text.ready)).toBeNull();
  } finally { BackHandler.addEventListener = original; }
});

it.each(['en', 'sv'] as const)('opens memory review intentionally for this owned session in %s and returns without creating another session', async language => {
  jest.mocked(listStorySessions).mockResolvedValueOnce([session({ language })]);
  open({ language, project: project({ language }) });
  await screen.findByText(conversationCopy[language].resumed);
  expect(MemoryReview).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: conversationCopy[language].review }));
  const review = screen.UNSAFE_getByType(MemoryReview).props;
  expect(review).toMatchObject({ language, projectId: id, ownerId: user.id, sessionId, sessionLanguage: language });
  act(() => review.onBack());
  await screen.findByText(conversationCopy[language].resumed);
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).not.toHaveBeenCalled();
});

it('signs out from review through the existing private-data cleanup path', async () => {
  jest.mocked(listStorySessions).mockResolvedValueOnce([session()]);
  open(); await screen.findByText(text.resumed);
  fireEvent.press(screen.getByRole('button', { name: text.review }));
  act(() => screen.UNSAFE_getByType(MemoryReview).props.onSignOut());
  expect(onSignOut).toHaveBeenCalledTimes(1); expect(screen.UNSAFE_queryByType(MemoryReview)).toBeNull();
});
