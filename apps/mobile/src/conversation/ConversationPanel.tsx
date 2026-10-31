import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AudioTranscript } from '../api/audio-transcripts';
import { useApiBackoff } from '../api/ApiBackoff';
import type { ConversationMessage } from '../api/conversation-messages';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { LargeButton } from '../components/LargeButton';
import { StoryDisclosure } from '../components/StoryPresentation';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { transcriptConversationCopy } from './conversation-copy';
import { ChatThread } from './ChatThread';

export interface TranscriptConversationState {
  phase: 'loading' | 'ready' | 'processing' | 'checking' | 'error' | 'uncertain';
  messages: ConversationMessage[];
  selectedId?: string;
  processedIds: string[];
  blockedIds?: string[];
  error?: StoryProjectsErrorKind;
  complete: boolean;
  canRetry: boolean;
}

export interface ConversationPanelProps {
  language: Language;
  state: TranscriptConversationState;
  transcripts: AudioTranscript[];
  onSelect: (id: string) => void;
  onProcess: () => void;
  onReconcile: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  composer?: ReactNode;
}

/** View only: one saved thread plus the existing recorder's separate composer.
 * No selection, render, status change or scroll event starts a network write. */
export function ConversationPanel({ language, state, transcripts, onSelect, onProcess,
  onReconcile, onRetry, onRefresh, composer }: ConversationPanelProps) {
  const text = transcriptConversationCopy[language];
  const { waiting } = useApiBackoff();
  const locale = accessibilityLanguages[language];
  const [focused, setFocused] = useState<string | null>(null);
  const busy = ['loading', 'processing', 'checking'].includes(state.phase);
  const selected = transcripts.find(transcript => transcript.transcript_id === state.selectedId);
  const canChoose = state.phase === 'ready' && state.complete;
  const canProcess = !waiting && canChoose && !!selected && !state.processedIds.includes(selected.transcript_id) && !state.blockedIds?.includes(selected.transcript_id);
  const failure = state.phase === 'error' || state.phase === 'uncertain';
  const status = state.error ? text.errors[state.error] : text.statuses[state.phase];
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  const sourceControl = (transcript: AudioTranscript, index: number) => {
      const processed = state.processedIds.includes(transcript.transcript_id);
      const blocked = state.blockedIds?.includes(transcript.transcript_id);
      const checked = selected?.transcript_id === transcript.transcript_id;
      const disabled = !canChoose || processed || blocked === true;
      const label = text.select + ' ' + (index + 1) + (processed ? '. ' + text.processed : blocked ? '. ' + text.blocked : '');
      return <Pressable accessibilityRole="radio" accessibilityLabel={label}
        accessibilityLanguage={locale} accessibilityState={{ checked, disabled }} disabled={disabled}
        onPress={() => onSelect(transcript.transcript_id)} onFocus={() => setFocused(transcript.transcript_id)}
        onBlur={() => setFocused(null)} style={[styles.choice, checked && styles.selected, disabled && styles.disabledChoice,
          focused === transcript.transcript_id && styles.focused]}>
        <View style={styles.choiceHeading}>
          <View accessible={false} style={[styles.radio, checked && styles.radioSelected]} />
          <Text allowFontScaling style={styles.choiceText}>{text.savedTranscript} {index + 1}</Text>
        </View>
        {checked && <Text allowFontScaling style={styles.body}>{text.selected}</Text>}
        {processed && <Text allowFontScaling style={styles.body}>{text.processed}</Text>}
        {blocked && <Text allowFontScaling style={styles.body}>{text.blocked}</Text>}
      </Pressable>;
  };
  // Access failures must not reintroduce private source text from recorder props.
  const hidePrivate = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const visibleMessages = hidePrivate ? [] : state.messages;
  const visibleTranscripts = hidePrivate ? [] : transcripts;
  return <View style={styles.panel} accessibilityState={{ busy }}>
    <ScrollView testID="chat-simulation-notice" style={styles.noticeHeader}
      contentContainerStyle={styles.noticeContent} alwaysBounceVertical={false}>
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.heading}>{text.title}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.notice}</Text>
    </ScrollView>
    <ChatThread language={language} messages={visibleMessages} transcripts={visibleTranscripts} renderSourceControl={sourceControl}>
    <View style={styles.selectionCard}>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
    <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLanguage={locale}
      accessibilityLiveRegion="polite" allowFontScaling style={styles.body}>{status}</Text>
    {state.phase === 'uncertain' && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
    {!busy && !state.complete && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.incomplete}</Text>}
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.choose}</Text>
    {!visibleTranscripts.length && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noTranscripts}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={text.process} accessibilityLanguage={locale}
      accessibilityState={{ disabled: !canProcess }} disabled={!canProcess} onPress={() => { if (canProcess) onProcess(); }}
      onFocus={() => setFocused('process')} onBlur={() => setFocused(null)}
      style={({ pressed }) => [styles.action, !canProcess && styles.disabledAction,
        canProcess && pressed && styles.pressed, focused === 'process' && styles.focused]}>
      <Text allowFontScaling style={styles.actionText}>{text.process}</Text>
    </Pressable>
    {failure && <>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.retryNotice}</Text>
      <LargeButton language={language} variant="secondary" label={text.reconcile} disabled={waiting} onPress={onReconcile} />
      {state.canRetry && <LargeButton language={language} label={text.retry} disabled={waiting} onPress={onRetry} />}
    </>}
    {state.phase === 'ready' && <LargeButton language={language} label={text.refresh}
      variant="secondary" density="compact" disabled={waiting} onPress={onRefresh} />}
    </View>
    {!busy && state.complete && !visibleMessages.length && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noMessages}</Text>}
    {visibleTranscripts.length > 0 &&
      <StoryDisclosure language={language} label={text.details}>
        {[...new Set(visibleTranscripts.map(row => row.transcript_id))]
          .map(id => <Text key={id} accessibilityLanguage={locale} allowFontScaling selectable style={styles.reference}>
            {text.reference}: {id}
          </Text>)}
      </StoryDisclosure>}
    </ChatThread>
    {composer && <View testID="chat-composer-dock" style={styles.composer}>{composer}</View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', flex: 1, minHeight: 0, gap: 10 },
  noticeHeader: { flexShrink: 1, flexGrow: 0, minHeight: 48, maxHeight: '26%' },
  noticeContent: { gap: 6 },
  composer: { width: '100%', flexShrink: 1, maxHeight: '55%', borderTopWidth: 2,
    borderColor: colors.border, paddingTop: 8 },
  selectionCard: { width: '100%', gap: 16, padding: 18, backgroundColor: colors.paper,
    borderRadius: layout.controlRadius, borderWidth: 2, borderColor: colors.border },
  heading: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 19, lineHeight: 29, padding: 14,
    borderRadius: 14, backgroundColor: colors.selected },
  choice: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 20,
    gap: 8, borderWidth: 2, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.paper },
  choiceHeading: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.forest },
  radioSelected: { borderWidth: 7 },
  choiceText: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flex: 1, flexShrink: 1 },
  selected: { backgroundColor: colors.selected, borderColor: colors.forest },
  disabledChoice: { borderColor: colors.muted },
  focused: { borderColor: colors.ink },
  action: { minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius,
    backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  disabledAction: { backgroundColor: colors.muted, borderColor: colors.muted },
  pressed: { backgroundColor: colors.forestPressed },
  actionText: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  reference: { color: colors.muted, fontSize: 18, lineHeight: 28, flexShrink: 1 },
});
