import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import './native-tree';
import { AppState, Pressable, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as projects from '../src/api/story-projects';
import { createNativeRecorder, createRecordingId, MAX_RECORDING_MS } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { getComponents } from './component-probe';
import { realCopy } from '../src/real-ai/copy';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { realIds as ids, realMessage, realTranscript } from './real-ai-fixtures';

jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(), getRealMemories: jest.fn(), getRealDrafts: jest.fn(),
  transcribeRealRecording: jest.fn(), sendRealMessage: jest.fn(), sendRealTextMessage: jest.fn(), hashRealText: jest.fn(),
  getRealOperation: jest.fn(), findRealOperation: jest.fn(), createRealSpeech: jest.fn(), getRealSpeechAudio: jest.fn(),
}));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createNativeRecorder: jest.fn(), createRecordingId: jest.fn() }));
const mockPrivacy = { ready: true, failed: false, release: jest.fn(), rememberReturn: jest.fn(), createStore: jest.fn() };
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: () => mockPrivacy }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn(async () => {}) };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));

const project = { id: ids.project, language: 'en' as const, title: 'Synthetic voice-flow test', description: null, status: 'draft',
  created_at: '2026-11-03T12:00:00Z', updated_at: '2026-11-03T12:00:00Z' };
const user = { id: '80000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' };
const clip = { uri: 'file:///synthetic-private-cache/voice.m4a', name: 'recording.m4a' as const, type: 'audio/mp4' as const, size: 1000, durationMs: 2000 };
const recorder = { requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}), stop: jest.fn(async () => clip),
  getStatus: jest.fn(() => ({ durationMs: 1000, isRecording: true, interrupted: false })),
  discard: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
