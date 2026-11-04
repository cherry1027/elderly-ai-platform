import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as projects from '../src/api/story-projects';
import { createRecordingId } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { realCopy } from '../src/real-ai/copy';
import { storyContentCopy } from '../src/real-ai/StoryContent';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { realDraft, realIds as ids, realMemory, realMessage } from './real-ai-fixtures';

jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(), getRealMemories: jest.fn(), getRealDrafts: jest.fn(),
  getRealDraftHistory: jest.fn(), getRealExports: jest.fn(), hashRealText: jest.fn(), sendRealTextMessage: jest.fn(), reviewRealMemory: jest.fn(),
  getRealOperation: jest.fn(), findRealOperation: jest.fn(), transcribeRealRecording: jest.fn(), sendRealMessage: jest.fn(),
  generateRealDraft: jest.fn(), editRealDraft: jest.fn(), exportRealDraft: jest.fn(), downloadRealExport: jest.fn(), createRealSpeech: jest.fn(),
}));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createRecordingId: jest.fn() }));
const mockPrivacy = { ready: true, failed: false, release: jest.fn(), rememberReturn: jest.fn(), createStore: jest.fn() };
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: () => mockPrivacy }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn(async () => {}) };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));

const t = realCopy.en;
const project = { id: ids.project, language: 'en' as const, title: 'Synthetic progressive workspace', description: null, status: 'draft',
  created_at: '2026-11-03T12:00:00Z', updated_at: '2026-11-03T12:00:00Z' };
const user = { id: '80000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' };
const props = { language: 'en' as const, user, project, config: { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' as const },
  getAccessToken: jest.fn(async () => 'synthetic.token.signature'), onBack: jest.fn(), onSignOut: jest.fn() };
const caps = { contract: 'real-v2' as const, mode: 'real' as const, enabled: true, transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' };
const session = { id: ids.session, project_id: ids.project, language: 'en' as const, status: 'active' as const,
  created_at: project.created_at, updated_at: project.updated_at, ended_at: null };
const savedMessage = realMessage('assistant', { text: 'Previously saved conversation.' });
let listeners: ((state: AppStateStatus) => void)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T) { await act(async () => { pending.resolve(value); }); }
async function tab(label: string) { await fireEvent.press(screen.getByRole('tab', { name: label })); await act(async () => {}); }
async function press(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); await act(async () => {}); }
async function chatReady() { await waitFor(() => { expect(api.getRealMessages).toHaveBeenCalled(); expect(screen.getByLabelText(t.input)).toBeEnabled(); }); }
async function opened() { const view = await render(<RealStoryWorkspace {...props} />); await chatReady(); return view; }
async function refresh() { if (!screen.queryByRole('button', { name: t.reload })) await press(t.moreActions); await press(t.reload); }
async function emit(state: AppStateStatus) { await act(async () => { AppState.currentState = state; [...listeners].forEach(listener => listener(state)); }); }

beforeEach(() => {
  AppState.currentState = 'active'; listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: () => { listeners = listeners.filter(item => item !== callback); } }; });
  jest.mocked(api.getRealCapabilities).mockReset().mockResolvedValue(caps);
  jest.mocked(projects.listStorySessions).mockReset().mockResolvedValue([session]);
  jest.mocked(projects.continueStoryProject).mockReset();
  jest.mocked(api.getRealTranscripts).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealMessages).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealDrafts).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealDraftHistory).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealExports).mockReset().mockResolvedValue([]);
  jest.mocked(api.hashRealText).mockReset().mockResolvedValue('a'.repeat(64));
  jest.mocked(createRecordingId).mockReturnValue(ids.key);
  jest.mocked(api.sendRealTextMessage).mockReset().mockImplementation(async (_scope, original) => ({
    user_message: realMessage('user', { text: original, source_transcript_id: null, source_text_input_id: ids.key,
      provenance: { mode: 'original', provider: 'user', model: null, version: 1 } }),
    message: realMessage('assistant', { text: 'Fresh Memy reply.', source_transcript_id: null, source_text_input_id: ids.key }), memories: [], mode: 'real',
  }));
  jest.mocked(api.reviewRealMemory).mockReset().mockResolvedValue(realMemory({ status: 'confirmed', version: 2 }));
});
afterEach(async () => {
  await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active';
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.exportRealDraft).not.toHaveBeenCalled();
});

