import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { AudioTranscript } from '../src/api/audio-transcripts';
import type { ConversationMessage } from '../src/api/conversation-messages';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { ConversationPanel, type TranscriptConversationState } from '../src/conversation/ConversationPanel';
import { transcriptConversationCopy } from '../src/conversation/conversation-copy';
import type { Language } from '../src/i18n';

const session = '10000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000001';
const secondId = '20000000-0000-4000-8000-000000000002';
const source: AudioTranscript = { transcript_id: sourceId, session_id: session, language: 'en', status: 'completed',
  created_at: '2026-10-21T10:00:00Z', text: 'SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — fictional source retained in the recording panel.' };
const messages: ConversationMessage[] = [
  { id: sourceId, session_id: session, sequence: 1, role: 'user', text: source.text, language: 'en', created_at: source.created_at },
  { id: '30000000-0000-4000-8000-000000000001', session_id: session, sequence: 2, role: 'assistant',
    text: 'A complete simulated reply returned by the backend.', language: 'en', created_at: source.created_at },
];
const initial: TranscriptConversationState = { phase: 'ready', messages: [], processedIds: [], complete: true, canRetry: false };
async function open(state: TranscriptConversationState = initial, language: Language = 'en', transcripts: AudioTranscript[] = [source]) {
  const actions = { onSelect: jest.fn(), onProcess: jest.fn(), onReconcile: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn() };
  const view = await render(<ConversationPanel language={language} state={state} transcripts={transcripts} {...actions} />);
  return { ...view, ...actions };
}

it.each(['en', 'sv'] as const)('shows clear simulation copy without automatically processing in %s', async language => {
  const actions = await open(initial, language); const text = transcriptConversationCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.notice)).toBeOnTheScreen();
  expect(screen.getByText(text.introduction)).toBeOnTheScreen();
  expect(screen.getByText(text.noMessages)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  expect(actions.onSelect).not.toHaveBeenCalled(); expect(actions.onProcess).not.toHaveBeenCalled();
  expect(actions.onRefresh).not.toHaveBeenCalled(); expect(actions.onReconcile).not.toHaveBeenCalled();
  expect(actions.onRetry).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('selects a numbered saved transcript without sending anything in %s', async language => {
  const actions = await open(initial, language, [source, { ...source, transcript_id: secondId }]);
  const text = transcriptConversationCopy[language];
  const second = screen.getByRole('radio', { name: `${text.select} 2` });
  expect(second.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
  await fireEvent.press(second); expect(actions.onSelect).toHaveBeenCalledWith(secondId);
  expect(actions.onProcess).not.toHaveBeenCalled();
  expect(screen.queryByText(source.text)).toBeNull();
});

it('processes only through a separate explicit action on the controlled selected source', async () => {
  const actions = await open({ ...initial, selectedId: sourceId }); const text = transcriptConversationCopy.en;
  expect(screen.getByRole('radio', { name: `${text.select} 1` }).props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByText(text.selected)).toBeOnTheScreen();
  const button = screen.getByRole('button', { name: text.process }); expect(button).toBeEnabled();
  expect(actions.onProcess).not.toHaveBeenCalled(); await fireEvent.press(button); expect(actions.onProcess).toHaveBeenCalledTimes(1);
});

it('cannot process a selected identifier that is not in the current transcript list', async () => {
  const actions = await open({ ...initial, selectedId: 'unverified-source' });
  const button = screen.getByRole('button', { name: transcriptConversationCopy.en.process });
  expect(button).toBeDisabled(); await fireEvent.press(button); expect(actions.onProcess).not.toHaveBeenCalled();
});

it('marks known processed sources and prevents a second action', async () => {
  const text = transcriptConversationCopy.en;
  const actions = await open({ ...initial, selectedId: sourceId, processedIds: [sourceId], messages });
  const radio = screen.getByRole('radio', { name: `${text.select} 1. ${text.processed}` });
  expect(radio.props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  expect(screen.getByText(text.processed)).toBeOnTheScreen(); await fireEvent.press(radio); expect(actions.onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  expect(actions.onProcess).not.toHaveBeenCalled();
});

it.each(['loading', 'processing', 'checking'] as const)('prevents selection and submission while %s', async phase => {
  const text = transcriptConversationCopy.en; const actions = await open({ ...initial, phase, selectedId: sourceId, canRetry: true });
  expect(screen.getByText(text.statuses[phase])).toBeOnTheScreen();
  const radio = screen.getByRole('radio', { name: `${text.select} 1` }); expect(radio).toBeDisabled(); await fireEvent.press(radio);
  const process = screen.getByRole('button', { name: text.process }); expect(process).toBeDisabled(); await fireEvent.press(process);
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  expect(screen.queryByRole('button', { name: text.reconcile })).toBeNull();
  expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  expect(actions.onSelect).not.toHaveBeenCalled(); expect(actions.onProcess).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('does not treat incomplete history as proof that no turn exists in %s', async language => {
  const actions = await open({ ...initial, selectedId: sourceId, complete: false }, language); const text = transcriptConversationCopy[language];
  expect(screen.getByText(text.incomplete)).toBeOnTheScreen(); expect(screen.queryByText(text.noMessages)).toBeNull();
  expect(screen.getByRole('radio', { name: `${text.select} 1` })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: text.refresh })); expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  expect(actions.onProcess).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('offers read-only reconciliation before an explicit retry in %s', async language => {
  const actions = await open({ ...initial, phase: 'uncertain', error: 'timeout', selectedId: sourceId }, language);
  const text = transcriptConversationCopy[language];
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.timeout);
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen(); expect(screen.getByText(text.retryNotice)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.reconcile })); expect(actions.onReconcile).toHaveBeenCalledTimes(1);
  expect(actions.onRetry).not.toHaveBeenCalled(); expect(actions.onProcess).not.toHaveBeenCalled();
});

it('retains a distinct retry action without creating a replacement process action', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', error: 'network', selectedId: sourceId, canRetry: true });
  const text = transcriptConversationCopy.en;
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: text.retry })); expect(actions.onRetry).toHaveBeenCalledTimes(1);
  expect(actions.onProcess).not.toHaveBeenCalled(); expect(actions.onSelect).not.toHaveBeenCalled();
});

