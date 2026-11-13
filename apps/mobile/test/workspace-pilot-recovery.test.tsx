/** Synthetic controller regressions; no hosted data, device audio or paid calls. */
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as storyApi from '../src/api/story-projects';
import { createRecordingId } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { realCopy } from '../src/real-ai/copy';
import { conversationModeCopy } from '../src/real-ai/conversation-mode';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { realIds as ids, realMessage } from './real-ai-fixtures';

jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  hashRealText: jest.fn(), getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(),
  getRealMemories: jest.fn(), getRealDrafts: jest.fn(), sendRealTextMessage: jest.fn(), getPreparedRealSpeech: jest.fn(),
  createRealSpeech: jest.fn(), getRealSpeechAudio: jest.fn(), getRealOperation: jest.fn(), findRealOperation: jest.fn(),
}));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createRecordingId: jest.fn() }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn() };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));
const mockPrivacy = { ready: true, failed: false, release: jest.fn() };
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: () => mockPrivacy }));

const t = realCopy.en;
const readyCapabilities: api.RealCapabilities = { contract: 'real-v2', mode: 'real', enabled: true,
  transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' };
const pausedCapabilities: api.RealCapabilities = { contract: 'real-v2', mode: 'real', enabled: false,
  transcription: false, conversation: false, writing: false, speech: false, reason: 'LIVE_AI_DISABLED' };
const project = { id: ids.project, language: 'en' as const, title: 'Synthetic recovery fixture', description: null,
  status: 'draft', created_at: '2026-10-29T12:00:00Z', updated_at: '2026-10-29T12:00:00Z' };
const user = { id: '80000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' };
const props = { language: 'en' as const, user, project,
  config: { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' as const },
  getAccessToken: jest.fn(async () => 'synthetic.token.signature'), onBack: jest.fn(), onSignOut: jest.fn() };
let listeners: ((value: AppStateStatus) => void)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function metadata(): api.SpeechMetadata {
  return { speech_id: ids.draft, assistant_message_id: ids.assistant, language: 'en', media_type: 'audio/wav',
    audio_sha256: 'a'.repeat(64), audio_size: 44, expires_at: new Date(Date.now() + 60000).toISOString(), status: 'ready' };
}
async function press(label: string) {
  await fireEvent.press(screen.getByRole('button', { name: label })); await act(async () => {});
}
async function listen() { await press(t.speak); }
async function ready() {
  await waitFor(() => {
    expect(api.getRealTranscripts).toHaveBeenCalled();
    expect(api.getRealMessages).toHaveBeenCalled();
    const input = screen.queryByLabelText(t.input);
    if (input) expect(input.props.editable).toBe(true);
    else expect(screen.getByRole('button', { name: t.start })).toBeOnTheScreen();
  });
}
async function emit(value: AppStateStatus) {
  await act(async () => { AppState.currentState = value; for (const listener of [...listeners]) listener(value); });
}
async function refresh() { await press(t.moreActions); await press(t.reload); }
async function operatorPaused() {
  jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false,
    'AI_SPENDING_NOT_APPROVED', undefined, undefined, 'contact-operator'));
  await render(<RealStoryWorkspace {...props} />); await ready();
  await fireEvent.changeText(screen.getByLabelText(t.input), 'Synthetic unsent words'); await press(t.send);
  await waitFor(() => expect(screen.getByRole('button', { name: t.send })).toBeDisabled());
  expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText(t.serviceUnavailable).length).toBeGreaterThan(0);
}

