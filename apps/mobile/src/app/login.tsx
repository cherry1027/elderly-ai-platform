import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { LoginScreen } from '../screens/LoginScreen';
import { useLoginNavigation } from '../navigation/LoginNavigation';

export default function LoginRoute() {
  const router = useRouter();
  const { language, ready } = useLanguage();
  const auth = useAuth();
  const { loginRequested, cancelLogin } = useLoginNavigation();
  const { status, error, signOut } = auth;
  const back = useCallback(() => {
    // Both visible Back and Android hardware Back cancel the same generation.
    if (!loginRequested) { router.replace('/'); return; }
    cancelLogin();
    if (status !== 'signed-out' && error !== 'configuration') void signOut().catch(() => {});
    router.dismissTo('/welcome');
  }, [status, error, signOut, router, loginRequested, cancelLogin]);
  // Route departure clears intent, but ordinary AppState backgrounding does not.
  useFocusEffect(useCallback(() => () => { cancelLogin(); }, [cancelLogin]));
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [back]));
  if (!ready || !auth.appActive || auth.status === 'checking') return <PreferenceLoading language={language} />;
  if (auth.status === 'signed-in' && auth.user) return <Redirect href="/authenticated" />;
  if (!loginRequested) return <Redirect href="/" />;
  return <LoginScreen language={language} busy={auth.status === 'busy'}
    blocked={auth.status === 'blocked' || auth.error === 'configuration'} error={auth.error}
    onSignIn={auth.signIn}
    onRetryCleanup={auth.status === 'blocked' ? () => { void auth.signOut().catch(() => {}); } : undefined}
    onBack={back} />;
}
