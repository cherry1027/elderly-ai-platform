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
  return <>
    {messages.filter(message => message.role === 'user' && message.source_text_input_id).map(message => <View key={message.id}>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.note}>{t.originalTyped}</Text>
      <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[storyLanguage]} style={styles.body}>{message.text}</Text>
    </View>)}
    {transcripts.map(source => <View key={source.transcript_id}>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.note}>{t.original}</Text>
      <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[storyLanguage]} style={styles.body}>{source.text}</Text>
    </View>)}
  </>;
});
const styles = StyleSheet.create({
  note: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 33 },
});
