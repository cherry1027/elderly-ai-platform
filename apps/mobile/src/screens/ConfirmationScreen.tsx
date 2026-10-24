import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { MemoryBookArtwork } from '../components/BrandArtwork';
import { AccountAction, AccountHeading, AccountScreen, accountStyles } from '../components/AccountPresentation';
import { accessibilityLanguages, type Language } from '../i18n';
import { registrationCopy } from '../registration-copy';

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
    if (Platform.OS === 'ios') {
      try { AccessibilityInfo.announceForAccessibility(message); } catch { /* Text remains available. */ }
    }
  }, [status, message]);
  const alert = status === 'invalid' || status === 'blocked';
  return <AccountScreen>
    <AccountHeading language={language} title={text.confirmationTitle} />
    <View style={accountStyles.form}>
      <Text accessibilityRole={alert ? 'alert' : 'text'} accessibilityLiveRegion={alert ? 'assertive' : 'polite'}
        accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.notice}>{message}</Text>
      {onLogin && status !== 'checking' && status !== 'blocked' &&
        <AccountAction label={text.login} language={language} onPress={onLogin} />}
      <AccountAction label={text.back} language={language} secondary onPress={onWelcome} />
    </View>
    <View style={styles.artwork}><MemoryBookArtwork /></View>
  </AccountScreen>;
}

const styles = StyleSheet.create({ artwork: { width: '100%', maxWidth: 160, alignSelf: 'center' } });
