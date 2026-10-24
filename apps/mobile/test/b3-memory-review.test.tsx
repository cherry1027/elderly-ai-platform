import { getComponent, getComponents } from './component-probe';
import { nativeNodes } from './native-tree';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, BackHandler, Keyboard, type AppStateStatus } from 'react-native';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import { readMobileApiConfig } from '../src/api/config';
import { listConversationMessages } from '../src/api/conversation-messages';
import { listMemoryReview, patchMemory, type MemoryFact } from '../src/api/memory-review';
import { continueStoryProject, listStorySessions, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';
import { MemoryReview } from '../src/memories/MemoryReview';
import { MemoryReviewScreen, type MemoryReviewState } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { AccountAction } from '../src/components/AccountPresentation';
import { Conversation } from '../src/stories/Conversation';
import { ConversationScreen } from '../src/screens/ConversationScreen';


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

jest.mock('../src/screens/ConversationScreen', () => {
  const actual = jest.requireActual<typeof import('../src/screens/ConversationScreen')>('../src/screens/ConversationScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, ConversationScreen: observeComponent(actual.ConversationScreen) };
});

jest.mock('../src/components/AccountPresentation', () => {
  const actual = jest.requireActual<typeof import('../src/components/AccountPresentation')>('../src/components/AccountPresentation');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, AccountAction: observeComponent(actual.AccountAction) };
});

jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'),
  listMemoryReview: jest.fn(), patchMemory: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'), listConversationMessages: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: () => false }));
jest.mock('../src/audio/SessionRecording', () => ({ SessionRecording: () => null }));
let mockWaiting = false;
jest.mock('../src/api/ApiBackoff', () => ({ useApiBackoff: () => ({ waiting: mockWaiting }), ApiBackoffBanner: () => null }));

const projectId = '10000000-0000-4000-8000-000000000001', sessionId = '20000000-0000-4000-8000-000000000001';
const memoryId = '30000000-0000-4000-8000-000000000001', sourceId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-01-01T00:00:00Z';
const words = (language: Language) => language === 'sv' ? 'Jag flyttade år 1974.' : 'I moved in 1974.';
const fact = (language: Language, changes: Partial<MemoryFact> = {}): MemoryFact => ({ id: memoryId, project_id: projectId,
  session_id: sessionId, source_message_id: sourceId, fact_type: 'date', value: '1974', evidence: words(language), year: 1974,
  slot: null, uncertain: true, status: 'pending', corrected_value: null, version: 1, created_at: stamp, updated_at: stamp, ...changes });
const source = (language: Language) => ({ id: sourceId, session_id: sessionId, role: 'user' as const, sequence: 1,
  language, text: SIMULATED_TRANSCRIPT_NOTICE + words(language), created_at: stamp });
const review = (language: Language, changes: Partial<MemoryFact> = {}) => ({ memories: [fact(language, changes)], clarifications: [], complete: true });
const token = jest.fn(async (_owner: string) => 'synthetic-user-token'), back = jest.fn(), signOut = jest.fn();
const props = (language: Language) => ({ language, title: 'A fictional story', ownerId: 'account-a', projectId, sessionId,
  sessionLanguage: language, baseUrl: 'http://192.168.20.30:8000', getAccessToken: token, onBack: back, onSignOut: signOut });
const ui = () => getComponent(MemoryReviewScreen).props;
const cases = (['en', 'sv'] as const).flatMap(language => (['RATE_LIMITED', 'API_BUSY'] as const).map(code => ({ language, code })));
const appListeners = new Set<(status: AppStateStatus) => void>();
const backListeners = new Set<Parameters<typeof BackHandler.addEventListener>[1]>();
async function hardwareBack() { await act(() => {
  for (const callback of [...backListeners].reverse()) if (callback({ type: 'hardwareBackPress', timeStamp: 0 })) break;
}); }
async function press(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); }
async function correction(language: Language, value = '1975') {
  await fireEvent.press(screen.getByRole('radio', { name: memoryReviewCopy[language].correct }));
  await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy[language].correctionLabel), value);
}
function backoff(code: 'RATE_LIMITED' | 'API_BUSY') {
  mockWaiting = true;
  return new StoryProjectsError('unavailable', code === 'RATE_LIMITED' ? 429 : 503, false,
    { code, retryAfterSeconds: 60, retryAt: Date.now() + 60_000 });
}
async function open(language: Language) {
  const view = await render(<MemoryReview {...props(language)} />);
  await waitFor(() => expect(ui().state.phase).toBe('ready'));
  return view;
}
beforeEach(() => {
  mockWaiting = false; AppState.currentState = 'active'; appListeners.clear(); backListeners.clear();
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listMemoryReview).mockReset(); jest.mocked(patchMemory).mockReset(); jest.mocked(listConversationMessages).mockReset();
  jest.mocked(listStorySessions).mockReset(); jest.mocked(continueStoryProject).mockReset();
  token.mockClear(); back.mockClear(); signOut.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => {
    appListeners.add(callback); return { remove: () => { appListeners.delete(callback); } };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, callback) => {
    backListeners.add(callback); return { remove: () => { backListeners.delete(callback); } };
  });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });
