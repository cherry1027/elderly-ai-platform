import { Text } from 'react-native';
import { Screen, screenStyles } from './Screen';
import { MemyBrand } from './BrandArtwork';
import { accessibilityLanguages, type Language } from '../i18n';

export function PreferenceLoading({ language }: { language: Language }) {
  return <Screen><MemyBrand />
    <Text allowFontScaling accessibilityLiveRegion="polite"
      accessibilityLanguage={accessibilityLanguages[language]} style={screenStyles.description}>
      {language === 'sv' ? 'Öppnar Memy…' : 'Opening Memy…'}
    </Text>
  </Screen>;
}