it.each(Object.keys(transcriptConversationCopy.en.errors) as StoryProjectsErrorKind[])('renders sanitized translated %s errors', async error => {
  await open({ ...initial, phase: 'error', error }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(transcriptConversationCopy.sv.errors[error]);
  expect(screen.getByRole('button', { name: transcriptConversationCopy.sv.process })).toBeDisabled();
  expect(screen.queryByText(/Bearer|access_token|refresh_token|file:\/\//)).toBeNull();
});

it.each(['en', 'sv'] as const)('shows an honest empty source state with no fabricated conversation in %s', async language => {
  const actions = await open(initial, language, []); const text = transcriptConversationCopy[language];
  expect(screen.getByText(text.noTranscripts)).toBeOnTheScreen(); expect(screen.getByText(text.noMessages)).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull(); expect(screen.queryByText(messages[1].text)).toBeNull();
  expect(screen.getByRole('button', { name: text.process })).toBeDisabled(); expect(actions.onProcess).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('displays actual backend assistant text and source references without duplicating the transcript in %s', async language => {
  await open({ ...initial, messages, processedIds: [sourceId] }, language); const text = transcriptConversationCopy[language];
  expect(screen.getByRole('header', { name: text.historyTitle })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: text.userMessage })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: text.assistantMessage })).toBeOnTheScreen();
  expect(screen.getByText(messages[1].text)).toBeOnTheScreen(); expect(screen.queryByText(source.text)).toBeNull();
  expect(screen.queryByText(`${text.reference}: ${sourceId}`)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.getByText(`${text.reference}: ${sourceId}`)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /confirm|accept memory|bekräfta/i })).toBeNull();
  expect(screen.queryByText(/confirmed memory|bekräftat minne/i)).toBeNull();
});

it('does not infer processing or invent an assistant from an existing user transcript', async () => {
  const actions = await open({ ...initial, messages: [messages[0]] }); const text = transcriptConversationCopy.en;
  expect(screen.queryByRole('header', { name: text.assistantMessage })).toBeNull();
  expect(screen.queryByText(messages[1].text)).toBeNull();
  expect(screen.queryByText(text.processed)).toBeNull(); expect(actions.onProcess).not.toHaveBeenCalled();
});

it('renders other actual saved user messages without claiming they were recognized from the recording', async () => {
  const other: ConversationMessage = { ...messages[0], id: secondId, text: 'A separate saved fictional user message.' };
  await open({ ...initial, messages: [other, messages[1]] });
  expect(screen.getByText(other.text)).toBeOnTheScreen(); expect(screen.getByText(messages[1].text)).toBeOnTheScreen();
  expect(screen.queryByText(source.text)).toBeNull();
});

it('announces phase and error changes without speaking message content automatically', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    const actions = await open(); const text = transcriptConversationCopy.en;
    expect(announce).toHaveBeenCalledWith(text.statuses.ready);
    await actions.rerender(<ConversationPanel language="en" state={{ ...initial, phase: 'processing' }} transcripts={[source]} {...actions} />);
    expect(announce).toHaveBeenCalledWith(text.statuses.processing);
    await actions.rerender(<ConversationPanel language="en" state={{ ...initial, phase: 'error', error: 'authentication' }} transcripts={[source]} {...actions} />);
    expect(announce).toHaveBeenCalledWith(text.errors.authentication);
    expect(announce).not.toHaveBeenCalledWith(source.text); expect(announce).not.toHaveBeenCalledWith(messages[1].text);
  } finally { announce.mockRestore(); }
});

it('replaces prior account content entirely when supplied a cleared state', async () => {
  const actions = await open({ ...initial, messages, selectedId: sourceId, processedIds: [sourceId] });
  expect(screen.getByText(messages[1].text)).toBeOnTheScreen();
  await actions.rerender(<ConversationPanel language="en" state={{ ...initial, phase: 'loading', complete: false }} transcripts={[]} {...actions} />);
  expect(screen.queryByText(messages[1].text)).toBeNull(); expect(screen.queryByText(sourceId, { exact: false })).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull(); expect(actions.onProcess).not.toHaveBeenCalled();
});

it('keeps buttons and selectors large, with scalable unclipped content', async () => {
  await open({ ...initial, messages, selectedId: sourceId });
  for (const role of ['button', 'radio'] as const) {
    for (const control of screen.getAllByRole(role)) expect(control).toHaveStyle({ minHeight: 56 });
  }
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});
