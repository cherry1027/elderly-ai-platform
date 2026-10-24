import { useCallback, useEffect, useRef, type ComponentRef, type PropsWithChildren, type RefObject } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout } from '../theme';
import { ApiBackoffBanner } from '../api/ApiBackoff';

type ScreenProps = PropsWithChildren<{
  scrollViewRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  onContentLayout?: (event: LayoutChangeEvent) => void;
  working?: boolean;
  keyboardAware?: boolean;
}>;

export function Screen({ children, scrollViewRef, onContentLayout, working = false, keyboardAware = false }: ScreenProps) {
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
  return (
    <SafeAreaView style={styles.safeArea} edges={working ? ['top', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
      <ScrollView
        ref={scroll}
        style={keyboardAware ? styles.keyboardScroll : undefined}
        automaticallyAdjustKeyboardInsets={keyboardAware && Platform.OS === 'ios'}
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
  keyboardScroll: { flex: 1 },
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
