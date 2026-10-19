import { useCallback, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { useLanguage } from '../language';
import { IntroductionScreen } from '../screens/IntroductionScreen';
import type { IntroScene } from '../intro-copy';

export default function IntroductionRoute() {
  const { scene: parameter } = useLocalSearchParams<{ scene?: string | string[] }>();
  const scene: IntroScene = parameter === '1' ? 1 : parameter === '2' ? 2 : 0;
  const router = useRouter();
  const { language, ready, completeIntroduction } = useLanguage();
  const finishing = useRef(false);
  const back = useCallback(() => {
    if (finishing.current) return;
    if (scene > 0) router.setParams({ scene: String(scene - 1) });
    else router.dismissTo('/language');
  }, [router, scene]);
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => listener.remove();
  }, [back]));
  function finish() {
    if (finishing.current) return;
    finishing.current = true;
    // Persist in the background; a slow device write must not block Welcome.
    void completeIntroduction();
    router.dismissTo('/welcome');
  }
  if (!ready) return <PreferenceLoading language={language} />;
  return <IntroductionScreen key={scene} language={language} scene={scene}
    onNext={() => { if (!finishing.current && scene < 2) router.setParams({ scene: String(scene + 1) }); }}
    onBack={back} onSkip={finish} onEnter={finish} />;
}
