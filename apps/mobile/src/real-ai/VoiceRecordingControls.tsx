import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';

const icons = {
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6',
  discard: 'm6 6 12 12M18 6 6 18',
  send: 'M12 20V4m-6 6 6-6 6 6',
  replay: 'M11 5 6 9H3v6h3l5 4V5Zm4 4a4.2 4.2 0 0 1 0 6m3-9a8.5 8.5 0 0 1 0 12',
} as const;
const waveform = [8, 15, 24, 14, 30, 21, 11, 19, 8];

type Icon = keyof typeof icons;
interface VoiceButtonProps {
  language: Language;
  label: string;
  onPress(): void;
  disabled?: boolean;
}

function VoiceIconButton({ icon, language, label, onPress, disabled = false }: VoiceButtonProps & { icon: Icon }) {
  const [focused, setFocused] = useState(false);
  const primary = icon === 'mic' || icon === 'send';
  const size = icon === 'replay' ? 22 : 28;
  return <Pressable
    accessibilityRole="button" accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled }} disabled={disabled} testID={`voice-${icon}`}
    onPress={() => { if (!disabled) onPress(); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary,
      pressed && !disabled && (primary ? styles.primaryPressed : styles.secondaryPressed),
      focused && styles.focused, disabled && styles.disabled]}>
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={icons[icon]} stroke={primary ? colors.paper : colors.forest} fill="none"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </Pressable>;
}

type VoiceRecordingControlsProps = { language: Language; disabled?: boolean } & (
  { state: 'idle'; recordLabel: string; onRecord(): void } |
  { state: 'capturing' | 'ready'; discardLabel: string; sendLabel: string; durationLabel: string; recordingLabel: string;
    onDiscard(): void; onSend(): void; sendDisabled?: boolean }
);

export function VoiceRecordingControls(props: VoiceRecordingControlsProps) {
  const { language, disabled } = props;
  if (props.state === 'idle') return <View style={styles.idle}>
    <VoiceIconButton icon="mic" language={language} label={props.recordLabel} onPress={props.onRecord} disabled={disabled} />
  </View>;
  return <View style={styles.capture}>
    <VoiceIconButton icon="discard" language={language} label={props.discardLabel} onPress={props.onDiscard} disabled={disabled} />
    <View style={styles.indicator}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform}>
        {waveform.map((height, index) => <View key={index} style={[styles.bar, { height }]} />)}
      </View>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityLabel={props.state === 'capturing' ? `${props.recordingLabel}. ${props.durationLabel}` : props.durationLabel}
        style={styles.duration}>{props.durationLabel}</Text>
    </View>
    <VoiceIconButton icon="send" language={language} label={props.sendLabel} onPress={props.onSend} disabled={disabled || props.sendDisabled} />
  </View>;
}

export function VoicePlaybackButton(props: VoiceButtonProps) {
  return <VoiceIconButton {...props} icon="replay" />;
}

const styles = StyleSheet.create({
  idle: { alignItems: 'center' },
  capture: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  indicator: { flex: 1, minWidth: 0, alignItems: 'center', gap: 3 },
  waveform: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  bar: { width: 3, backgroundColor: colors.forest, borderRadius: 3 },
  duration: { color: colors.muted, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  button: { width: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, alignItems: 'center',
    justifyContent: 'center', alignSelf: 'flex-start', borderRadius: layout.minimumTouchTarget / 2, borderWidth: 2 },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest },
  primaryPressed: { backgroundColor: colors.forestPressed, borderColor: colors.forestPressed },
  secondary: { borderColor: colors.border, backgroundColor: colors.paper },
  secondaryPressed: { backgroundColor: colors.selected },
  focused: { borderColor: colors.ink },
  disabled: { opacity: 0.65 },
});
