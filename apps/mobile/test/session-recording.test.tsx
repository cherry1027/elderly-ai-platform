import { getComponent } from './component-probe';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createRef } from 'react';
import { Alert, AppState } from 'react-native';
import { SessionRecording, type SessionRecordingHandle } from '../src/audio/SessionRecording';
import { RecordingPanel } from '../src/audio/RecordingPanel';
import { audioCopy } from '../src/audio/audio-copy';
import { createNativeRecorder, createRecordingId, RecordingFailure, type RecordingDriver } from '../src/audio/native-recorder';
import { AudioTranscriptError, listSessionTranscripts, uploadSessionRecording,
  SIMULATED_TRANSCRIPT_NOTICE, type AudioTranscript } from '../src/api/audio-transcripts';
import { StoryProjectsError } from '../src/api/story-projects';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';


jest.mock('../src/audio/RecordingPanel', () => {
  const actual = jest.requireActual<typeof import('../src/audio/RecordingPanel')>('../src/audio/RecordingPanel');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, RecordingPanel: observeComponent(actual.RecordingPanel) };
});

jest.mock('../src/conversation/TranscriptConversation', () => ({ TranscriptConversation: () => null }));

jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createNativeRecorder: jest.fn(), createRecordingId: jest.fn() }));
jest.mock('../src/api/audio-transcripts', () => ({ ...jest.requireActual('../src/api/audio-transcripts'),
  listSessionTranscripts: jest.fn(), uploadSessionRecording: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
const sessionId = '20000000-0000-4000-8000-000000000001';
const file = { uri: 'file:///private/cache/fictional.m4a', name: 'recording.m4a' as const,
  type: 'audio/mp4' as const, size: 2000, durationMs: 5000 };
const transcript: AudioTranscript = { transcript_id: '30000000-0000-4000-8000-000000000001',
  session_id: sessionId, language: 'en', status: 'completed', created_at: '2026-10-21T10:00:00Z',
  text: SIMULATED_TRANSCRIPT_NOTICE + '\nI moved to Malmö in 1974.' };
let driver: jest.Mocked<RecordingDriver>;
const token = jest.fn(async (_owner: string) => 'synthetic-token');
const base = { language: 'en' as const, ownerId: 'account-a',
  projectId: '10000000-0000-4000-8000-000000000001', sessionId, sessionLanguage: 'en' as const,
  baseUrl: 'http://192.168.20.30:8000', getAccessToken: token };
async function open(props: Partial<React.ComponentProps<typeof SessionRecording>> = {}) {
  const ref = createRef<SessionRecordingHandle>();
  return { ...await render(<SessionRecording {...base} {...props} ref={ref} />), ref };
}

it.each(['en', 'sv'] as const)('keeps the real recorder mounted while inspecting saved recording details in %s', async language => {
  jest.mocked(listSessionTranscripts).mockResolvedValueOnce([{ ...transcript, language }]);
  const text = audioCopy[language];
  await open({ language, sessionLanguage: language });
  await screen.findByText(transcript.text);
  await fireEvent.press(screen.getByRole('button', { name: text.start }));
  await screen.findByText(text.phases.recording);
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.getByRole('button', { name: text.stop })).toBeEnabled();
  expect(screen.getByText(`${text.transcriptId} 1: ${transcript.transcript_id}`)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.queryByText(`${text.transcriptId} 1: ${transcript.transcript_id}`)).toBeNull();
  expect(driver.start).toHaveBeenCalledTimes(1);
  expect(driver.dispose).not.toHaveBeenCalled();
  expect(createNativeRecorder).toHaveBeenCalledTimes(1);
  expect(uploadSessionRecording).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.stop }));
  await screen.findByText(text.phases.ready);
  expect(state()).toMatchObject({ hasRecording: true, consent: false });
  expect(driver.stop).toHaveBeenCalledTimes(1);
  expect(createRecordingId).toHaveBeenCalledTimes(1);
});
const panel = () => getComponent(RecordingPanel).props;
const state = () => panel().state;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function ready() {
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByText(audioCopy.en.phases.recording);
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.stop }));
  await screen.findByText(audioCopy.en.phases.ready);
}
async function consentAndUpload() {
  await fireEvent.press(screen.getByRole('checkbox', { name: audioCopy.en.consent }));
  await act(async () => {
    await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.upload }));
  });
}
beforeEach(() => {
  driver = { requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}),
    stop: jest.fn(async () => file), discard: jest.fn(async (_recording: typeof file) => {}), dispose: jest.fn(async () => {}),
    getStatus: jest.fn(() => ({ durationMs: 5000, isRecording: true, interrupted: false })) };
  jest.mocked(createNativeRecorder).mockReset().mockReturnValue(driver);
  jest.mocked(createRecordingId).mockReset().mockReturnValue('40000000-0000-4000-8000-000000000001');
  jest.mocked(listSessionTranscripts).mockReset().mockResolvedValue([]);
  jest.mocked(uploadSessionRecording).mockReset().mockResolvedValue(transcript);
  jest.mocked(readStoryPreviewEnabled).mockReset().mockReturnValue(false);
  token.mockReset().mockResolvedValue('synthetic-token');
});
it('only reads history on entry, without requesting permission, recording or uploading', async () => {
  await open(); await waitFor(() => expect(state().historyLoading).toBe(false));
  expect(driver.requestPermission).not.toHaveBeenCalled(); expect(driver.start).not.toHaveBeenCalled();
  expect(uploadSessionRecording).not.toHaveBeenCalled();
  const options = jest.mocked(listSessionTranscripts).mock.calls[0][0];
  expect(options).toMatchObject({ sessionId, expectedLanguage: 'en', baseUrl: base.baseUrl });
  await options.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
});
it.each(['sample', 'unconfigured'] as const)('blocks recorder, token and history in %s mode', async mode => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(mode === 'sample');
  await open(mode === 'unconfigured' ? { baseUrl: null } : {});
  expect(state()).toMatchObject({ phase: 'error', error: 'configuration' });
  await act(() => panel().onStart());
  expect(createNativeRecorder).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(listSessionTranscripts).not.toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
});
it.each(['null', 'throw'] as const)('does not request microphone permission after a %s token failure', async kind => {
  if (kind === 'null') token.mockResolvedValueOnce(null as unknown as string);
  else token.mockRejectedValueOnce(new Error('secret token failure'));
  await open(); await act(() => panel().onStart());
  await waitFor(() => expect(state().phase).toBe('error'));
  expect(driver.requestPermission).not.toHaveBeenCalled(); expect(driver.start).not.toHaveBeenCalled();
  expect(uploadSessionRecording).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain('secret token failure');
});
it('rejects denied permission without starting a recording', async () => {
  driver.requestPermission.mockResolvedValue(false);
  await open(); await act(() => panel().onStart());
  await screen.findByText(audioCopy.en.errors.permission);
  expect(driver.start).not.toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
});
it('locks repeated Start and Stop taps and retains one recording until explicit consent', async () => {
  const pending = deferred<void>(); driver.start.mockReturnValueOnce(pending.promise);
  await open(); const start = panel().onStart; await act(() => { start(); start(); start(); });
  await waitFor(() => expect(driver.start).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve());
  const stopping = deferred<typeof file>(); driver.stop.mockReturnValueOnce(stopping.promise);
  const stop = panel().onStop; await act(() => { stop(); stop(); stop(); });
  expect(driver.stop).toHaveBeenCalledTimes(1);
  await act(async () => stopping.resolve(file));
  expect(state()).toMatchObject({ phase: 'ready', consent: false, durationMs: 5000, hasRecording: true });
  await act(() => panel().onUpload()); expect(uploadSessionRecording).not.toHaveBeenCalled();
});
it.each(['en', 'sv'] as const)('uploads the owned session in %s only after explicit consent', async language => {
  jest.mocked(uploadSessionRecording).mockResolvedValueOnce({ ...transcript, language });
  await open({ language, sessionLanguage: language });
  await act(() => panel().onStart()); await waitFor(() => expect(state().phase).toBe('recording'));
  await act(() => panel().onStop()); await waitFor(() => expect(state().phase).toBe('ready'));
  await act(() => panel().onConsentChange(true)); await act(() => panel().onUpload());
  await waitFor(() => expect(state().phase).toBe('completed'));
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
  const call = jest.mocked(uploadSessionRecording).mock.calls[0][0];
  expect(call).toMatchObject({ recording: file, sessionId, expectedLanguage: language, consent: true,
    idempotencyKey: '40000000-0000-4000-8000-000000000001' });
  await call.getAccessToken(); expect(token).toHaveBeenLastCalledWith('account-a');
  expect(state().transcripts[0].transcript_id).toBe(transcript.transcript_id);
  expect(driver.discard).toHaveBeenCalledWith(file);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('locks duplicate uploads while a request is pending', async () => {
  const pending = deferred<AudioTranscript>(); jest.mocked(uploadSessionRecording).mockReturnValueOnce(pending.promise);
  await open(); await ready(); await act(() => panel().onConsentChange(true));
  const upload = panel().onUpload; await act(() => { upload(); upload(); upload(); });
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(transcript));
  expect(state().phase).toBe('completed'); expect(createRecordingId).toHaveBeenCalledTimes(1);
});
it.each(['network', 'timeout', 'invalid-response'] as const)('retains exact bytes/key on an explicit uncertain %s retry', async kind => {
  jest.mocked(uploadSessionRecording).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
  await open(); await ready(); await consentAndUpload();
  await waitFor(() => expect(state().phase).toBe('uncertain'));
  expect(driver.discard).not.toHaveBeenCalled();
  await act(async () => { await Promise.resolve(); });
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
  await act(() => panel().onUpload()); await waitFor(() => expect(state().phase).toBe('completed'));
  const calls = jest.mocked(uploadSessionRecording).mock.calls;
  expect(calls[1][0].recording).toBe(calls[0][0].recording);
  expect(calls[1][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
  expect(createRecordingId).toHaveBeenCalledTimes(1);
});
it('shows disabled simulation safely without automatically retrying or claiming success', async () => {
  jest.mocked(uploadSessionRecording).mockRejectedValueOnce(new AudioTranscriptError('unavailable', 503, false, 'TRANSCRIPTION_DISABLED'));
  await open(); await ready(); await consentAndUpload();
  await screen.findByText(audioCopy.en.errors.disabled);
  expect(state().transcripts).toEqual([]); expect(driver.discard).not.toHaveBeenCalled();
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
});
it.each(['authentication', 'forbidden', 'not-found', 'validation', 'conflict'] as const)('does not retry a definitive %s rejection', async kind => {
  jest.mocked(uploadSessionRecording).mockRejectedValueOnce(new StoryProjectsError(kind));
  await open(); await ready(); await consentAndUpload();
  await waitFor(() => expect(state().phase).toBe('error'));
  await act(() => panel().onUpload()); expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
  expect(state().transcripts).toEqual([]);
});
it('confirms discard and clears only the local pending recording', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await open(); await ready(); await act(() => panel().onDiscard());
    expect(driver.discard).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2]!;
    await act(() => buttons.find(button => button.style === 'destructive')!.onPress!());
    await waitFor(() => expect(state().phase).toBe('idle'));
    expect(driver.discard).toHaveBeenCalledWith(file);
    expect(uploadSessionRecording).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});
it('confirms leaving with a recording and aborts a pending upload only after approval', async () => {
  const pending = deferred<AudioTranscript>(); jest.mocked(uploadSessionRecording).mockReturnValueOnce(pending.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const view = await open(); await ready(); await consentAndUpload();
    const proceed = jest.fn(); await act(() => view.ref.current!.requestLeave(proceed));
    expect(proceed).not.toHaveBeenCalled();
    const signal = jest.mocked(uploadSessionRecording).mock.calls[0][0].signal!;
    await act(() => alert.mock.calls[0][2]!.find(button => button.style === 'destructive')!.onPress!());
    expect(signal.aborted).toBe(true); expect(proceed).toHaveBeenCalledTimes(1);
    expect(driver.dispose).toHaveBeenCalled();
    await act(async () => pending.resolve(transcript));
    expect(state().transcripts).toEqual([]);
  } finally { alert.mockRestore(); }
});
it.each(['owner', 'project', 'session', 'unmount'] as const)('aborts and ignores uploads on %s change', async change => {
  const pending = deferred<AudioTranscript>(); jest.mocked(uploadSessionRecording).mockReturnValueOnce(pending.promise);
  const view = await open(); await ready(); await consentAndUpload();
  const signal = jest.mocked(uploadSessionRecording).mock.calls[0][0].signal!;
  if (change === 'unmount') await view.unmount();
  else await view.rerender(<SessionRecording {...base}
    ownerId={change === 'owner' ? 'account-b' : base.ownerId}
    projectId={change === 'project' ? '10000000-0000-4000-8000-000000000002' : base.projectId}
    sessionId={change === 'session' ? '20000000-0000-4000-8000-000000000002' : sessionId} />);
  expect(signal.aborted).toBe(true); expect(driver.dispose).toHaveBeenCalled();
  await act(async () => pending.resolve(transcript));
  if (change !== 'unmount') expect(state().transcripts).toEqual([]);
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
});
it('disposes and never starts after permission resolves following unmount', async () => {
  const permission = deferred<boolean>(); driver.requestPermission.mockReturnValueOnce(permission.promise);
  const view = await open(); await act(() => panel().onStart());
  await waitFor(() => expect(driver.requestPermission).toHaveBeenCalledTimes(1));
  await view.unmount(); await act(async () => permission.resolve(true));
  expect(driver.start).not.toHaveBeenCalled(); expect(driver.dispose).toHaveBeenCalled();
});
it('does not let a late history reply replace a confirmed upload', async () => {
  const history = deferred<AudioTranscript[]>(); jest.mocked(listSessionTranscripts).mockReturnValueOnce(history.promise);
  await open(); await ready(); await consentAndUpload(); await waitFor(() => expect(state().phase).toBe('completed'));
  await act(async () => history.resolve([]));
  expect(state().transcripts).toEqual([transcript]);
});
it('reopens completed history without posting another original', async () => {
  jest.mocked(listSessionTranscripts).mockResolvedValue([transcript]);
  const view = await open(); await screen.findByText(transcript.text); await view.unmount();
  await open(); await screen.findByText(transcript.text);
  expect(uploadSessionRecording).not.toHaveBeenCalled(); expect(driver.start).not.toHaveBeenCalled();
});
it('does not reconcile an uncertain upload by guessing that a history item is its result', async () => {
  jest.mocked(uploadSessionRecording).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await open(); await ready(); await consentAndUpload(); await waitFor(() => expect(state().phase).toBe('uncertain'));
  jest.mocked(listSessionTranscripts).mockResolvedValueOnce([transcript]);
  await act(() => panel().onRetryHistory()); await waitFor(() => expect(state().transcripts).toEqual([transcript]));
  expect(state().phase).toBe('uncertain'); expect(driver.discard).not.toHaveBeenCalled();
});
it('cleans up on background and safely reactivates if the authenticated parent retains the component', async () => {
  let change: ((value: string) => void) | undefined;
  const original = AppState.addEventListener;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') change = listener as (value: string) => void;
    return { remove: jest.fn() };
  });
  try {
    await open(); await ready(); await act(() => change!('background'));
    expect(driver.dispose).toHaveBeenCalled();
    await act(() => panel().onUpload()); expect(uploadSessionRecording).not.toHaveBeenCalled();
    await act(async () => change!('active'));
    await waitFor(() => expect(state().phase).toBe('idle'));
    expect(screen.getByRole('button', { name: audioCopy.en.start })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await waitFor(() => expect(state().phase).toBe('recording'));
  } finally { AppState.addEventListener = original; }
});
it('fences a microphone permission result during an inactive-system-dialog transition', async () => {
  let change: ((value: string) => void) | undefined;
  const original = AppState.addEventListener;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') change = listener as (value: string) => void;
    return { remove: jest.fn() };
  });
  try {
    const permission = deferred<boolean>(); driver.requestPermission.mockReturnValueOnce(permission.promise);
    await open(); await act(() => panel().onStart());
    await waitFor(() => expect(driver.requestPermission).toHaveBeenCalledTimes(1));
    await act(() => change!('inactive')); await act(async () => permission.resolve(true));
    expect(driver.start).not.toHaveBeenCalled();
    await act(async () => change!('active'));
    await waitFor(() => expect(state().phase).toBe('idle'));
    expect(driver.start).not.toHaveBeenCalled();
  } finally { AppState.addEventListener = original; }
});

