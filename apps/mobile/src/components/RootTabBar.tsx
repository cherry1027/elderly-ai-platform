import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accessibilityLanguages, type Language } from '../i18n';
import { rootNavigationCopy, type RootTab } from '../root-navigation-copy';
import { colors, layout } from '../theme';

interface Props { language: Language; tab: RootTab; onSelectTab: (tab: RootTab) => void }
const tabs: RootTab[] = ['home', 'stories', 'settings'];

/** Root-only local navigation. The coordinator, not this presenter, authorizes exits. */
export function RootTabBar({ language, tab, onSelectTab }: Props) {
  const [focused, setFocused] = useState<RootTab | null>(null);
  const { width, height, fontScale } = useWindowDimensions();
  const text = rootNavigationCopy[language], locale = accessibilityLanguages[language];
  const weights = language === 'sv'
    ? { home: 0.6, stories: 1.7, settings: 1.35 }
    : { home: 0.75, stories: 1.4, settings: 1.2 };
  // Long Swedish labels keep their full font size. At very large text/narrow
  // widths a vertical arrangement leaves room for readable complete labels.
  const stacked = width / Math.max(1, fontScale) < 240;
  const short = height / Math.max(1, fontScale) < 250;
  const choices = <View accessibilityRole="tablist" accessibilityLabel={text.navigation}
      accessibilityLanguage={locale} style={[styles.bar, stacked && styles.stacked]}>
      {tabs.map(item => <Pressable key={item} accessibilityRole="tab"
        accessibilityLabel={text.tabs[item]} accessibilityLanguage={locale}
        accessibilityState={{ selected: tab === item }}
        onPress={() => { if (item !== tab) onSelectTab(item); }}
        onFocus={() => setFocused(item)} onBlur={() => setFocused(null)}
        style={({ pressed }) => [styles.tab, { flex: weights[item] }, stacked && styles.stackedTab,
          item === tab && styles.selected, focused === item && styles.focused,
          pressed && styles.pressed]}>
        <Text allowFontScaling style={[styles.label, item === tab && styles.selectedLabel]}>{text.tabs[item]}</Text>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.indicator, item === tab && styles.selectedIndicator]} />
      </Pressable>)}
    </View>;
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
    {short ? <ScrollView style={{ maxHeight: Math.max(56, Math.floor(height * 0.42)) }}
      accessibilityHint={text.navigationScrollHint} accessibilityLanguage={locale}
      keyboardShouldPersistTaps="handled" alwaysBounceVertical={false} showsVerticalScrollIndicator>
      {choices}
    </ScrollView> : choices}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.border },
  bar: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, gap: 4, alignItems: 'stretch' },
  stacked: { flexDirection: 'column' },
  tab: { minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, paddingHorizontal: 4,
    paddingVertical: 6, gap: 3, borderWidth: 2, borderColor: colors.paper, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center' },
  stackedTab: { flex: 0, width: '100%' },
  selected: { backgroundColor: colors.selected, borderColor: colors.selected },
  focused: { borderColor: colors.ink }, pressed: { backgroundColor: colors.selected },
  label: { color: colors.forest, fontSize: 20, lineHeight: 28, textAlign: 'center', flexShrink: 1 },
  selectedLabel: { fontWeight: '700' },
  indicator: { width: 20, height: 3, borderRadius: 2, opacity: 0, backgroundColor: colors.forest },
  selectedIndicator: { opacity: 1 },
});
