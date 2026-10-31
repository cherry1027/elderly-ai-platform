import { useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AudioTranscript } from '../api/audio-transcripts';
import type { ConversationMessage } from '../api/conversation-messages';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';
import { transcriptConversationCopy } from './conversation-copy';

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: Language;
  transcript?: AudioTranscript;
  transcriptIndex?: number;
  sequence?: number;
}

/** Sequence is authoritative. A transcript response has no sequence: never
 * fabricate one from its time, list index, matching text or an adjacent reply. */
export function chatEntries(messages: ConversationMessage[], transcripts: AudioTranscript[]) {
  const sources = new Map<string, { transcript: AudioTranscript; index: number }>();
  for (const [index, transcript] of transcripts.entries()) {
    if (!sources.has(transcript.transcript_id)) sources.set(transcript.transcript_id, { transcript, index });
  }
  const seen = new Set<string>();
  const ordered: ChatEntry[] = [];
  for (const message of [...messages].sort((a, b) => a.sequence - b.sequence)) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    const source = message.role === 'user' ? sources.get(message.id) : undefined;
    ordered.push({ id: message.id, role: message.role, text: message.text, language: message.language,
      sequence: message.sequence, transcript: source?.transcript, transcriptIndex: source?.index });
  }
  const unplaced: ChatEntry[] = [];
  // Retain the API transcript-list order, but keep these explicitly outside the
  // sequenced-history group until an authenticated history read establishes it.
  for (const [id, source] of sources) {
    if (seen.has(id)) continue;
    unplaced.push({ id, role: 'user', text: source.transcript.text, language: source.transcript.language,
      transcript: source.transcript, transcriptIndex: source.index });
  }
  return { ordered, unplaced };
}

interface Props {
  language: Language;
  messages: ConversationMessage[];
  transcripts: AudioTranscript[];
  children?: ReactNode;
  renderSourceControl?: (transcript: AudioTranscript, index: number) => ReactNode;
}

/** One real saved-history scroller. The recording composer is its sibling, not
 * overlaid on messages. Never move VoiceOver focus when a saved row arrives. */
export function ChatThread({ language, messages, transcripts, children, renderSourceControl }: Props) {
  const text = transcriptConversationCopy[language];
  const { ordered, unplaced } = chatEntries(messages, transcripts);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const nearEnd = useRef(true);
  const scrollPending = useRef(true);
  const previousIds = useRef(new Set<string>());
  const [newMessages, setNewMessages] = useState(false);
  // Identity-only tracking keeps timer/status/layout changes from dragging the
  // reader down. Moving the same source into sequenced history is not a new turn.
  const identity = [...ordered, ...unplaced].map(row => row.id).sort().join(':');
  useLayoutEffect(() => {
    const ids = new Set(identity ? identity.split(':') : []);
    const added = [...ids].some(id => !previousIds.current.has(id));
    previousIds.current = ids;
    if (!added) return;
    if (nearEnd.current) scrollPending.current = true;
    else setNewMessages(true);
  }, [identity]);
  const revealLatest = () => {
    nearEnd.current = true;
    scrollPending.current = false;
    setNewMessages(false);
    scroll.current?.scrollToEnd({ animated: false });
  };
  const bubble = (row: ChatEntry) => <View key={row.id} testID={`chat-message-${row.id}`}
    style={[styles.bubble, row.role === 'user' ? styles.user : styles.assistant]}>
    <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
      style={styles.speaker}>{row.role === 'assistant' ? text.assistantMessage : text.userMessage}</Text>
    {row.transcript && <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
      style={styles.label}>{text.simulatedSource}</Text>}
    <Text accessibilityLanguage={accessibilityLanguages[row.language]} allowFontScaling selectable style={styles.prose}>{row.text}</Text>
    {row.transcript && renderSourceControl?.(row.transcript, row.transcriptIndex ?? 0)}
  </View>;
  return <View style={styles.frame}>
    {newMessages && !!identity && <LargeButton language={language} density="compact" variant="secondary" label={text.newMessages}
      onPress={revealLatest} />}
    <ScrollView ref={scroll} testID="chat-thread-scroll" style={styles.scroll}
      accessibilityLabel={text.historyTitle} keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content} alwaysBounceVertical={false} scrollEventThrottle={64}
      onScroll={event => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        nearEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height <= 96;
        if (nearEnd.current) setNewMessages(false);
        else scrollPending.current = false;
      }} onContentSizeChange={() => {
        if (!scrollPending.current || !nearEnd.current) return;
        scrollPending.current = false;
        setNewMessages(false);
        scroll.current?.scrollToEnd({ animated: false });
      }}>
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{text.historyTitle}</Text>
      {!ordered.length && !unplaced.length && <View style={styles.guidance}>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.speaker}>{text.localGuidance}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.prose}>{text.localIntroduction}</Text>
      </View>}
      {ordered.map(bubble)}
      {!!unplaced.length && <View style={styles.unplaced}>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>{text.unplacedSources}</Text>
        {unplaced.map(bubble)}
      </View>}
      {children}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', flex: 1, minHeight: layout.minimumTouchTarget, gap: 8 },
  scroll: { flex: 1, minHeight: 0 }, content: { paddingVertical: 12, gap: 16 },
  heading: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  bubble: { maxWidth: '94%', padding: 16, gap: 10, borderRadius: 20, borderWidth: 2, borderColor: colors.border },
  user: { alignSelf: 'flex-end', backgroundColor: colors.paper, borderBottomRightRadius: 6 },
  assistant: { alignSelf: 'flex-start', backgroundColor: colors.selected, borderBottomLeftRadius: 6 },
  speaker: { color: colors.forest, fontSize: 19, lineHeight: 29, fontWeight: '700', flexShrink: 1 },
  prose: { color: colors.ink, fontSize: 22, lineHeight: 34, flexShrink: 1 },
  label: { color: colors.muted, fontSize: 18, lineHeight: 28, flexShrink: 1 },
  guidance: { padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: layout.controlRadius },
  unplaced: { gap: 12 },
});