const props = { language: 'en' as const, user, project, config: { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' as const },
  getAccessToken: jest.fn(async () => 'synthetic.token.signature'), onBack: jest.fn(), onSignOut: jest.fn() };
const transcript = realTranscript({ text: 'My preserved original spoken words.' });
const turn = { user_message: realMessage('user', { text: transcript.text }), message: realMessage('assistant'), memories: [], mode: 'real' as const };
const t = realCopy.en;
let listeners: ((state: AppStateStatus) => void)[] = [], keyNumber = 0;
async function press(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); await act(async () => {}); }
async function ready() {
  await waitFor(() => {
    expect(api.getRealMessages).toHaveBeenCalled(); expect(api.getRealTranscripts).toHaveBeenCalled();
    const input = screen.queryByLabelText(t.input) ?? screen.queryByLabelText(realCopy.sv.input);
    if (input) expect(input.props.editable).toBe(true);
    else expect(screen.getByRole('button', { name: t.start })).toBeOnTheScreen();
  });
}
async function opened() { const view = await render(<RealStoryWorkspace {...props} />); await ready(); return view; }
async function permitVoice() { await press(t.start); await press(t.consentContinue); await waitFor(() => expect(screen.getByRole('button', { name: t.stop })).toBeOnTheScreen()); }
async function emit(state: AppStateStatus) { await act(async () => { AppState.currentState = state; [...listeners].forEach(listener => listener(state)); }); }
function pendingOperation(kind: 'transcription' | 'conversation', status: 'uncertain' | 'completed' = 'uncertain') {
  return { operation_id: ids.memory, project_id: ids.project, session_id: ids.session, kind, status,
    created_at: project.created_at, updated_at: project.updated_at, error_code: null, result: null };
}
beforeEach(() => {
  AppState.currentState = 'active'; listeners = []; keyNumber = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: () => { listeners = listeners.filter(item => item !== callback); } }; });
  jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: true, transcription: true, conversation: true, writing: true, speech: false, reason: 'READY' });
  jest.mocked(projects.listStorySessions).mockResolvedValue([{ id: ids.session, project_id: ids.project, language: 'en', status: 'active',
    created_at: project.created_at, updated_at: project.updated_at, ended_at: null }]);
  jest.mocked(api.getRealTranscripts).mockResolvedValue([]); jest.mocked(api.getRealMessages).mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockResolvedValue([]); jest.mocked(api.getRealDrafts).mockResolvedValue([]);
  jest.mocked(createNativeRecorder).mockReturnValue(recorder);
  jest.mocked(createRecordingId).mockImplementation(() => `30000000-0000-4000-8000-${String(++keyNumber).padStart(12, '0')}`);
  jest.mocked(api.transcribeRealRecording).mockResolvedValue(transcript); jest.mocked(api.sendRealMessage).mockResolvedValue(turn);
  recorder.requestPermission.mockResolvedValue(true); recorder.start.mockResolvedValue(undefined); recorder.stop.mockResolvedValue(clip);
  recorder.getStatus.mockReturnValue({ durationMs: 1000, isRecording: true, interrupted: false });
  recorder.discard.mockResolvedValue(undefined); recorder.dispose.mockResolvedValue(undefined);
});
afterEach(async () => { jest.useRealTimers(); await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active'; expect(globalThis.fetch).not.toHaveBeenCalled(); });

describe('voice consent and automatic chaining — synthetic transports only', () => {
  it.each(['en', 'sv'] as const)('asks consent before microphone/provider actions and keeps Cancel inert in %s', async language => {
    const copy = realCopy[language]; await render(<RealStoryWorkspace {...props} language={language} />); await ready(); await press(copy.start);
    expect(screen.getByText(copy.consentTitle)).toBeOnTheScreen();
    expect(recorder.requestPermission).not.toHaveBeenCalled(); expect(recorder.start).not.toHaveBeenCalled();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled();
    await press(copy.consentCancel);
    expect(screen.queryByText(copy.consentTitle)).toBeNull(); expect(recorder.requestPermission).not.toHaveBeenCalled();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  });
  it('discards from the recording composer without a transcription, conversation, or speech request', async () => {
    await opened(); await permitVoice();
    expect(screen.getByRole('button', { name: t.discard })).toBeEnabled();
    await press(t.discard);
    await waitFor(() => expect(screen.getByRole('button', { name: t.start })).toBeEnabled());
    expect(screen.getByLabelText(t.input)).toBeEnabled();
    expect(recorder.dispose).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('keeps recording through a pause and holds the capped clip for an explicit send', async () => {
    await opened();
    jest.useFakeTimers();
    await permitVoice();
    recorder.getStatus.mockReturnValue({ durationMs: 8000, isRecording: true, interrupted: false });
    await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();

    recorder.getStatus.mockReturnValue({ durationMs: MAX_RECORDING_MS, isRecording: false, interrupted: false });
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.discard })).toBeEnabled();

    await press(t.stop);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
    expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('clears an interrupted recording without sending it or asking to reconcile', async () => {
    await opened();
    jest.useFakeTimers();
    await permitVoice();
    recorder.getStatus.mockReturnValue({ durationMs: 2500, isRecording: false, interrupted: true });
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });

    expect(recorder.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.recordingInterrupted)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: t.start })).toBeEnabled();
    expect(screen.queryByRole('button', { name: t.check })).toBeNull();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it('does not reconcile a paid attempt when the app backgrounds before recording finalization', async () => {
    let finish: (value: typeof clip) => void = () => {};
    recorder.stop.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await opened(); await permitVoice(); await press(t.stop);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();

    await emit('background'); await act(async () => finish(clip));
    await emit('active'); await press(t.resume); await ready();
    expect(screen.queryByRole('button', { name: t.check })).toBeNull();
    expect(api.findRealOperation).not.toHaveBeenCalled();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it('sends consent=true and chains only the verified immutable transcript through a separate action key', async () => {
    let finishTranscript: (value: api.RealTranscript) => void = () => {};
    let finishReply: (value: typeof turn) => void = () => {};
    jest.mocked(api.transcribeRealRecording).mockReturnValueOnce(new Promise(resolve => { finishTranscript = resolve; }));
    jest.mocked(api.sendRealMessage).mockReturnValueOnce(new Promise(resolve => { finishReply = resolve; }));
    await opened(); await permitVoice(); await press(t.stop);
    expect(api.transcribeRealRecording).toHaveBeenCalledWith(expect.objectContaining({ projectId: ids.project, sessionId: ids.session }), clip, true, expect.any(String));
    expect(api.sendRealMessage).not.toHaveBeenCalled();
    await act(async () => finishTranscript(transcript));
    await waitFor(() => expect(api.sendRealMessage).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(transcript.text).length).toBeGreaterThan(0); expect(screen.getByText(t.thinking)).toBeOnTheScreen();
    expect(api.sendRealMessage).toHaveBeenCalledWith(expect.objectContaining({ projectId: ids.project, sessionId: ids.session }), { source_transcript_id: transcript.transcript_id }, expect.any(String), expect.any(Function), undefined);
    expect(jest.mocked(api.sendRealMessage).mock.calls[0][2]).not.toBe(jest.mocked(api.transcribeRealRecording).mock.calls[0][3]);
    await act(async () => finishReply(turn));
    expect(screen.getByText(turn.message.text)).toBeOnTheScreen(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('reuses consent for another recording in the same active owner/session', async () => {
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByText(turn.message.text)).toBeOnTheScreen()); await press(t.start);
    expect(screen.queryByText(t.consentTitle)).toBeNull(); await waitFor(() => expect(recorder.start).toHaveBeenCalledTimes(2));
  });
  it('reconfirms voice consent after the background privacy boundary', async () => {
    await opened(); await permitVoice(); await emit('background'); await emit('active'); await press(t.resume);
    await waitFor(() => expect(screen.getByRole('button', { name: t.start })).toBeOnTheScreen()); await press(t.start);
    expect(screen.getByText(t.consentTitle)).toBeOnTheScreen(); expect(recorder.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  });
  it('does not transfer accepted voice consent to another signed-in user', async () => {
    const view = await opened(); await permitVoice(); await press(t.stop); await waitFor(() => expect(api.sendRealMessage).toHaveBeenCalledTimes(1));
    await view.rerender(<RealStoryWorkspace {...props} user={{ ...user, id: '80000000-0000-4000-8000-000000000002' }} />);
    await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2)); await ready(); await press(t.start);
    expect(screen.getByText(t.consentTitle)).toBeOnTheScreen(); expect(recorder.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('never chains an uncertain transcription or automatically repeats it', async () => {
    jest.mocked(api.transcribeRealRecording).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    jest.mocked(api.findRealOperation).mockResolvedValue(pendingOperation('transcription'));
    await press(t.check); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it('keeps the transcript after an uncertain conversation, offers only checking, and does not repeat either paid stage', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
    expect(screen.getAllByText(transcript.text).length).toBeGreaterThan(0); expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    jest.mocked(api.findRealOperation).mockResolvedValue(pendingOperation('conversation'));
    await press(t.check);
    expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'conversation', jest.mocked(api.sendRealMessage).mock.calls[0][2]);
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('does not begin a new paid stage just because an uncertain transcription was reconciled as completed', async () => {
    jest.mocked(api.transcribeRealRecording).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
    jest.mocked(api.findRealOperation).mockResolvedValue(pendingOperation('transcription', 'completed'));
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    await press(t.check);
    expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1); expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('keeps a successfully saved transcript after a proven unsent reply failure and retries only on explicit Get Memy reply', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false, 'AI_BUSY')).mockResolvedValueOnce(turn);
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.process })).toBeOnTheScreen());
    expect(screen.getAllByText(transcript.text).length).toBeGreaterThan(0); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    await press(t.process); expect(api.sendRealMessage).toHaveBeenCalledTimes(2); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
    expect(jest.mocked(api.sendRealMessage).mock.calls[0][2]).not.toBe(jest.mocked(api.sendRealMessage).mock.calls[1][2]);
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('does not re-upload a saved transcription when native deletion fails, and respects the cleanup block', async () => {
    recorder.discard.mockRejectedValueOnce(new Error('Synthetic native deletion failure'));
    recorder.dispose.mockRejectedValueOnce(new Error('Synthetic cleanup failure'));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(mediaPrivacy.isBlocked()).toBe(true));
    expect(screen.getAllByText(transcript.text).length).toBeGreaterThan(0); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
    expect(api.sendRealMessage).not.toHaveBeenCalled();
    await press(t.retryCleanup); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
  });
  it('does not let an old transcription response chain into another owner after a switch', async () => {
    let finish: (value: api.RealTranscript) => void = () => {};
    jest.mocked(api.transcribeRealRecording).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = await opened(); await permitVoice(); await press(t.stop);
    await view.rerender(<RealStoryWorkspace {...props} user={{ ...user, id: '80000000-0000-4000-8000-000000000002' }} />);
    await waitFor(() => expect(api.getRealMessages).toHaveBeenCalledTimes(2)); await ready(); await act(async () => finish(transcript));
    expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(screen.queryByText(transcript.text)).toBeNull();
  });
  it('preserves a separate unsent typed draft throughout successful voice processing', async () => {
    await opened(); await fireEvent.changeText(screen.getByLabelText(t.input), 'Keep my unsent typed words.');
    await permitVoice(); await press(t.stop); await waitFor(() => expect(api.sendRealMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(t.input).props.value).toBe('Keep my unsent typed words.'); expect(api.sendRealTextMessage).not.toHaveBeenCalled();
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('treats duplicate Send presses as one transcription and one conversation', async () => {
    await opened(); await permitVoice();
    const sendCapture = getComponents(Pressable).find(button => button.props.accessibilityLabel === t.stop)?.props.onPress;
    if (!sendCapture) throw new Error('Expected the recording Send control.');
    await act(() => { sendCapture({} as never); sendCapture({} as never); });
    await waitFor(() => expect(api.sendRealMessage).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
    expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('ignores the Send control from a discarded recording after a new recording starts', async () => {
    await opened(); await permitVoice();
    const oldSend = getComponents(Pressable).find(button => button.props.accessibilityLabel === t.stop)!.props.onPress!;
    await press(t.discard); await press(t.start);
    expect(screen.getByRole('button', { name: t.stop })).toBeEnabled();
    await act(() => oldSend({} as never));
    expect(recorder.stop).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    await press(t.stop);
    expect(recorder.stop).toHaveBeenCalledTimes(1); expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1);
  });
  it('does not touch the microphone or ask voice consent while real AI is off', async () => {
    jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: false,
      transcription: false, conversation: false, writing: false, speech: false, reason: 'LIVE_AI_DISABLED' });
    await opened(); const record = screen.queryByRole('button', { name: t.start });
    if (record) { expect(record).toBeDisabled(); await fireEvent.press(record); }
    expect(screen.getByText(t.disabled)).toBeOnTheScreen(); expect(screen.queryByText(t.consentTitle)).toBeNull();
    expect(recorder.requestPermission).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('does not send a transcript to conversation when that capability is off', async () => {
    jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: true,
      transcription: true, conversation: false, writing: false, speech: false, reason: 'CONVERSATION_DISABLED' });
    await opened(); await permitVoice(); await press(t.stop); await waitFor(() => expect(api.transcribeRealRecording).toHaveBeenCalledTimes(1));
    expect(api.sendRealMessage).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
});

describe('independent review: saved voice recovery', () => {
  it('offers a deliberate continuation after recovering a completed transcription', async () => {
    jest.mocked(api.transcribeRealRecording).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
    jest.mocked(api.findRealOperation).mockResolvedValue(pendingOperation('transcription', 'completed'));
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    await press(t.check);
    expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.process })).toBeOnTheScreen();
  });
  it('keeps deliberate reply recovery available after proven unsent reply and background', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false, 'AI_BUSY'));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.process })).toBeOnTheScreen());
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    await emit('background'); await emit('active'); await press(t.resume); await ready();
    expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: t.process })).toBeOnTheScreen();
  });
});

 describe('owned saved voice continuation safeguards', () => {
  it('does not offer a duplicate reply for a saved turn', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    jest.mocked(api.getRealMessages).mockResolvedValue([turn.user_message, turn.message]);
    await opened(); expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it('does not infer absence from a partial messages page', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    jest.mocked(api.getRealMessages).mockResolvedValue(Array.from({ length: 100 }, (_, i) =>
      realMessage('user', { id: `other-${i}`, sequence: i, source_transcript_id: ids.key })));
    await opened(); expect(screen.queryByRole('button', { name: t.process })).toBeNull();
  });
  it('keeps uncertain conversation recovery ahead of continuation after resume', async () => {
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await permitVoice(); await press(t.stop);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen());
    jest.mocked(api.getRealTranscripts).mockResolvedValue([transcript]);
    await emit('background'); await emit('active'); await press(t.resume);
    await waitFor(() => expect(api.getRealTranscripts).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(t.input).props.editable).toBe(false);
    expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('rejects a saved transcript from another session', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([realTranscript({ session_id: ids.key })]);
    await opened(); expect(screen.queryByRole('button', { name: t.process })).toBeNull();
  });
  it('does not inherit continuation across an owner change', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValueOnce([transcript]).mockResolvedValue([]);
    const view = await opened(); expect(screen.getByRole('button', { name: t.process })).toBeOnTheScreen();
    await view.rerender(<RealStoryWorkspace {...props} user={{ ...user, id: ids.key }} />); await ready();
    await waitFor(() => expect(api.getRealTranscripts).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: t.process })).toBeNull();
    expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
 });
