import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { LanguageScreen } from '../screens/LanguageScreen';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { useAuth } from '../auth/AuthProvider';
import { hasWelcomeDestination } from '../navigation/entrance';

export default function LanguageRoute() {
  const router = useRouter();
  const { language, setLanguage, ready, completed } = useLanguage();
  const { welcomeAvailable } = useLoginNavigation();
  const auth = useAuth();
  const returning = hasWelcomeDestination(completed, welcomeAvailable, auth) || (auth.status === 'signed-in' && !!auth.user);
  const back = useCallback(() => { router.dismissTo('/welcome'); }, [router]);
  useFocusEffect(useCallback(() => {
    if (!returning) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [back, returning]));
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  return <LanguageScreen language={language} onSelectLanguage={setLanguage}
    onBack={returning ? back : undefined}
    onContinue={() => returning ? router.dismissTo('/welcome')
      : router.navigate({ pathname: '/introduction', params: { scene: '0' } })} />;
}
