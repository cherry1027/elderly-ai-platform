import { getComponent } from './component-probe';
import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { AudioTranscript } from '../src/api/audio-transcripts';
import type { ConversationMessage } from '../src/api/conversation-messages';
import { RecordingPanel, type AudioPanelState } from '../src/audio/RecordingPanel';
import { audioCopy } from '../src/audio/audio-copy';
import { ConversationPanel, type TranscriptConversationState } from '../src/conversation/ConversationPanel';
import { transcriptConversationCopy } from '../src/conversation/conversation-copy';
import { Screen } from '../src/components/Screen';
import { conversationCopy } from '../src/conversation-copy';
import { ConversationScreen } from '../src/screens/ConversationScreen';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});

const transcript: AudioTranscript = {
  transcript_id: '10000000-0000-4000-8000-000000000001',
  session_id: '20000000-0000-4000-8000-000000000001', status: 'completed', language: 'en',
  created_at: '2026-10-24T12:00:00Z', text: 'SIMULATED TRANSCRIPT — fictional source, not recognized speech.',
};
const audioState: AudioPanelState = { phase: 'idle', durationMs: 0, consent: false, transcripts: [] };
const conversationState: TranscriptConversationState = {
  phase: 'ready', messages: [], processedIds: [], complete: true, canRetry: false,
};
const recordingActions = () => ({ onStart: jest.fn(), onStop: jest.fn(), onConsentChange: jest.fn(),
  onUpload: jest.fn(), onDiscard: jest.fn(), onRetryHistory: jest.fn() });
const conversationActions = () => ({ onSelect: jest.fn(), onProcess: jest.fn(), onReconcile: jest.fn(),
  onRetry: jest.fn(), onRefresh: jest.fn() });

it.each(['en', 'sv'] as const)('puts Stop before saved history and secondary navigation without inventing a prompt in %s', async language => {
  const text = audioCopy[language], actions = recordingActions();
  const onBack = jest.fn(), onSignOut = jest.fn(), onReview = jest.fn();
  const view = await render(<ConversationScreen language={language} state={{ status: 'ready',
    project: { title: 'A fictional story', language }, resumed: true,
    session: { id: transcript.session_id, language } }} onCheck={jest.fn()} onBack={onBack}
    onSignOut={onSignOut} onReviewMemories={onReview}
    recordingPanel={<RecordingPanel language={language}
      state={{ ...audioState, phase: 'recording', durationMs: 8000, transcripts: [transcript], historyFailed: true }}
      {...actions} />} />);
  const tree = JSON.stringify(view.toJSON());
  // This nested screen has no bottom root tabs: retain Screen's bottom safe area.
  expect(getComponent(Screen).props.working).not.toBe(true);
  expect(tree.indexOf(text.stop)).toBeLessThan(tree.indexOf(transcript.text));
  expect(tree.indexOf(text.stop)).toBeLessThan(tree.indexOf(conversationCopy[language].review));
  expect(screen.getByRole('button', { name: text.stop })).toHaveStyle({ minHeight: 56 });
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.start })).toBeNull();
  expect(screen.queryByRole('button', { name: text.upload })).toBeNull();
  expect(screen.queryByRole('button', { name: text.retryHistory })).toBeNull();
  expect(screen.queryByRole('button', { name: /play|listen|spela upp|lyssna/i })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.stop }));
  expect(actions.onStop).toHaveBeenCalledTimes(1);
  expect(actions.onUpload).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled(); expect(onReview).not.toHaveBeenCalled();
  expect(onSignOut).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('keeps simulation and uncertain-upload warnings outside optional details in %s', async language => {
  const text = audioCopy[language], actions = recordingActions();
  await render(<RecordingPanel language={language} state={{ ...audioState, phase: 'uncertain', hasRecording: true,
    consent: true, canRetry: true, error: 'timeout', transcripts: [transcript],
    uploadDiagnostic: { stage: 'fetch-invoked', outcome: 'failed', kind: 'timeout' } }} {...actions} />);
  expect(screen.getByRole('button', { name: text.details }).props.accessibilityState).toMatchObject({ expanded: false });
  expect(screen.queryByTestId('audio-upload-diagnostic')).toBeNull();
  expect(screen.queryByText(transcript.transcript_id, { exact: false })).toBeNull();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.timeout);
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.getByTestId('audio-upload-diagnostic')).toHaveTextContent(text.diagnosticTimeout, { exact: false });
  expect(screen.getByText(`${text.transcriptId} 1: ${transcript.transcript_id}`)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.retry })).toBeEnabled();
  expect(screen.queryByRole('button', { name: text.start })).toBeNull();
  expect(actions.onUpload).not.toHaveBeenCalled(); expect(actions.onDiscard).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('keeps consent and upload as separate explicit steps for a completed recording in %s', async language => {
  const text = audioCopy[language], actions = recordingActions();
  const view = await render(<RecordingPanel language={language}
    state={{ ...audioState, phase: 'ready', durationMs: 8000, hasRecording: true }} {...actions} />);
  const upload = screen.getByRole('button', { name: text.upload });
  expect(upload).toBeDisabled(); await fireEvent.press(upload); expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('checkbox', { name: text.consent }));
  expect(actions.onConsentChange).toHaveBeenCalledWith(true); expect(actions.onUpload).not.toHaveBeenCalled();
  await view.rerender(<RecordingPanel language={language}
    state={{ ...audioState, phase: 'ready', durationMs: 8000, hasRecording: true, consent: true }} {...actions} />);
  expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.upload }));
  expect(actions.onUpload).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('keeps actual saved replies separate from immutable simulated source references in %s', async language => {
  const text = transcriptConversationCopy[language], actions = conversationActions();
  const source = { ...transcript, language };
  const messages: ConversationMessage[] = [{ id: source.transcript_id, session_id: source.session_id,
    role: 'user', text: source.text, sequence: 1, language, created_at: source.created_at }, {
    id: '30000000-0000-4000-8000-000000000001', session_id: source.session_id, role: 'assistant',
    text: language === 'sv' ? 'Ett faktiskt sparat simulerat svar.' : 'An actually saved simulated reply.',
    sequence: 2, language, created_at: source.created_at }];
  await render(<ConversationPanel language={language} state={{ ...conversationState, messages,
    selectedId: source.transcript_id, processedIds: [source.transcript_id] }} transcripts={[source]} {...actions} />);
  expect(screen.getByText(text.notice)).toBeOnTheScreen();
  expect(screen.getByText(messages[1].text)).toBeOnTheScreen();
  expect(screen.queryByText(source.text)).toBeNull();
  expect(screen.getByRole('header', { name: text.assistantMessage })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  expect(screen.queryByText(`${text.reference}: ${source.transcript_id}`)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.getByText(`${text.reference}: ${source.transcript_id}`)).toBeOnTheScreen();
  expect(actions.onProcess).not.toHaveBeenCalled(); expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(actions.onRetry).not.toHaveBeenCalled(); expect(actions.onReconcile).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('provides scalable and unclipped recording and conversation controls in %s', async language => {
  await render(<><RecordingPanel language={language} state={{ ...audioState, phase: 'ready', hasRecording: true,
    transcripts: [transcript] }} {...recordingActions()} />
    <ConversationPanel language={language} state={{ ...conversationState, selectedId: transcript.transcript_id }}
      transcripts={[transcript]} {...conversationActions()} /></>);
  for (const role of ['button', 'checkbox', 'radio'] as const) {
    for (const control of screen.getAllByRole(role)) expect(control).toHaveStyle({ minHeight: 56 });
  }
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true);
    expect(node.props.numberOfLines).toBeUndefined(); expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});
