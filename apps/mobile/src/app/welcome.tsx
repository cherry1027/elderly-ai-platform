import { useCallback } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useAuth } from '../auth/AuthProvider';
import { authCopy } from '../auth-copy';
import { useLoginNavigation } from '../navigation/LoginNavigation';

export default function WelcomeRoute() {
  const router = useRouter();
  const { language, ready, completed, storageUnavailable } = useLanguage();
  const auth = useAuth();
  const { requestLogin, cancelLogin, welcomeAvailable } = useLoginNavigation();
  useFocusEffect(useCallback(() => { cancelLogin(); }, [cancelLogin]));
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  if (auth.status === 'signed-in' && auth.user) return <Redirect href="/authenticated" />;
  if (!completed && !welcomeAvailable) return <Redirect href="/language" />;
  const text = authCopy[language];
  return <WelcomeScreen language={language} storageUnavailable={storageUnavailable}
    onLogin={() => {
      if (auth.status !== 'signed-out') return;
      requestLogin();
      router.navigate('/login');
    }}
    cleanup={auth.status === 'blocked' ? {
      message: text.errors.cleanup, retryLabel: text.retryCleanup,
      onRetry: () => { void auth.signOut().catch(() => {}); },
    } : undefined}
    onChangeLanguage={() => router.dismissTo('/language')}
    onReplayIntroduction={() => router.navigate({ pathname: '/introduction', params: { scene: '0' } })} />;
}
