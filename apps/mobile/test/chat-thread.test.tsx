import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView, StyleSheet, Text } from 'react-native';
import { getComponent } from './component-probe';
import { ChatThread, chatEntries } from '../src/conversation/ChatThread';
import { ConversationPanel, type TranscriptConversationState } from '../src/conversation/ConversationPanel';
import { RecordingPanel, type AudioPanelState } from '../src/audio/RecordingPanel';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { transcriptConversationCopy as copy } from '../src/conversation/conversation-copy';
import { audioCopy } from '../src/audio/audio-copy';
import type { AudioTranscript } from '../src/api/audio-transcripts';
import type { ConversationMessage } from '../src/api/conversation-messages';
import * as ApiBackoffModule from '../src/api/ApiBackoff';

jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  for (const [name, component] of Object.entries({ ScrollView: observeComponent(actual.ScrollView) })) {
    descriptors[name] = { value: component, enumerable: true, configurable: true, writable: true };
  }
  return Object.create(Object.getPrototypeOf(actual), descriptors);
});

const sessionId = '11000000-0000-4000-8000-000000000001';
const source: AudioTranscript = { transcript_id: '21000000-0000-4000-8000-000000000001', session_id: sessionId,
  language: 'en', text: '[SIMULATED TRANSCRIPT] Fictional source only.', status: 'completed', created_at: '2026-10-24T10:00:00Z' };
const user: ConversationMessage = { id: source.transcript_id, session_id: sessionId, role: 'user', text: source.text,
  sequence: 3, language: 'en', created_at: source.created_at };
const assistant: ConversationMessage = { ...user, id: '31000000-0000-4000-8000-000000000001', role: 'assistant',
  text: 'An actual persisted simulated follow-up.', sequence: 7 };
const actions = () => ({ onSelect: jest.fn(), onProcess: jest.fn(), onReconcile: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn() });
const ready: TranscriptConversationState = { phase: 'ready', messages: [user, assistant], processedIds: [], complete: true, canRetry: false };
const audio: AudioPanelState = { phase: 'idle', durationMs: 0, consent: false, transcripts: [] };
const audioActions = () => ({ onStart: jest.fn(), onStop: jest.fn(), onConsentChange: jest.fn(), onUpload: jest.fn(), onDiscard: jest.fn(), onRetryHistory: jest.fn() });

it('uses real backend sequences rather than input order, timestamps, adjacency or invented turn numbers', () => {
  const first = { ...assistant, id: '31000000-0000-4000-8000-000000000002', sequence: 1, created_at: '2026-10-25T10:00:00Z' };
  const result = chatEntries([assistant, user, first], [source]);
  expect(result.ordered.map(row => row.id)).toEqual([first.id, user.id, assistant.id]);
  expect(result.ordered.map(row => row.sequence)).toEqual([1, 3, 7]);
  expect(result.unplaced).toEqual([]);
});
it('deduplicates identity, never equal wording from different real source IDs', () => {
  const other = { ...source, transcript_id: '21000000-0000-4000-8000-000000000002' };
  const result = chatEntries([user, user, assistant], [source, source, other]);
  expect(result.ordered.map(row => row.id)).toEqual([source.transcript_id, assistant.id]);
  expect(result.unplaced.map(row => row.id)).toEqual([other.transcript_id]);
  expect(result.ordered[0].text).toBe(result.unplaced[0].text);
});
it('never assigns a sequence or a guessed assistant association to a saved transcript response', () => {
  const result = chatEntries([assistant], [source]);
  expect(result.unplaced[0]).not.toHaveProperty('sequence');
  expect(result.unplaced[0]).not.toHaveProperty('assistantId');
  expect(result.unplaced[0].id).toBe(source.transcript_id);
});

