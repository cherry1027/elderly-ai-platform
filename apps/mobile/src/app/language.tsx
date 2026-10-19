import { useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { LanguageScreen } from '../screens/LanguageScreen';
import { PreferenceLoading } from '../components/PreferenceLoading';

export default function LanguageRoute() {
  const router = useRouter();
  const { language, setLanguage, ready, completed } = useLanguage();
  if (!ready) return <PreferenceLoading language={language} />;
  return <LanguageScreen language={language} onSelectLanguage={setLanguage}
    onContinue={() => completed ? router.navigate('/welcome')
      : router.navigate({ pathname: '/introduction', params: { scene: '0' } })} />;
}
