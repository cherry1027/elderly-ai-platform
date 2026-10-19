import { useRouter } from 'expo-router';
import { useLanguage } from '../language';
import { WelcomeScreen } from '../screens/WelcomeScreen';

export default function WelcomeRoute() {
  const router = useRouter();
  const { language } = useLanguage();
  function changeLanguage() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }
  return <WelcomeScreen language={language} onChangeLanguage={changeLanguage} />;
}
