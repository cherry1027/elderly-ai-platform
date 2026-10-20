import { useCallback } from 'react';
import { Redirect, useFocusEffect } from 'expo-router';
import { useLanguage } from '../language';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useAuth } from '../auth/AuthProvider';
import { useLoginNavigation } from '../navigation/LoginNavigation';

export default function EntryRoute() {
  const { language, ready, completed } = useLanguage();
  const auth = useAuth();
  const { cancelLogin, welcomeAvailable } = useLoginNavigation();
  useFocusEffect(useCallback(() => { cancelLogin(); }, [cancelLogin]));
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  if (auth.status === 'signed-in' && auth.user) return <Redirect href="/authenticated" />;
  return <Redirect href={completed || welcomeAvailable ? '/welcome' : '/language'} />;
}