it('disposes an unidentifiable stopped clip instead of retaining it for upload', async () => {
  jest.mocked(createRecordingId).mockImplementationOnce(() => { throw new Error('synthetic native UUID failure'); });
  await open(); await act(() => panel().onStart()); await waitFor(() => expect(state().phase).toBe('recording'));
  await act(() => panel().onStop()); await waitFor(() => expect(state().phase).toBe('error'));
  expect(driver.dispose).toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
  expect(state().hasRecording).toBe(false);
});

it('waits for the first permission prompt and native preparation before showing Recording and Stop', async () => {
  const permission = deferred<boolean>(); const preparation = deferred<void>();
  driver.requestPermission.mockReturnValueOnce(permission.promise);
  driver.start.mockReturnValueOnce(preparation.promise);
  await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByText(audioCopy.en.phases.permission);
  expect(driver.start).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: audioCopy.en.stop })).toBeNull();
  await act(async () => permission.resolve(true));
  await screen.findByText(audioCopy.en.phases.preparing);
  expect(screen.queryByRole('button', { name: audioCopy.en.start })).toBeNull();
  expect(screen.queryByRole('button', { name: audioCopy.en.stop })).toBeNull();
  await act(async () => preparation.resolve());
  expect(screen.getByRole('button', { name: audioCopy.en.stop })).toBeOnTheScreen();
  expect(screen.getByText(audioCopy.en.phases.recording)).toBeOnTheScreen();
  expect(uploadSessionRecording).not.toHaveBeenCalled();
});