describe('progressive workspace reads — synthetic transports only', () => {
  it('renders its shell and available navigation while capabilities and session lookup start in parallel', async () => {
    const capability = deferred<api.RealCapabilities>(), sessions = deferred<typeof session[]>();
    jest.mocked(api.getRealCapabilities).mockReturnValueOnce(capability.promise);
    jest.mocked(projects.listStorySessions).mockReturnValueOnce(sessions.promise);
    await render(<RealStoryWorkspace {...props} />);
    expect(screen.getByText(project.title)).toBeOnTheScreen(); expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: t.memories })).toBeEnabled();
    expect(api.getRealCapabilities).toHaveBeenCalledTimes(1); expect(projects.listStorySessions).toHaveBeenCalledTimes(1);
    expect(api.getRealMessages).not.toHaveBeenCalled(); await settle(sessions, [session]);
    expect(api.getRealMessages).not.toHaveBeenCalled(); await settle(capability, caps); await chatReady();
    expect(api.getRealMessages).toHaveBeenCalledTimes(1); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
    expect(projects.continueStoryProject).not.toHaveBeenCalled();
  });
  it('starts only the two conversation reads after session discovery and renders each successful resource progressively', async () => {
    const messages = deferred<api.RealMessage[]>(), transcripts = deferred<api.RealTranscript[]>();
    jest.mocked(api.getRealMessages).mockReturnValueOnce(messages.promise); jest.mocked(api.getRealTranscripts).mockReturnValueOnce(transcripts.promise);
    await render(<RealStoryWorkspace {...props} />);
    await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(1)); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
    expect(api.getRealMemories).not.toHaveBeenCalled(); expect(api.getRealDrafts).not.toHaveBeenCalled();
    expect(api.getRealDraftHistory).not.toHaveBeenCalled(); expect(api.getRealExports).not.toHaveBeenCalled();
    await settle(messages, [savedMessage]); expect(screen.getByText(savedMessage.text)).toBeOnTheScreen();
    await settle(transcripts, []); await chatReady();
  });
  it.each(['memories', 'book'] as const)('prioritizes the directly opened %s section without reading the conversation', async initialTab => {
    await render(<RealStoryWorkspace {...props} initialTab={initialTab} />);
    await waitFor(() => expect(api.getRealMemories).toHaveBeenCalledTimes(1));
    expect(api.getRealMessages).not.toHaveBeenCalled(); expect(api.getRealTranscripts).not.toHaveBeenCalled();
    if (initialTab === 'book') expect(api.getRealDrafts).toHaveBeenCalledTimes(1); else expect(api.getRealDrafts).not.toHaveBeenCalled();
    expect(api.getRealDraftHistory).not.toHaveBeenCalled(); expect(api.getRealExports).not.toHaveBeenCalled();
  });
  it('keeps a loaded conversation usable while the other sections have outstanding reads', async () => {
    const memories = deferred<api.RealMemory[]>(), drafts = deferred<api.RealDraft[]>();
    jest.mocked(api.getRealMemories).mockReturnValueOnce(memories.promise); jest.mocked(api.getRealDrafts).mockReturnValueOnce(drafts.promise);
    await opened(); await tab(t.memories); await tab(t.book); await tab(t.chat); await chatReady();
    expect(api.getRealMemories).toHaveBeenCalledTimes(1); expect(api.getRealDrafts).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByLabelText(t.input), 'A typed memory while another section loads.');
    expect(screen.getByRole('button', { name: t.send })).toBeEnabled();
    await settle(memories, []); await settle(drafts, []);
  });
  it('retains a nonempty conversation across memory-tab navigation without another message read', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([savedMessage]); await opened(); await tab(t.memories);
    await waitFor(() => expect(screen.getByText(t.emptyMemories)).toBeOnTheScreen()); await tab(t.chat);
    expect(screen.getByText(savedMessage.text)).toBeOnTheScreen(); expect(api.getRealMessages).toHaveBeenCalledTimes(1);
    expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
  });
  it('deduplicates rapid tab switches and retains an empty successful memory result', async () => {
    const memories = deferred<api.RealMemory[]>(); jest.mocked(api.getRealMemories).mockReturnValueOnce(memories.promise);
    await opened(); await tab(t.memories); await tab(t.chat); await tab(t.memories);
    expect(api.getRealMemories).toHaveBeenCalledTimes(1); await settle(memories, []);
    await tab(t.chat); await tab(t.memories); expect(api.getRealMemories).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.emptyMemories)).toBeOnTheScreen();
  });
  it('retains an empty successful autobiography result across tab changes', async () => {
    await opened(); await tab(t.book); await waitFor(() => expect(screen.getByText(t.emptyBook)).toBeOnTheScreen());
    await tab(t.chat); await tab(t.book); expect(api.getRealDrafts).toHaveBeenCalledTimes(1);
    expect(api.getRealMemories).toHaveBeenCalledTimes(1); expect(screen.getByText(t.emptyBook)).toBeOnTheScreen();
  });
  it('shows saved autobiography prose before related memories finish and reuses both completed reads', async () => {
    const memories = deferred<api.RealMemory[]>(); jest.mocked(api.getRealMemories).mockReturnValueOnce(memories.promise);
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]); await render(<RealStoryWorkspace {...props} initialTab="book" />);
    await waitFor(() => expect(screen.getByText(realDraft().content)).toBeOnTheScreen());
    expect(screen.getByRole('button', { name: t.edit })).toBeEnabled(); expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
    await settle(memories, []); await tab(t.memories); await tab(t.book);
    expect(api.getRealDrafts).toHaveBeenCalledTimes(1); expect(api.getRealMemories).toHaveBeenCalledTimes(1);
  });
  it('fetches history and saved PDF metadata only on their disclosures and reuses successful empty results', async () => {
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]); await render(<RealStoryWorkspace {...props} initialTab="book" />);
    await waitFor(() => expect(screen.getByText(realDraft().content)).toBeOnTheScreen());
    expect(api.getRealDraftHistory).not.toHaveBeenCalled(); expect(api.getRealExports).not.toHaveBeenCalled();
    await press(t.draftDetails); await press(t.historySection); expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1);
    await press(t.historySection); await press(t.historySection); expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1);
    await press(t.pdfVersions); expect(api.getRealExports).toHaveBeenCalledTimes(1);
    await press(t.pdfVersions); await press(t.pdfVersions); expect(api.getRealExports).toHaveBeenCalledTimes(1);
    await tab(t.memories); await tab(t.book); await press(t.draftDetails); await press(t.historySection); await press(t.pdfVersions);
    expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1); expect(api.getRealExports).toHaveBeenCalledTimes(1);
  });
  it('keeps independent history and PDF reads from blocking the autobiography or conversation', async () => {
    const history = deferred<Awaited<ReturnType<typeof api.getRealDraftHistory>>>(), exports = deferred<api.RealExport[]>();
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]); jest.mocked(api.getRealDraftHistory).mockReturnValueOnce(history.promise);
    jest.mocked(api.getRealExports).mockReturnValueOnce(exports.promise);
    await render(<RealStoryWorkspace {...props} initialTab="book" />); await waitFor(() => expect(screen.getByText(realDraft().content)).toBeOnTheScreen());
    await press(t.historySection); expect(screen.getByRole('button', { name: t.pdfVersions })).toBeEnabled(); await press(t.pdfVersions);
    expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1); expect(api.getRealExports).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: t.edit })).toBeEnabled(); await tab(t.chat); await chatReady();
    await settle(history, []); await settle(exports, []);
  });
  it('forces real refresh reads while retaining the useful saved conversation and already-loaded sections', async () => {
    const update = deferred<api.RealMessage[]>(); jest.mocked(api.getRealMessages).mockResolvedValue([savedMessage]);
    await render(<RealStoryWorkspace {...props} initialTab="memories" />);
    await waitFor(() => expect(screen.getByText(t.emptyMemories)).toBeOnTheScreen()); await tab(t.chat); await chatReady();
    jest.mocked(api.getRealMessages).mockReturnValueOnce(update.promise); await refresh();
    expect(screen.getByText(savedMessage.text)).toBeOnTheScreen(); expect(screen.getByLabelText(t.input)).toBeEnabled();
    await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2));
    expect(api.getRealCapabilities).toHaveBeenCalledTimes(2); expect(projects.listStorySessions).toHaveBeenCalledTimes(2);
    expect(api.getRealTranscripts).toHaveBeenCalledTimes(2); expect(api.getRealMemories).toHaveBeenCalledTimes(2);
    expect(api.getRealDrafts).not.toHaveBeenCalled(); expect(api.getRealDraftHistory).not.toHaveBeenCalled(); expect(api.getRealExports).not.toHaveBeenCalled();
    await settle(update, [realMessage('assistant', { text: 'Newer saved conversation.' })]);
    expect(screen.getByText('Newer saved conversation.')).toBeOnTheScreen();
  });
  it('keeps cached content visible and reports a refresh failure instead of fabricating an empty success', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValueOnce([savedMessage]).mockRejectedValueOnce(new api.RealAiError('network'));
    await opened(); await refresh(); await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2));
    expect(screen.getByText(savedMessage.text)).toBeOnTheScreen(); expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.queryByText(t.noMessages)).toBeNull();
  });
  it('aborts every resource read on background and prevents late responses from restoring private content', async () => {
    const messages = deferred<api.RealMessage[]>(), transcripts = deferred<api.RealTranscript[]>(), memories = deferred<api.RealMemory[]>(), drafts = deferred<api.RealDraft[]>();
    jest.mocked(api.getRealMessages).mockReturnValueOnce(messages.promise); jest.mocked(api.getRealTranscripts).mockReturnValueOnce(transcripts.promise);
    jest.mocked(api.getRealMemories).mockReturnValueOnce(memories.promise); jest.mocked(api.getRealDrafts).mockReturnValueOnce(drafts.promise);
    await render(<RealStoryWorkspace {...props} />); await waitFor(() => expect(api.getRealMessages).toHaveBeenCalled());
    await tab(t.memories); await tab(t.book);
    const scopes = [jest.mocked(api.getRealMessages).mock.calls[0][0], jest.mocked(api.getRealTranscripts).mock.calls[0][0],
      jest.mocked(api.getRealMemories).mock.calls[0][0], jest.mocked(api.getRealDrafts).mock.calls[0][0]];
    await emit('background'); scopes.forEach(scope => expect(scope.signal?.aborted).toBe(true));
    await settle(messages, [savedMessage]); await settle(transcripts, []); await settle(memories, [realMemory()]); await settle(drafts, [realDraft()]);
    expect(screen.queryByText(savedMessage.text)).toBeNull(); expect(screen.queryByText(realDraft().content)).toBeNull();
    expect(screen.getByText(t.background)).toBeOnTheScreen(); expect(projects.continueStoryProject).not.toHaveBeenCalled();
  });
  it('isolates old-owner promises and token callbacks when the account is replaced', async () => {
    const old = deferred<api.RealMessage[]>(); jest.mocked(api.getRealMessages).mockReturnValueOnce(old.promise);
    const view = await render(<RealStoryWorkspace {...props} />); await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(1));
    const oldScope = jest.mocked(api.getRealMessages).mock.calls[0][0], other = { ...user, id: '80000000-0000-4000-8000-000000000002' };
    await view.rerender(<RealStoryWorkspace {...props} user={other} />); await chatReady();
    expect(oldScope.signal?.aborted).toBe(true); await settle(old, [savedMessage]); expect(screen.queryByText(savedMessage.text)).toBeNull();
    const latestScope = jest.mocked(api.getRealMessages).mock.calls[1][0]; await latestScope.getAccessToken();
    expect(props.getAccessToken).toHaveBeenLastCalledWith(other.id);
  });
  it('revokes saved content and outstanding read callbacks after an authentication failure', async () => {
    const memories = deferred<api.RealMemory[]>(), drafts = deferred<api.RealDraft[]>(), onAuthenticationFailure = jest.fn();
    jest.mocked(api.getRealMessages).mockResolvedValue([savedMessage]); jest.mocked(api.getRealMemories).mockReturnValueOnce(memories.promise);
    jest.mocked(api.getRealDrafts).mockReturnValueOnce(drafts.promise);
    await render(<RealStoryWorkspace {...props} {...{ onAuthenticationFailure }} />); await chatReady();
    await tab(t.memories); await tab(t.book); const draftScope = jest.mocked(api.getRealDrafts).mock.calls[0][0];
    await act(async () => { memories.reject(new api.RealAiError('authentication', 401)); });
    expect(onAuthenticationFailure).toHaveBeenCalledTimes(1); expect(draftScope.signal?.aborted).toBe(true);
    await settle(drafts, [realDraft()]); expect(screen.queryByText(realDraft().content)).toBeNull(); await tab(t.chat);
    expect(screen.queryByText(savedMessage.text)).toBeNull(); expect(screen.getByText(t.auth)).toBeOnTheScreen();
  });
  it('does not let an older refresh response overwrite a newly completed typed turn', async () => {
    const old = deferred<api.RealMessage[]>(); jest.mocked(api.getRealMessages).mockResolvedValueOnce([]).mockReturnValueOnce(old.promise);
    await opened(); await refresh(); await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2));
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Keep my newly submitted original words.'); await press(t.send);
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(screen.getByText('Fresh Memy reply.')).toBeOnTheScreen();
    await settle(old, []); expect(screen.getByText('Fresh Memy reply.')).toBeOnTheScreen();
    expect(screen.getByText('Keep my newly submitted original words.')).toBeOnTheScreen();
  });
  it('does not restore an outdated pending memory after the user confirms its newer version', async () => {
    const old = deferred<api.RealMemory[]>(); jest.mocked(api.getRealMemories).mockResolvedValueOnce([realMemory()]).mockReturnValueOnce(old.promise);
    await render(<RealStoryWorkspace {...props} initialTab="memories" />); await waitFor(() => expect(screen.getByText(realMemory().value)).toBeOnTheScreen());
    await refresh(); await waitFor(() => expect(api.getRealMemories).toHaveBeenCalledTimes(2)); await press(t.confirm);
    expect(api.reviewRealMemory).toHaveBeenCalledTimes(1); expect(screen.queryByText(t.pendingStatus)).toBeNull();
    await settle(old, [realMemory()]); expect(screen.queryByText(t.pendingStatus)).toBeNull(); expect(screen.getByText(t.memoryConfirmed)).toBeOnTheScreen();
  });
  it('preserves the memory correction baseline when a late refresh returns a different source version', async () => {
    const original = realMemory(), update = deferred<api.RealMemory[]>(), correction = 'A correction based on the displayed original memory.';
    jest.mocked(api.getRealMemories).mockResolvedValueOnce([original]).mockReturnValueOnce(update.promise);
    await render(<RealStoryWorkspace {...props} initialTab="memories" />);
    await waitFor(() => expect(screen.getByText(original.value)).toBeOnTheScreen());
    await refresh(); await waitFor(() => expect(api.getRealMemories).toHaveBeenCalledTimes(2));
    await press(t.correctAction);
    await fireEvent.changeText(screen.getByLabelText(t.correct), correction);
    await settle(update, [realMemory({ version: 2, value: 'A different newer saved memory.' })]);
    await press(storyContentCopy.en.saveCorrection);
    expect(api.reviewRealMemory).toHaveBeenCalledWith(expect.anything(), original, 'confirmed', correction);
  });
  it('allows a fresh draft read after an unchanged editor closes through tab navigation', async () => {
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]); await render(<RealStoryWorkspace {...props} initialTab="book" />);
    await waitFor(() => expect(screen.getByText(realDraft().content)).toBeOnTheScreen()); await press(t.edit);
    expect(screen.getByLabelText(t.editor)).toBeOnTheScreen(); await tab(t.memories); await tab(t.book);
    expect(screen.queryByLabelText(t.editor)).toBeNull(); await refresh();
    await waitFor(() => expect(api.getRealDrafts).toHaveBeenCalledTimes(2));
  });
  it('preserves the autobiography edit baseline when an older refresh returns a newer draft revision', async () => {
    const original = realDraft(), update = deferred<api.RealDraft[]>(), localText = 'My local edit based on the original revision.';
    jest.mocked(api.getRealDrafts).mockResolvedValueOnce([original]).mockReturnValueOnce(update.promise);
    jest.mocked(api.editRealDraft).mockResolvedValueOnce(realDraft({ revision: 2, content: localText, status: 'edited' }));
    await render(<RealStoryWorkspace {...props} initialTab="book" />); await waitFor(() => expect(screen.getByText(original.content)).toBeOnTheScreen());
    await refresh(); await waitFor(() => expect(api.getRealDrafts).toHaveBeenCalledTimes(2)); await press(t.edit);
    await fireEvent.changeText(screen.getByLabelText(t.editor), localText);
    await settle(update, [realDraft({ revision: 2, content: 'A newer saved revision from another device.' })]);
    expect(screen.getByLabelText(t.editor)).toHaveDisplayValue(localText); await press(t.save);
    expect(api.editRealDraft).toHaveBeenCalledWith(expect.anything(), original, localText);
  });
  it('keeps an uncertain typed write owned while an older read settles and never automatically resends', async () => {
    const old = deferred<api.RealMessage[]>(); jest.mocked(api.getRealMessages).mockResolvedValueOnce([]).mockReturnValueOnce(old.promise);
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await refresh(); await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2));
    await fireEvent.changeText(screen.getByLabelText(t.input), 'An uncertain original message.'); await press(t.send); await settle(old, []);
    expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen(); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.updated_at, error_code: null, result: null });
    await press(t.check); expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'conversation', ids.key, true);
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(screen.getByText(t.operationPending)).toBeOnTheScreen();
  });
  it('preserves the existing guarded leave warning while the atomic Continue write is pending', async () => {
    const continuation = deferred<Awaited<ReturnType<typeof projects.continueStoryProject>>>();
    jest.mocked(projects.listStorySessions).mockResolvedValue([]); jest.mocked(projects.continueStoryProject).mockReturnValueOnce(continuation.promise);
    await render(<RealStoryWorkspace {...props} />); await waitFor(() => expect(projects.continueStoryProject).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(props.onBack).not.toHaveBeenCalled(); expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen();
    await settle(continuation, { project_id: ids.project, language: 'en', session_created: true, generation_triggered: false, session, latest_draft: null });
  });
  it('uses one atomic Continue even when the user changes sections during session discovery', async () => {
    const continuation = deferred<Awaited<ReturnType<typeof projects.continueStoryProject>>>();
    jest.mocked(projects.listStorySessions).mockResolvedValue([]); jest.mocked(projects.continueStoryProject).mockReturnValueOnce(continuation.promise);
    await render(<RealStoryWorkspace {...props} />); await waitFor(() => expect(projects.continueStoryProject).toHaveBeenCalledTimes(1));
    await tab(t.memories); await press(leaveCopy.en.keep); await tab(t.book); await press(leaveCopy.en.keep);
    expect(projects.continueStoryProject).toHaveBeenCalledTimes(1);
    expect(api.getRealMessages).not.toHaveBeenCalled();
    await settle(continuation, { project_id: ids.project, language: 'en', session_created: true, generation_triggered: false, session, latest_draft: null });
    await chatReady(); expect(projects.continueStoryProject).toHaveBeenCalledTimes(1);
  });
});