it.each(['en', 'sv'] as const)('uses speaker-labelled right/left bubbles and immutable source language in %s', async language => {
  await render(<ChatThread language={language} messages={[user, { ...assistant, language: 'sv' }]} transcripts={[source]} />);
  expect(screen.getByRole('header', { name: copy[language].userMessage })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: copy[language].assistantMessage })).toBeOnTheScreen();
  expect(screen.getByTestId(`chat-message-${source.transcript_id}`)).toHaveStyle({ alignSelf: 'flex-end' });
  expect(screen.getByTestId(`chat-message-${assistant.id}`)).toHaveStyle({ alignSelf: 'flex-start' });
  expect(screen.getByText(source.text).props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(assistant.text).props.accessibilityLanguage).toBe('sv-SE');
  expect(screen.getAllByText(source.text)).toHaveLength(1);
  expect(screen.getByText(copy[language].simulatedSource)).toBeOnTheScreen();
});
it.each(['en', 'sv'] as const)('shows immediate saved source text with honest unplaced ordering, then one sequenced representation in %s', async language => {
  const view = await render(<ChatThread language={language} messages={[]} transcripts={[source]} />);
  expect(screen.getByText(source.text)).toBeOnTheScreen();
  expect(screen.getByText(copy[language].unplacedSources)).toBeOnTheScreen();
  expect(screen.queryByText(audioCopy[language].unsent)).toBeNull();
  await view.rerender(<ChatThread language={language} messages={[user, assistant]} transcripts={[source]} />);
  expect(screen.getAllByText(source.text)).toHaveLength(1);
  expect(screen.queryByText(copy[language].unplacedSources)).toBeNull();
  expect(screen.getByText(assistant.text)).toBeOnTheScreen();
});
it.each(['en', 'sv'] as const)('identifies empty local guidance and never invents a saved Memy question in %s', async language => {
  const view = await render(<ChatThread language={language} messages={[]} transcripts={[]} />);
  expect(screen.getByText(copy[language].localGuidance)).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: copy[language].assistantMessage })).toBeNull();
  await view.rerender(<ChatThread language={language} messages={[assistant]} transcripts={[]} />);
  expect(screen.queryByText(copy[language].localGuidance)).toBeNull();
  expect(screen.getByText(assistant.text)).toBeOnTheScreen();
});
it('does not force a reader down the thread or speak private new message text', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const view = await render(<ChatThread language="en" messages={[user]} transcripts={[source]} />);
  const reference = getComponent(ScrollView).props.ref;
  if (!reference || typeof reference === 'function' || !reference.current) throw new Error('Expected the public scroll reference.');
  const end = jest.spyOn(reference.current, 'scrollToEnd'); end.mockClear();
  const thread = screen.getByTestId('chat-thread-scroll');
  await fireEvent.scroll(thread, { nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1800, width: 300 }, layoutMeasurement: { height: 500, width: 300 } } });
  await view.rerender(<ChatThread language="en" messages={[user, assistant]} transcripts={[source]} />);
  await fireEvent(thread, 'contentSizeChange', 300, 2000);
  expect(end).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: copy.en.newMessages })).toBeOnTheScreen();
  expect(announce).not.toHaveBeenCalledWith(assistant.text);
  await fireEvent.press(screen.getByRole('button', { name: copy.en.newMessages }));
  expect(end).toHaveBeenCalledWith({ animated: false });
  expect(screen.queryByRole('button', { name: copy.en.newMessages })).toBeNull();
  end.mockRestore(); announce.mockRestore();
});
it('scrolls only for a genuinely new identity near the end, not a status/layout update or source deduplication', async () => {
  const view = await render(<ChatThread language="en" messages={[]} transcripts={[source]} />);
  const reference = getComponent(ScrollView).props.ref;
  if (!reference || typeof reference === 'function' || !reference.current) throw new Error('Expected the public scroll reference.');
  const end = jest.spyOn(reference.current, 'scrollToEnd');
  const thread = screen.getByTestId('chat-thread-scroll');
  await fireEvent(thread, 'contentSizeChange', 300, 900); end.mockClear();
  await view.rerender(<ChatThread language="en" messages={[user]} transcripts={[source]}><Text>Status only.</Text></ChatThread>);
  await fireEvent(thread, 'contentSizeChange', 300, 920); expect(end).not.toHaveBeenCalled();
  await view.rerender(<ChatThread language="en" messages={[user, assistant]} transcripts={[source]} />);
  await fireEvent(thread, 'contentSizeChange', 300, 1200);
  expect(end).toHaveBeenCalledTimes(1); expect(end).toHaveBeenCalledWith({ animated: false });
  end.mockRestore();
});
it('cancels an old auto-scroll when the reader moves away before layout, and clears stale new-message controls with history', async () => {
  const view = await render(<ChatThread language="en" messages={[user]} transcripts={[source]} />);
  const reference = getComponent(ScrollView).props.ref;
  if (!reference || typeof reference === 'function' || !reference.current) throw new Error('Expected the public scroll reference.');
  const end = jest.spyOn(reference.current, 'scrollToEnd'); end.mockClear();
  const thread = screen.getByTestId('chat-thread-scroll');
  await fireEvent.scroll(thread, { nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1800, width: 300 }, layoutMeasurement: { height: 500, width: 300 } } });
  await fireEvent.scroll(thread, { nativeEvent: { contentOffset: { y: 1300 }, contentSize: { height: 1800, width: 300 }, layoutMeasurement: { height: 500, width: 300 } } });
  await fireEvent(thread, 'contentSizeChange', 300, 1820);
  expect(end).not.toHaveBeenCalled();
  await fireEvent.scroll(thread, { nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1800, width: 300 }, layoutMeasurement: { height: 500, width: 300 } } });
  await view.rerender(<ChatThread language="en" messages={[user, assistant]} transcripts={[source]} />);
  expect(screen.getByRole('button', { name: copy.en.newMessages })).toBeOnTheScreen();
  await view.rerender(<ChatThread language="en" messages={[]} transcripts={[]} />);
  expect(screen.queryByRole('button', { name: copy.en.newMessages })).toBeNull();
  end.mockRestore();
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('never reintroduces recorder source text on %s failure', async error => {
  await render(<ConversationPanel language="en" state={{ ...ready, phase: 'error', error }} transcripts={[source]} {...actions()} />);
  expect(screen.queryByText(source.text)).toBeNull(); expect(screen.queryByText(assistant.text)).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(copy.en.errors[error]);
});
it('keeps the actual conversation scroller and composer separate without an absolute overlay', async () => {
  await render(<ConversationPanel language="en" state={ready} transcripts={[source]} {...actions()}
    composer={<Text testID="composer-fixture">Existing recorder controls.</Text>} />);
  expect(within(screen.getByTestId('chat-thread-scroll')).queryByTestId('composer-fixture')).toBeNull();
  expect(within(screen.getByTestId('chat-composer-dock')).getByTestId('composer-fixture')).toBeOnTheScreen();
  expect(screen.getByTestId('chat-composer-dock')).toHaveStyle({ maxHeight: '55%', flexShrink: 1 });
  expect(StyleSheet.flatten(screen.getByTestId('chat-composer-dock').props.style)?.position).toBeUndefined();
  expect(screen.getByTestId('chat-simulation-notice')).toHaveStyle({ maxHeight: '26%' });
});
it.each(['en', 'sv'] as const)('keeps Stop outside scrollable composer details and retains actual elapsed time/limits in %s', async language => {
  const controls = audioActions();
  await render(<RecordingPanel language={language} state={{ ...audio, phase: 'recording', durationMs: 12_900 }} presentation="composer" {...controls} />);
  const stop = screen.getByRole('button', { name: audioCopy[language].stop });
  expect(within(screen.getByTestId('recording-composer-details')).queryByRole('button', { name: audioCopy[language].stop })).toBeNull();
  expect(stop).toHaveStyle({ minHeight: 56 });
  expect(screen.getByText(`${audioCopy[language].duration}: 0:12`)).toBeOnTheScreen();
  expect(screen.getByText(audioCopy[language].limit)).toBeOnTheScreen();
  await fireEvent.press(stop); expect(controls.onStop).toHaveBeenCalledTimes(1);
  expect(controls.onUpload).not.toHaveBeenCalled();
});
it.each(['ready', 'uploading', 'uncertain'] as const)('distinguishes an actually unsent local recording from %s server state', async phase => {
  await render(<RecordingPanel language="en" presentation="composer" state={{ ...audio, phase, hasRecording: true }} {...audioActions()} />);
  if (phase === 'ready') expect(screen.getByText(audioCopy.en.unsent)).toBeOnTheScreen();
  else { expect(screen.queryByText(audioCopy.en.unsent)).toBeNull(); expect(screen.getByText(audioCopy.en.localCopy)).toBeOnTheScreen(); }
  expect(screen.queryByText(source.text)).toBeNull();
});
it('keeps the ready recording workspace outside the old full-page scroll with bounded header and safe area', async () => {
  await render(<ConversationScreen language="en" state={{ status: 'ready', project: { title: 'Fictional story', language: 'sv' }, session: { id: sessionId, language: 'sv' }, resumed: true }}
    onCheck={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} recordingPanel={<Text testID="real-workspace-slot">Recorder scope.</Text>} />);
  expect(within(screen.getByTestId('conversation-header-scroll')).queryByTestId('real-workspace-slot')).toBeNull();
  expect(within(screen.getByTestId('conversation-live-workspace')).getByTestId('real-workspace-slot')).toBeOnTheScreen();
  expect(screen.getByTestId('conversation-header-scroll')).toHaveStyle({ maxHeight: '28%' });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('keeps a long backoff warning inside the bounded header instead of shrinking the recorder out of the workspace', async () => {
  const banner = jest.spyOn(ApiBackoffModule, 'ApiBackoffBanner').mockImplementation(() =>
    <Text testID="backoff-layout-probe" allowFontScaling>{'A long scalable wait warning. '.repeat(40)}</Text>);
  try {
    await render(<ConversationScreen language="en" state={{ status: 'ready', project: { title: 'Fictional story', language: 'en' }, session: { id: sessionId, language: 'en' }, resumed: true }}
      onCheck={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} recordingPanel={<Text testID="real-workspace-slot">Recorder scope.</Text>} />);
    expect(within(screen.getByTestId('conversation-header-scroll')).getByTestId('backoff-layout-probe')).toBeOnTheScreen();
    expect(within(screen.getByTestId('conversation-live-workspace')).queryByTestId('backoff-layout-probe')).toBeNull();
    expect(screen.getByTestId('conversation-header-scroll')).toHaveStyle({ maxHeight: '28%', flexShrink: 1 });
  } finally { banner.mockRestore(); }
});
