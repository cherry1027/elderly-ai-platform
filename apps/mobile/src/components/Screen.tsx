import { useCallback, useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type ReactNode, type RefObject } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout } from '../theme';
import { ApiBackoffBanner } from '../api/ApiBackoff';
import { accessibilityLanguages, type Language } from '../i18n';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';

type ScreenProps = PropsWithChildren<{
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  onContentLayout?: (event: LayoutChangeEvent) => void;
  working?: boolean;
  keyboardAware?: boolean;
  back?: { language: Language; label: string; onPress: () => void };
  bottomControls?: ReactNode;
  bottomKeyboardAware?: boolean;
}>;

/** Presentation only: the owning screen supplies its existing safe leave action. */
export function ScreenBackControl({ language, label, onPress }: NonNullable<ScreenProps['back']>) {
  const [backFocused, setBackFocused] = useState(false);
  return <View testID="story-top-navigation" style={styles.topNavigation}>
    <View style={styles.fixedContent}>
      <Pressable testID="story-top-back" accessibilityRole="button"
        accessibilityLabel={`${language === 'sv' ? 'Gå tillbaka' : 'Go back'}: ${label}`}
        accessibilityLanguage={accessibilityLanguages[language]} onPress={onPress}
        onFocus={() => setBackFocused(true)} onBlur={() => setBackFocused(false)}
        style={({ pressed }) => [styles.backButton, pressed && styles.backPressed, backFocused && styles.backFocused]}>
        <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          allowFontScaling style={styles.backArrow}>‹</Text>
        <Text allowFontScaling style={styles.backLabel}>{language === 'sv' ? 'Tillbaka' : 'Back'}</Text>
      </Pressable>
    </View>
  </View>;
}

export function Screen({ children, scrollViewRef, onContentLayout, working = false, keyboardAware = false, back, bottomControls, bottomKeyboardAware = false }: ScreenProps) {
  const edgeSwipe = useEdgeSwipeBack(back?.onPress);
  const internalScrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  const scroll = scrollViewRef ?? internalScrollView;
  const focusedTarget = useRef<number | null>(null);
  const revealFocus = useCallback(() => {
    if (!keyboardAware || !Keyboard.isVisible() || focusedTarget.current === null) return;
    scroll.current?.scrollResponderScrollNativeHandleToKeyboard?.(focusedTarget.current, 16, true);
  }, [keyboardAware, scroll]);
  useEffect(() => {
    if (!keyboardAware) return;
    let active = true;
    const shown = Keyboard.addListener('keyboardDidShow', () => { if (active) revealFocus(); });
    return () => { active = false; focusedTarget.current = null; shown.remove(); };
  }, [keyboardAware, revealFocus]);
  const body = <>
      <ScrollView
        ref={scroll}
        testID={back || bottomControls ? 'story-content-scroll' : undefined}
        style={back || bottomControls ? styles.boundedScroll : keyboardAware ? styles.keyboardScroll : undefined}
        automaticallyAdjustKeyboardInsets={keyboardAware && Platform.OS === 'ios' && !(bottomControls && bottomKeyboardAware)}
        contentInsetAdjustmentBehavior={keyboardAware ? 'never' : undefined}
        keyboardDismissMode={keyboardAware ? Platform.OS === 'ios' ? 'interactive' : 'on-drag' : undefined}
        onFocus={keyboardAware ? event => {
          focusedTarget.current = typeof event.nativeEvent.target === 'number' ? event.nativeEvent.target : null;
          revealFocus();
        } : undefined}
        onBlur={keyboardAware ? () => { focusedTarget.current = null; } : undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        alwaysBounceVertical={false}
      >
        <View style={[styles.content, working && styles.workingContent]} onLayout={onContentLayout}><ApiBackoffBanner />{children}</View>
      </ScrollView>
      {bottomControls && <ScrollView testID="story-bottom-controls" style={styles.bottomControls}
        contentContainerStyle={styles.bottomControlsContent} keyboardShouldPersistTaps="handled" alwaysBounceVertical={false}>
        <View style={styles.fixedContent}>{bottomControls}</View>
      </ScrollView>}
    </>;
  return (
    <SafeAreaView {...edgeSwipe} testID={back ? 'story-gesture-surface' : undefined}
      style={styles.safeArea} edges={working ? ['top', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
      {back && <ScreenBackControl {...back} />}
      {bottomControls && bottomKeyboardAware ? <KeyboardAvoidingView testID="story-keyboard-area" style={styles.keyboardScroll}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{body}</KeyboardAvoidingView> : body}
    </SafeAreaView>
  );
}

export const screenStyles = StyleSheet.create({
  section: {
    width: '100%',
    gap: 16,
    alignItems: 'center',
  },
  heading: {
    color: colors.ink,
    fontSize: 36,
    lineHeight: 46,
    textAlign: 'center',
    flexShrink: 1,
  },
  description: {
    color: colors.muted,
    fontSize: 21,
    lineHeight: 32,
    textAlign: 'center',
    flexShrink: 1,
  },
  footer: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
    flexShrink: 1,
  },
});

const styles = StyleSheet.create({
  keyboardScroll: { flex: 1 }, boundedScroll: { flex: 1, minHeight: 0 },
  topNavigation: { paddingHorizontal: layout.screenPadding, paddingVertical: 8, flexShrink: 0 },
  fixedContent: { width: '100%', maxWidth: layout.contentWidth, alignSelf: 'center' },
  backButton: { alignSelf: 'flex-start', maxWidth: '100%', minWidth: layout.minimumTouchTarget,
    minHeight: layout.minimumTouchTarget, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row',
    alignItems: 'center', gap: 8, borderWidth: 2, borderColor: 'transparent', borderRadius: 12, backgroundColor: 'transparent' },
  backArrow: { color: colors.forest, fontSize: 30, lineHeight: 34 },
  backLabel: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  backPressed: { backgroundColor: colors.selected }, backFocused: { borderColor: colors.ink },
  // Separate, bounded scrolling keeps long consent text reachable at large text
  // sizes without covering the history or letting it push the microphone away.
  bottomControls: { flexGrow: 0, flexShrink: 1, maxHeight: '50%' },
  bottomControlsContent: { paddingHorizontal: layout.screenPadding, paddingVertical: 12 },
  workingContent: { justifyContent: 'flex-start', alignItems: 'stretch', gap: 24 },
  safeArea: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    padding: layout.screenPadding,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.contentWidth,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
  },
});
