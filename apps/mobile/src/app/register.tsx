import { useCallback, useState } from 'react';
import { BackHandler } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { useRegistration } from '../auth/RegistrationProvider';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { RegistrationScreen } from '../screens/RegistrationScreen';

export default function RegistrationRoute() {
  const router = useRouter();
  const { language, ready } = useLanguage();
  const auth = useAuth();
  const registration = useRegistration();
  const { registrationRequested, cancelRegistration, requestLogin } = useLoginNavigation();
  const { cancel } = registration;
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const leave = useCallback((login: boolean) => {
    // Never sign out a main account when leaving registration. Failed temporary
    // cleanup stays on this route and prevents navigation to ordinary login.
    void cancel().then(() => {
      cancelRegistration();
      if (login) { requestLogin(); router.replace('/login'); }
      else router.dismissTo('/welcome');
    }).catch(() => setCleanupFailed(true));
  }, [cancel, cancelRegistration, requestLogin, router]);
  // Callback navigation must preserve its pending PKCE verifier. Only an
  // explicit Back/Login action cancels temporary registration material.
  useFocusEffect(useCallback(() => () => { cancelRegistration(); }, [cancelRegistration]));
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(false); return true; });
    return () => listener.remove();
  }, [leave]));
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  if (auth.status === 'signed-in' && auth.user) return <Redirect href="/authenticated" />;
  if (!registrationRequested || auth.status === 'blocked') return <Redirect href="/" />;
  return <RegistrationScreen language={language} enabled={registration.enabled}
    pending={registration.status === 'sending' || registration.status === 'confirming'}
    sent={registration.status === 'check-email'}
    externalFailure={cleanupFailed || registration.status === 'blocked' ? 'cleanup' : undefined}
    onSubmit={registration.signUp} onBack={() => leave(false)} onLogin={() => leave(true)} />;
}
