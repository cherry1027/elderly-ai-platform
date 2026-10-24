import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { RecordingPanel, type AudioPanelState, type AudioUIError } from '../src/audio/RecordingPanel';
import { audioCopy } from '../src/audio/audio-copy';
import type { Language } from '../src/i18n';

const transcript = {
  transcript_id: '11111111-1111-4111-8111-111111111111',
  session_id: '22222222-2222-4222-8222-222222222222',
  language: 'en' as const, status: 'completed' as const, created_at: '2026-10-21T10:00:00Z',
  text: 'SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — fictional output, not recognized speech. I moved to Malmö in 1974.',
};
const initial: AudioPanelState = { phase: 'idle', durationMs: 0, consent: false, transcripts: [] };
async function open(state: AudioPanelState = initial, language: Language = 'en') {
  const actions = { onStart: jest.fn(), onStop: jest.fn(), onConsentChange: jest.fn(),
    onUpload: jest.fn(), onDiscard: jest.fn(), onRetryHistory: jest.fn() };
  const view = await render(<RecordingPanel language={language} state={state} {...actions} />);
  return { ...actions, ...view };
}

it.each(['en', 'sv'] as const)('does not record, upload or request permission on mount in %s', async language => {
  const actions = await open(initial, language); const text = audioCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.introduction)).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByText(text.phases.idle)).toBeOnTheScreen();
  expect(actions.onStart).not.toHaveBeenCalled(); expect(actions.onUpload).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: text.upload })).toBeNull();
  expect(screen.queryByRole('button', { name: text.stop })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.start }));
  expect(actions.onStart).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['permission', 'preparing', 'stopping', 'uploading'] as const)('blocks duplicate actions during %s', async phase => {
  const actions = await open({ ...initial, phase, hasRecording: true, consent: true });
  expect(screen.getByText(audioCopy.en.phases[phase])).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(actions.onStart).not.toHaveBeenCalled(); expect(actions.onUpload).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('shows a recording status and explicit Stop action in %s', async language => {
  const actions = await open({ ...initial, phase: 'recording', durationMs: 9500 }, language); const text = audioCopy[language];
  expect(screen.getByText(text.phases.recording)).toBeOnTheScreen();
  expect(screen.getByText(`${text.duration}: 0:09`)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.upload })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.stop }));
  expect(actions.onStop).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('requires a distinct upload-consent choice in %s', async language => {
  const actions = await open({ ...initial, phase: 'ready', hasRecording: true, durationMs: 7000 }, language);
  const text = audioCopy[language];
  expect(screen.getByText(text.phases.ready)).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: text.consent }).props.accessibilityState).toEqual({ checked: false });
  const upload = screen.getByRole('button', { name: text.upload });
  expect(upload).toBeDisabled(); await fireEvent.press(upload); expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('checkbox', { name: text.consent }));
  expect(actions.onConsentChange).toHaveBeenCalledWith(true);
  expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.discard }));
  expect(actions.onDiscard).toHaveBeenCalledTimes(1);
});

it('lets the controller retain or withdraw consent without an automatic upload', async () => {
  const actions = await open({ ...initial, phase: 'ready', hasRecording: true, consent: true });
  expect(screen.getByRole('button', { name: audioCopy.en.upload })).toBeEnabled();
  expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('checkbox', { name: audioCopy.en.consent }));
  expect(actions.onConsentChange).toHaveBeenCalledWith(false);
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.upload }));
  expect(actions.onUpload).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('labels returned text as fictional rather than recognized speech in %s', async language => {
  const actions = await open({ ...initial, phase: 'completed', transcripts: [transcript] }, language);
  const text = audioCopy[language];
  expect(screen.getByText(text.phases.completed)).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: text.transcriptTitle })).toBeOnTheScreen();
  expect(screen.getByText(transcript.text)).toBeOnTheScreen();
  expect(screen.queryByText(`${text.transcriptId} 1: ${transcript.transcript_id}`)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.details }));
  expect(screen.getByText(`${text.transcriptId} 1: ${transcript.transcript_id}`)).toBeOnTheScreen();
  expect(screen.queryByText(transcript.session_id)).toBeNull();
  expect(screen.queryByRole('button', { name: /send|message|skicka/i })).toBeNull();
  expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.start })); expect(actions.onStart).toHaveBeenCalledTimes(1);
});

