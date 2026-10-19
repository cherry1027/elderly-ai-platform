import { useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { LanguageScreen } from '../screens/LanguageScreen';

export default function LanguageRoute() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  return <LanguageScreen
    language={language}
    onSelectLanguage={setLanguage}
    onContinue={() => router.navigate('/welcome')}
  />;
}
