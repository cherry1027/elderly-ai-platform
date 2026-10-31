import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SessionRecording } from '../src/audio/SessionRecording';
import { createNativeRecorder, createRecordingId, type RecordingDriver } from '../src/audio/native-recorder';
import { audioCopy } from '../src/audio/audio-copy';
import { transcriptConversationCopy as copy } from '../src/conversation/conversation-copy';
import { ConversationActionsProvider } from '../src/conversation/ConversationActions';
import { listSessionTranscripts, uploadSessionRecording, SIMULATED_TRANSCRIPT_NOTICE, type AudioTranscript } from '../src/api/audio-transcripts';
import { listConversationMessages, processTranscript, type ConversationMessage, type ConversationTurn } from '../src/api/conversation-messages';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import * as Crypto from 'expo-crypto';

jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'),
  createNativeRecorder: jest.fn(), createRecordingId: jest.fn() }));
jest.mock('../src/api/audio-transcripts', () => ({ ...jest.requireActual('../src/api/audio-transcripts'),
  listSessionTranscripts: jest.fn(), uploadSessionRecording: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn(), processTranscript: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));

const sessionId = '12000000-0000-4000-8000-000000000001';
const projectId = '22000000-0000-4000-8000-000000000001';
const uploadKey = '32000000-0000-4000-8000-000000000001';
const conversationKey = '42000000-0000-4000-8000-000000000001';
const file = { uri: 'file:///private/synthetic/recording.m4a', name: 'recording.m4a' as const,
  type: 'audio/mp4' as const, durationMs: 5000, size: 2000 };
const token = jest.fn(async (_owner: string): Promise<string | null> => 'synthetic-current-user-token');
let driver: jest.Mocked<RecordingDriver>;
const source = (language: 'en' | 'sv'): AudioTranscript => ({ transcript_id: '52000000-0000-4000-8000-000000000001',
  session_id: sessionId, language, status: 'completed', created_at: '2026-10-24T10:00:00Z',
  text: SIMULATED_TRANSCRIPT_NOTICE + (language === 'sv' ? 'Jag flyttade till Malmö 1974.' : 'I moved to Malmö in 1974.') });
const user = (language: 'en' | 'sv'): ConversationMessage => ({ id: source(language).transcript_id,
  session_id: sessionId, language, role: 'user', sequence: 2, created_at: source(language).created_at, text: source(language).text });
const turn = (language: 'en' | 'sv'): ConversationTurn => ({ user_message: user(language),
  message: { ...user(language), id: '62000000-0000-4000-8000-000000000001', role: 'assistant', sequence: 5,
    text: language === 'sv' ? 'Ett faktiskt sparat, simulerat Memy-svar.' : 'An actual saved simulated Memy reply.' },
  memories: [], clarifications: [], requires_clarification: false, mode: 'mock' });
function tree(language: 'en' | 'sv', ownerId = 'account-a') {
  return <ConversationActionsProvider ownerId={ownerId}><SessionRecording language={language} ownerId={ownerId}
    projectId={projectId} sessionId={sessionId} sessionLanguage={language} baseUrl="http://192.168.20.30:8000" getAccessToken={token} />
  </ConversationActionsProvider>;
}
async function record(language: 'en' | 'sv') {
  await fireEvent.press(screen.getByRole('button', { name: audioCopy[language].start }));
  await screen.findByText(audioCopy[language].phases.recording);
  await fireEvent.press(screen.getByRole('button', { name: audioCopy[language].stop }));
  await screen.findByText(audioCopy[language].phases.ready);
}
beforeEach(() => {
  driver = { requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}), stop: jest.fn(async () => file),
    discard: jest.fn(async (_recording: typeof file) => {}), dispose: jest.fn(async () => {}),
    getStatus: jest.fn(() => ({ isRecording: true, interrupted: false, durationMs: 5000 })) };
  jest.mocked(createNativeRecorder).mockReset().mockReturnValue(driver);
  jest.mocked(createRecordingId).mockReset().mockReturnValue(uploadKey);
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(conversationKey);
  jest.mocked(readStoryPreviewEnabled).mockReset().mockReturnValue(false);
  jest.mocked(listSessionTranscripts).mockReset().mockResolvedValue([]);
  jest.mocked(listConversationMessages).mockReset().mockResolvedValue({ messages: [], complete: true });
  jest.mocked(uploadSessionRecording).mockReset().mockResolvedValue(source('en'));
  jest.mocked(processTranscript).mockReset().mockResolvedValue(turn('en'));
  token.mockClear();
});