it('rechecks the verified account after the permission prompt before preparing the microphone', async () => {
  token.mockResolvedValueOnce('synthetic-token').mockResolvedValueOnce(null as unknown as string);
  await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByText(audioCopy.en.errors.authentication);
  expect(driver.requestPermission).toHaveBeenCalledTimes(1);
  expect(driver.start).not.toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
});

it.each([
  ['foreground', 'recording-foreground'],
  ['audio-mode', 'recording-audio-mode'],
  ['creation', 'recording-preparation'],
  ['preparation', 'recording-preparation'],
  ['file-validation', 'recording-file'],
  ['startup', 'recording-startup'],
] as const)('shows safe %s failure details without offering a stopped clip', async (stage, key) => {
  driver.start.mockRejectedValueOnce(new RecordingFailure(stage));
  await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByText(audioCopy.en.errors[key]);
  expect(screen.queryByRole('button', { name: audioCopy.en.stop })).toBeNull();
  expect(screen.queryByRole('button', { name: audioCopy.en.upload })).toBeNull();
  expect(driver.dispose).toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/file:\/\/|access_token|Bearer/);
});

it('distinguishes stopped-file validation from a permission or startup failure', async () => {
  driver.stop.mockRejectedValueOnce(new RecordingFailure('file-validation', 'stop'));
  await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByRole('button', { name: audioCopy.en.stop });
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.stop }));
  await screen.findByText(audioCopy.en.errors['recording-file']);
  expect(uploadSessionRecording).not.toHaveBeenCalled();
});

