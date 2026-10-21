import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AudioTranscript, AudioUploadDiagnostic } from '../api/audio-transcripts';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { audioCopy } from './audio-copy';

export type AudioUIError = keyof typeof audioCopy.en.errors;
export interface AudioPanelState {
  phase: 'idle' | 'permission' | 'preparing' | 'recording' | 'stopping' | 'ready' | 'uploading' | 'completed' | 'error' | 'uncertain';
  durationMs: number;
  consent: boolean;
  error?: AudioUIError;
  uploadDiagnostic?: AudioUploadDiagnostic;
  canRetry?: boolean;
  hasRecording?: boolean;
  historyLoading?: boolean;
  historyFailed?: boolean;
  transcripts: AudioTranscript[];
}
export interface RecordingPanelProps {
  language: Language;
  state: AudioPanelState;
  onStart: () => void;
  onStop: () => void;
  onConsentChange: (consent: boolean) => void;
  onUpload: () => void;
  onDiscard: () => void;
  onRetryHistory: () => void;
}

function durationLabel(milliseconds: number) {
  const seconds = Number.isFinite(milliseconds) ? Math.floor(Math.max(0, milliseconds) / 1000) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** View only: recording, explicit upload consent, file disposal and identity guards belong to the controller. */
export function RecordingPanel({ language, state, onStart, onStop, onConsentChange, onUpload,
  onDiscard, onRetryHistory }: RecordingPanelProps) {
  const text = audioCopy[language];
  const locale = accessibilityLanguages[language];
  const [focused, setFocused] = useState(false);
  const busy = ['permission', 'preparing', 'stopping', 'uploading'].includes(state.phase);
  const canManageRecording = Boolean(state.hasRecording) && ['ready', 'error', 'uncertain'].includes(state.phase);
  const canUpload = canManageRecording && (state.phase === 'ready' || state.canRetry === true);
  const canStart = !state.hasRecording && ['idle', 'completed', 'error'].includes(state.phase) &&
    !['configuration', 'authentication', 'access', 'completed-session'].includes(state.error ?? '');
  const status = state.error ? text.errors[state.error] : text.phases[state.phase];
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  return <View style={styles.panel} accessibilityState={{ busy }}>
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.heading}>{text.title}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
    <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLanguage={locale}
      accessibilityLiveRegion="polite" allowFontScaling style={styles.body}>{status}</Text>
    {(state.phase === 'recording' || state.hasRecording) && <Text accessibilityLanguage={locale}
      allowFontScaling style={styles.duration}>{text.duration}: {durationLabel(state.durationMs)}</Text>}
    {__DEV__ && state.uploadDiagnostic && <Text testID="audio-upload-diagnostic"
      accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling selectable style={styles.reference}>
      {text.diagnosticTitle}: {text.uploadStages[state.uploadDiagnostic.stage]} · {text.uploadOutcomes[state.uploadDiagnostic.outcome]}
      {state.uploadDiagnostic.kind === 'timeout' ? ' · ' + text.diagnosticTimeout : ''}
      {state.uploadDiagnostic.kind === 'cancelled' ? ' · ' + text.diagnosticCancelled : ''}
      {state.uploadDiagnostic.status ? ' · HTTP ' + state.uploadDiagnostic.status : ''}
      {state.uploadDiagnostic.code ? ' · ' + state.uploadDiagnostic.code : ''}
    </Text>}
    {state.phase === 'uncertain' && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
    {canStart && <LargeButton language={language} label={text.start} onPress={onStart} />}
    {state.phase === 'recording' && <LargeButton language={language} label={text.stop} onPress={onStop} />}
    {canManageRecording && <>
      {canUpload && <>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={text.consent} accessibilityHint={text.consentHint}
          accessibilityLanguage={locale} accessibilityState={{ checked: state.consent }}
          onPress={() => onConsentChange(!state.consent)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={[styles.consent, state.consent && styles.selected, focused && styles.focused]}>
          <View accessible={false} style={[styles.check, state.consent && styles.checked]}>
            {state.consent && <Text accessible={false} allowFontScaling style={styles.checkmark}>✓</Text>}
          </View>
          <Text allowFontScaling style={styles.consentText}>{text.consent}</Text>
        </Pressable>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.consentHint}</Text>
        <Pressable accessibilityRole="button" accessibilityLanguage={locale}
          accessibilityLabel={state.phase === 'ready' ? text.upload : text.retry}
          accessibilityState={{ disabled: !state.consent }} disabled={!state.consent}
          onPress={onUpload} style={({ pressed }) => [styles.upload, !state.consent && styles.disabled,
            pressed && state.consent && styles.pressed]}>
          <Text allowFontScaling style={styles.uploadText}>{state.phase === 'ready' ? text.upload : text.retry}</Text>
        </Pressable>
      </>}
      <LargeButton language={language} label={text.discard} variant="secondary" onPress={onDiscard} />
    </>}
    {state.historyLoading && <Text accessibilityLanguage={locale} accessibilityLiveRegion="polite"
      allowFontScaling style={styles.body}>{text.historyLoading}</Text>}
    {state.historyFailed && <>
      <Text accessibilityRole="alert" accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.historyFailed}</Text>
      {!busy && state.phase !== 'recording' && <LargeButton language={language} label={text.retryHistory}
        variant="secondary" onPress={onRetryHistory} />}
    </>}
    {state.transcripts.map(transcript => <View key={transcript.transcript_id} style={styles.transcript}>
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.transcriptHeading}>{text.transcriptTitle}</Text>
      <Text accessibilityLanguage={accessibilityLanguages[transcript.language]} allowFontScaling selectable
        style={styles.body}>{transcript.text}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling selectable style={styles.reference}>{text.transcriptId}: {transcript.transcript_id}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: 20 },
  heading: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  duration: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600' },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  consent: { minHeight: layout.minimumTouchTarget, borderWidth: 2, borderColor: colors.forest,
    borderRadius: layout.controlRadius, padding: 16, gap: 14, flexDirection: 'row', alignItems: 'center' },
  selected: { backgroundColor: colors.selected },
  focused: { borderColor: colors.ink },
  consentText: { color: colors.ink, fontSize: 22, lineHeight: 32, flex: 1 },
  check: { width: 30, height: 30, borderWidth: 2, borderColor: colors.forest, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.forest },
  checkmark: { color: colors.paper, fontSize: 20, lineHeight: 24, fontWeight: '700' },
  upload: { minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderRadius: layout.controlRadius, backgroundColor: colors.forest, justifyContent: 'center', alignItems: 'center' },
  uploadText: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  disabled: { backgroundColor: colors.muted },
  pressed: { backgroundColor: colors.forestPressed },
  transcript: { gap: 16, padding: 16, borderRadius: layout.controlRadius, borderWidth: 2,
    borderColor: colors.border, backgroundColor: colors.paper },
  transcriptHeading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600' },
  reference: { color: colors.muted, fontSize: 18, lineHeight: 28, flexShrink: 1 },
});
