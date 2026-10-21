import { act, render, screen, waitFor, cleanup } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import { TranscriptConversation } from '../src/conversation/TranscriptConversation';
import { ConversationActionsProvider, createConversationActionId } from '../src/conversation/ConversationActions';
import { ConversationPanel } from '../src/conversation/ConversationPanel';
import { transcriptConversationCopy as copy } from '../src/conversation/conversation-copy';
import { listConversationMessages, processTranscript, ConversationMessagesError, type ConversationMessage, type ConversationTurn } from '../src/api/conversation-messages';
import { SIMULATED_TRANSCRIPT_NOTICE, type AudioTranscript } from '../src/api/audio-transcripts';
import { StoryProjectsError, type StoryProjectsErrorKind } from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';

jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn(), processTranscript: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
const sourceId = '30000000-0000-4000-8000-000000000001';
const assistantId = '40000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const projectId = '10000000-0000-4000-8000-000000000001';
const source: AudioTranscript = { transcript_id: sourceId, session_id: sessionId, language: 'en',
  text: SIMULATED_TRANSCRIPT_NOTICE + 'A fictional source.', status: 'completed', created_at: '2026-10-21T12:00:00Z' };
const userMessage: ConversationMessage = { id: sourceId, session_id: sessionId, language: 'en', sequence: 1,
  role: 'user', text: source.text, created_at: source.created_at };
const assistant: ConversationMessage = { ...userMessage, id: assistantId, role: 'assistant', sequence: 3, text: 'A backend simulation reply.' };
const turn: ConversationTurn = { user_message: userMessage, message: assistant, memories: [], clarifications: [],
  requires_clarification: false, mode: 'mock' };
const getAccessToken = jest.fn(async (_owner: string) => 'synthetic-account-token');
const props = { language: 'en' as const, ownerId: 'account-a', projectId, sessionId, sessionLanguage: 'en' as const,
  baseUrl: 'http://192.168.20.40:8000', transcripts: [source], getAccessToken };
