import { useCallback, useEffect } from 'react';
import { Redirect, useFocusEffect } from 'expo-router';
import { useLanguage } from '../language';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useAuth } from '../auth/AuthProvider';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { hasWelcomeDestination } from '../navigation/entrance';

export default function EntryRoute() {
  const { language, ready, completed } = useLanguage();
  const auth = useAuth();
  const { cancelLogin, cancelRegistration, welcomeAvailable, rememberWelcomeVisit } = useLoginNavigation();
  useFocusEffect(useCallback(() => { cancelLogin(); cancelRegistration(); }, [cancelLogin, cancelRegistration]));
  const recovering = auth.status === 'blocked' || (auth.status === 'signed-out' && auth.error === 'session');
  useEffect(() => {
    if (ready && auth.appActive && recovering) rememberWelcomeVisit();
  }, [ready, auth.appActive, recovering, rememberWelcomeVisit]);
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  if (auth.status === 'signed-in' && auth.user) return <Redirect href="/authenticated" />;
  return <Redirect href={hasWelcomeDestination(completed, welcomeAvailable, auth) ? '/welcome' : '/language'} />;
}
