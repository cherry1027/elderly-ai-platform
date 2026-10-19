import { Redirect } from 'expo-router';
import { useLanguage } from '../language';
import { PreferenceLoading } from '../components/PreferenceLoading';

export default function EntryRoute() {
  const { language, ready, completed } = useLanguage();
  if (!ready) return <PreferenceLoading language={language} />;
  return <Redirect href={completed ? '/welcome' : '/language'} />;
}
