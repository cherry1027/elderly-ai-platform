import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';
import { realCopy } from './copy';

export function VoiceAction({ language, label, icon, disabled = false, onPress }: {
  language: Language; label: string; icon: 'mic' | 'discard' | 'send' | 'speaker' | 'stop'; disabled?: boolean; onPress(): void;
}) {
  const [focused, setFocused] = useState(false);
  const paths = {
    mic: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
    discard: 'M6 6l12 12M18 6 6 18', send: 'M12 20V4M5 11l7-7 7 7',
    speaker: 'M11 4 5 9H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
    stop: 'M5 5h14v14H5Z',
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.action, focused && styles.focused, disabled && styles.disabled]}>
    <Svg width={26} height={26} viewBox="0 0 24 24" accessible={false} aria-hidden>
      <Path d={paths[icon]} stroke={colors.forest} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  </Pressable>;
}

export function VoiceRecordingControls({ language, duration, retained, disabled, sendDisabled, onDiscard, onSend }: {
  language: Language; duration: number; retained: boolean; disabled: boolean; sendDisabled: boolean;
  onDiscard(): void; onSend(): void;
}) {
  const t = realCopy[language];
  return <View style={styles.strip} testID="voice-recording-controls">
    <VoiceAction language={language} label={t.discard} icon="discard" disabled={disabled} onPress={onDiscard} />
    <View style={styles.indicator}>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.text}>{retained ? t.recordingReady : t.recording}</Text>
      <Text allowFontScaling style={styles.text}>{Math.min(60, Math.floor(duration / 1000))} / 60 s</Text>
    </View>
    <VoiceAction language={language} label={t.stop} icon="send" disabled={disabled || sendDisabled} onPress={onSend} />
  </View>;
}
const styles = StyleSheet.create({
  action: { minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, borderRadius: 28, borderWidth: 2,
    borderColor: 'transparent', backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  focused: { borderColor: colors.forest }, disabled: { opacity: 0.45 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  indicator: { flex: 1, minWidth: 80 }, text: { color: colors.ink, fontSize: 18, lineHeight: 27, flexShrink: 1 },
});
