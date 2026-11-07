import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors } from '../theme';
import type { RealMessage } from './api';
import { realCopy } from './copy';
interface RowProps {
  message: RealMessage; language: Language; storyLanguage: Language; disabled: boolean;
  renewing: boolean; onSpeak(message: RealMessage): void; onMessageLayout?(id: string, y: number): void;
}
const MessageBubble = memo(function MessageBubble({ message, language, storyLanguage, disabled, renewing, onSpeak, onMessageLayout }: RowProps) {
  const t = realCopy[language];
  return <View testID={`saved-message-${message.id}`} onLayout={onMessageLayout ? event => onMessageLayout(message.id, event.nativeEvent.layout.y) : undefined}
    style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
    <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.speaker}>{message.role === 'user' ? t.you : t.assistant}</Text>
    {message.role === 'user' && message.source_transcript_id && <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.note}>{t.voiceMessage}</Text>}
    <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[storyLanguage]} style={styles.body}>{message.text}</Text>
    {message.role === 'assistant' && <LargeButton language={language} density="compact" variant="tertiary"
      label={renewing ? t.renewSpeech : t.speak} onPress={() => onSpeak(message)} disabled={disabled} />}
  </View>;
});
interface Props {
  messages: RealMessage[]; language: Language; storyLanguage: Language; blocked: boolean;
  renewSpeech: Set<string>; speechBlocked: boolean; onSpeak(message: RealMessage): void; onMessageLayout?(id: string, y: number): void;
}
/** Composer changes do not rerender saved rows; each new verified turn only adds its changed bubbles. */
export const ChatMessageHistory = memo(function ChatMessageHistory({ messages, language, storyLanguage, blocked, renewSpeech, speechBlocked, onSpeak, onMessageLayout }: Props) {
  return <>{messages.map(message => <MessageBubble key={message.id} message={message} language={language} storyLanguage={storyLanguage}
    disabled={blocked || (renewSpeech.has(message.id) && speechBlocked)} renewing={renewSpeech.has(message.id)} onSpeak={onSpeak} onMessageLayout={onMessageLayout} />)}</>;
});
const styles = StyleSheet.create({
  bubble: { maxWidth: '96%', gap: 8, padding: 16, borderRadius: 18 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.selected, borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  speaker: { fontSize: 18, lineHeight: 27, fontWeight: '600', color: colors.forest },
  body: { color: colors.ink, fontSize: 21, lineHeight: 33 },
  note: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
});