const state = () => screen.UNSAFE_getByType(ConversationPanel).props.state;
const callbacks = () => screen.UNSAFE_getByType(ConversationPanel).props;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function open(overrides: Partial<React.ComponentProps<typeof TranscriptConversation>> = {}) {
  const view = render(<TranscriptConversation {...props} {...overrides} />);
  await waitFor(() => expect(state().phase).not.toBe('loading'));
  return view;
}
async function select() { act(() => callbacks().onSelect(sourceId)); }
async function process() { await select(); await act(async () => callbacks().onProcess()); }
let onAppState: (value: string) => void;
beforeEach(() => {
  jest.mocked(listConversationMessages).mockReset().mockResolvedValue({ messages: [userMessage], complete: true });
  jest.mocked(processTranscript).mockReset().mockResolvedValue(turn);
  jest.mocked(readStoryPreviewEnabled).mockReset().mockReturnValue(false);
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(key);
  getAccessToken.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onAppState = listener as (value: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it('loads only saved history on entry, selection, transcript changes and refresh', async () => {
  const view = await open();
  expect(listConversationMessages).toHaveBeenCalledTimes(1);
  expect(processTranscript).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
  await select();
  expect(processTranscript).not.toHaveBeenCalled();
  view.rerender(<TranscriptConversation {...props} transcripts={[{ ...source }]} />);
  await act(async () => callbacks().onRefresh());
  expect(processTranscript).not.toHaveBeenCalled();
  expect(listConversationMessages).toHaveBeenCalledTimes(2);
  const options = jest.mocked(listConversationMessages).mock.calls[0][0];
  await options.getAccessToken();
  expect(getAccessToken).toHaveBeenLastCalledWith('account-a');
});
it.each(['en', 'sv'] as const)('explicitly processes one saved %s source with a separate stable UUID', async language => {
  const transcript = { ...source, language };
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [{ ...userMessage, language }], complete: true });
  jest.mocked(processTranscript).mockResolvedValue({ ...turn,
    user_message: { ...userMessage, language }, message: { ...assistant, language } });
  await open({ language, sessionLanguage: language, transcripts: [transcript] });
  await process();
  expect(processTranscript).toHaveBeenCalledTimes(1);
  expect(processTranscript).toHaveBeenCalledWith(expect.objectContaining({
    sourceTranscript: transcript, sessionId, projectId, expectedLanguage: language, idempotencyKey: key,
  }));
  expect(key).not.toBe(sourceId);
  expect(state().processedIds).toEqual([sourceId]);
  expect(state().messages).toHaveLength(2);
  expect(state().messages[0].text).toBe(source.text);
  expect(screen.queryByText(source.text)).toBeNull(); // full immutable source already displayed above by RecordingPanel
  expect(screen.getByText(assistant.text)).toBeOnTheScreen();
  act(() => { callbacks().onProcess(); callbacks().onProcess(); });
  expect(processTranscript).toHaveBeenCalledTimes(1);
});
it('locks repeat taps before reconciliation or POST resolves', async () => {
  await open(); const pending = deferred<ConversationTurn>();
  jest.mocked(processTranscript).mockReturnValueOnce(pending.promise);
  await select();
  act(() => { callbacks().onProcess(); callbacks().onProcess(); callbacks().onProcess(); });
  await waitFor(() => expect(processTranscript).toHaveBeenCalledTimes(1));
  expect(state().phase).toBe('processing');
  act(() => callbacks().onSelect('other'));
  await act(async () => pending.resolve(turn));
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(processTranscript).toHaveBeenCalledTimes(1);
});
it('requires GET reconciliation and a separate explicit same-key retry; adjacency never proves success', async () => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await open(); await process();
  expect(state().phase).toBe('uncertain');
  await act(async () => callbacks().onRetry());
  expect(processTranscript).toHaveBeenCalledTimes(1);
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [userMessage, assistant], complete: true });
  await act(async () => callbacks().onReconcile());
  expect(state()).toMatchObject({ phase: 'uncertain', canRetry: true, processedIds: [] });
  expect(processTranscript).toHaveBeenCalledTimes(1);
  await act(async () => callbacks().onRetry());
  expect(processTranscript).toHaveBeenCalledTimes(2);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  const calls = jest.mocked(processTranscript).mock.calls;
  expect(calls[0][0].idempotencyKey).toBe(calls[1][0].idempotencyKey);
  expect(calls[0][0].sourceTranscript).toBe(calls[1][0].sourceTranscript);
  expect(state().processedIds).toEqual([sourceId]);
  expect(state().messages).toHaveLength(2);
});
it('retains the same uncertain action across navigation in the same verified account scope', async () => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new StoryProjectsError('network', undefined, true));
  const tree = (visible: boolean) => <ConversationActionsProvider ownerId="account-a">
    {visible ? <TranscriptConversation {...props} /> : <Text>Outside conversation</Text>}
  </ConversationActionsProvider>;
  const view = render(tree(true));
  await waitFor(() => expect(state().phase).toBe('ready'));
  await process();
  view.rerender(tree(false)); view.rerender(tree(true));
  await waitFor(() => expect(state().phase).toBe('ready'));
  await select();
  expect(state().phase).toBe('uncertain');
  await act(async () => callbacks().onReconcile());
  await act(async () => callbacks().onRetry());
  expect(processTranscript).toHaveBeenCalledTimes(2);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(jest.mocked(processTranscript).mock.calls[1][0].idempotencyKey).toBe(key);
});
it.each(['configuration', 'authentication', 'forbidden', 'not-found', 'validation', 'conflict'] as StoryProjectsErrorKind[])
('blocks rejected %s actions without pretending success', async kind => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new StoryProjectsError(kind));
  await open(); await process();
  expect(state().processedIds).toEqual([]);
  expect(state().error).toBe(kind);
  await act(async () => callbacks().onReconcile());
  expect(state().canRetry).toBe(false);
  await act(async () => callbacks().onRetry());
  expect(processTranscript).toHaveBeenCalledTimes(1);
});
it.each(['sample', 'unconfigured'] as const)('never requests history or POST in %s mode', async mode => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(mode === 'sample');
  await open({ baseUrl: mode === 'unconfigured' ? null : props.baseUrl });
  act(() => callbacks().onProcess());
  expect(listConversationMessages).not.toHaveBeenCalled(); expect(processTranscript).not.toHaveBeenCalled();
  expect(state().error).toBe('configuration');
});
it('refuses processing when history is incomplete or source identity/text does not match', async () => {
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [], complete: false });
  const view = await open();
  act(() => { callbacks().onSelect(sourceId); callbacks().onProcess(); });
  expect(processTranscript).not.toHaveBeenCalled();
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [{ ...userMessage, text: 'Different original' }], complete: true });
  await act(async () => callbacks().onRefresh());
  await process();
  expect(state().error).toBe('invalid-response');
  expect(processTranscript).not.toHaveBeenCalled();
  view.unmount();
});
it.each(['ownerId', 'sessionId', 'projectId'] as const)('cancels and ignores late private results after %s changes', async field => {
  const pending = deferred<ConversationTurn>();
  jest.mocked(processTranscript).mockReturnValueOnce(pending.promise);
  const view = await open(); await select();
  act(() => callbacks().onProcess());
  await waitFor(() => expect(processTranscript).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(processTranscript).mock.calls[0][0].signal;
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [], complete: true });
  view.rerender(<TranscriptConversation {...props} {...{ [field]: field === 'ownerId' ? 'account-b' : '90000000-0000-4000-8000-000000000001' }} />);
  await waitFor(() => expect(state().phase).toBe('ready'));
  await act(async () => pending.resolve(turn));
  expect(signal?.aborted).toBe(true);
  expect(state().messages).toEqual([]); expect(state().processedIds).toEqual([]);
  expect(screen.queryByText(assistant.text)).toBeNull();
});
it('aborts and clears history on background and reloads without automatically retrying on return', async () => {
  const pending = deferred<ConversationTurn>();
  jest.mocked(processTranscript).mockReturnValueOnce(pending.promise);
  await open(); await select();
  act(() => callbacks().onProcess());
  await waitFor(() => expect(processTranscript).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(processTranscript).mock.calls[0][0].signal;
  act(() => onAppState('background'));
  expect(state().messages).toEqual([]);
  await act(async () => pending.resolve(turn));
  expect(state().messages).toEqual([]); expect(signal?.aborted).toBe(true);
  await act(async () => onAppState('active'));
  expect(processTranscript).toHaveBeenCalledTimes(1);
});
it('never exposes raw failure details or credentials', async () => {
  const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  jest.mocked(processTranscript).mockRejectedValueOnce(new Error('private-token password private-source'));
  await open(); await process();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/private-token|password|private-source/);
  logs.forEach(log => expect(log).not.toHaveBeenCalled());
});
it.each(['', 'not-uuid', sourceId] as const)('fails secure UUID validation or source collision %s without POST', async invalid => {
  jest.mocked(Crypto.randomUUID).mockReturnValue(invalid as ReturnType<typeof Crypto.randomUUID>);
  await open(); await process();
  expect(processTranscript).not.toHaveBeenCalled(); expect(state().processedIds).toEqual([]);
});
it('provides a cryptographic conversation helper independently from the audio upload adapter', () => {
  expect(createConversationActionId()).toBe(key);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});


