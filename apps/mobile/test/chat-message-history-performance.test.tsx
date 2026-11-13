import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { VoiceAction } from '../src/real-ai/VoiceRecordingControls';
import { ChatMessageHistory } from '../src/real-ai/ChatMessageHistory';
import { realMessage } from './real-ai-fixtures';
import { realCopy } from '../src/real-ai/copy';
jest.mock('../src/real-ai/VoiceRecordingControls', () => {
  const actual = jest.requireActual<typeof import('../src/real-ai/VoiceRecordingControls')>('../src/real-ai/VoiceRecordingControls');
  return { ...actual, VoiceAction: jest.fn(actual.VoiceAction) };
});
const rows = [realMessage('assistant')], renewSpeech = new Set<string>(), onSpeak = jest.fn();
function Composer() {
  const [text, setText] = useState('');
  return <><ChatMessageHistory messages={rows} language="en" storyLanguage="en" blocked={false} renewSpeech={renewSpeech} speechBlocked={false} onSpeak={onSpeak} />
    <TextInput accessibilityLabel="Synthetic composer" value={text} onChangeText={setText} /></>;
}
it('typing does not rerender saved-message controls or dispatch a network call', async () => {
  await render(<Composer />); const initial = jest.mocked(VoiceAction).mock.calls.length;
  await fireEvent.changeText(screen.getByLabelText('Synthetic composer'), 'One synthetic memory');
  await fireEvent.changeText(screen.getByLabelText('Synthetic composer'), 'One synthetic memory from childhood');
  expect(VoiceAction).toHaveBeenCalledTimes(initial); expect(globalThis.fetch).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: realCopy.en.speak })); expect(onSpeak).toHaveBeenCalledWith(rows[0]);
});
it('appending a verified turn does not rerender an unchanged saved bubble', async () => {
  const base = { language: 'en' as const, storyLanguage: 'en' as const, blocked: false, renewSpeech, speechBlocked: false, onSpeak };
  const view = await render(<ChatMessageHistory {...base} messages={rows} />);
  const initial = jest.mocked(VoiceAction).mock.calls.length;
  const next = realMessage('assistant', { id: '50000000-0000-4000-8000-000000000003', sequence: 3, text: 'A new synthetic question?' });
  await view.rerender(<ChatMessageHistory {...base} messages={[...rows, next]} />);
  expect(VoiceAction).toHaveBeenCalledTimes(initial + 1);
  expect(screen.getByText(rows[0].text)).toBeOnTheScreen(); expect(screen.getByText(next.text)).toBeOnTheScreen();
});