it('uses a fresh driver on a subsequent explicit attempt after preparation fails', async () => {
  const first = driver;
  const next = { ...driver, requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}) };
  first.start.mockRejectedValueOnce(new RecordingFailure('preparation'));
  jest.mocked(createNativeRecorder).mockReset().mockReturnValueOnce(first).mockReturnValue(next);
  await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByText(audioCopy.en.errors['recording-preparation']);
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
  await screen.findByRole('button', { name: audioCopy.en.stop });
  expect(first.start).toHaveBeenCalledTimes(1); expect(next.start).toHaveBeenCalledTimes(1);
  expect(first.dispose).toHaveBeenCalled(); expect(next.dispose).not.toHaveBeenCalled();
});

it('a permission-popup interruption never auto-starts or reuses its disposed driver on return', async () => {
  let change: ((value: string) => void) | undefined;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    if (event === 'change') change = callback as (value: string) => void;
    return { remove: jest.fn() };
  });
  const first = driver; const permission = deferred<boolean>();
  first.requestPermission.mockReturnValueOnce(permission.promise);
  const next = { ...driver, requestPermission: jest.fn(async () => true),
    start: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
  jest.mocked(createNativeRecorder).mockReset().mockReturnValueOnce(first).mockReturnValue(next);
  try {
    await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await waitFor(() => expect(first.requestPermission).toHaveBeenCalled());
    await act(() => change!('inactive'));
    await act(async () => { permission.resolve(true); });
    expect(first.dispose).toHaveBeenCalled(); expect(first.start).not.toHaveBeenCalled();
    await act(async () => change!('active'));
    expect(screen.getByRole('button', { name: audioCopy.en.start })).toBeOnTheScreen();
    expect(next.start).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await screen.findByRole('button', { name: audioCopy.en.stop });
    expect(next.requestPermission).toHaveBeenCalledTimes(1);
    expect(next.start).toHaveBeenCalledTimes(1); expect(uploadSessionRecording).not.toHaveBeenCalled();
  } finally { listener.mockRestore(); }
});