function seed(language: Language) {
  jest.mocked(listMemoryReview).mockResolvedValue(review(language));
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [source(language)], complete: true });
}

it.each((['en', 'sv'] as const).flatMap(language => (['back', 'signOut', 'refresh', 'next'] as const).map(intent => ({ language, intent }))))(
  'protects the unsaved $language correction from $intent and preserves it on Keep Editing', async ({ language, intent }) => {
    const text = memoryReviewCopy[language], leave = leaveCopy[language];
    const state: MemoryReviewState = { phase: 'ready', complete: true, sources: [source(language)], clarifications: [],
      memories: [fact(language), fact(language, { id: '30000000-0000-4000-8000-000000000002' })] };
    const refresh = jest.fn(), save = jest.fn();
    await render(<MemoryReviewScreen language={language} title="A fictional story" state={state}
      onBack={back} onSignOut={signOut} onRefresh={refresh} onSave={save} />);
    await correction(language);
    const label = text[intent];
    await press(label); expect(screen.getByText(leave.dirty)).toBeOnTheScreen();
    expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    await press(leave.keep);
    expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
    expect(screen.getByRole('radio', { name: text.correct }).props.accessibilityState.checked).toBe(true);
    await press(label); await press(leave.discard);
    if (intent === 'back') expect(back).toHaveBeenCalledTimes(1);
    else if (intent === 'signOut') expect(signOut).toHaveBeenCalledTimes(1);
    else if (intent === 'refresh') expect(refresh).toHaveBeenCalledTimes(1);
    else expect(screen.getByText(`${text.memory} 2 ${text.of} 2`)).toBeOnTheScreen();
    expect(screen.queryByLabelText(text.correctionLabel)).toBeNull(); expect(save).not.toHaveBeenCalled();
  });

it.each(['en', 'sv'] as const)('keeps %s correction, explicit submission and immutable provenance across keyboard Done', async language => {
  const text = memoryReviewCopy[language], save = jest.fn(), dismiss = jest.spyOn(Keyboard, 'dismiss');
  await render(<MemoryReviewScreen language={language} title="A fictional story" state={{ phase: 'ready', complete: true,
    sources: [source(language)], clarifications: [], memories: [fact(language)] }}
    onBack={back} onSignOut={signOut} onRefresh={jest.fn()} onSave={save} />);
  await correction(language); await fireEvent(screen.getByLabelText(text.correctionLabel), 'submitEditing');
  expect(dismiss).toHaveBeenCalled(); expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
  expect(save).not.toHaveBeenCalled(); expect(nativeNodes('scroll')).toHaveLength(1);
  expect(screen.getByText(text.uncertainFact)).toBeOnTheScreen(); expect(screen.getByText(text.simulated)).toBeOnTheScreen();
  expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen(); expect(screen.getByText(words(language))).toBeOnTheScreen();
  expect(screen.queryByText(source(language).text)).toBeNull(); await press(text.showSource);
  expect(screen.getByText(source(language).text)).toBeOnTheScreen();
  await press(text.save); expect(save).toHaveBeenCalledWith(fact(language), 'confirmed', '1975');
});

