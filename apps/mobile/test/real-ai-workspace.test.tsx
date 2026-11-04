import { createHash } from 'node:crypto';
import { nativeNodes } from './native-tree';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, Keyboard, Platform, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as storyApi from '../src/api/story-projects';
import { createNativeRecorder, createRecordingId } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { realCopy } from '../src/real-ai/copy';
import { storyContentCopy } from '../src/real-ai/StoryContent';
import { realDraft, realIds as ids, realMemory, realMessage, realTranscript } from './real-ai-fixtures';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { completeEdgeSwipe } from './edge-swipe-events';
jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  hashRealText: jest.fn(), getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(), getRealMemories: jest.fn(),
  getRealDrafts: jest.fn(), transcribeRealRecording: jest.fn(), sendRealMessage: jest.fn(), sendRealTextMessage: jest.fn(), reviewRealMemory: jest.fn(),
  generateRealDraft: jest.fn(), editRealDraft: jest.fn(), getRealDraftHistory: jest.fn(), exportRealDraft: jest.fn(),
  createRealSpeech: jest.fn(), getRealSpeechAudio: jest.fn(), getRealOperation: jest.fn(),
  findRealOperation: jest.fn(), getRealExports: jest.fn(), downloadRealExport: jest.fn(),
}));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createNativeRecorder: jest.fn(), createRecordingId: jest.fn() }));
const mockPdfStore = { save: jest.fn(), share: jest.fn(), discard: jest.fn(), revoke: jest.fn() };
const mockPrivacy = { ready: true, failed: false, createStore: jest.fn(() => mockPdfStore), release: jest.fn(), rememberReturn: jest.fn() };
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: () => mockPrivacy }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn() };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));
const t = realCopy.en;
const project = { id: ids.project, language: 'en' as const, title: 'Synthetic UI contract story', description: null, status: 'draft', created_at: '2026-10-29T12:00:00Z', updated_at: '2026-10-29T12:00:00Z' };
const user = { id: '80000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' };
const clip = { uri: 'file:///synthetic-private-cache/recording.m4a', name: 'recording.m4a' as const, type: 'audio/mp4' as const, size: 1000, durationMs: 5000 };
let listeners: ((value: AppStateStatus) => void)[] = [];
const recorder = { requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}), stop: jest.fn(async () => clip),
  getStatus: jest.fn(() => ({ durationMs: 1000, isRecording: true, interrupted: false })), discard: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
