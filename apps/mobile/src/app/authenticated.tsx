import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { StoriesHome } from '../stories/StoriesHome';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { useEntranceRoot } from '../navigation/entrance';

export default function AuthenticatedRoute() {
  const router = useRouter();
  const auth = useAuth();
  const { cancelLogin, rememberAuthenticatedVisit } = useLoginNavigation();
  const { language, ready } = useLanguage();
  const [ending, setEnding] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const verifiedAccountId = auth.status === 'signed-in' ? auth.user?.id : undefined;
  useEffect(() => {
    if (verifiedAccountId) rememberAuthenticatedVisit();
  }, [verifiedAccountId, rememberAuthenticatedVisit]);
  useFocusEffect(useCallback(() => { cancelLogin(); }, [cancelLogin]));
  useEntranceRoot(ready && auth.appActive && !ending && auth.status === 'signed-in' && !!auth.user, 'authenticated');
  if (!ready || !auth.appActive || ending || ['checking', 'busy'].includes(auth.status)) {
    return <PreferenceLoading language={language} />;
  }
  if (auth.status !== 'signed-in' || !auth.user) return <Redirect href="/" />;
  return <StoriesHome key={auth.user.id} language={language} user={auth.user} getAccessToken={auth.getAccessToken} onSignOut={() => {
    if (ending) return;
    rememberAuthenticatedVisit();
    cancelLogin();
    setEnding(true);
    void auth.signOut().then(() => {
      if (mounted.current) router.dismissTo('/welcome');
    }).catch(() => {
      // Private content has already gone. The entrance shows cleanup failure
      // and retry on Welcome, without opening Login automatically.
      if (mounted.current) setEnding(false);
    });
  }} />;
}