it.each(cases)('preserves actual controller correction through guarded leave and explicit recovery: $language $code', async ({ language, code }) => {
  seed(language); const view = await open(language), text = memoryReviewCopy[language];
  jest.mocked(patchMemory).mockImplementationOnce(async () => { throw backoff(code); });
  await correction(language, ' 1975 '); await press(text.save); await waitFor(() => expect(ui().state.error).toBe('unavailable'));
  await press(text.back); await press(leaveCopy[language].keep);
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', ' 1975 ');
  expect(ui().state.retainedReview).toMatchObject({ memoryId, expectedVersion: 1, action: 'correct', canRetry: false });
  mockWaiting = false; await view.rerender(<MemoryReview {...props(language)} />);
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(listMemoryReview).toHaveBeenCalledTimes(1);
  await press(text.refresh); await waitFor(() => expect(ui().state.retainedReview?.canRetry).toBe(true));
  expect(screen.queryByText(leaveCopy[language].dirty)).toBeNull();
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', ' 1975 ');
  jest.mocked(patchMemory).mockImplementationOnce(async () => {
    const saved = fact(language, { corrected_value: '1975', status: 'confirmed', version: 2 });
    jest.mocked(listMemoryReview).mockResolvedValue({ memories: [saved], clarifications: [], complete: true }); return saved;
  });
  await press(text.save); await waitFor(() => expect(ui().state.notice).toBe('saved'));
  expect(patchMemory).toHaveBeenCalledTimes(2);
  expect(jest.mocked(patchMemory).mock.calls[1][0].input).toEqual({ status: 'confirmed', corrected_value: '1975', expected_version: 1 });
  expect(jest.mocked(patchMemory).mock.calls[1][0].input).toEqual(jest.mocked(patchMemory).mock.calls[0][0].input);
  expect(listMemoryReview).toHaveBeenCalledTimes(4); expect(back).not.toHaveBeenCalled();
});

it.each(cases)('checks acknowledged uncertain save read-only from the leave warning: $language $code', async ({ language, code }) => {
  seed(language); const view = await open(language), text = memoryReviewCopy[language], leave = leaveCopy[language];
  const saved = fact(language, { corrected_value: '1975', status: 'confirmed', version: 2 });
  jest.mocked(patchMemory).mockResolvedValueOnce(saved);
  jest.mocked(listMemoryReview).mockImplementationOnce(async () => { throw backoff(code); });
  await correction(language); await press(text.save); await waitFor(() => expect(ui().state.phase).toBe('uncertain'));
  await press(text.back); expect(screen.getByText(leave.uncertain)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: leave.check })).toBeDisabled(); await press(leave.keep);
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
  mockWaiting = false; await view.rerender(<MemoryReview {...props(language)} />);
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(listMemoryReview).toHaveBeenCalledTimes(2);
  jest.mocked(listMemoryReview).mockResolvedValue({ memories: [saved], clarifications: [], complete: true });
  await press(text.back); await press(leave.check); await waitFor(() => expect(ui().state.notice).toBe('saved'));
  expect(patchMemory).toHaveBeenCalledTimes(1); expect(listMemoryReview).toHaveBeenCalledTimes(3);
  expect(back).not.toHaveBeenCalled(); expect(screen.queryByText(leave.title)).toBeNull();
});

