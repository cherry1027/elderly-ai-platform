import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MemoryBookArtwork, MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, copy, type Language } from '../i18n';
import { introCopy } from '../intro-copy';
import { colors, headingFont, layout } from '../theme';

interface WelcomeScreenProps {
  language: Language;
  onChangeLanguage: () => void;
  onLogin?: () => void;
  onReplayIntroduction?: () => void;
  storageUnavailable?: boolean;
  cleanup?: { message: string; retryLabel: string; onRetry: () => void };
}

export function WelcomeScreen({
  language, onChangeLanguage, onLogin, onReplayIntroduction, storageUnavailable = false, cleanup,
}: WelcomeScreenProps) {
  const text = copy[language];
  const intro = introCopy[language];

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
      <View style={styles.controls}>
        <Text
          allowFontScaling
          accessibilityLanguage={accessibilityLanguages[language]}
          style={screenStyles.footer}
        >
          {onLogin ? (language === 'sv' ? 'Nya konton och gäståtkomst är inte tillgängliga ännu.'
            : 'Account creation and guest access are not available yet.') : intro.unavailable}
        </Text>
        {cleanup && <>
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
            accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.description}>
            {cleanup.message}
          </Text>
          <LargeButton label={cleanup.retryLabel} language={language} onPress={cleanup.onRetry} variant="secondary" />
        </>}
        {onLogin && !cleanup && <LargeButton label={intro.login} language={language} onPress={onLogin} />}
        {(onLogin && !cleanup ? [intro.register, intro.guest] : [intro.login, intro.register, intro.guest]).map((label) => (
          <Pressable
            key={label}
            disabled
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: true }}
            accessibilityLanguage={accessibilityLanguages[language]}
            style={styles.unavailableAction}
          >
            <Text allowFontScaling style={styles.unavailableLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {onReplayIntroduction && (
        <LargeButton
          label={intro.replay}
          language={language}
          onPress={onReplayIntroduction}
          variant="secondary"
        />
      )}
      <LargeButton
        label={text.changeLanguage}
        language={language}
        onPress={onChangeLanguage}
        variant="secondary"
      />
      {storageUnavailable && (
        <Text
          allowFontScaling
          accessibilityLanguage={accessibilityLanguages[language]}
          accessibilityLiveRegion="polite"
          style={screenStyles.footer}
        >
          {intro.storageNote}
        </Text>
      )}
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
  controls: { width: '100%', gap: 16 },
  unavailableAction: {
    width: '100%',
    minHeight: layout.minimumTouchTarget,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    borderRadius: layout.controlRadius,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableLabel: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 32,
    textAlign: 'center',
    flexShrink: 1,
  },
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
