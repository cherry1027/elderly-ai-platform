import { Platform } from 'react-native';

export const colors = {
  cream: '#f7f4eb',
  paper: '#fffdf7',
  forest: '#345b46',
  forestPressed: '#294b39',
  ink: '#342f27',
  muted: '#686354',
  border: '#d4d4c4',
  selected: '#e8eee6',
} as const;

export const layout = {
  minimumTouchTarget: 56,
  contentWidth: 480,
  screenPadding: 24,
  controlRadius: 20,
} as const;

export const headingFont = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});
