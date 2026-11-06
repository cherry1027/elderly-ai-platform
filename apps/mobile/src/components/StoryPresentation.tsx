import { useState, type PropsWithChildren, type ReactNode } from 'react';
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
export function StoryDisclosure({ language, label, children, initiallyExpanded = false, compact = false, heading }: PropsWithChildren<{
  language: Language; label: string; initiallyExpanded?: boolean; compact?: boolean; heading?: ReactNode;
}>) {
  const [expanded, setExpanded] = useState(initiallyExpanded), [focused, setFocused] = useState(false);
  return <View style={styles.section}>
    <View style={styles.summary}>
    {heading && <View style={styles.summaryHeading}>{heading}</View>}
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.disclosure, compact && styles.compact, pressed && styles.pressed, focused && styles.focused]}>
      <Text allowFontScaling style={styles.disclosureLabel}>{compact ? '⋯' : label}</Text>
      {!compact && <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        allowFontScaling style={styles.marker}>{expanded ? '−' : '+'}</Text>}
    </Pressable>
    </View>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      style={[styles.contents, !expanded && styles.hidden]}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  heading: { width: '100%', gap: 6 }, kicker: { color: colors.muted, fontSize: 19, lineHeight: 28, flexShrink: 1 },
  section: { width: '100%', gap: 12 }, contents: { width: '100%', gap: 16 }, hidden: { display: 'none' },
  disclosure: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 10, paddingHorizontal: 2,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: 'transparent',
    borderBottomColor: colors.border, borderRadius: 4, backgroundColor: 'transparent' },
  summary: { flexDirection: 'row', alignItems: 'flex-start' }, summaryHeading: { flex: 1, minWidth: 0 },
  compact: { alignSelf: 'flex-end', width: 'auto', flexShrink: 0, minWidth: layout.minimumTouchTarget, paddingHorizontal: 14, borderBottomColor: 'transparent' },
  disclosureLabel: { flex: 1, flexShrink: 1, color: colors.forest, fontSize: 21, lineHeight: 31, fontWeight: '600' },
  marker: { color: colors.forest, fontSize: 24, lineHeight: 32 },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink },
});
