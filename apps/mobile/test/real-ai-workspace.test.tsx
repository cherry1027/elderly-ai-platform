import { nativeNodes } from './native-tree';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as storyApi from '../src/api/story-projects';
import { createNativeRecorder, createRecordingId } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { realCopy } from '../src/real-ai/copy';
import { realDraft, realIds as ids, realMemory, realMessage, realTranscript } from './real-ai-fixtures';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(), getRealMemories: jest.fn(),
  getRealDrafts: jest.fn(), transcribeRealRecording: jest.fn(), sendRealMessage: jest.fn(), reviewRealMemory: jest.fn(),
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
async function ready() { await waitFor(() => expect(api.getRealDrafts).toHaveBeenCalled()); }
async function press(label: string) { await fireEvent.press(screen.getByText(label)); await act(async () => {}); }
async function emit(value: AppStateStatus) { await act(async () => { AppState.currentState = value; for (const listener of [...listeners]) listener(value); }); }
beforeEach(() => {
  AppState.currentState = 'active'; listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => { listeners.push(listener); return { remove: () => { listeners = listeners.filter(item => item !== listener); } }; });
  jest.mocked(api.getRealCapabilities).mockResolvedValue({ contract: 'real-v2', mode: 'real', enabled: true, transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' });
  jest.mocked(storyApi.listStorySessions).mockResolvedValue([{ id: ids.session, project_id: ids.project, language: 'en', status: 'active', created_at: project.created_at, updated_at: project.created_at, ended_at: null }]);
  jest.mocked(api.getRealTranscripts).mockResolvedValue([]); jest.mocked(api.getRealMessages).mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockResolvedValue([]); jest.mocked(api.getRealDrafts).mockResolvedValue([]);
  jest.mocked(createNativeRecorder).mockReturnValue(recorder); jest.mocked(createRecordingId).mockReturnValue(ids.key);
  jest.mocked(api.transcribeRealRecording).mockResolvedValue(realTranscript());
  jest.mocked(api.sendRealMessage).mockResolvedValue({ user_message: realMessage(), message: realMessage('assistant'), memories: [realMemory()], mode: 'real' });
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
    expect(copy.disabled).toBe(language === 'en' ? 'AI is currently off. Your saved work is still available.'
      : 'AI är avstängd just nu. Ditt sparade arbete finns kvar.');
    expect(screen.queryByText(copy.disabledDetails)).toBeNull();
    const details = screen.getByRole('button', { name: copy.details });
    expect(details.props.accessibilityState.expanded).toBe(false); expect(details).toHaveStyle({ minHeight: 56 });
    expect(details.props.accessibilityLanguage).toBe(language === 'sv' ? 'sv-SE' : 'en-GB');
    await fireEvent.press(details); expect(details.props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText(copy.disabledDetails)).toBeOnTheScreen();
    await fireEvent.press(details); expect(screen.queryByText(copy.disabledDetails)).toBeNull();
    expect(screen.queryByText(/SIMULATED TRANSCRIPT/)).toBeNull();
    await press(copy.start); expect(createNativeRecorder).not.toHaveBeenCalled(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
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
  it('keeps the microphone, stop, consent, save and discard in a separate scroll region beside a long history', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue(Array.from({ length: 40 }, (_, index) => realMessage('user', {
      id: `synthetic-message-${index}`, sequence: index + 1, text: `Saved memory ${index}: ${'A long memory. '.repeat(40)}`,
    })));
    await render(<RealStoryWorkspace {...props} />); await ready();
    const history = screen.getByTestId('story-content-scroll');
    const controls = () => within(screen.getByTestId('story-bottom-controls'));
    expect(within(history).getByTestId('real-ai-chat-thread')).toBeOnTheScreen();
    expect(within(history).queryByText(t.start)).toBeNull();
    await fireEvent.scroll(history, { nativeEvent: { contentOffset: { y: 2000 } } });
    await fireEvent.press(controls().getByRole('button', { name: t.start })); await act(async () => {});
    expect(controls().getByRole('button', { name: t.stop })).toBeOnTheScreen();
    await press(t.stop);
    expect(controls().getByRole('checkbox', { name: t.consent })).toBeOnTheScreen();
    expect(controls().getByRole('button', { name: t.transcribe })).toBeDisabled();
    await fireEvent.press(controls().getByRole('checkbox'));
    expect(controls().getByRole('button', { name: t.transcribe })).toBeEnabled();
    await fireEvent.press(controls().getByRole('button', { name: t.discard })); await act(async () => {});
    expect(recorder.discard).toHaveBeenCalledWith(clip); expect(controls().getByText(t.start)).toBeOnTheScreen();
    expect(api.transcribeRealRecording).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('top Back retains the existing unsaved autobiography warning in %s', async language => {
    const copy = realCopy[language], warning = leaveCopy[language];
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="book" />); await ready();
    await press(copy.edit); await fireEvent.changeText(screen.getByLabelText(copy.editor), 'My unsaved correction.');
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(warning.keep); expect(screen.getByLabelText(copy.editor).props.value).toBe('My unsaved correction.');
    await fireEvent.press(screen.getByTestId('story-top-back')); await press(warning.discard);
    expect(props.onBack).toHaveBeenCalledTimes(1); expect(api.editRealDraft).not.toHaveBeenCalled();
  });
  it('top Back retains the uncertain-request warning and existing check-saved-result action', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([realTranscript()]);
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.process);
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
  it('records locally, requires explicit consent, then processes only the saved original in a deliberate second step', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.start);
    expect(recorder.requestPermission).toHaveBeenCalledTimes(1); expect(recorder.start).toHaveBeenCalledTimes(1);
    await press(t.stop); expect(screen.getByText(t.recorded)).toBeTruthy(); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    await press(t.transcribe); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('checkbox')); await press(t.transcribe);
    expect(api.transcribeRealRecording).toHaveBeenCalledWith(expect.objectContaining({ sessionId: ids.session }), clip, true, ids.key);
    expect(recorder.discard).toHaveBeenCalledWith(clip); expect(api.sendRealMessage).not.toHaveBeenCalled();
    expect(screen.getByText(t.original)).toBeTruthy(); await press(t.process);
    expect(api.sendRealMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: ids.session }), { source_transcript_id: ids.transcript }, ids.key);
    expect(screen.getByText(realMessage('assistant').text)).toBeTruthy(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('supports reviewed memories → generation → editing/history → private native PDF, each as an explicit action', async () => {
    jest.mocked(api.getRealMemories).mockResolvedValue([realMemory()]);
    await render(<RealStoryWorkspace {...props} initialTab="memories" />); await ready();
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
    await press(t.historySection); await press(t.history); expect(screen.getByText(t.noHistory)).toBeTruthy();
    await press(t.export); expect(mockPrivacy.createStore).toHaveBeenCalledWith(user.id); expect(mockPdfStore.share).toHaveBeenCalledTimes(1);
    expect(mockPdfStore.discard).toHaveBeenCalledTimes(1); expect(mockPrivacy.release).toHaveBeenCalledWith(mockPdfStore);
  });
  it('retains the paid operation identity on ambiguous submission, disables repeat sends and only reads status', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([realTranscript()]);
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.process);
    expect(screen.getByText(t.uncertain)).toBeTruthy(); await press(t.process); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await press(t.check); expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'conversation', ids.key);
    expect(api.getRealOperation).not.toHaveBeenCalled();
    expect(screen.getByText(t.operationPending)).toBeTruthy(); expect(api.sendRealMessage).toHaveBeenCalledTimes(1);
  });
  it('uses the separate server operation ID when an acknowledged paid response becomes uncertain', async () => {
    jest.mocked(api.getRealTranscripts).mockResolvedValue([realTranscript()]);
    jest.mocked(api.sendRealMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, true, 'REAL_AI_UNCERTAIN', undefined, ids.memory));
    jest.mocked(api.getRealOperation).mockResolvedValue({ operation_id: ids.memory, project_id: ids.project, session_id: ids.session,
      kind: 'conversation', status: 'uncertain', created_at: project.created_at, updated_at: project.created_at, error_code: null, result: null });
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.process); await press(t.check);
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
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.start);
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
    await press(t.start); await emit('background');
    expect(screen.queryByText(realMessage('assistant').text)).toBeNull(); expect(recorder.dispose).toHaveBeenCalled();
    expect(screen.getByText(t.background)).toBeTruthy(); await emit('active'); expect(screen.queryByText(realMessage('assistant').text)).toBeNull();
    await press(t.resume); expect(screen.getByText(realMessage('assistant').text)).toBeTruthy(); await rendered.unmount();
  });
  it('requires a fresh confirmed leave intent for an unsaved native recording', async () => {
    await render(<RealStoryWorkspace {...props} />); await ready(); await press(t.start); await press(t.stop);
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(props.onBack).not.toHaveBeenCalled(); expect(screen.getByText('Keep your changes?')).toBeTruthy();
    await press('Leave Without Saving'); expect(props.onBack).toHaveBeenCalledTimes(1); expect(recorder.dispose).toHaveBeenCalled();
  });
  it('shows saved Swedish speech and source content in its project language without changing the selected language', async () => {
    jest.mocked(storyApi.listStorySessions).mockResolvedValue([{ id: ids.session, project_id: ids.project, language: 'sv', status: 'active', created_at: project.created_at, updated_at: project.created_at, ended_at: null }]);
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant', { language: 'sv', text: 'Syntetisk svensk kontraktsfråga?' })]);
    await render(<RealStoryWorkspace {...props} language="sv" project={{ ...project, language: 'sv' }} />); await ready();
    expect(screen.getByText('Syntetisk svensk kontraktsfråga?')).toBeTruthy();
    await press(realCopy.sv.moreActions); expect(screen.getByText(realCopy.sv.pending)).toBeTruthy();
    expect(api.getRealMessages).toHaveBeenCalledWith(expect.objectContaining({ language: 'sv' }));
  });
  it.each(['en', 'sv'] as const)('presents the memory and three review actions with exact evidence available in %s', async language => {
    const copy = realCopy[language], memory = realMemory({ clarification_question: null });
    jest.mocked(api.getRealMemories).mockResolvedValue([memory]);
    jest.mocked(api.reviewRealMemory).mockResolvedValue({ ...memory, status: 'rejected', version: 2 });
    await render(<RealStoryWorkspace {...props} language={language} initialTab="memories" />); await ready();
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
    await render(<RealStoryWorkspace {...props} language={language} initialTab="memories" />); await ready();
    await press(copy.correctAction); await fireEvent.changeText(screen.getByLabelText(copy.correct), 'My corrected memory');
    for (const label of [copy.seeOriginal, copy.correctAction, copy.seeOriginal, copy.correctAction]) await press(label);
    const input = screen.getByLabelText(copy.correct);
    expect(input.props.value).toBe('My corrected memory'); expect(input.props.allowFontScaling).toBe(true);
    expect(input.props.multiline).toBe(true); expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByTestId('story-content-scroll').props.automaticallyAdjustKeyboardInsets).toBe(true);
    await fireEvent.press(screen.getByTestId('story-top-back'));
    expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); expect(props.onBack).not.toHaveBeenCalled();
    await press(warning.keep); expect(screen.getByLabelText(copy.correct).props.value).toBe('My corrected memory');
    await press(copy.confirm);
    expect(api.reviewRealMemory).toHaveBeenNthCalledWith(1, expect.anything(), memory, 'confirmed', 'My corrected memory');
    expect(screen.getByText(corrected.corrected_value)).toBeOnTheScreen();
    await press(copy.reject);
    expect(api.reviewRealMemory).toHaveBeenNthCalledWith(2, expect.anything(), corrected, 'rejected', undefined);
    expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('prioritizes saved prose and keeps Sources, History, Versions and PDFs reachable in %s', async language => {
    const copy = realCopy[language], latest = realDraft({ version: 2, revision: 3, content: 'The newest saved autobiography.' });
    const older = realDraft({ draft_id: ids.assistant, content: 'An older saved autobiography.' });
    jest.mocked(api.getRealDrafts).mockResolvedValue([latest, older]);
    jest.mocked(api.getRealExports).mockResolvedValue([]);
    await render(<RealStoryWorkspace {...props} language={language} initialTab="book" />); await ready();
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
    await press(copy.sources); expect(screen.getByText(latest.source_memories[0].evidence)).toBeOnTheScreen();
    await press(copy.draftDetails); expect(screen.getByText(copy.modelReview)).toBeOnTheScreen();
    await press(copy.historySection); expect(api.getRealDraftHistory).not.toHaveBeenCalled();
    await press(copy.history); expect(api.getRealDraftHistory).toHaveBeenCalledWith(expect.anything(), latest.draft_id);
    expect(screen.getByText(copy.noHistory)).toBeOnTheScreen();
    await press(copy.historySection); await press(copy.historySection);
    expect(screen.getByText(copy.noHistory)).toBeOnTheScreen(); expect(api.getRealDraftHistory).toHaveBeenCalledTimes(1);
    await press(copy.pdfVersions); expect(api.getRealExports).not.toHaveBeenCalled();
    await press(copy.exports); expect(screen.getByText(copy.noExports)).toBeOnTheScreen();
    expect(api.getRealExports).toHaveBeenCalledTimes(1);
    await press(copy.versions); await press(`${copy.version} 1 · ${copy.revision} 1`);
    expect(screen.getByText(older.content)).toBeOnTheScreen();
    await press(copy.edit); expect(screen.getByLabelText(copy.editor).props.value).toBe(older.content);
    await press(copy.cancel); expect(screen.getByText(older.content)).toBeOnTheScreen();
    await press(copy.export); expect(api.exportRealDraft).toHaveBeenCalledWith(expect.anything(), older);
    expect(mockPdfStore.share).toHaveBeenCalledTimes(1); expect(mockPdfStore.discard).toHaveBeenCalledTimes(1);
    expect(screen.getByText(copy.pdfNotice)).toBeOnTheScreen();
    expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.editRealDraft).not.toHaveBeenCalled();
  });
  it('keeps refresh and deep Sign Out quiet while retaining their existing safe actions', async () => {
    jest.mocked(api.getRealDrafts).mockResolvedValue([realDraft()]);
    await render(<RealStoryWorkspace {...props} initialTab="book" />); await ready();
    expect(screen.queryByRole('button', { name: t.reload })).toBeNull(); await press(t.moreActions);
    for (const label of [t.reload, t.signOut]) expect(screen.getByRole('button', { name: label })).toHaveStyle({ minHeight: 56, backgroundColor: 'transparent' });
    await press(t.reload); expect(api.getRealCapabilities).toHaveBeenCalledTimes(2);
    await press(t.edit); await fireEvent.changeText(screen.getByLabelText(t.editor), 'Unsaved autobiography.');
    expect(screen.getByRole('button', { name: t.reload })).toBeDisabled();
    await press(t.signOut); expect(props.onSignOut).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(screen.getByLabelText(t.editor).props.value).toBe('Unsaved autobiography.');
    await press(t.signOut); await press(leaveCopy.en.discard); expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
});