it.each(Object.keys(audioCopy.en.errors) as AudioUIError[])('shows only the translated safe %s error', async error => {
  await open({ ...initial, phase: 'error', error }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(audioCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|file:\/\/|refresh_token|access_token/)).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['configuration', 'authentication', 'access', 'completed-session'] as const)('cannot offer a fresh recording for blocking %s errors', async error => {
  await open({ ...initial, phase: 'error', error });
  expect(screen.queryByRole('button', { name: audioCopy.en.start })).toBeNull();
});

it('explains an uncertain upload without silently resending or replacing it', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', error: 'network', hasRecording: true, canRetry: true, consent: true });
  expect(screen.getByText(audioCopy.en.uncertain)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: audioCopy.en.start })).toBeNull();
  expect(actions.onUpload).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.retry })); expect(actions.onUpload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/I moved|Jag flyttade/)).toBeNull();
});

it('does not offer retry when the controller cannot safely retry the retained recording', async () => {
  await open({ ...initial, phase: 'uncertain', error: 'conflict', hasRecording: true, canRetry: false, consent: true });
  expect(screen.queryByRole('button', { name: audioCopy.en.retry })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: audioCopy.en.discard })).toBeOnTheScreen();
});

it('explains history failure separately from the result of an earlier upload', async () => {
  const actions = await open({ ...initial, historyFailed: true });
  expect(screen.getByRole('alert')).toHaveTextContent(audioCopy.en.historyFailed);
  expect(actions.onRetryHistory).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: audioCopy.en.retryHistory }));
  expect(actions.onRetryHistory).toHaveBeenCalledTimes(1);
});

it('shows history loading without claiming an upload succeeded or failed', async () => {
  await open({ ...initial, historyLoading: true });
  expect(screen.getByText(audioCopy.en.historyLoading)).toBeOnTheScreen();
  expect(screen.queryByText(audioCopy.en.phases.completed)).toBeNull();
});

it('does not provide a history-retry control while uploading or recording', async () => {
  const actions = await open({ ...initial, phase: 'uploading', historyFailed: true });
  expect(screen.queryByRole('button', { name: audioCopy.en.retryHistory })).toBeNull();
  await actions.rerender(<RecordingPanel language="en" state={{ ...initial, phase: 'recording', historyFailed: true }} {...actions} />);
  expect(screen.queryByRole('button', { name: audioCopy.en.retryHistory })).toBeNull();
});

it('announces meaningful state changes without announcing a timer every second', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    const actions = await open({ ...initial, phase: 'recording', durationMs: 1000 });
    expect(announce).toHaveBeenCalledWith(audioCopy.en.phases.recording);
    const count = announce.mock.calls.length;
    await actions.rerender(<RecordingPanel language="en" state={{ ...initial, phase: 'recording', durationMs: 2000 }} {...actions} />);
    expect(announce).toHaveBeenCalledTimes(count);
    await actions.rerender(<RecordingPanel language="en" state={{ ...initial, phase: 'error', error: 'permission' }} {...actions} />);
    expect(announce).toHaveBeenCalledWith(audioCopy.en.errors.permission);
  } finally { announce.mockRestore(); }
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -500])('never displays a malformed recording duration for %s', async durationMs => {
  await open({ ...initial, phase: 'recording', durationMs });
  expect(screen.getByText(`${audioCopy.en.duration}: 0:00`)).toBeOnTheScreen();
});

it('provides large touch controls and scalable unclipped text', async () => {
  await open({ ...initial, phase: 'ready', hasRecording: true, transcripts: [transcript] });
  for (const role of ['button', 'checkbox'] as const) {
    for (const control of screen.getAllByRole(role)) expect(control).toHaveStyle({ minHeight: 56 });
  }
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});

it.each(['en', 'sv'] as const)('shows translated development-only upload diagnostics safely in %s', async language => {
  await open({ ...initial, phase: 'error', error: 'disabled', uploadDiagnostic: {
    stage: 'response-body', outcome: 'failed', status: 503, code: 'TRANSCRIPTION_DISABLED',
  } }, language);
  expect(screen.queryByTestId('audio-upload-diagnostic')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: audioCopy[language].details }));
  const text = screen.getByTestId('audio-upload-diagnostic');
  expect(text).toHaveTextContent(audioCopy[language].diagnosticTitle, { exact: false });
  expect(text).toHaveTextContent(audioCopy[language].uploadStages['response-body'], { exact: false });
  expect(text).toHaveTextContent('HTTP 503', { exact: false });
  expect(text).toHaveTextContent('TRANSCRIPTION_DISABLED', { exact: false });
  expect(text.props.allowFontScaling).toBe(true);
  expect(text.props.selectable).toBe(true);
});
it('has no diagnostic on initial entry', async () => {
  await open(); expect(screen.queryByTestId('audio-upload-diagnostic')).toBeNull();
});
