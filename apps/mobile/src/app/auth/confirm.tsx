import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { useRegistration } from '../../auth/RegistrationProvider';
import { clearConfirmationLink, subscribeConfirmationLink, takeConfirmationLink } from '../../auth/confirmation-link';
import { PreferenceLoading } from '../../components/PreferenceLoading';
import { useLanguage } from '../../language';
import { useLoginNavigation } from '../../navigation/LoginNavigation';
import { ConfirmationScreen } from '../../screens/ConfirmationScreen';

type Status = 'checking' | 'confirmed' | 'invalid' | 'blocked' | 'unavailable';
export default function ConfirmationRoute() {
  const router = useRouter();
  const { language, ready } = useLanguage();
  const auth = useAuth();
  const { confirm, cancel } = useRegistration();
  const { requestLogin, cancelRegistration } = useLoginNavigation();
  const [status, setStatus] = useState<Status>('checking');
  const active = useRef(auth.appActive);
  useEffect(() => { active.current = auth.appActive; }, [auth.appActive]);
  const resume = useRef<() => void>(() => {});
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let busy = false;
    let first = true;
    let confirmed = false;
    const drain = async () => {
      if (busy || !alive || !active.current) return;
      const entry = takeConfirmationLink();
      if (!entry) { if (first) setStatus('invalid'); first = false; return; }
      first = false;
      // Repeated native delivery cannot replace an already verified result.
      if (confirmed) return;
      if (entry.kind !== 'code') { setStatus('invalid'); return; }
      busy = true;
      setStatus('checking');
      try {
        await confirm(entry.code, entry.state);
        confirmed = true;
        if (alive) setStatus('confirmed');
      } catch (error) {
        const kind = error && typeof error === 'object' && 'kind' in error ? error.kind : null;
        if (alive) setStatus(kind === 'unavailable' ? 'unavailable' : kind === 'cleanup' ? 'blocked' : 'invalid');
      } finally { busy = false; if (alive) void drain(); }
    };
    resume.current = () => { void drain(); };
    const unsubscribe = subscribeConfirmationLink(() => { void drain(); });
    void drain();
    return () => { alive = false; unsubscribe(); resume.current = () => {}; };
  }, [ready, confirm]);
  useEffect(() => { if (auth.appActive) resume.current(); }, [auth.appActive]);
  const leave = useCallback((login: boolean) => {
    void cancel().then(() => {
      clearConfirmationLink();
      cancelRegistration();
      if (login && auth.status === 'signed-out') { requestLogin(); router.replace('/login'); }
      else router.replace('/');
    }).catch(() => setStatus('blocked'));
  }, [cancel, cancelRegistration, requestLogin, auth.status, router]);
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(false); return true; });
    return () => listener.remove();
  }, [leave]));
  if (!ready || !auth.appActive) return <PreferenceLoading language={language} />;
  return <ConfirmationScreen language={language} status={status} onWelcome={() => leave(false)}
    onLogin={status === 'confirmed' && auth.status === 'signed-out' ? () => leave(true) : undefined} />;
}
