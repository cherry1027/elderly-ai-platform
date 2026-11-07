import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { OriginalWordsEvidence } from '../src/real-ai/OriginalWordsEvidence';
import { realMessage, realTranscript } from './real-ai-fixtures';
import { realCopy } from '../src/real-ai/copy';
import type { Language } from '../src/i18n';

it('typing does not rebuild mounted original-word rows; a language change updates labels while preserving exact words', async () => {
  let messageReads = 0, transcriptReads = 0;
  const original = realMessage('user', { text: '  Exact saved words.\n', source_transcript_id: null, source_text_input_id: 'typed-source' });
  const messages = new Proxy([original], { get(target, key, receiver) { if (key === 'filter') messageReads++; return Reflect.get(target, key, receiver); } });
  const transcript = realTranscript();
  const transcripts = new Proxy([transcript], { get(target, key, receiver) { if (key === 'map') transcriptReads++; return Reflect.get(target, key, receiver); } });
  function Composer({ language }: { language: Language }) {
    const [text, setText] = useState('');
    return <><OriginalWordsEvidence messages={messages} transcripts={transcripts} language={language} storyLanguage="en" />
      <TextInput accessibilityLabel="Synthetic composer" value={text} onChangeText={setText} /></>;
  }
  const view = await render(<Composer language="en" />);
  expect(messageReads).toBe(1); expect(transcriptReads).toBe(1);
  await fireEvent.changeText(screen.getByLabelText('Synthetic composer'), 'A new');
  await fireEvent.changeText(screen.getByLabelText('Synthetic composer'), 'A new memory');
  expect(messageReads).toBe(1); expect(transcriptReads).toBe(1);
  await view.rerender(<Composer language="sv" />);
  expect(messageReads).toBe(2); expect(transcriptReads).toBe(2);
  expect(screen.getByText(realCopy.sv.originalTyped)).toBeOnTheScreen();
  expect(screen.getByText(original.text)).toBeOnTheScreen(); expect(screen.getByText(transcript.text)).toBeOnTheScreen();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