it.each(['en', 'sv'] as const)('keeps the complete %s Stop → consent → upload → select → explicit reply path separate and identity-deduplicated', async language => {
  jest.mocked(uploadSessionRecording).mockResolvedValue(source(language));
  jest.mocked(processTranscript).mockResolvedValue(turn(language));
  await render(tree(language));
  await waitFor(() => expect(listConversationMessages).toHaveBeenCalledTimes(1));
  expect(driver.start).not.toHaveBeenCalled(); expect(uploadSessionRecording).not.toHaveBeenCalled();
  expect(processTranscript).not.toHaveBeenCalled();
  await record(language);
  expect(screen.getByText(audioCopy[language].unsent)).toBeOnTheScreen();
  expect(uploadSessionRecording).not.toHaveBeenCalled(); expect(processTranscript).not.toHaveBeenCalled();
  expect(Crypto.randomUUID).not.toHaveBeenCalled();
  const upload = screen.getByRole('button', { name: audioCopy[language].upload });
  expect(upload).toBeDisabled(); await fireEvent.press(upload); expect(uploadSessionRecording).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('checkbox', { name: audioCopy[language].consent }));
  expect(uploadSessionRecording).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: audioCopy[language].upload }));
  await screen.findByText(source(language).text);
  expect(uploadSessionRecording).toHaveBeenCalledTimes(1);
  expect(uploadSessionRecording).toHaveBeenCalledWith(expect.objectContaining({ recording: file, consent: true, idempotencyKey: uploadKey, sessionId }));
  expect(screen.getAllByText(source(language).text)).toHaveLength(1);
  expect(screen.queryByText(audioCopy[language].unsent)).toBeNull();
  expect(screen.getByText(copy[language].unplacedSources)).toBeOnTheScreen();
  expect(screen.getByText(audioCopy[language].simulation)).toBeOnTheScreen();
  expect(screen.getByText(copy[language].notice)).toBeOnTheScreen();
  expect(processTranscript).not.toHaveBeenCalled(); expect(Crypto.randomUUID).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('radio', { name: `${copy[language].select} 1` }));
  expect(processTranscript).not.toHaveBeenCalled();
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [user(language)], complete: true });
  await fireEvent.press(screen.getByRole('button', { name: copy[language].process }));
  await screen.findByText(turn(language).message.text);
  expect(processTranscript).toHaveBeenCalledTimes(1);
  expect(processTranscript).toHaveBeenCalledWith(expect.objectContaining({ sourceTranscript: source(language), idempotencyKey: conversationKey, expectedLanguage: language, projectId, sessionId }));
  expect(conversationKey).not.toBe(uploadKey);
  expect(screen.getAllByText(source(language).text)).toHaveLength(1);
  expect(screen.queryByText(copy[language].unplacedSources)).toBeNull();
  expect(screen.getByRole('button', { name: audioCopy[language].start })).toBeEnabled();
  expect(driver.discard).toHaveBeenCalledWith(file);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('retains an uncertain saved-source action without invented reply and clears a late old-owner response', async () => {
  jest.mocked(listSessionTranscripts).mockResolvedValue([source('en')]);
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [user('en')], complete: true });
  let resolve!: (value: ConversationTurn) => void;
  jest.mocked(processTranscript).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = await render(tree('en'));
  await screen.findByText(source('en').text);
  await fireEvent.press(screen.getByRole('radio', { name: `${copy.en.select} 1` }));
  await fireEvent.press(screen.getByRole('button', { name: copy.en.process }));
  await waitFor(() => expect(processTranscript).toHaveBeenCalledTimes(1));
  expect(screen.getByText(copy.en.statuses.processing)).toBeOnTheScreen();
  expect(screen.queryByText(turn('en').message.text)).toBeNull();
  const signal = jest.mocked(processTranscript).mock.calls[0][0].signal!;
  jest.mocked(listSessionTranscripts).mockResolvedValue([]);
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [], complete: true });
  await view.rerender(tree('sv', 'account-b'));
  expect(signal.aborted).toBe(true);
  await act(() => resolve(turn('en')));
  expect(screen.queryByText(source('en').text)).toBeNull(); expect(screen.queryByText(turn('en').message.text)).toBeNull();
  expect(uploadSessionRecording).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