it('classifies secure identity failure as unavailable before any POST', async () => {
  jest.mocked(Crypto.randomUUID).mockImplementation(() => { throw new Error('native private details'); });
  await open(); await process();
  expect(state()).toMatchObject({ phase: 'error', error: 'unavailable', canRetry: false });
  expect(processTranscript).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain('native private details');
});
it('never labels a blocked conflict as processed or offers an inert process action after navigation', async () => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new StoryProjectsError('conflict', 409));
  const tree = (visible: boolean) => <ConversationActionsProvider ownerId="account-a">
    {visible ? <TranscriptConversation {...props} /> : <Text>Outside conversation</Text>}
  </ConversationActionsProvider>;
  const view = render(tree(true));
  await waitFor(() => expect(state().phase).toBe('ready'));
  await process();
  await act(async () => callbacks().onReconcile());
  expect(state()).toMatchObject({ phase: 'ready', blockedIds: [sourceId], processedIds: [], selectedId: undefined });
  view.rerender(tree(false)); view.rerender(tree(true));
  await waitFor(() => expect(state().phase).toBe('ready'));
  const radio = screen.getByRole('radio');
  expect(radio).toBeDisabled();
  expect(screen.getByRole('button', { name: copy.en.process })).toBeDisabled();
  expect(screen.queryByText(copy.en.processed)).toBeNull();
  expect(processTranscript).toHaveBeenCalledTimes(1);
});


it('permits an explicit same-key retry of CONVERSATION_CHANGED only after saved-history checks', async () => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new ConversationMessagesError('conflict', 409, false, 'CONVERSATION_CHANGED'));
  await open(); await process();
  expect(state().phase).toBe('error');
  await act(async () => callbacks().onReconcile());
  expect(state().canRetry).toBe(true);
  expect(processTranscript).toHaveBeenCalledTimes(1);
  await act(async () => callbacks().onRetry());
  expect(processTranscript).toHaveBeenCalledTimes(2);
  expect(jest.mocked(processTranscript).mock.calls[1][0].idempotencyKey).toBe(key);
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('clears displayed history after %s revocation', async kind => {
  jest.mocked(processTranscript).mockRejectedValueOnce(new StoryProjectsError(kind));
  await open(); await process();
  expect(state().messages).toEqual([]);
  expect(state().selectedId).toBeUndefined();
});
