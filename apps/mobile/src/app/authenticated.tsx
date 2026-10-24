import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { StoriesHome } from '../stories/StoriesHome';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { useEntranceRoot } from '../navigation/entrance';
import { createIntroductionReplaySource } from '../navigation/IntroductionReplay';

export default function AuthenticatedRoute() {
  const router = useRouter();
  const auth = useAuth();
  const { cancelLogin, rememberAuthenticatedVisit } = useLoginNavigation();
  const { language, ready, setLanguage } = useLanguage();
  const [ending, setEnding] = useState(false);
  const endingRef = useRef(false);
  const authRef = useRef(auth);
  const [replay] = useState(createIntroductionReplaySource);
  useLayoutEffect(() => { authRef.current = auth; replay.sync(auth); }, [auth, replay]);
  useEffect(() => {
    replay.sync(authRef.current);
    return () => replay.dispose();
  }, [replay]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const verifiedAccountId = auth.status === 'signed-in' ? auth.user?.id : undefined;
  const consumeReplayReturn = useCallback(() => !endingRef.current && !!verifiedAccountId &&
    authRef.current.user?.id === verifiedAccountId && replay.consumeReturn(authRef.current), [replay, verifiedAccountId]);
  const requestReplay = useCallback(() => {
    if (!mounted.current || endingRef.current || !verifiedAccountId || authRef.current.user?.id !== verifiedAccountId ||
      !replay.begin(authRef.current)) return false;
    router.navigate({ pathname: '/introduction', params: { scene: '0' } });
    return true;
  }, [replay, router, verifiedAccountId]);
  useEffect(() => {
    if (verifiedAccountId) rememberAuthenticatedVisit();
  }, [verifiedAccountId, rememberAuthenticatedVisit]);
  useFocusEffect(useCallback(() => { cancelLogin(); }, [cancelLogin]));
  useEntranceRoot(ready && auth.appActive && !ending && auth.status === 'signed-in' && !!auth.user, 'authenticated');
  if (!ready || !auth.appActive || ending || ['checking', 'busy'].includes(auth.status)) {
    return <PreferenceLoading language={language} />;
  }
  if (auth.status !== 'signed-in' || !auth.user) return <Redirect href="/" />;
  const owner = auth.user.id;
  return <StoriesHome key={owner} language={language} user={auth.user} getAccessToken={auth.getAccessToken}
    initialRootTab={replay.hasReturn(auth) ? 'settings' : 'home'} consumeReplayReturn={consumeReplayReturn}
    onSelectLanguage={setLanguage} onReplayIntroduction={requestReplay} onSignOut={() => {
    if (endingRef.current || !mounted.current || authRef.current.user?.id !== owner) return;
    endingRef.current = true;
    replay.dispose();
    rememberAuthenticatedVisit();
    cancelLogin();
    setEnding(true);
    void auth.signOut().then(() => {
      if (mounted.current) router.dismissTo('/welcome');
    }).catch(() => {
      // Private content has already gone. The entrance shows cleanup failure
      // and retry on Welcome, without opening Login automatically.
      if (mounted.current) { endingRef.current = false; setEnding(false); }
    });
  }} />;
}
