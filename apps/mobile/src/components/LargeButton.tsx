import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';

interface LargeButtonProps {
  label: string;
  accessibilityLabel?: string;
  language: Language;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  density?: 'comfortable' | 'compact';
}

export function LargeButton({
  label,
  accessibilityLabel,
  language,
  onPress,
  disabled = false,
  variant = 'primary',
  density = 'comfortable',
}: LargeButtonProps) {
  const [focused, setFocused] = useState(false);
  const primary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityLanguage={accessibilityLanguages[language]}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { if (!disabled) onPress(); }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        density === 'compact' && styles.compact,
        primary ? styles.primary : styles.secondary,
        pressed && !disabled && (primary ? styles.primaryPressed : styles.secondaryPressed),
        disabled && styles.disabled,
        focused && styles.focused,
      ]}
    >
      <Text allowFontScaling style={[styles.label, primary && styles.primaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const buttonStyles = StyleSheet.create({
  target: {
    minHeight: layout.minimumTouchTarget,
  },
});

const styles = StyleSheet.create({
  compact: { paddingVertical: 10, borderRadius: 16 },
  button: {
    ...buttonStyles.target,
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: layout.controlRadius,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  secondary: {
    backgroundColor: colors.paper,
    borderColor: colors.forest,
  },
  primaryPressed: {
    backgroundColor: colors.forestPressed,
    borderColor: colors.forestPressed,
  },
  secondaryPressed: {
    backgroundColor: colors.selected,
  },
  focused: {
    borderColor: colors.ink,
  },
  disabled: { opacity: 0.65 },
  label: {
    color: colors.forest,
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  primaryLabel: {
    color: colors.paper,
  },
});
