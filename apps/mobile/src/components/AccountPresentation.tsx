import { useEffect, useState, type PropsWithChildren, type RefObject } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Screen } from './Screen';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';

/** Entrance-only composition. Shared Screen/provider/backoff behavior stays intact. */
export function AccountScreen({ children, scrollViewRef, onContentLayout, compact = false }: PropsWithChildren<{
  scrollViewRef?: RefObject<ScrollView | null>; onContentLayout?: (event: LayoutChangeEvent) => void;
  compact?: boolean;
}>) {
  return <Screen scrollViewRef={scrollViewRef} onContentLayout={onContentLayout}>
    <View style={[styles.composition, compact && styles.compact]}>{children}</View>
  </Screen>;
}

/** Reuses B1's once-on-entry focus; language changes do not remount the heading. */
export function AccountHeading({ language, title, description }: {
  language: Language; title: string; description?: string;
}) {
  return <View style={styles.heading}>
    <RootScreenHeading language={language} title={title} centered />
    {description && <Text accessibilityLanguage={accessibilityLanguages[language]}
      allowFontScaling style={styles.description}>{description}</Text>}
  </View>;
}

interface ActionProps {
  label: string; language: Language; onPress: () => void;
  disabled?: boolean; busy?: boolean; secondary?: boolean; quiet?: boolean; selected?: boolean;
}
/** Presentation only; callers retain cancellation, auth and request ownership. */
export function AccountAction({ label, language, onPress, disabled = false, busy = false,
  secondary = false, quiet = false, selected }: ActionProps) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, busy, ...(selected === undefined ? {} : { selected }) }}
    disabled={disabled} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, secondary && styles.secondary, quiet && styles.quiet,
      pressed && !disabled && (secondary || quiet ? styles.pressed : styles.primaryPressed),
      focused && styles.focused, disabled && styles.disabled]}>
    <Text allowFontScaling style={[styles.actionLabel, (secondary || quiet) && styles.secondaryLabel,
      quiet && styles.quietLabel]}>{label}</Text>
  </Pressable>;
}

export function PasswordVisibility(props: Omit<ActionProps, 'busy' | 'secondary' | 'quiet'>) {
  return <AccountAction {...props} quiet />;
}

/** Only mapped, credential-free account copy belongs here, never input/server text. */
export function AccountNotice({ language, message, urgent = true }: {
  language: Language; message: string; urgent?: boolean;
}) {
  useEffect(() => {
    // Android uses the live region below; VoiceOver needs a native announcement.
    if (Platform.OS !== 'ios') return;
    let active = true;
    void (async () => {
      try {
        if (await AccessibilityInfo.isScreenReaderEnabled() && active) AccessibilityInfo.announceForAccessibility(message);
      } catch { /* The readable labelled notice remains available. */ }
    })();
    return () => { active = false; };
  }, [message]);
  return <Text accessibilityRole={urgent ? 'alert' : 'text'} accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
    accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.notice}>{message}</Text>;
}

export const accountStyles = StyleSheet.create({
  form: { width: '100%', gap: 20 }, field: { width: '100%', gap: 8 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  input: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 2, borderColor: colors.forest, borderRadius: 16, backgroundColor: colors.paper,
    color: colors.ink, fontSize: 22, lineHeight: 32 },
  focused: { borderColor: colors.ink },
  notice: { color: colors.ink, fontSize: 21, lineHeight: 31, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: 16, backgroundColor: colors.paper, flexShrink: 1 },
  help: { color: colors.muted, fontSize: 18, lineHeight: 27, flexShrink: 1 },
});

const styles = StyleSheet.create({
  composition: { width: '100%', gap: 20 }, compact: { gap: 14 }, heading: { width: '100%', gap: 8 },
  description: { color: colors.muted, fontSize: 21, lineHeight: 31, textAlign: 'center', flexShrink: 1 },
  action: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 10, paddingHorizontal: 20,
    borderWidth: 2, borderColor: colors.forest, borderRadius: 16, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.paper }, quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  actionLabel: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondaryLabel: { color: colors.forest }, quietLabel: { fontSize: 20, lineHeight: 30, fontWeight: '500', textDecorationLine: 'underline' },
  primaryPressed: { backgroundColor: colors.forestPressed }, pressed: { backgroundColor: colors.selected },
  focused: { borderColor: colors.ink }, disabled: { opacity: 0.65 },
});
