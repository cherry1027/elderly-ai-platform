import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { authCopy } from '../auth-copy';
import { MemoryBookArtwork, MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';

interface AuthenticatedScreenProps {
  language: Language;
  user: { id: string; email?: string };
  onSignOut: () => void;
  busy?: boolean;
}

export function AuthenticatedScreen({ language, user, onSignOut, busy = false }: AuthenticatedScreenProps) {
  const text = authCopy[language];
  const [focused, setFocused] = useState(false);
  return <Screen>
    <MemyBrand />
    <View style={screenStyles.section}>
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.signedInTitle}</Text>
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
        style={screenStyles.description}>{text.signedIn}</Text>
      {user.email && <Text allowFontScaling selectable style={styles.email}>{user.email}</Text>}
    </View>
    <MemoryBookArtwork />
    <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
      style={screenStyles.description}>{text.authenticatedNote}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={busy ? text.signingOut : text.signOut}
      accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ disabled: busy, busy }}
      disabled={busy} onPress={onSignOut} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, focused && styles.focused]}>
      <Text allowFontScaling style={styles.buttonLabel}>{busy ? text.signingOut : text.signOut}</Text>
    </Pressable>
  </Screen>;
}

const styles = StyleSheet.create({
  heading: { fontFamily: headingFont },
  email: { color: colors.ink, fontSize: 22, lineHeight: 32, textAlign: 'center', flexShrink: 1 },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  pressed: { backgroundColor: colors.forestPressed },
  focused: { borderColor: colors.ink },
});
