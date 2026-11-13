import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, radius } from '../theme';

/** Decorative, complete cover fallback. No image URL, download, or storage state. */
export function StoryCover({ compact = false }: { compact?: boolean }) {
  return <View testID="memy-story-cover" pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.cover, compact && styles.compact]}>
    <Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" accessible={false}>
      <Rect width="320" height="180" fill={colors.selected} />
      <Path d="M0 120Q80 50 150 160T330 120V190H0Z" fill={colors.sage} />
      <Path d="M235 0Q210 75 320 88V0Z" fill={colors.peach} />
      <Path d="M143 142Q155 97 181 47M158 109Q120 107 128 76Q156 76 158 109M169 83Q194 87 205 59Q177 53 169 83M149 133Q183 132 191 107Q166 99 149 133" fill={colors.forest} />
      <Path d="M143 142Q155 97 181 47" stroke={colors.forest} strokeWidth="3" fill="none" />
    </Svg>
  </View>;
}

/** Stationary organic detail; never covers content or receives focus. */
export function BrandCorner() {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.corner}>
    <Svg width="112" height="76" viewBox="0 0 112 76" accessible={false}>
      <Path d="M12 44Q34 1 100 6L112 0V48Q61 31 12 44Z" fill={colors.peach} />
      <Path d="M112 0Q65 20 74 49Q79 64 112 76Z" fill={colors.sage} />
    </Svg>
  </View>;
}
const styles = StyleSheet.create({
  cover: { width: '100%', height: 80, overflow: 'hidden', borderRadius: radius.card },
  compact: { width: 80, height: 96, borderRadius: radius.small, flexShrink: 0 },
  corner: { alignSelf: 'flex-end', width: 112, height: 76 },
});
