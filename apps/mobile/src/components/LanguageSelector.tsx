import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { accessibilityLanguages, copy, languageNames, type Language } from '../i18n';
import { colors, layout } from '../theme';

const languages: Language[] = ['sv', 'en'];
interface Props { language: Language; onSelectLanguage: (language: Language) => void; density?: 'comfortable' | 'compact' }

/** Shared native radio choices; preference ownership stays in LanguageProvider. */
export function LanguageSelector({ language, onSelectLanguage, density = 'comfortable' }: Props) {
  const text = copy[language];
  return <View accessibilityRole="radiogroup" accessibilityLabel={text.languageGroup} style={[styles.group, density === 'compact' && styles.compactGroup]}>
    {languages.map(option => <LanguageOption key={option} language={option} selected={language === option}
      selectedLabel={text.selected} compact={density === 'compact'} onPress={() => onSelectLanguage(option)} />)}
  </View>;
}
function LanguageOption({ language, selected, selectedLabel, compact, onPress }: {
  language: Language; selected: boolean; selectedLabel: string; compact: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="radio" accessibilityLabel={languageNames[language]}
    accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ checked: selected }}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.option, compact && styles.compactOption, selected && styles.selected, pressed && styles.pressed, focused && styles.focused]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.radio, selected && styles.radioSelected]}>
      {selected && <View style={styles.dot} />}
    </View>
    <View style={styles.optionCopy}>
      <Text allowFontScaling style={styles.label}>{languageNames[language]}</Text>
      {selected && !compact && <Text allowFontScaling style={styles.selectedLabel}>{selectedLabel}</Text>}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  group: { width: '100%', gap: 16 },
  compactGroup: { gap: 12 },
  compactOption: { paddingVertical: 10, paddingHorizontal: 16, gap: 14 },
  option: { width: '100%', minHeight: layout.minimumTouchTarget, backgroundColor: colors.paper,
    borderWidth: 2, borderColor: colors.border, borderRadius: layout.controlRadius,
    paddingVertical: 20, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 18 },
  selected: { borderColor: colors.forest, backgroundColor: colors.selected },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.muted,
    alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.forest },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.forest },
  optionCopy: { flex: 1, gap: 4 },
  label: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  selectedLabel: { color: colors.forest, fontSize: 18, lineHeight: 27, flexShrink: 1 },
});