beforeEach(() => {
  for (const value of Object.values(api)) if (jest.isMockFunction(value)) value.mockReset();
  AppState.currentState = 'active'; listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener); return { remove: () => { listeners = listeners.filter(item => item !== listener); } };
  });
  jest.mocked(api.getRealCapabilities).mockResolvedValue(readyCapabilities);
  jest.mocked(storyApi.listStorySessions).mockReset().mockResolvedValue([{ id: ids.session, project_id: ids.project,
    language: 'en', status: 'active', created_at: project.created_at, updated_at: project.updated_at, ended_at: null }]);
  jest.mocked(api.getRealTranscripts).mockResolvedValue([]); jest.mocked(api.getRealMessages).mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockResolvedValue([]); jest.mocked(api.getRealDrafts).mockResolvedValue([]);
  jest.mocked(api.hashRealText).mockImplementation(async original => createHash('sha256').update(original, 'utf8').digest('hex'));
  jest.mocked(api.sendRealTextMessage).mockImplementation(async (scope, original) => ({
    user_message: realMessage('user', { id: ids.key, source_transcript_id: null, source_text_input_id: ids.key,
      text: original, language: scope.language, provenance: { mode: 'original', provider: 'user', model: null, version: 1 } }),
    message: realMessage('assistant', { source_transcript_id: null, source_text_input_id: ids.key, language: scope.language }),
    memories: [], mode: 'real',
  }));
  jest.mocked(createRecordingId).mockReturnValue(ids.key);
  jest.mocked(api.getPreparedRealSpeech).mockRejectedValue(new api.RealAiError('not-found', 404));
  jest.mocked(api.getRealSpeechAudio).mockResolvedValue(new Uint8Array(44));
  jest.mocked(api.createRealSpeech).mockResolvedValue(metadata());
  jest.mocked(api.findRealOperation).mockRejectedValue(new api.RealAiError('not-found', 404));
  mockPlayback.play.mockResolvedValue(undefined); mockPlayback.stop.mockResolvedValue(undefined); mockPlayback.dispose.mockResolvedValue(undefined);
});
afterEach(async () => { await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active'; });

describe('prepared speech reads and paid operation boundaries', () => {
  it('opens My Story immediately during speech preparation and keeps the completed audio off that page', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const paid = deferred<api.SpeechMetadata>();
    jest.mocked(api.createRealSpeech).mockReturnValueOnce(paid.promise);
    await render(<RealStoryWorkspace {...props} />); await ready(); await listen();
    await waitFor(() => expect(api.createRealSpeech).toHaveBeenCalledTimes(1));

    await press(conversationModeCopy.en.finishAndOpenStory);
    expect(screen.getByRole('tab', { name: t.book }).props.accessibilityState.selected).toBe(true);
    await waitFor(() => expect(api.getRealDrafts).toHaveBeenCalledTimes(1));
    await act(async () => paid.resolve(metadata()));
    expect(api.createRealSpeech).toHaveBeenCalledTimes(1);
    expect(mockPlayback.play).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'audio'] as const)('background during a free %s read never invents a paid operation', async phase => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    jest.mocked(api.getRealCapabilities).mockResolvedValue(pausedCapabilities);
    const metadataRead = deferred<api.SpeechMetadata>(), audioRead = deferred<Uint8Array>();
    if (phase === 'metadata') jest.mocked(api.getPreparedRealSpeech).mockReturnValueOnce(metadataRead.promise);
    else {
      jest.mocked(api.getPreparedRealSpeech).mockResolvedValue(metadata());
      jest.mocked(api.getRealSpeechAudio).mockReturnValueOnce(audioRead.promise);
    }
    await render(<RealStoryWorkspace {...props} />); await ready(); await listen();
    await waitFor(() => expect(phase === 'metadata' ? api.getPreparedRealSpeech : api.getRealSpeechAudio).toHaveBeenCalledTimes(1));
    await emit('background');
    await act(async () => {
      if (phase === 'metadata') metadataRead.reject(new api.RealAiError('cancelled'));
      else audioRead.reject(new api.RealAiError('cancelled'));
    });
    await emit('active'); await press(t.resume); await ready();
    expect(screen.queryByRole('button', { name: t.check })).toBeNull();
    expect(api.findRealOperation).not.toHaveBeenCalled(); expect(api.getRealOperation).not.toHaveBeenCalled();
    expect(api.createRealSpeech).not.toHaveBeenCalled(); expect(api.sendRealTextMessage).not.toHaveBeenCalled();
    jest.mocked(api.getPreparedRealSpeech).mockResolvedValue(metadata());
    await press(t.speak); await waitFor(() => expect(mockPlayback.play).toHaveBeenCalledTimes(1));
    expect(api.createRealSpeech).not.toHaveBeenCalled(); expect(api.findRealOperation).not.toHaveBeenCalled();
  });

  it('preserves reconciliation after a real synthesis attempt becomes uncertain during backgrounding', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const paid = deferred<api.SpeechMetadata>();
    jest.mocked(api.createRealSpeech).mockReturnValueOnce(paid.promise);
    jest.mocked(api.findRealOperation).mockResolvedValue({ operation_id: ids.key, project_id: ids.project,
      session_id: ids.session, kind: 'speech', status: 'uncertain', created_at: project.created_at,
      updated_at: project.updated_at, error_code: 'AI_PROVIDER_TIMEOUT', result: null });
    await render(<RealStoryWorkspace {...props} />); await ready(); await listen();
    await waitFor(() => expect(api.createRealSpeech).toHaveBeenCalledTimes(1));
    await emit('background'); await act(async () => paid.reject(new api.RealAiError('network', undefined, true)));
    await emit('active'); await press(t.resume);
    await waitFor(() => expect(screen.getByRole('button', { name: t.check })).toBeOnTheScreen()); await press(t.check);
    expect(api.findRealOperation).toHaveBeenCalledWith(expect.anything(), 'speech', ids.assistant);
    expect(screen.getByLabelText(t.input).props.editable).toBe(false);
    expect(api.createRealSpeech).toHaveBeenCalledTimes(1); expect(mockPlayback.play).not.toHaveBeenCalled();
  });

  it('does not synthesize or invent an operation after an unknown prepared-read failure', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    jest.mocked(api.getPreparedRealSpeech).mockRejectedValueOnce(new api.RealAiError('network'));
    await render(<RealStoryWorkspace {...props} />); await ready(); await listen();
    expect(api.createRealSpeech).not.toHaveBeenCalled(); expect(api.findRealOperation).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t.check })).toBeNull();
    expect(screen.getByLabelText(t.input).props.editable).toBe(true);
  });

  it('admits only one explicit synthesis while the prepared lookup is pending', async () => {
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    const lookup = deferred<api.SpeechMetadata>();
    jest.mocked(api.getPreparedRealSpeech).mockReturnValueOnce(lookup.promise);
    await render(<RealStoryWorkspace {...props} />); await ready(); await listen();
    await fireEvent.press(screen.getByRole('button', { name: t.speak }));
    expect(api.getPreparedRealSpeech).toHaveBeenCalledTimes(1);
    await act(async () => lookup.reject(new api.RealAiError('not-found', 404)));
    await waitFor(() => expect(mockPlayback.play).toHaveBeenCalledTimes(1));
    expect(api.createRealSpeech).toHaveBeenCalledTimes(1); expect(api.findRealOperation).not.toHaveBeenCalled();
  });
});

