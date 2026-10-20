import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout } from '../theme';

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        alwaysBounceVertical={false}
      >
        <View style={styles.content}>{children}</View>
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
