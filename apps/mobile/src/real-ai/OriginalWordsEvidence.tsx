import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors } from '../theme';
import type { RealMessage, RealTranscript } from './api';
import { realCopy } from './copy';

/** Pure original-word presentation. Collapsing keeps it mounted, typing does not rebuild its saved rows. */
export const OriginalWordsEvidence = memo(function OriginalWordsEvidence({ messages, transcripts, language, storyLanguage }: {
  messages: RealMessage[]; transcripts: RealTranscript[]; language: Language; storyLanguage: Language;
}) {
  const t = realCopy[language];
  const transcriptIds = new Set<string>();
  const recordings = transcripts.map(source => {
    transcriptIds.add(source.transcript_id);
    return { key: `recording:${source.transcript_id}`, text: source.text, at: Date.parse(source.created_at), label: t.original };
  });
  // Messages and transcripts page independently. A saved voice message carries
  // the exact words even when its transcript is outside the loaded page.
  const otherOriginals = messages.filter(message => message.role === 'user' &&
    (message.source_text_input_id || (message.source_transcript_id && !transcriptIds.has(message.source_transcript_id))))
    .map(message => ({ key: `message:${message.id}`, text: message.text, at: Date.parse(message.created_at),
      label: message.source_text_input_id ? t.originalTyped : t.original }));
  const originals = [...recordings, ...otherOriginals].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  return <View testID="saved-original-words" style={styles.list}>
    {originals.map(source => <View key={source.key}>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.note}>{source.label}</Text>
      <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[storyLanguage]} style={styles.body}>{source.text}</Text>
    </View>)}
  </View>;
});
const styles = StyleSheet.create({
  list: { gap: 16 },
  note: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 33 },
});
