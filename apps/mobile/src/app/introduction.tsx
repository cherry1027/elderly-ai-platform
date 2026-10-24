import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { IntroductionScreen } from '../screens/IntroductionScreen';
import type { IntroScene } from '../intro-copy';
import { useLoginNavigation } from '../navigation/LoginNavigation';
import { useAuth } from '../auth/AuthProvider';
import { hasWelcomeDestination } from '../navigation/entrance';
import { finishIntroductionReplay, isIntroductionReplayCurrent, readIntroductionReplay, type IntroductionReplayTicket } from '../navigation/IntroductionReplay';

export default function IntroductionRoute() {
  const { scene: parameter } = useLocalSearchParams<{ scene?: string | string[] }>();
  const scene: IntroScene = parameter === '1' ? 1 : parameter === '2' ? 2 : 0;
  const router = useRouter();
  const { language, ready, completeIntroduction, completed } = useLanguage();
  const { welcomeAvailable } = useLoginNavigation();
  const auth = useAuth();
  const currentAuth = useRef(auth);
  useLayoutEffect(() => { currentAuth.current = auth; }, [auth]);
  const replay = readIntroductionReplay(auth);
  const [replayTicket, setReplayTicket] = useState<IntroductionReplayTicket | null>(() => replay);
  // Capture a delayed verified intent once; never replace an earlier owner's ticket.
  if (replayTicket === null && replay !== null) setReplayTicket(replay);
  const returning = hasWelcomeDestination(completed, welcomeAvailable, auth) || (auth.status === 'signed-in' && !!auth.user);
  const finishing = useRef(false);
  const [returningToSettings, setReturningToSettings] = useState(false);
  const focused = useRef(false);
  const [invalidated, setInvalidated] = useState(false);
  const currentReplay = useCallback(() => {
    if (!focused.current || !currentAuth.current.appActive ||
      currentAuth.current.status === 'checking' || currentAuth.current.status === 'busy') return false;
    if (!replayTicket) return readIntroductionReplay(currentAuth.current) === null;
    if (isIntroductionReplayCurrent(replayTicket, currentAuth.current)) return true;
    // A finite replay can expire while the scene is idle. Its next deliberate
    // action returns through the verified entrance, never leaving inert controls.
    setInvalidated(true);
    return false;
  }, [replayTicket]);
  const returnToSettings = useCallback(() => {
    const ticket = replayTicket;
    if (!currentReplay() || !ticket || !finishIntroductionReplay(ticket, currentAuth.current)) return;
    finishing.current = true;
    setReturningToSettings(true);
    router.dismissTo('/authenticated');
  }, [router, currentReplay, replayTicket]);
  const back = useCallback(() => {
    if (finishing.current || !currentReplay()) return;
    if (scene > 0) router.setParams({ scene: String(scene - 1) });
    else if (replayTicket) returnToSettings();
    else router.dismissTo(returning ? '/welcome' : '/language');
  }, [router, scene, returning, returnToSettings, currentReplay, replayTicket]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => { focused.current = false; listener.remove(); };
  }, [back]));
  function finish() {
    if (finishing.current || !currentReplay()) return;
    if (replayTicket) { returnToSettings(); return; }
    finishing.current = true;
    // Public first-run completion is unchanged; authenticated Replay writes no preference.
    void completeIntroduction();
    router.dismissTo('/welcome');
  }
  if (!ready || !auth.appActive || auth.status === 'checking' || auth.status === 'busy') return <PreferenceLoading language={language} />;
  if (invalidated || (replayTicket && !replay && !returningToSettings)) return <Redirect href="/" />;
  return <IntroductionScreen key={scene} language={language} scene={scene}
    onNext={() => {
      if (!currentReplay()) return;
      if (!finishing.current && scene < 2) router.setParams({ scene: String(scene + 1) });
    }}
    onBack={back} onSkip={finish} onEnter={finish} />;
}
