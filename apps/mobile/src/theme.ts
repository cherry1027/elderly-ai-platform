import { Platform } from 'react-native';

export const colors = {
  cream: '#FAF4EC',
  paper: '#FFFCF7',
  forest: '#123F31',
  forestPressed: '#0B3025',
  ink: '#202F29',
  muted: '#5F685F',
  border: '#DED4C6',
  selected: '#E5EDE2',
  sage: '#A6B99C',
  peach: '#F7D1BB',
  coral: '#EF9278',
  danger: '#8A302E',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { small: 12, card: 24, pill: 32 } as const;
export const typography = { title: 36, titleLine: 46, body: 21, bodyLine: 33 } as const;

export const layout = {
  minimumTouchTarget: 56,
  contentWidth: 640,
  screenPadding: 24,
  controlRadius: 28,
} as const;

export const headingFont = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});
