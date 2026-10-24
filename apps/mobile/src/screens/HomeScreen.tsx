import { StyleSheet, Text, View } from 'react-native';
import { MemoryBookArtwork } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { rootNavigationCopy } from '../root-navigation-copy';
import { colors } from '../theme';

interface Props { language: Language; onOpenStories: () => void; onCreateStory: () => void }
/** Local orientation, never a second dashboard or an inferred recent story. */
export function HomeScreen({ language, onOpenStories, onCreateStory }: Props) {
  const text = rootNavigationCopy[language], locale = accessibilityLanguages[language];
  return <Screen working>
    <View style={styles.composition}>
      <View style={styles.introduction}>
        <RootScreenHeading language={language} title={text.homeTitle} centered />
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.description}>{text.homeDescription}</Text>
      </View>
      <View style={styles.actions}>
        <LargeButton language={language} label={text.openStories} onPress={onOpenStories} />
        <LargeButton language={language} label={text.createStory} variant="secondary" onPress={onCreateStory} />
      </View>
      <View style={styles.artwork}><MemoryBookArtwork /></View>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.note}>{text.simulation}</Text>
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  composition: { width: '100%', gap: 16 },
  introduction: { width: '100%', gap: 8 }, actions: { width: '100%', gap: 12 },
  artwork: { width: '100%', maxWidth: 184, alignSelf: 'center' },
  description: { color: colors.muted, fontSize: 22, lineHeight: 33, textAlign: 'center', flexShrink: 1 },
  note: { color: colors.muted, fontSize: 18, lineHeight: 26, textAlign: 'center', flexShrink: 1 },
});
