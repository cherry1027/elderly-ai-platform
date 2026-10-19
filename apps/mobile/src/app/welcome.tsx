import { useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { PreferenceLoading } from '../components/PreferenceLoading';

export default function WelcomeRoute() {
  const router = useRouter();
  const { language, ready, storageUnavailable } = useLanguage();
  if (!ready) return <PreferenceLoading language={language} />;
  return <WelcomeScreen language={language} storageUnavailable={storageUnavailable}
    onChangeLanguage={() => router.dismissTo('/language')}
    onReplayIntroduction={() => router.navigate({ pathname: '/introduction', params: { scene: '0' } })} />;
}
