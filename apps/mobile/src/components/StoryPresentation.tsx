import { useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { accessibilityLanguages, type Language } from '../i18n';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { colors, layout } from '../theme';

/** Compact story-workflow heading, with B1's once-on-entry accessibility focus. */
export function StoryHeading({ language, title, kicker, storyLanguage = language }: {
  language: Language; title: string; kicker?: string; storyLanguage?: Language;
}) {
  return <View style={styles.heading}>
    {kicker && <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.kicker}>{kicker}</Text>}
    <RootScreenHeading language={storyLanguage} title={title} />
  </View>;
}

/** Disclosure changes visibility only. Controllers and their cleanup stay mounted. */
export function StoryDisclosure({ language, label, children, initiallyExpanded = false }: PropsWithChildren<{
  language: Language; label: string; initiallyExpanded?: boolean;
}>) {
  const [expanded, setExpanded] = useState(initiallyExpanded), [focused, setFocused] = useState(false);
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.disclosure, pressed && styles.pressed, focused && styles.focused]}>
      <Text allowFontScaling style={styles.disclosureLabel}>{label}</Text>
      <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        allowFontScaling style={styles.marker}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      style={[styles.contents, !expanded && styles.hidden]}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  heading: { width: '100%', gap: 6 }, kicker: { color: colors.muted, fontSize: 19, lineHeight: 28, flexShrink: 1 },
  section: { width: '100%', gap: 12 }, contents: { width: '100%', gap: 16 }, hidden: { display: 'none' },
  disclosure: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 10, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: colors.border,
    borderRadius: 16, backgroundColor: colors.paper },
  disclosureLabel: { flex: 1, flexShrink: 1, color: colors.forest, fontSize: 21, lineHeight: 31, fontWeight: '600' },
  marker: { color: colors.forest, fontSize: 24, lineHeight: 32 },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink },
});
