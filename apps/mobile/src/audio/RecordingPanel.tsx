import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { AudioTranscript, AudioUploadDiagnostic } from '../api/audio-transcripts';
import { useApiBackoff } from '../api/ApiBackoff';
import { LargeButton } from '../components/LargeButton';
import { StoryDisclosure } from '../components/StoryPresentation';
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

/** A static microphone, not a listening or speech-recognition animation. */
function MicrophoneMark({ recording }: { recording: boolean }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.microphone, recording && styles.microphoneRecording]}>
    <Svg width={40} height={48} viewBox="0 0 40 48" accessible={false}>
      <Rect x={13} y={3} width={14} height={27} rx={7} fill="none" stroke={colors.forest} strokeWidth={3} />
      <Path d="M6 23v2a14 14 0 0 0 28 0v-2M20 39v6M12 45h16" fill="none" stroke={colors.forest} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  </View>;
}

/** View only: recording, explicit upload consent, file disposal and identity guards belong to the controller. */
export function RecordingPanel({ language, state, onStart, onStop, onConsentChange, onUpload,
  onDiscard, onRetryHistory }: RecordingPanelProps) {
  const text = audioCopy[language];
  const { waiting } = useApiBackoff();
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
    <View style={[styles.recordingCard, state.phase === 'recording' && styles.activeCard]}>
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.heading}>{text.title}</Text>
    {!busy && !state.hasRecording && state.phase !== 'recording' &&
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>}
    <MicrophoneMark recording={state.phase === 'recording'} />
    <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLanguage={locale}
      accessibilityLiveRegion="polite" allowFontScaling style={styles.body}>{status}</Text>
    {(state.phase === 'recording' || state.hasRecording) && <Text accessibilityLanguage={locale}
      allowFontScaling style={styles.duration}>{text.duration}: {durationLabel(state.durationMs)}</Text>}
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
          accessibilityState={{ disabled: waiting || !state.consent }} disabled={waiting || !state.consent}
          onPress={() => { if (!waiting && state.consent) onUpload(); }} style={({ pressed }) => [styles.upload, (waiting || !state.consent) && styles.disabled,
            pressed && state.consent && !waiting && styles.pressed]}>
          <Text allowFontScaling style={styles.uploadText}>{state.phase === 'ready' ? text.upload : text.retry}</Text>
        </Pressable>
      </>}
      <LargeButton language={language} label={text.discard} variant="secondary" density="compact" onPress={onDiscard} />
    </>}
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
    </View>
    {state.historyLoading && <Text accessibilityLanguage={locale} accessibilityLiveRegion="polite"
      allowFontScaling style={styles.body}>{text.historyLoading}</Text>}
    {state.historyFailed && <>
      <Text accessibilityRole="alert" accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.historyFailed}</Text>
      {!busy && state.phase !== 'recording' && <LargeButton language={language} label={text.retryHistory}
        variant="secondary" disabled={waiting} onPress={onRetryHistory} />}
    </>}
    {state.transcripts.map(transcript => <View key={transcript.transcript_id} style={styles.transcript}>
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.transcriptHeading}>{text.transcriptTitle}</Text>
      <Text accessibilityLanguage={accessibilityLanguages[transcript.language]} allowFontScaling selectable
        style={styles.body}>{transcript.text}</Text>
    </View>)}
    {(state.transcripts.length > 0 || (__DEV__ && state.uploadDiagnostic)) &&
      <StoryDisclosure language={language} label={text.details}>
        {state.transcripts.map((transcript, index) => <Text key={transcript.transcript_id}
          accessibilityLanguage={locale} allowFontScaling selectable style={styles.reference}>
          {text.transcriptId} {index + 1}: {transcript.transcript_id}
        </Text>)}
        {__DEV__ && state.uploadDiagnostic && <Text testID="audio-upload-diagnostic"
          accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling selectable style={styles.reference}>
          {text.diagnosticTitle}: {text.uploadStages[state.uploadDiagnostic.stage]} · {text.uploadOutcomes[state.uploadDiagnostic.outcome]}
          {state.uploadDiagnostic.kind === 'timeout' ? ' · ' + text.diagnosticTimeout : ''}
          {state.uploadDiagnostic.kind === 'cancelled' ? ' · ' + text.diagnosticCancelled : ''}
          {state.uploadDiagnostic.status ? ' · HTTP ' + state.uploadDiagnostic.status : ''}
          {state.uploadDiagnostic.code ? ' · ' + state.uploadDiagnostic.code : ''}
        </Text>}
      </StoryDisclosure>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: 18 },
  recordingCard: { width: '100%', padding: 18, gap: 16, borderRadius: layout.controlRadius,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.paper },
  activeCard: { borderColor: colors.forest },
  microphone: { alignSelf: 'center', width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  microphoneRecording: { backgroundColor: colors.selected, borderWidth: 2, borderColor: colors.forest },
  heading: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  duration: { color: colors.forest, fontSize: 25, lineHeight: 35, fontWeight: '600' },
  notice: { color: colors.ink, fontSize: 19, lineHeight: 29, padding: 14,
    borderRadius: 14, backgroundColor: colors.selected },
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
  transcript: { gap: 12, padding: 18, borderRadius: layout.controlRadius, borderWidth: 2,
    borderColor: colors.border, backgroundColor: colors.paper },
  transcriptHeading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600' },
  reference: { color: colors.muted, fontSize: 18, lineHeight: 28, flexShrink: 1 },
});
