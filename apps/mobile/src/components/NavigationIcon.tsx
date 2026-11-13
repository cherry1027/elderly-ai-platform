import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

/** Decorative companion to the destination's existing accessible text label. */
export function NavigationIcon({ name }: { name: 'home' | 'stories' | 'settings' | 'chat' | 'memories' | 'book' }) {
  const paths = {
    home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
    stories: 'M3 4h8v16H3ZM15 4h6v16h-6ZM6 8h2M18 8h1',
    settings: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3',
    chat: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3',
    memories: 'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M16 7h.01',
    book: 'M12 5v16M12 5Q7 2 2 4v16q5-2 10 1 5-3 10-1V4Q17 2 12 5Z',
  };
  return <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false} aria-hidden>
    <Path d={paths[name]} fill="none" stroke={colors.forest} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
