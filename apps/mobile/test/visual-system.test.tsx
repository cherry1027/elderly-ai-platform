import { fireEvent, render, screen } from '@testing-library/react-native';
import { StoryCover } from '../src/components/StoryCover';
import { VoiceAction, VoiceRecordingControls } from '../src/real-ai/VoiceRecordingControls';
import { realCopy } from '../src/real-ai/copy';
import { colors } from '../src/theme';

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
it.each([[colors.ink, colors.cream], [colors.muted, colors.paper], [colors.paper, colors.forest],
  [colors.forest, colors.coral], [colors.danger, colors.paper]])('keeps readable contrast for %s on %s', (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
});
it('keeps the no-photo cover decorative and local', async () => {
  await render(<StoryCover compact />);
  expect(screen.getByTestId('memy-story-cover', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(['en', 'sv'] as const)('keeps recording icons labelled, large and actionable in %s', async language => {
  const discard = jest.fn(), send = jest.fn(), t = realCopy[language];
  const view = await render(<VoiceRecordingControls language={language} duration={60000} retained disabled={false} sendDisabled={false} onDiscard={discard} onSend={send} />);
  const button = screen.getByRole('button', { name: t.stop });
  expect(button).toHaveStyle({ minWidth: 56, minHeight: 56 });
  expect(screen.getByRole('button', { name: t.discard })).toHaveStyle({ minWidth: 56, minHeight: 56 });
  expect(screen.getByText(t.recordingReady)).toHaveProp('allowFontScaling', true);
  await fireEvent.press(button); expect(send).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: t.discard })); expect(discard).toHaveBeenCalledTimes(1);
  await view.rerender(<VoiceRecordingControls language={language} duration={60000} retained disabled sendDisabled onDiscard={discard} onSend={send} />);
  await fireEvent.press(screen.getByRole('button', { name: t.stop })); expect(send).toHaveBeenCalledTimes(1);
});
it('shows keyboard focus on the coral microphone without starting capture', async () => {
  const start = jest.fn(); await render(<VoiceAction language="en" label="Microphone" icon="mic" onPress={start} />);
  const mic = screen.getByRole('button', { name: 'Microphone' });
  await fireEvent(mic, 'focus'); expect(mic).toHaveStyle({ borderColor: colors.forest });
  expect(start).not.toHaveBeenCalled();
});
