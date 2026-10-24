import { StyleSheet, Text, View } from 'react-native';
import { LargeButton } from '../components/LargeButton';
import { LanguageSelector } from '../components/LanguageSelector';
import { Screen } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { rootNavigationCopy } from '../root-navigation-copy';
import { colors } from '../theme';

interface Props {
  language: Language; onSelectLanguage: (language: Language) => void;
  onReplayIntroduction: () => void; onSignOut: () => void; user?: { email?: string };
}
/** Supported preferences/actions only; never stores a second account session. */
export function SettingsScreen({ language, onSelectLanguage, onReplayIntroduction, onSignOut, user }: Props) {
  const text = rootNavigationCopy[language], locale = accessibilityLanguages[language];
  return <Screen working>
    <View style={styles.composition}>
      <View style={styles.section}>
        <RootScreenHeading language={language} title={text.settingsTitle} />
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.description}>{text.settingsDescription}</Text>
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.languageTitle}</Text>
        <LanguageSelector language={language} onSelectLanguage={onSelectLanguage} density="compact" />
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.languageHelp}</Text>
      </View>
      <LargeButton language={language} label={text.replay} variant="secondary" density="compact" onPress={onReplayIntroduction} />
      <View style={styles.account}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.accountTitle}</Text>
        {user?.email && <Text accessibilityLanguage={locale} allowFontScaling selectable style={styles.description}>{user.email}</Text>}
        <LargeButton language={language} label={text.signOut} variant="secondary" density="compact" onPress={onSignOut} />
      </View>
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  composition: { width: '100%', gap: 20 },
  section: { width: '100%', gap: 12 }, account: { width: '100%', gap: 12, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: colors.border },
  description: { color: colors.muted, fontSize: 21, lineHeight: 31, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
});