const props = { language: 'en' as const, user, project, config: { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' as const },
  getAccessToken: jest.fn(async () => 'synthetic.token.signature'), onBack: jest.fn(), onSignOut: jest.fn() };
async function ready(tab: 'chat' | 'memories' | 'book' = 'chat') {
  await waitFor(() => {
    if (tab === 'chat') {
      expect(api.getRealMessages).toHaveBeenCalled(); expect(api.getRealTranscripts).toHaveBeenCalled();
      const input = screen.queryByLabelText(t.input) ?? screen.getByLabelText(realCopy.sv.input);
      expect(input.props.editable).toBe(true);
    } else {
      expect(tab === 'book' ? api.getRealDrafts : api.getRealMemories).toHaveBeenCalled();
      for (const copy of Object.values(realCopy)) {
        expect(screen.queryByText(tab === 'book' ? copy.loadingBook : copy.loadingMemories)).toBeNull();
        if (tab === 'book') expect(screen.queryByText(copy.loadingMemories)).toBeNull();
      }
    }
  });
}
async function press(label: string) { await fireEvent.press(screen.queryByRole('button', { name: label }) ?? screen.getByText(label)); await act(async () => {}); }
async function startVoice(language: 'en' | 'sv' = 'en') {
  const copy = realCopy[language];
  await fireEvent.press(screen.getByRole('button', { name: copy.start })); await act(async () => {});
  if (screen.queryByRole('button', { name: copy.consentContinue })) await press(copy.consentContinue);
}
async function emit(value: AppStateStatus) { await act(async () => { AppState.currentState = value; for (const listener of [...listeners]) listener(value); }); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.mocked(api.hashRealText).mockImplementation(async original => createHash('sha256').update(original, 'utf8').digest('hex'));
  AppState.currentState = 'active'; listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => { listeners.push(listener); return { remove: () => { listeners = listeners.filter(item => item !== listener); } }; });
  jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: true, transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' });
  jest.mocked(storyApi.listStorySessions).mockResolvedValue([{ id: ids.session, project_id: ids.project, language: 'en', status: 'active', created_at: project.created_at, updated_at: project.created_at, ended_at: null }]);
  jest.mocked(api.getRealTranscripts).mockResolvedValue([]); jest.mocked(api.getRealMessages).mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockResolvedValue([]); jest.mocked(api.getRealDrafts).mockResolvedValue([]);
  jest.mocked(createNativeRecorder).mockReturnValue(recorder); jest.mocked(createRecordingId).mockReturnValue(ids.key);
  jest.mocked(api.transcribeRealRecording).mockResolvedValue(realTranscript());
  jest.mocked(api.sendRealMessage).mockResolvedValue({ user_message: realMessage(), message: realMessage('assistant'), memories: [realMemory()], mode: 'real' });
  jest.mocked(api.sendRealTextMessage).mockImplementation(async (scope, original) => ({
    user_message: realMessage('user', { id: ids.key, source_transcript_id: null, source_text_input_id: ids.key,
      text: original, language: scope.language, provenance: { mode: 'original', provider: 'user', model: null, version: 1 } }),
    message: realMessage('assistant', { source_transcript_id: null, source_text_input_id: ids.key, language: scope.language }),
    memories: [], mode: 'real',
  }));
  jest.mocked(api.reviewRealMemory).mockResolvedValue(realMemory({ status: 'confirmed', version: 2 }));
  jest.mocked(api.generateRealDraft).mockResolvedValue(realDraft());
  jest.mocked(api.getRealDraftHistory).mockResolvedValue([]);
  jest.mocked(api.exportRealDraft).mockResolvedValue(new TextEncoder().encode('%PDF-1.4\nsynthetic bytes\n%%EOF'));
  mockPdfStore.save.mockResolvedValue({ id: ids.key }); mockPdfStore.share.mockResolvedValue(undefined); mockPdfStore.discard.mockResolvedValue(undefined);
  mockPlayback.play.mockResolvedValue(undefined); mockPlayback.stop.mockResolvedValue(undefined); mockPlayback.dispose.mockResolvedValue(undefined);
});
afterEach(async () => { await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active'; });

describe('real mobile workspace, synthetic controller checks only; physical phone acceptance remains separate', () => {
  it.each(['en', 'sv'] as const)('shows a short AI-off status and accessible Details in %s without enabling AI', async language => {
    const copy = realCopy[language];
    jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: false, transcription: false, conversation: false, writing: false, speech: false, reason: 'LIVE_AI_DISABLED' });
    await render(<RealStoryWorkspace {...props} language={language} />); await ready();
    expect(screen.getByText(copy.disabled)).toBeOnTheScreen();
    expect(copy.disabled).toBe(language === 'en' ? 'Memy is unavailable right now. Your saved stories are still here.'
      : 'Memy är inte tillgänglig just nu. Dina sparade berättelser finns kvar.');
    expect(screen.queryByText(copy.disabledDetails)).toBeNull();
    const details = screen.getByRole('button', { name: copy.details });
    expect(details.props.accessibilityState.expanded).toBe(false); expect(details).toHaveStyle({ minHeight: 56 });
    expect(details.props.accessibilityLanguage).toBe(language === 'sv' ? 'sv-SE' : 'en-GB');
    await fireEvent.press(details); expect(details.props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText(copy.disabledDetails)).toBeOnTheScreen();
    await fireEvent.press(details); expect(screen.queryByText(copy.disabledDetails)).toBeNull();
    expect(screen.queryByText(/SIMULATED TRANSCRIPT/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.start })); expect(createNativeRecorder).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(api.generateRealDraft).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('keeps top Back outside the scroll in all three workspace tabs in %s', async language => {
    const copy = realCopy[language];
    await render(<RealStoryWorkspace {...props} language={language} />); await ready();
    for (const label of [copy.chat, copy.memories, copy.book]) {
      await press(label);
      expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
      expect(within(screen.getByTestId('story-content-scroll')).queryByTestId('story-top-back')).toBeNull();
    }
    await fireEvent.press(screen.getByTestId('story-top-back')); expect(props.onBack).toHaveBeenCalledTimes(1);
  });
  it('keeps voice controls reachable beside long history through consent, saving and a recoverable recording failure', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue(Array.from({ length: 40 }, (_, index) => realMessage('user', {
      id: `synthetic-message-${index}`, sequence: index + 1, text: `Saved memory ${index}: ${'A long memory. '.repeat(40)}`,
    })));
    const transcript = deferred<Awaited<ReturnType<typeof api.transcribeRealRecording>>>();
    jest.mocked(api.transcribeRealRecording).mockReturnValueOnce(transcript.promise);
    await render(<RealStoryWorkspace {...props} />); await ready();
    const history = screen.getByTestId('story-content-scroll');
    const controls = () => within(screen.getByTestId('story-bottom-controls'));
    expect(within(history).getByTestId('real-ai-chat-thread')).toBeOnTheScreen();
    expect(within(history).queryByRole('button', { name: t.start })).toBeNull();
    await fireEvent.scroll(history, { nativeEvent: { contentOffset: { y: 2000 } } });
    await fireEvent.press(controls().getByRole('button', { name: t.start })); await act(async () => {});
    expect(screen.getByText(t.consent)).toBeOnTheScreen();
    expect(recorder.start).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    await press(t.consentCancel); await startVoice();
    expect(controls().getByRole('button', { name: t.stop })).toBeOnTheScreen();
    await press(t.stop);
    expect(controls().getByText(t.transcribing)).toBeOnTheScreen();
    expect(controls().getByRole('button', { name: t.discard })).toBeDisabled();
    // A proven unsuccessful upload retains only the local recording and its explicit recovery actions.
    await act(async () => transcript.reject(new api.RealAiError('unavailable', 503)));
    expect(controls().getByRole('button', { name: t.retry })).toBeEnabled();
    await fireEvent.press(controls().getByRole('button', { name: t.discard })); await act(async () => {});
    expect(recorder.discard).toHaveBeenCalledWith(clip);
    expect(controls().getByRole('button', { name: t.start })).toBeOnTheScreen();
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('top Back retains the existing unsaved autobiography warning in %s', async language => {
    const copy = realCopy[language], warning = leaveCopy[language];
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="book" />); await ready('book');
    await press(copy.edit); await fireEvent.changeText(screen.getByLabelText(copy.editor), 'My unsaved correction.');
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(warning.keep); expect(screen.getByLabelText(copy.editor).props.value).toBe('My unsaved correction.');
    await fireEvent.press(screen.getByTestId('story-top-back')); await press(warning.discard);
    expect(props.onBack).toHaveBeenCalledTimes(1); expect(api.editRealDraft).not.toHaveBeenCalled();
  });
  it('top Back retains the uncertain-request warning and existing check-saved-result action', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice(); await press(t.stop);
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await fireEvent.press(within(nativeNodes('modal')[0]).getByRole('button', { name: leaveCopy.en.check })); await act(async () => {});
    expect(api.findRealOperation).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    expect(props.onBack).not.toHaveBeenCalled();
  });
  it('reuses the authenticated active session and never creates duplicates merely while loading', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready();
    expect(storyApi.continueStoryProject).not.toHaveBeenCalled();
    expect(api.getRealTranscripts).toHaveBeenCalledWith(expect.objectContaining({ projectId: ids.project, sessionId: ids.session, language: 'en' }));
  });
  it('starts independent capability and session reads together, then waits for both before loading the conversation', async () => {
    const caps = deferred<Awaited<ReturnType<typeof api.getRealCapabilities>>>();
    const sessions = deferred<Awaited<ReturnType<typeof storyApi.listStorySessions>>>();
    jest.mocked(api.getRealCapabilities).mockReturnValueOnce(caps.promise);
    jest.mocked(storyApi.listStorySessions).mockReturnValueOnce(sessions.promise);
    await render(<RealStoryWorkspace {...props} />);
    // Neither promise has settled: a serial startup would not have requested sessions yet.
    expect(api.getRealCapabilities).toHaveBeenCalledTimes(1);
    expect(storyApi.listStorySessions).toHaveBeenCalledTimes(1);
    expect(api.getRealTranscripts).not.toHaveBeenCalled();
    await act(async () => { sessions.resolve([{ id: ids.session, project_id: ids.project, language: 'en', status: 'active',
      created_at: project.created_at, updated_at: project.created_at, ended_at: null }]); });
    expect(api.getRealTranscripts).not.toHaveBeenCalled();
    await act(async () => { caps.resolve({ contract: 'real-v2', mode: 'real', enabled: true, transcription: true,
      conversation: true, writing: true, speech: true, reason: 'READY' }); });
    await ready();
    expect(storyApi.continueStoryProject).not.toHaveBeenCalled();
    expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
  });
  it('does not continue a session or restore private content when parallel startup settles after backgrounding', async () => {
    const caps = deferred<Awaited<ReturnType<typeof api.getRealCapabilities>>>();
    const sessions = deferred<Awaited<ReturnType<typeof storyApi.listStorySessions>>>();
    jest.mocked(api.getRealCapabilities).mockReturnValueOnce(caps.promise);
    jest.mocked(storyApi.listStorySessions).mockReturnValueOnce(sessions.promise);
    await render(<RealStoryWorkspace {...props} />);
    expect(storyApi.listStorySessions).toHaveBeenCalledTimes(1);
    await emit('background');
    await act(async () => {
      sessions.resolve([]);
      caps.resolve({ contract: 'real-v2', mode: 'real', enabled: true, transcription: true,
        conversation: true, writing: true, speech: true, reason: 'READY' });
    });
    expect(storyApi.continueStoryProject).not.toHaveBeenCalled();
    expect(api.getRealTranscripts).not.toHaveBeenCalled();
    expect(screen.getByText(t.background)).toBeTruthy();
  });
  it('requires consent before capture and automatically sends a stopped recording for transcript then reply exactly once', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.press(screen.getByRole('button', { name: t.start })); await act(async () => {});
    expect(screen.getByText(t.consent)).toBeOnTheScreen();
    expect(recorder.requestPermission).not.toHaveBeenCalled(); expect(recorder.start).not.toHaveBeenCalled();
    await press(t.consentCancel); expect(createNativeRecorder).not.toHaveBeenCalled();
    await startVoice();
    expect(recorder.requestPermission).toHaveBeenCalledTimes(1); expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled();
    await press(t.stop);
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).toHaveBeenCalledWith(expect.objectContaining({ sessionId: ids.session }), clip, true, ids.key);
    expect(recorder.discard).toHaveBeenCalledWith(clip);
    expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    expect(api.sendRealMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: ids.session }), { source_transcript_id: ids.transcript }, ids.key);
    expect(screen.getByText(realMessage('assistant').text)).toBeOnTheScreen();
    expect(screen.queryByText(t.original)).toBeNull(); await press(t.moreActions); await press(t.yourWords);
    expect(screen.getByText(t.original)).toBeOnTheScreen(); expect(screen.getByText(t.recordingSaved)).toBeOnTheScreen();
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('supports reviewed memories → generation → editing/history → private native PDF, each as an explicit action', async () => {
    jest.mocked(api.getRealMemories).mockResolvedValue([realMemory()]);
    await render(<RealStoryWorkspace {...props} initialTab="memories" />); await ready('memories');
    expect(screen.getByText(t.pendingStatus)).toBeTruthy(); await press(t.confirm);
    expect(api.reviewRealMemory).toHaveBeenCalledWith(expect.objectContaining({ sessionId: ids.session }), realMemory(), 'confirmed', undefined);
    await press(t.book); expect(api.generateRealDraft).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('checkbox')); await press(t.generate);
    expect(screen.getByText(realDraft().content)).toBeTruthy();
    expect(screen.queryByText(t.modelReview)).toBeNull(); await press(t.draftDetails);
    expect(screen.getByText(t.modelReview)).toBeTruthy();
    await press(t.edit); await fireEvent.changeText(screen.getByLabelText(t.editor), 'My explicit correction.');
    jest.mocked(api.editRealDraft).mockResolvedValue(realDraft({ content: 'My explicit correction.', revision: 2, status: 'edited',
      verification: { ...realDraft().verification, checked_revision: 2, method: 'manual_unverified' } }));
    await press(t.save); expect(api.editRealDraft).toHaveBeenCalledWith(expect.anything(), realDraft(), 'My explicit correction.');
    await press(t.historySection); expect(screen.getByText(t.noHistory)).toBeTruthy();
    await press(t.export); expect(mockPrivacy.createStore).toHaveBeenCalledWith(user.id); expect(mockPdfStore.share).toHaveBeenCalledTimes(1);
    expect(mockPdfStore.discard).toHaveBeenCalledTimes(1); expect(mockPrivacy.release).toHaveBeenCalledWith(mockPdfStore);
  });
  it('retains the paid operation identity on ambiguous submission, disables repeat sends and only reads status', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice(); await press(t.stop);
    expect(screen.getByText(t.uncertain)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.send }));
    expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await press(t.check); expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'conversation', ids.key);
    expect(api.getRealOperation).not.toHaveBeenCalled();
    expect(screen.getByText(t.operationPending)).toBeTruthy(); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('uses the separate server operation ID when an acknowledged paid response becomes uncertain', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, true, 'REAL_AI_UNCERTAIN', undefined, ids.memory));
    jest.mocked(api.getRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice(); await press(t.stop); await press(t.check);
    expect(api.getRealOperation).toHaveBeenCalledWith(expect.anything(), ids.memory);
    expect(api.findRealOperation).not.toHaveBeenCalled(); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('reconciles a completed speech operation and replays its owned audio without a second paid synthesis', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const metadata = { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en' as const, media_type: 'audio/wav' as const,
      audio_sha256: '0'.repeat(64), audio_size: 64, expires_at: '2099-10-29T12:00:00Z', status: 'ready' as const };
    jest.mocked(api.createRealSpeech).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, true, 'AI_OPERATION_UNCERTAIN', undefined, ids.memory));
    jest.mocked(api.getRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'speech', status: 'completed', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: metadata });
    jest.mocked(api.getRealSpeechAudio).mockResolvedValue(new Uint8Array(64));
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.speak); await press(t.check);
    await press(t.speak); expect(api.createRealSpeech).toHaveBeenCalledTimes(1);
    expect(api.getRealSpeechAudio).toHaveBeenCalledWith(expect.anything(), metadata); expect(mockPlayback.play).toHaveBeenCalledTimes(1);
  });
  it('requires an explicitly relabelled new-synthesis action after owned audio cache loss', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const metadata = { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en' as const, media_type: 'audio/wav' as const,
      audio_sha256: '0'.repeat(64), audio_size: 64, expires_at: '2099-10-29T12:00:00Z', status: 'ready' as const };
    jest.mocked(api.createRealSpeech).mockResolvedValue(metadata); jest.mocked(api.getRealSpeechAudio).mockRejectedValueOnce(new api.RealAiError('not-found', 410));
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.speak);
    expect(api.createRealSpeech).toHaveBeenCalledTimes(1); expect(screen.getByText(t.renewSpeech)).toBeTruthy();
    expect(mockPlayback.play).not.toHaveBeenCalled();
    jest.mocked(api.getRealSpeechAudio).mockResolvedValueOnce(new Uint8Array(64)); await press(t.renewSpeech);
    expect(api.createRealSpeech).toHaveBeenCalledTimes(2);
  });
  it('retains a failed native cleanup lease and blocks capture until a deliberate cleanup retry succeeds', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice();
    recorder.dispose.mockRejectedValueOnce(new Error('synthetic cleanup failure'));
    await emit('background'); expect(screen.getByText(t.cleanupBlocked)).toBeTruthy(); expect(mediaPrivacy.isBlocked()).toBe(true);
    await emit('active'); await press(t.retryCleanup); expect(mediaPrivacy.isBlocked()).toBe(false);
    expect(recorder.dispose).toHaveBeenCalledTimes(2); await press(t.resume);
    expect(screen.queryByText(t.cleanupBlocked)).toBeNull();
  });
  it('zeroes acquired speech/PDF buffers even when native file writing or playback fails', async () => {
    const wave = new Uint8Array(64).fill(7);
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    jest.mocked(api.createRealSpeech).mockResolvedValue({ speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en', media_type: 'audio/wav',
      audio_sha256: '0'.repeat(64), audio_size: 64, expires_at: '2099-10-29T12:00:00Z', status: 'ready' });
    jest.mocked(api.getRealSpeechAudio).mockResolvedValue(wave); mockPlayback.play.mockRejectedValueOnce(new Error('synthetic playback failure'));
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.speak); expect(wave.every(byte => byte === 0)).toBe(true);
    await press(t.book); const pdf = new TextEncoder().encode('%PDF-1.4\nsynthetic private bytes\n%%EOF');
    jest.mocked(api.exportRealDraft).mockResolvedValueOnce(pdf); mockPdfStore.save.mockRejectedValueOnce(new Error('synthetic file failure'));
    await press(t.export); expect(pdf.every(byte => byte === 0)).toBe(true); expect(mockPrivacy.release).toHaveBeenCalled();
  });
  it('makes a full page visible as incomplete and lets the reader fetch the next bounded page', async () => {
    const first = Array.from({ length: 100 }, (_, index) => realMessage('assistant', {
      id: index.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000001', sequence: index + 1, text: `Synthetic page row ${index + 1}`,
    }));
    jest.mocked(api.getRealMessages).mockResolvedValueOnce(first).mockResolvedValueOnce([realMessage('assistant', { sequence: 101, text: 'Synthetic page row 101' })]);
    await render(<RealStoryWorkspace {...props} />); await ready();
    expect(screen.getByText(`${t.moreSaved}: ${t.messages}`)).toBeTruthy(); await press(`${t.loadMore}: ${t.messages}`);
    expect(api.getRealMessages).toHaveBeenLastCalledWith(expect.anything(), 100); expect(screen.getByText('Synthetic page row 101')).toBeTruthy();
  });
  it('clears private contents and revokes audio on background; late callbacks cannot restore transcript/story text', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const rendered = await render(<RealStoryWorkspace {...props} />); await ready();
    expect(screen.getByText(realMessage('assistant').text)).toBeTruthy();
    await startVoice(); await emit('background');
    expect(screen.queryByText(realMessage('assistant').text)).toBeNull(); expect(recorder.dispose).toHaveBeenCalled();
    expect(screen.getByText(t.background)).toBeTruthy(); await emit('active'); expect(screen.queryByText(realMessage('assistant').text)).toBeNull();
    await press(t.resume); expect(screen.getByText(realMessage('assistant').text)).toBeTruthy(); await rendered.unmount();
  });
  it('requires a fresh confirmed leave intent for an unsaved native recording', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice();
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(props.onBack).not.toHaveBeenCalled(); expect(screen.getByText(leaveCopy.en.dirty)).toBeTruthy();
    await press(leaveCopy.en.discard); expect(props.onBack).toHaveBeenCalledTimes(1); expect(recorder.dispose).toHaveBeenCalled();
  });
  it('shows saved Swedish speech and source content in its project language without changing the selected language', async () => {
    jest.mocked(storyApi.listStorySessions).mockResolvedValue([{ id: ids.session, project_id: ids.project, language: 'sv', status: 'active', created_at: project.created_at, updated_at: project.created_at, ended_at: null }]);
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant', { language: 'sv', text: 'Syntetisk svensk kontraktsfråga?' })]);
    await render(<RealStoryWorkspace {...props} language="sv" project={{ ...project, language: 'sv' }} />); await ready();
    expect(screen.getByText('Syntetisk svensk kontraktsfråga?')).toBeTruthy();
    expect(screen.queryByText(realCopy.sv.introduction)).toBeNull();
    await press(realCopy.sv.moreActions); await press(realCopy.sv.privacy);
    expect(screen.getByText(realCopy.sv.introduction)).toBeOnTheScreen(); expect(screen.queryByText(realCopy.sv.pending)).toBeNull();
    expect(api.getRealMessages).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }));
  });
  it.each(['en', 'sv'] as const)('presents the memory and three review actions with exact evidence available in %s', async language => {
    const copy = realCopy[language], memory = realMemory({ clarification_question: null });
    jest.mocked(api.getRealMemories).mockResolvedValue([memory]);
    jest.mocked(api.reviewRealMemory).mockResolvedValue({ ...memory, status: 'rejected', version: 2 });
    await render(<RealStoryWorkspace {...props} language={language} initialTab="memories" />); await ready('memories');
    expect(screen.getByText(memory.value)).toBeOnTheScreen(); expect(screen.getByText(copy.pendingStatus)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.confirm })).toHaveStyle({ minHeight: 56 });
    expect(screen.getByRole('button', { name: copy.correctAction })).toHaveStyle({ minHeight: 56 });
    expect(screen.getByRole('button', { name: copy.reject })).toHaveStyle({ minHeight: 56 });
    expect(copy.reject).toBe(language === 'en' ? 'Leave out' : 'Utelämna');
    expect(screen.queryByLabelText(copy.correct)).toBeNull(); expect(screen.queryByText(memory.evidence)).toBeNull();
    const evidence = screen.getByRole('button', { name: copy.seeOriginal });
    expect(evidence.props.accessibilityState.expanded).toBe(false);
    expect(evidence.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
    await fireEvent.press(evidence); expect(evidence.props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText(memory.evidence)).toHaveProp('selectable', true);
    await fireEvent.press(evidence); expect(screen.queryByText(memory.evidence)).toBeNull();
    expect(api.reviewRealMemory).not.toHaveBeenCalled();
    await press(copy.reject);
    expect(api.reviewRealMemory).toHaveBeenCalledWith(expect.anything(), memory, 'rejected', undefined);
    expect(screen.getByText(copy.rejected)).toBeOnTheScreen();
  });
  it.each(['en', 'sv'] as const)('preserves a typed correction through disclosure toggles and guarded Back in %s', async language => {
    const copy = realCopy[language], warning = leaveCopy[language], memory = realMemory();
    const corrected = { ...memory, corrected_value: 'My corrected memory', status: 'confirmed' as const, version: 2 };
    jest.mocked(api.getRealMemories).mockResolvedValue([memory]);
    jest.mocked(api.reviewRealMemory).mockResolvedValueOnce(corrected).mockResolvedValueOnce({ ...corrected, status: 'rejected', version: 3 });
    await render(<RealStoryWorkspace {...props} language={language} initialTab="memories" />); await ready('memories');
    await press(copy.correctAction); await fireEvent.changeText(screen.getByLabelText(copy.correct), 'My corrected memory');
    for (const label of [copy.seeOriginal, copy.correctAction, copy.seeOriginal, copy.correctAction]) await press(label);
    const input = screen.getByLabelText(copy.correct);
    expect(input.props.value).toBe('My corrected memory'); expect(input.props.allowFontScaling).toBe(true);
    expect(input.props.multiline).toBe(true); expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByTestId('story-content-scroll').props.automaticallyAdjustKeyboardInsets).toBe(true);
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(warning.keep); expect(screen.getByLabelText(copy.correct).props.value).toBe('My corrected memory');
    await press(storyContentCopy[language].saveCorrection);
    expect(api.reviewRealMemory).toHaveBeenNthCalledWith(1, expect.anything(), memory, 'confirmed', 'My corrected memory');
    expect(screen.getByText(corrected.corrected_value)).toBeOnTheScreen();
    await press(storyContentCopy[language].changeDecision); await press(copy.reject);
    expect(api.reviewRealMemory).toHaveBeenNthCalledWith(2, expect.anything(), corrected, 'rejected', undefined);
    expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('prioritizes saved prose and keeps Sources, History, Versions and PDFs reachable in %s', async language => {
    const copy = realCopy[language], latest = realDraft({ version: 2, revision: 3, content: 'The newest saved autobiography.' });
    const older = realDraft({ draft_id: ids.assistant, content: 'An older saved autobiography.' });
    jest.mocked(api.getRealDrafts).mockResolvedValue([latest, older]);
    jest.mocked(api.getRealExports).mockResolvedValue([]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="book" />); await ready('book');
    expect(screen.getAllByText(project.title)).toHaveLength(1);
    expect(screen.getByText(latest.content)).toHaveProp('selectable', true);
    expect(screen.getByText(copy.reviewDraft)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.edit })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.export })).toBeOnTheScreen();
    expect(screen.queryByText(copy.modelReview)).toBeNull();
    expect(screen.queryByText(latest.source_memories[0].evidence)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.history })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.exports })).toBeNull();
    expect(screen.queryByRole('button', { name: `${copy.version} 1 · ${copy.revision} 1` })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.generate })).toBeNull();
    await press(copy.draftDetails);
    expect(screen.getByText(latest.source_memories[0].evidence)).toBeOnTheScreen();
    expect(screen.getByText(copy.modelReview)).toBeOnTheScreen();
    expect(api.getRealDraftHistory).not.toHaveBeenCalled();
    await press(copy.historySection); expect(api.getRealDraftHistory).toHaveBeenCalledWith(expect.anything(), latest.draft_id);
    expect(screen.getByText(copy.noHistory)).toBeOnTheScreen();
    await press(copy.historySection); await press(copy.historySection);
    expect(screen.getByText(copy.noHistory)).toBeOnTheScreen(); expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1);
    expect(api.getRealExports).not.toHaveBeenCalled();
    await press(copy.pdfVersions); expect(screen.getByText(copy.noExports)).toBeOnTheScreen();
    expect(api.getRealExports).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: copy.historySection })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${copy.version} 1 · ${copy.revision} 1` })).toBeOnTheScreen();
    await press(`${copy.version} 1 · ${copy.revision} 1`);
    expect(screen.getByText(older.content)).toBeOnTheScreen();
    await press(copy.edit); expect(screen.getByLabelText(copy.editor).props.value).toBe(older.content);
    await press(copy.cancel); expect(screen.getByText(older.content)).toBeOnTheScreen();
    await press(copy.export); expect(api.exportRealDraft).toHaveBeenCalledWith(expect.anything(), older);
    expect(mockPdfStore.share).toHaveBeenCalledTimes(1); expect(mockPdfStore.discard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.pdfNotice)).toBeNull();
    await press(storyContentCopy[language].pdfDetails); expect(screen.getByText(copy.pdfNotice)).toBeOnTheScreen();
    expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.editRealDraft).not.toHaveBeenCalled();
  });
  it('keeps refresh and deep Sign Out quiet while retaining their existing safe actions', async () => {
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} initialTab="book" />); await ready('book');
    expect(screen.queryByRole('button', { name: t.reload })).toBeNull(); await press(t.moreActions);
    for (const label of [t.reload, t.signOut]) expect(screen.getByRole('button', { name: label })).toHaveStyle({ minHeight: 56, backgroundColor: 'transparent' });
    await press(t.reload); expect(api.getRealCapabilities).toHaveBeenCalledTimes(2);
    await press(t.edit); await fireEvent.changeText(screen.getByLabelText(t.editor), 'Unsaved autobiography.');
    expect(screen.getByRole('button', { name: t.reload })).toBeDisabled();
    await press(t.signOut); expect(props.onSignOut).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(screen.getByLabelText(t.editor).props.value).toBe('Unsaved autobiography.');
    await press(t.signOut); await press(leaveCopy.en.discard); expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
  it.each((['en', 'sv'] as const).flatMap(language => (['chat', 'memories', 'book'] as const).map(tab => ({ language, tab }))))(
    'swipe uses the visible Back action from the %s workspace', async ({ language, tab }) => {
      jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
      await render(<RealStoryWorkspace {...props} language={language} initialTab={tab} />); await ready(tab);
      expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
      await completeEdgeSwipe(screen.getByTestId('story-gesture-surface')); expect(props.onBack).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['en', 'sv'] as const)('swipe dismisses the keyboard and keeps exact unsaved autobiography text after Keep Editing in %s', async language => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true); const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const copy = realCopy[language], warning = leaveCopy[language];
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="book" />); await ready('book');
    await press(copy.edit); await fireEvent.changeText(screen.getByLabelText(copy.editor), 'My exact unsaved text.\nSecond line.');
    await completeEdgeSwipe(screen.getByTestId('story-gesture-surface'));
    expect(dismiss).toHaveBeenCalled(); expect(props.onBack).not.toHaveBeenCalled();
    expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); await press(warning.keep);
    expect(screen.getByLabelText(copy.editor).props.value).toBe('My exact unsaved text.\nSecond line.');
    expect(api.editRealDraft).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('swipe/cancel retains typed memory correction and evidence controls in %s', async language => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const copy = realCopy[language]; jest.mocked(api.getRealMemories).mockResolvedValue([realMemory()]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="memories" />); await ready('memories');
    await press(copy.correctAction); await fireEvent.changeText(screen.getByLabelText(copy.correct), 'Keep this exact correction.');
    await press(copy.seeOriginal); await completeEdgeSwipe(screen.getByTestId('story-gesture-surface'));
    expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen(); await press(leaveCopy[language].keep);
    expect(screen.getByLabelText(copy.correct).props.value).toBe('Keep this exact correction.');
    expect(screen.getByText(realMemory().evidence)).toBeOnTheScreen();
    expect(props.onBack).not.toHaveBeenCalled(); expect(api.reviewRealMemory).not.toHaveBeenCalled();
  });
  it.each(['active', 'local'] as const)('swipe retains the existing warning for an %s recording', async mode => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice();
    if (mode === 'local') {
      jest.mocked(api.transcribeRealRecording).mockRejectedValueOnce(new api.RealAiError('unavailable', 503));
      await press(t.stop);
    }
    await completeEdgeSwipe(screen.getByTestId('story-gesture-surface'));
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(screen.getByText(mode === 'active' ? t.stop : t.recorded)).toBeOnTheScreen();
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(mode === 'local' ? 1 : 0);
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it('swipe retains the existing uncertain request warning without repeating a request', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice(); await press(t.stop);
    await completeEdgeSwipe(screen.getByTestId('story-gesture-surface'));
    expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('confirmed swipe leave retains a failed private-audio cleanup lease', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    recorder.dispose.mockRejectedValueOnce(new Error('Synthetic cleanup failure'));
    await render(<RealStoryWorkspace {...props} />); await ready(); await startVoice();
    await completeEdgeSwipe(screen.getByTestId('story-gesture-surface')); await press(leaveCopy.en.discard);
    expect(props.onBack).toHaveBeenCalledTimes(1); await waitFor(() => expect(mediaPrivacy.isBlocked()).toBe(true));
    expect(screen.getByRole('button', { name: t.start })).toBeDisabled();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  });
  it('Android hardware Back still uses the same autobiography warning without an edge gesture', async () => {
    jest.replaceProperty(Platform, 'OS', 'android'); let hardwareBack = () => false;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => { hardwareBack = () => callback({ type: 'hardwareBackPress', timeStamp: 1 }) === true; return { remove: jest.fn() }; });
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} initialTab="book" />); await ready('book');
    expect(screen.getByTestId('story-gesture-surface').props.onMoveShouldSetResponderCapture).toBeUndefined();
    await press(t.edit); await fireEvent.changeText(screen.getByLabelText(t.editor), 'Unsaved Android text.');
    await act(() => { expect(hardwareBack()).toBe(true); });
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen(); await press(leaveCopy.en.keep);
    expect(screen.getByLabelText(t.editor).props.value).toBe('Unsaved Android text.'); expect(props.onBack).not.toHaveBeenCalled();
  });
});


describe('native typed composer — synthetic UI only, no live provider or phone certification', () => {
  it('starts with a large empty composer and never starts recording implicitly', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready();
    expect(screen.getByLabelText(t.input)).toBeTruthy();
    await press(t.send);
    expect(api.sendRealTextMessage).not.toHaveBeenCalled();
    expect(createNativeRecorder).not.toHaveBeenCalled();
  });
  it('sends exact words once, shows thinking, saves the shared thread and leaves listening optional', async () => {
    const original = '  I remember my garden.\n';
    const result = deferred<Awaited<ReturnType<typeof api.sendRealTextMessage>>>();
    jest.mocked(api.sendRealTextMessage).mockReturnValueOnce(result.promise);
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original);
    await press(t.send); await press(t.send);
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
    expect(api.sendRealTextMessage).toHaveBeenCalledWith(expect.objectContaining({ language: 'en', sessionId: ids.session }), original, ids.key);
    expect(screen.getByText(t.thinking)).toBeTruthy();
    await act(async () => result.resolve({
      user_message: realMessage('user', { id: ids.key, text: original, source_transcript_id: null, source_text_input_id: ids.key,
        provenance: { mode: 'original', provider: 'user', model: null, version: 1 } }),
      message: realMessage('assistant', { source_transcript_id: null, source_text_input_id: ids.key }), memories: [], mode: 'real',
    }));
    expect(screen.getByText(original)).toBeTruthy();
    expect(screen.queryByText(t.originalTyped)).toBeNull();
    await press(t.moreActions); await press(t.yourWords); expect(screen.getByText(t.originalTyped)).toBeOnTheScreen();
    expect(screen.getByLabelText(t.input).props.value).toBe('');
    expect(api.createRealSpeech).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  });
  it('preserves unsent words after a proven missing-migration failure without automatic retry', async () => {
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false, 'TEXT_CHAT_NOT_READY'));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'My unsent memory'); await press(t.send);
    expect(screen.getByLabelText(t.input).props.value).toBe('My unsent memory');
    expect(screen.getByText(t.textNotReady)).toBeTruthy(); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('clears unsent wording on backgrounding and never restores it from saved history', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Private unsent words'); await emit('background');
    await emit('active'); await press(t.resume); await ready();
    expect(screen.getByLabelText(t.input).props.value).toBe(''); expect(api.sendRealTextMessage).not.toHaveBeenCalled();
  });
  it('uses the story language for typed requests even when interface language differs', async () => {
    await render(<RealStoryWorkspace {...props} project={{ ...project, language: 'sv' }} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Jag minns Malmö.'); await press(t.send);
    expect(api.sendRealTextMessage).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }), 'Jag minns Malmö.', ids.key);
  });
});


function typedRecoveryTurn(original: string, changes: Partial<api.RealMessage> = {}): api.RealTurn {
  return { mode: 'real',
    user_message: realMessage('user', { id: ids.key, text: original, source_transcript_id: null,
      source_text_input_id: ids.key, provenance: { mode: 'original', provider: 'user', model: null, version: 1 }, ...changes }),
    message: realMessage('assistant', { source_transcript_id: null, source_text_input_id: ids.key }), memories: [] };
}
function typedRecoveryState(turn: api.RealTurn): api.RealOperation {
  return { operation_id: ids.key, kind: 'conversation', status: 'completed', project_id: ids.project, session_id: ids.session,
    created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null, typedTurn: turn };
}
describe('native typed retry/privacy fences — synthetic UI only', () => {
  it('does not claim a migration error is unsent when a server operation exists', async () => {
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, true, 'TEXT_CHAT_NOT_READY', undefined, ids.key));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'My held original'); await press(t.send);
    await waitFor(() => expect(screen.getByText(t.uncertain)).toBeTruthy());
    expect(screen.queryByText(t.textNotReady)).toBeNull();
    expect(screen.getByLabelText(t.input).props.value).toBe('My held original');
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('recovers the exact submitted text via GET only and appends the verified newest pair beyond the first page', async () => {
    const original = '  A typed memory beyond the first page.\n';
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original); await press(t.send);
    await waitFor(() => expect(screen.getByText(t.uncertain)).toBeTruthy());
    const turn = typedRecoveryTurn(original);
    jest.mocked(api.findRealOperation).mockResolvedValueOnce(typedRecoveryState(turn));
    // The reload deliberately does not include this newly completed turn.
    jest.mocked(api.getRealMessages).mockResolvedValueOnce([]);
    await press(t.check);
    await waitFor(() => expect(screen.getByLabelText(t.input).props.value).toBe(''));
    expect(screen.getByText(original)).toBeTruthy(); expect(screen.getByText(turn.message.text)).toBeTruthy();
    expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'conversation', ids.key, true);
    expect(api.hashRealText).toHaveBeenCalledTimes(2); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('does not restore stale pending memory review state from an old operation snapshot', async () => {
    const original = 'I lived in Malmö.';
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original); await press(t.send);
    const turn = typedRecoveryTurn(original);
    turn.memories = [realMemory({ source_message_id: ids.key, value: 'Malmö', evidence: 'Malmö', uncertain: false })];
    jest.mocked(api.findRealOperation).mockResolvedValueOnce(typedRecoveryState(turn));
    jest.mocked(api.getRealMemories).mockResolvedValueOnce([]);
    await press(t.check);
    await waitFor(() => expect(screen.getByLabelText(t.input).props.value).toBe(''));
    expect(screen.queryByText(t.reviewSuggested)).toBeNull();
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('keeps the draft and pending action when recovery returns altered original words', async () => {
    const original = 'Keep my exact unsent words.';
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true, undefined, undefined, ids.key));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original); await press(t.send);
    jest.mocked(api.getRealOperation).mockResolvedValueOnce(typedRecoveryState(typedRecoveryTurn('Altered saved words.')));
    await press(t.check);
    await waitFor(() => expect(screen.getByText(t.invalid)).toBeTruthy());
    expect(screen.getByLabelText(t.input).props.value).toBe(original);
    expect(screen.getByLabelText(t.input).props.editable).toBe(false);
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('does not clear original words for an incomplete typed recovery payload', async () => {
    const original = 'A held typed message.';
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true, undefined, undefined, ids.key));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original); await press(t.send);
    const state = typedRecoveryState(typedRecoveryTurn(original)); delete state.typedTurn;
    jest.mocked(api.getRealOperation).mockResolvedValueOnce(state); await press(t.check);
    await waitFor(() => expect(screen.getByText(t.invalid)).toBeTruthy());
    expect(screen.getByLabelText(t.input).props.value).toBe(original); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('labels a verified failed typed action unsent and retains wording for a later explicit choice', async () => {
    const original = 'My words after a proven failure.';
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), original); await press(t.send);
    jest.mocked(api.findRealOperation).mockResolvedValueOnce({ ...typedRecoveryState(typedRecoveryTurn(original)),
      status: 'failed', error_code: 'AI_RATE_LIMIT', typedTurn: undefined });
    await press(t.check);
    await waitFor(() => expect(screen.getByText(t.textNotSent)).toBeTruthy());
    expect(screen.getByLabelText(t.input).props.value).toBe(original); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });
  it('backgrounding during native SHA prevents dispatch and never revives the draft', async () => {
    const hash = deferred<string>(); jest.mocked(api.hashRealText).mockReturnValueOnce(hash.promise);
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Cleared while hashing.'); await press(t.send);
    expect(api.sendRealTextMessage).not.toHaveBeenCalled(); await emit('background'); await emit('active');
    await act(async () => hash.resolve('a'.repeat(64)));
    await press(t.resume); await ready();
    expect(screen.getByLabelText(t.input).props.value).toBe(''); expect(api.sendRealTextMessage).not.toHaveBeenCalled();
  });
  it('actor changes while hashing cannot post or restore the old actor draft', async () => {
    const hash = deferred<string>(); jest.mocked(api.hashRealText).mockReturnValueOnce(hash.promise);
    const view = await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Old actor private text'); await press(t.send);
    await view.rerender(<RealStoryWorkspace {...props} user={{ ...user, id: '80000000-0000-4000-8000-000000000002' }} />);
    await act(async () => hash.resolve('a'.repeat(64))); await ready();
    expect(screen.getByLabelText(t.input).props.value).toBe(''); expect(api.sendRealTextMessage).not.toHaveBeenCalled();
  });
});

it('REVIEW: reloads saved PDF metadata after creating a new export in the same view', async () => {
  jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
  jest.mocked(api.getRealExports).mockResolvedValueOnce([]).mockResolvedValueOnce([{
    export_id: ids.key, project_id: ids.project, draft_id: ids.draft, title: 'Newly exported PDF', language: 'en',
    draft_version: 1, draft_revision: 1, created_at: project.created_at,
    renderer_version: 'memy_real_pdf_v1',
  } as api.RealExport]);
  await render(<RealStoryWorkspace {...props} initialTab="book" />); await ready('book');
  await press(t.pdfVersions); await waitFor(() => expect(screen.getByText(t.noExports)).toBeOnTheScreen());
  await press(t.pdfVersions);
  await press(t.export); await waitFor(() => expect(mockPdfStore.share).toHaveBeenCalledTimes(1));
  await press(t.pdfVersions);
  await waitFor(() => expect(screen.getByText('Newly exported PDF')).toBeOnTheScreen());
  expect(api.getRealExports).toHaveBeenCalledTimes(2);
  expect(api.exportRealDraft).toHaveBeenCalledTimes(1);
  expect(api.getRealDrafts).toHaveBeenCalledTimes(1);
  expect(api.getRealMemories).toHaveBeenCalledTimes(1);
  expect(api.getRealMessages).not.toHaveBeenCalled();
  expect(api.getRealTranscripts).not.toHaveBeenCalled();
});

describe('localized backend recovery presentation', () => {
  it.each(['en', 'sv'] as const)('distinguishes allowance, service and wait errors in %s', async language => {
    const copy = realCopy[language];
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('unavailable', 429, false, 'AI_USER_BUDGET_EXHAUSTED', undefined, undefined, 'contact-operator'));
    const view = await render(<RealStoryWorkspace {...props} language={language} />);
    await waitFor(() => expect(screen.getAllByText(copy.usageLimit).length).toBeGreaterThan(0));
    expect(screen.queryByText(copy.unavailable)).toBeNull();
    await view.unmount();
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false, 'AI_SPENDING_NOT_APPROVED', undefined, undefined, 'contact-operator'));
    const service = await render(<RealStoryWorkspace {...props} language={language} />);
    await waitFor(() => expect(screen.getAllByText(copy.serviceUnavailable).length).toBeGreaterThan(0));
    expect(screen.queryByText(copy.unavailable)).toBeNull(); await service.unmount();
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false, 'AI_BUSY', undefined, undefined, 'wait'));
    await render(<RealStoryWorkspace {...props} language={language} />);
    await waitFor(() => expect(screen.getByText(copy.serviceBusy)).toBeOnTheScreen());
  });
  it('uses existing authentication failure recovery for sign-in advice', async () => {
    const onAuthenticationFailure = jest.fn();
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('authentication', 503, false, 'AI_USER_LIMIT_UNAVAILABLE', undefined, undefined, 'sign-in'));
    await render(<RealStoryWorkspace {...props} onAuthenticationFailure={onAuthenticationFailure} />);
    await waitFor(() => expect(onAuthenticationFailure).toHaveBeenCalledTimes(1));
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
});

it.each(['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE'])('keeps %s on the existing check-saved path', async code => {
  jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, true, code, undefined, ids.key, 'check-saved'));
  await render(<RealStoryWorkspace {...props} />); await ready();
  await fireEvent.changeText(screen.getByLabelText(t.input), 'Synthetic recovery words'); await press(t.send);
  await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
  expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  jest.mocked(api.getRealOperation).mockResolvedValue({ operation_id: ids.key, project_id: ids.project, session_id: ids.session,
    kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.updated_at, error_code: code, result: null });
  await press(t.check);
  expect(api.getRealOperation).toHaveBeenCalledWith(expect.anything(), ids.key, true);
  expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
});
it.each(['AI_USAGE_LIMIT', 'AI_GLOBAL_BUDGET_EXHAUSTED'])('shows allowance wording for %s without connection advice', async code => {
  jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('unavailable', 429, false, code, undefined, undefined, 'contact-operator'));
  await render(<RealStoryWorkspace {...props} />);
  await waitFor(() => expect(screen.getAllByText(t.usageLimit).length).toBeGreaterThan(0));
  expect(screen.queryByText(t.unavailable)).toBeNull(); expect(screen.queryByRole('button', { name: t.retry })).toBeNull();
});
