import { useEffect, useRef, type PropsWithChildren } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { RootTabBar } from '../components/RootTabBar';
import { accessibilityLanguages, type Language } from '../i18n';
import type { RootTab } from '../root-navigation-copy';
import { colors, headingFont } from '../theme';

interface Props extends PropsWithChildren {
  language: Language; tab: RootTab; onSelectTab: (tab: RootTab) => void;
}
/** Presentation only: original providers and private coordinator remain outside. */
export function AuthenticatedShell({ language, tab, onSelectTab, children }: Props) {
  return <View style={styles.root}>
    <View style={styles.content}>{children}</View>
    <RootTabBar language={language} tab={tab} onSelectTab={onSelectTab} />
  </View>;
}

/** Same once-on-entry native focus pattern as the approved introduction. */
export function RootScreenHeading({ language, title, centered = false }: {
  language: Language; title: string; centered?: boolean;
}) {
  const heading = useRef<Text>(null), laidOut = useRef(false);
  const requestFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    let active = true, readerEnabled = false, requested = false;
    let frame: number | undefined;
    const focus = () => {
      if (!active || !readerEnabled || !laidOut.current || requested) return;
      requested = true;
      frame = requestAnimationFrame(() => {
        if (!active || !heading.current) return;
        try { AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus'); }
        catch { /* Native focus is best effort; all controls remain available. */ }
      });
    };
    requestFocus.current = focus;
    void (async () => {
      try { readerEnabled = await AccessibilityInfo.isScreenReaderEnabled(); focus(); }
      catch { /* A missing native query must not interrupt navigation. */ }
    })();
    return () => { active = false; requestFocus.current = undefined; if (frame !== undefined) cancelAnimationFrame(frame); };
  }, []);
  return <Text ref={heading} accessible accessibilityRole="header"
    accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
    onLayout={() => { laidOut.current = true; requestFocus.current?.(); }}
    style={[styles.heading, centered && styles.centered]}>{title}</Text>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream }, content: { flex: 1 },
  heading: { color: colors.ink, fontFamily: headingFont, fontSize: 34, lineHeight: 44,
    flexShrink: 1, textAlign: 'left' }, centered: { textAlign: 'center' },
});
