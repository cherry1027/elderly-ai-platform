import { StyleSheet, Text, View } from 'react-native';
import { AccountAction, AccountHeading, AccountNotice, AccountScreen } from '../components/AccountPresentation';
import { MemoryBookArtwork } from '../components/BrandArtwork';
import { screenStyles } from '../components/Screen';
import { entranceCopy } from '../entrance-copy';
import { accessibilityLanguages, copy, type Language } from '../i18n';
import { introCopy } from '../intro-copy';

interface WelcomeScreenProps {
  language: Language;
  onChangeLanguage: () => void;
  onLogin?: () => void;
  onRegister?: () => void;
  onReplayIntroduction?: () => void;
  storageUnavailable?: boolean;
  cleanup?: { message: string; retryLabel: string; onRetry: () => void };
  primaryAction?: { label: string; onPress: () => void };
}

export function WelcomeScreen({
  language, onChangeLanguage, onLogin, onRegister, onReplayIntroduction, storageUnavailable = false, cleanup, primaryAction,
}: WelcomeScreenProps) {
  const text = copy[language];
  const intro = introCopy[language];
  const entrance = entranceCopy[language];

  return (
    <AccountScreen compact>
      <AccountHeading language={language} title={text.welcomeTitle} description={text.welcomeDescription} />
      <View style={styles.controls}>
        {cleanup && <>
          <AccountNotice language={language} message={cleanup.message} />
          <AccountAction label={cleanup.retryLabel} language={language} onPress={cleanup.onRetry} secondary />
        </>}
        {primaryAction && <AccountAction label={primaryAction.label} language={language} onPress={primaryAction.onPress} secondary={Boolean(onLogin && !cleanup)} />}
        {onLogin && !cleanup && <AccountAction label={intro.login} language={language} onPress={onLogin} />}
      </View>
      <View style={styles.artwork}><MemoryBookArtwork /></View>
      {onRegister && !cleanup && <AccountAction label={entrance.previewRegistration} language={language} onPress={onRegister} secondary />}
      <View style={styles.controls}>
        <AccountAction label={text.changeLanguage} language={language} onPress={onChangeLanguage} quiet />
        {onReplayIntroduction && <AccountAction label={intro.replay} language={language} onPress={onReplayIntroduction} quiet />}
      </View>
      <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={screenStyles.footer}>
        {onLogin || onRegister ? entrance.availability : intro.unavailable}
      </Text>
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
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  controls: { width: '100%', gap: 8 },
  artwork: { width: '100%', maxWidth: 184, alignSelf: 'center' },
});
