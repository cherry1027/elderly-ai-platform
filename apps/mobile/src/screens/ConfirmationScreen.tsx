import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { MemoryBookArtwork, MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { registrationCopy } from '../registration-copy';
import { headingFont } from '../theme';

export type ConfirmationStatus = 'checking' | 'confirmed' | 'invalid' | 'blocked' | 'unavailable';
interface ConfirmationScreenProps {
  language: Language;
  status: ConfirmationStatus;
  onWelcome: () => void;
  onLogin?: () => void;
}

export function ConfirmationScreen({ language, status, onWelcome, onLogin }: ConfirmationScreenProps) {
  const text = registrationCopy[language];
  const messages = {
    checking: text.confirmationChecking, confirmed: text.confirmationConfirmed,
    invalid: text.confirmationInvalid, blocked: text.confirmationBlocked, unavailable: text.confirmationUnavailable,
  };
  const previousStatus = useRef(status);
  const message = messages[status];
  useEffect(() => {
    if (previousStatus.current === status) return;
    previousStatus.current = status;
    // Native iOS does not support accessibilityLiveRegion. Announce a completed
    // state change without stealing focus or reading any callback credentials.
    try { AccessibilityInfo.announceForAccessibility(message); } catch { /* Text remains available. */ }
  }, [status, message]);
  const alert = status === 'invalid' || status === 'blocked';
  return <Screen>
    <MemyBrand />
    <View style={screenStyles.section}>
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.confirmationTitle}</Text>
      <Text accessibilityRole={alert ? 'alert' : 'text'} accessibilityLiveRegion={alert ? 'assertive' : 'polite'}
        accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.description}>{message}</Text>
    </View>
    <MemoryBookArtwork />
    {onLogin && status !== 'checking' && status !== 'blocked' &&
      <LargeButton label={text.login} language={language} onPress={onLogin} />}
    <LargeButton label={text.back} language={language} variant="secondary" onPress={onWelcome} />
  </Screen>;
}

const styles = StyleSheet.create({ heading: { fontFamily: headingFont } });
