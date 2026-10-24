import { LanguageSelector } from '../components/LanguageSelector';
import { StyleSheet, Text, View } from 'react-native';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import {
  accessibilityLanguages,
  copy,

  type Language,
} from '../i18n';
import { headingFont } from '../theme';
import { introCopy } from '../intro-copy';

interface LanguageScreenProps {
  language: Language;
  onSelectLanguage: (language: Language) => void;
  onContinue: () => void;
  onBack?: () => void;
}



export function LanguageScreen({
  language,
  onSelectLanguage,
  onContinue,
  onBack,
}: LanguageScreenProps) {
  const text = copy[language];

  return (
    <Screen>
      <MemyBrand />
      <View style={screenStyles.section}>
        <Text
          accessibilityRole="header"
          accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling
          style={[screenStyles.heading, styles.heading]}
        >
          {text.languageTitle}
        </Text>
        <Text
          accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling
          style={screenStyles.description}
        >
          {text.languageDescription}
        </Text>
      </View>
      <LanguageSelector language={language} onSelectLanguage={onSelectLanguage} />
      <LargeButton label={text.continue} language={language} onPress={onContinue} />
      {onBack && <LargeButton label={introCopy[language].back} language={language} onPress={onBack} variant="secondary" />}
    </Screen>
  );
}

const styles = StyleSheet.create({ heading: { fontFamily: headingFont } });