it.each(cases)('keeps correction separate when explicit reconciliation finds a newer server version: $language $code', async ({ language, code }) => {
  seed(language); const view = await open(language), text = memoryReviewCopy[language];
  jest.mocked(patchMemory).mockImplementationOnce(async () => { throw backoff(code); });
  await correction(language); await press(text.save); await waitFor(() => expect(ui().state.error).toBe('unavailable'));
  mockWaiting = false; await view.rerender(<MemoryReview {...props(language)} />);
  jest.mocked(listMemoryReview).mockResolvedValue(review(language, { corrected_value: '1976', status: 'confirmed', version: 2 }));
  await press(text.refresh); await waitFor(() => expect(ui().state.notice).toBe('conflict'));
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975'); expect(screen.getByText('1976')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  expect(ui().state.retainedReview).toMatchObject({ expectedVersion: 1, conflict: true, canRetry: false });
  await press(text.back); await press(leaveCopy[language].keep);
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
  await press(text.reviewLatest); expect(screen.queryByLabelText(text.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled(); expect(patchMemory).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('clears private correction and pending navigation on background in %s', async language => {
  seed(language); await open(language); const text = memoryReviewCopy[language];
  await correction(language); await press(text.back);
  const staleDiscard = getComponents(AccountAction).find(node => node.props.label === leaveCopy[language].discard)!.props.onPress;
  await act(() => { for (const callback of [...appListeners]) callback('inactive'); });
  expect(screen.queryByLabelText(text.correctionLabel)).toBeNull(); expect(screen.queryByText(leaveCopy[language].title)).toBeNull();
  await act(() => staleDiscard()); expect(back).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
  expect(ui().state.retainedReview).toBeUndefined(); expect(ui().state.memories).toEqual([]);
});

it.each(['en', 'sv'] as const)('routes native Back through the actual memory guard when Conversation owns the parent in %s', async language => {
  seed(language); const text = memoryReviewCopy[language];
  jest.mocked(listStorySessions).mockResolvedValue([{ id: sessionId, project_id: projectId, language, status: 'active',
    created_at: stamp, updated_at: stamp, ended_at: null }]);
  const project: StoryProject = { id: projectId, title: 'Fictional story', description: null, language,
    status: 'draft', created_at: stamp, updated_at: stamp };
  await render(<Conversation language={language} user={{ id: 'account-a', email: 'account@example.test' }} project={project}
    getAccessToken={token} onBack={back} onSignOut={signOut} reviewOnOpen />);
  await waitFor(() => expect(ui().state.phase).toBe('ready'));
  await correction(language); await hardwareBack(); expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen();
  expect(back).not.toHaveBeenCalled(); await press(leaveCopy[language].keep);
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
  await hardwareBack(); await press(leaveCopy[language].discard); expect(back).toHaveBeenCalledTimes(1);
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
});

it.each((['en', 'sv'] as const).flatMap(language => (['onBack', 'onSignOut'] as const).map(action => ({ language, action })) ))(
  'routes captured conversation $action through the current $language memory warning', async ({ language, action }) => {
    seed(language); const text = memoryReviewCopy[language];
    jest.mocked(listStorySessions).mockResolvedValue([{ id: sessionId, project_id: projectId, language, status: 'active',
      created_at: stamp, updated_at: stamp, ended_at: null }]);
    const project: StoryProject = { id: projectId, title: 'Fictional story', description: null, language,
      status: 'draft', created_at: stamp, updated_at: stamp };
    await render(<Conversation language={language} user={{ id: 'account-a', email: 'account@example.test' }} project={project}
      getAccessToken={token} onBack={back} onSignOut={signOut} />);
    await waitFor(() => expect(getComponent(ConversationScreen).props.state.status).toBe('ready'));
    const old = getComponent(ConversationScreen).props;
    const oldParentBack = [...backListeners].at(-1)!;
    await act(() => required(old.onReviewMemories)()); await waitFor(() => expect(ui().state.phase).toBe('ready'));
    await correction(language);
    await act(() => expect(oldParentBack({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(false));
    await act(() => old[action]());
    expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen();
    expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled(); await press(leaveCopy[language].keep);
    expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1975');
    await act(() => old[action]()); await press(leaveCopy[language].discard);
    expect(action === 'onBack' ? back : signOut).toHaveBeenCalledTimes(1);
    expect(patchMemory).not.toHaveBeenCalled();
  });

it.each(['en', 'sv'] as const)('ignores another account’s captured conversation exits while reviewing in %s', async language => {
  seed(language); const text = memoryReviewCopy[language];
  jest.mocked(listStorySessions).mockResolvedValue([{ id: sessionId, project_id: projectId, language, status: 'active',
    created_at: stamp, updated_at: stamp, ended_at: null }]);
  const project: StoryProject = { id: projectId, title: 'Fictional story', description: null, language,
    status: 'draft', created_at: stamp, updated_at: stamp };
  const view = await render(<Conversation language={language} user={{ id: 'account-a', email: 'a@example.test' }} project={project}
    getAccessToken={token} onBack={back} onSignOut={signOut} />);
  await waitFor(() => expect(getComponent(ConversationScreen).props.state.status).toBe('ready'));
  const old = getComponent(ConversationScreen).props;
  await view.rerender(<Conversation language={language} user={{ id: 'account-b', email: 'b@example.test' }} project={project}
    getAccessToken={token} onBack={back} onSignOut={signOut} />);
  await waitFor(() => expect(getComponent(ConversationScreen).props.state.status).toBe('ready'));
  await act(() => required(getComponent(ConversationScreen).props.onReviewMemories)());
  await waitFor(() => expect(ui().state.phase).toBe('ready')); await correction(language, '1976');
  await act(() => { old.onBack(); old.onSignOut(); });
  expect(screen.queryByText(leaveCopy[language].title)).toBeNull();
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', '1976');
  expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled(); expect(patchMemory).not.toHaveBeenCalled();
});
