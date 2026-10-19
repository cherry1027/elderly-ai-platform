import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import {
  accessibilityLanguages,
  copy,
  languageNames,
  type Language,
} from '../i18n';
import { colors, headingFont, layout } from '../theme';

interface LanguageScreenProps {
  language: Language;
  onSelectLanguage: (language: Language) => void;
  onContinue: () => void;
}

const languages: Language[] = ['sv', 'en'];

export function LanguageScreen({
  language,
  onSelectLanguage,
  onContinue,
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
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={text.languageGroup}
        style={styles.languageGroup}
      >
        {languages.map((option) => (
          <LanguageOption
            key={option}
            language={option}
            selected={language === option}
            selectedLabel={text.selected}
            onPress={() => onSelectLanguage(option)}
          />
        ))}
      </View>
      <LargeButton label={text.continue} language={language} onPress={onContinue} />
    </Screen>
  );
}

interface LanguageOptionProps {
  language: Language;
  selected: boolean;
  selectedLabel: string;
  onPress: () => void;
}

function LanguageOption({
  language,
  selected,
  selectedLabel,
  onPress,
}: LanguageOptionProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={languageNames[language]}
      accessibilityLanguage={accessibilityLanguages[language]}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
        focused && styles.optionFocused,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.radio, selected && styles.radioSelected]}
      >
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={styles.optionCopy}>
        <Text allowFontScaling style={styles.optionLabel}>
          {languageNames[language]}
        </Text>
        {selected && (
          <Text allowFontScaling style={styles.selectedLabel}>
            {selectedLabel}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: headingFont,
  },
  languageGroup: {
    width: '100%',
    gap: 16,
  },
  option: {
    width: '100%',
    minHeight: layout.minimumTouchTarget,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: layout.controlRadius,
    paddingVertical: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  optionSelected: {
    borderColor: colors.forest,
    backgroundColor: colors.selected,
  },
  optionPressed: {
    backgroundColor: colors.selected,
  },
  optionFocused: {
    borderColor: colors.ink,
  },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.forest,
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.forest,
  },
  optionCopy: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '600',
    flexShrink: 1,
  },
  selectedLabel: {
    color: colors.forest,
    fontSize: 18,
    lineHeight: 27,
    flexShrink: 1,
  },
});
