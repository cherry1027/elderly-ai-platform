import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AudioTranscript } from '../api/audio-transcripts';
import { useApiBackoff } from '../api/ApiBackoff';
import type { ConversationMessage } from '../api/conversation-messages';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { transcriptConversationCopy } from './conversation-copy';

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
}

/** View only. Existing transcript text stays in RecordingPanel; messages are backend history, never guessed turn pairs. */
export function ConversationPanel({ language, state, transcripts, onSelect, onProcess,
  onReconcile, onRetry, onRefresh }: ConversationPanelProps) {
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

  return <View style={styles.panel} accessibilityState={{ busy }}>
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.heading}>{text.title}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.notice}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
    <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLanguage={locale}
      accessibilityLiveRegion="polite" allowFontScaling style={styles.body}>{status}</Text>
    {state.phase === 'uncertain' && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
    {!busy && !state.complete && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.incomplete}</Text>}
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.choose}</Text>
    {!transcripts.length && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noTranscripts}</Text>}
    {transcripts.map((transcript, index) => {
      const processed = state.processedIds.includes(transcript.transcript_id);
      const blocked = state.blockedIds?.includes(transcript.transcript_id);
      const checked = selected?.transcript_id === transcript.transcript_id;
      const disabled = !canChoose || processed || blocked === true;
      const label = text.select + ' ' + (index + 1) + (processed ? '. ' + text.processed : blocked ? '. ' + text.blocked : '');
      return <Pressable key={transcript.transcript_id} accessibilityRole="radio" accessibilityLabel={label}
        accessibilityLanguage={locale} accessibilityState={{ checked, disabled }} disabled={disabled}
        onPress={() => onSelect(transcript.transcript_id)} onFocus={() => setFocused(transcript.transcript_id)}
        onBlur={() => setFocused(null)} style={[styles.choice, checked && styles.selected, disabled && styles.disabledChoice,
          focused === transcript.transcript_id && styles.focused]}>
        <Text allowFontScaling style={styles.choiceText}>{text.savedTranscript} {index + 1}</Text>
        {checked && <Text allowFontScaling style={styles.body}>{text.selected}</Text>}
        {processed && <Text allowFontScaling style={styles.body}>{text.processed}</Text>}
        {blocked && <Text allowFontScaling style={styles.body}>{text.blocked}</Text>}
      </Pressable>;
    })}
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
      variant="secondary" disabled={waiting} onPress={onRefresh} />}
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.historyTitle}</Text>
    {!busy && state.complete && !state.messages.length && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noMessages}</Text>}
    {state.messages.map(message => {
      const sourceIndex = message.role === 'user'
        ? transcripts.findIndex(transcript => transcript.transcript_id === message.id) : -1;
      return <View key={message.id} style={styles.message}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>
          {message.role === 'assistant' ? text.assistantMessage : text.userMessage}
        </Text>
        {sourceIndex >= 0 ? <>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.savedTranscript} {sourceIndex + 1}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling selectable style={styles.reference}>{text.reference}: {message.id}</Text>
        </> : <Text accessibilityLanguage={accessibilityLanguages[message.language]} allowFontScaling selectable
          style={styles.body}>{message.text}</Text>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: 20 },
  heading: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, flexShrink: 1 },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  choice: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 20,
    gap: 8, borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  choiceText: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  selected: { backgroundColor: colors.selected },
  disabledChoice: { borderColor: colors.muted },
  focused: { borderColor: colors.ink },
  action: { minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius,
    backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  disabledAction: { backgroundColor: colors.muted, borderColor: colors.muted },
  pressed: { backgroundColor: colors.forestPressed },
  actionText: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  message: { padding: 16, gap: 16, borderWidth: 2, borderColor: colors.border,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  reference: { color: colors.muted, fontSize: 18, lineHeight: 28, flexShrink: 1 },
});