describe('explicit operator-paused capability recovery', () => {
  it('reenables explicit actions after fresh capabilities and ownership are verified, without auto-sending', async () => {
    await operatorPaused(); await refresh();
    await waitFor(() => expect(api.getRealCapabilities).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: t.send })).toBeEnabled());
    expect(screen.getByLabelText(t.input).props.value).toBe('Synthetic unsent words');
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
    await press(t.send); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(2);
  });

  it('does not clear the service pause after a failed capability refresh', async () => {
    await operatorPaused();
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('network'));
    await refresh(); await waitFor(() => expect(api.getRealCapabilities).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled();
    expect(screen.getByLabelText(t.input).props.value).toBe('Synthetic unsent words');
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });

  it('does not clear an operator pause while refreshed capabilities remain disabled', async () => {
    await operatorPaused(); jest.mocked(api.getRealCapabilities).mockResolvedValueOnce(pausedCapabilities);
    await refresh(); await waitFor(() => expect(api.getRealCapabilities).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled();
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });

  it('still clears private content and requests sign-in when ownership refresh fails authentication', async () => {
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false,
      'AI_SPENDING_NOT_APPROVED', undefined, undefined, 'contact-operator'));
    const onAuthenticationFailure = jest.fn();
    await render(<RealStoryWorkspace {...props} onAuthenticationFailure={onAuthenticationFailure} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Synthetic unsent words'); await press(t.send);
    jest.mocked(storyApi.listStorySessions).mockRejectedValueOnce(new storyApi.StoryProjectsError('authentication'));
    await refresh(); await waitFor(() => expect(onAuthenticationFailure).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(t.input).props.value).toBe('');
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });

  it('does not treat globally ready capabilities as proof that a user allowance was renewed', async () => {
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('unavailable', 429, false,
      'AI_USER_BUDGET_EXHAUSTED', undefined, undefined, 'contact-operator'));
    await render(<RealStoryWorkspace {...props} />); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Synthetic unsent words'); await press(t.send);
    await refresh(); await waitFor(() => expect(api.getRealCapabilities).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: t.send })).toBeDisabled();
    expect(screen.getByLabelText(t.input).props.value).toBe('Synthetic unsent words');
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1);
  });

  it('recovers an initial paused bootstrap only after the user deliberately refreshes', async () => {
    jest.mocked(api.getRealCapabilities).mockRejectedValueOnce(new api.RealAiError('unavailable', 503, false,
      'AI_SPENDING_NOT_APPROVED', undefined, undefined, 'contact-operator'));
    await render(<RealStoryWorkspace {...props} />);
    await waitFor(() => expect(screen.getAllByText(t.serviceUnavailable).length).toBeGreaterThan(0));
    await refresh(); await ready();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Synthetic later words');
    expect(screen.getByRole('button', { name: t.send })).toBeEnabled();
    expect(api.sendRealTextMessage).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
});
