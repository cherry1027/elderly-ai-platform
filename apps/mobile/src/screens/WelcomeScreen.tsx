import { StyleSheet, Text, View } from 'react-native';
import { MemoryBookArtwork, MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, copy, type Language } from '../i18n';
import { colors, headingFont } from '../theme';

interface WelcomeScreenProps {
  language: Language;
  onChangeLanguage: () => void;
}

export function WelcomeScreen({ language, onChangeLanguage }: WelcomeScreenProps) {
  const text = copy[language];

  return (
    <Screen>
      <MemyBrand />
      <View style={screenStyles.section}>
        <Text
          accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling
          style={styles.eyebrow}
        >
          {text.welcomeEyebrow}
        </Text>
        <Text
          accessibilityRole="header"
          accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling
          style={[screenStyles.heading, styles.heading]}
        >
          {text.welcomeTitle}
        </Text>
        <Text
          accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling
          style={screenStyles.description}
        >
          {text.welcomeDescription}
        </Text>
      </View>
      <MemoryBookArtwork />
      <LargeButton
        label={text.changeLanguage}
        language={language}
        onPress={onChangeLanguage}
      />
      <Text
        accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling
        style={screenStyles.footer}
      >
        {text.footer}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: headingFont,
  },
  eyebrow: {
    color: colors.forest,
    fontSize: 19,
    lineHeight: 29,
    textAlign: 'center',
    flexShrink: 1,
  },
});