it('duplicate active events cannot reset preparation, enable another Start, or hide an active recorder', async () => {
  let change: ((value: string) => void) | undefined;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    if (event === 'change') change = callback as (value: string) => void;
    return { remove: jest.fn() };
  });
  try {
    const preparation = deferred<void>(); driver.start.mockReturnValueOnce(preparation.promise);
    await open(); await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.start }));
    await screen.findByText(audioCopy.en.phases.preparing);
    await act(async () => { change!('active'); change!('active'); });
    expect(screen.getByText(audioCopy.en.phases.preparing)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: audioCopy.en.start })).toBeNull();
    await act(async () => preparation.resolve());
    await act(async () => change!('active'));
    expect(screen.getByRole('button', { name: audioCopy.en.stop })).toBeOnTheScreen();
    expect(driver.start).toHaveBeenCalledTimes(1); expect(driver.dispose).not.toHaveBeenCalled();
  } finally { listener.mockRestore(); }
});

it('fences late diagnostics across upload cancellation and account changes', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  try {
  const pending = deferred<AudioTranscript>();
  jest.mocked(uploadSessionRecording).mockReturnValueOnce(pending.promise);
  const view = await open(); await ready(); await consentAndUpload();
  const call = jest.mocked(uploadSessionRecording).mock.calls[0][0];
  await act(() => call.onDiagnostic?.({ stage: 'file-read', outcome: 'progress' }));
  expect(state().uploadDiagnostic).toEqual({ stage: 'file-read', outcome: 'progress' });
  await view.rerender(<SessionRecording {...base} ownerId="account-b" />);
  await waitFor(() => expect(state().historyLoading).toBe(false));
  await act(() => call.onDiagnostic?.({ stage: 'http-response', outcome: 'progress', status: 200 }));
  await act(async () => pending.resolve(transcript));
  expect(state().uploadDiagnostic).toBeUndefined();
  expect(state().transcripts).toEqual([]);
  expect(call.signal?.aborted).toBe(true);
  await view.unmount();
  } finally { listener.mockRestore(); }
});
