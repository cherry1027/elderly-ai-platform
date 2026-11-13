import { StyleSheet, Text, View } from 'react-native';
import { BrandCorner } from '../components/StoryCover';
import { MemoryBookArtwork, MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { rootNavigationCopy } from '../root-navigation-copy';
import { colors } from '../theme';

interface Props { language: Language; onOpenStories: () => void; onCreateStory: () => void; apiContract?: 'real-v2' }
/** Local orientation, never a second dashboard or an inferred recent story. */
export function HomeScreen({ language, onOpenStories, onCreateStory, apiContract }: Props) {
  const text = rootNavigationCopy[language], locale = accessibilityLanguages[language];
  return <Screen working>
    <View style={styles.composition}>
      <View style={styles.brandRow}><View style={styles.brand}><MemyBrand language={language} compact /></View><BrandCorner /></View>
      <View testID="home-introduction" style={styles.introduction}>
        <RootScreenHeading language={language} title={text.homeTitle} centered />
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.description}>{text.homeDescription}</Text>
      </View>
      <View testID="home-artwork" style={styles.artwork}><MemoryBookArtwork /></View>
      <View testID="home-actions" style={styles.actions}>
        <LargeButton language={language} label={text.openStories} onPress={onOpenStories} />
        <LargeButton language={language} label={text.createStory} variant="tertiary" onPress={onCreateStory} />
      </View>
      {apiContract !== 'real-v2' && <Text accessibilityLanguage={locale} allowFontScaling style={styles.note}>{text.simulation}</Text>}
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center' }, brand: { flex: 1, minWidth: 0 },
  composition: { width: '100%', gap: 24 },
  introduction: { width: '100%', gap: 8 }, actions: { width: '100%', gap: 6 },
  artwork: { width: '100%', maxWidth: 360, backgroundColor: colors.selected, borderRadius: 32, alignSelf: 'center', marginVertical: 4 },
  description: { color: colors.muted, fontSize: 22, lineHeight: 33, textAlign: 'center', flexShrink: 1 },
  note: { color: colors.muted, fontSize: 18, lineHeight: 26, textAlign: 'center', flexShrink: 1 },
});
