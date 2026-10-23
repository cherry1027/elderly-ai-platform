import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  useSyncExternalStore, type PropsWithChildren } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useLanguage } from '../language';
import { accessibilityLanguages } from '../i18n';
import { colors, layout } from '../theme';
import { readMobileApiConfig } from './config';
import { apiBackoff, MAX_RETRY_SECONDS, type RetryAdvice } from './backoff';

export interface ApiBackoffValue {
  waiting: boolean; advice?: RetryAdvice; expired: boolean; visible: boolean; language: 'en' | 'sv';
}
const Context = createContext<ApiBackoffValue>({ waiting: false, expired: false, visible: false, language: 'en' });
export function useApiBackoff(): ApiBackoffValue { return useContext(Context); }

/** Remains mounted above private views during foreground revalidation. */
export function ApiBackoffProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const { language } = useLanguage();
  const [origin] = useState(() => readMobileApiConfig()?.baseUrl ?? null);
  const lastAnnouncement = useRef<string | undefined>(undefined);
  const activeOwner = useRef<string | null>(null);
  const revision = useSyncExternalStore(apiBackoff.subscribe, apiBackoff.getRevision, apiBackoff.getRevision);
  useLayoutEffect(() => {
    if (auth.status === 'signed-in' && auth.user) {
      if (activeOwner.current !== auth.user.id) {
        activeOwner.current = auth.user.id; lastAnnouncement.current = undefined;
      }
      apiBackoff.activate(auth.user.id);
    }
    else if (['signed-out', 'blocked', 'busy'].includes(auth.status)) {
      apiBackoff.clear(); activeOwner.current = null; lastAnnouncement.current = undefined;
    }
    // Checking and background hide content, not the admission deadline.
  }, [auth.status, auth.user]);
  useEffect(() => () => apiBackoff.clear(), []);
  const advice = origin ? apiBackoff.getAdvice(origin) : undefined;
  const expired = origin ? apiBackoff.isExpired(origin) : false;
  const visible = auth.status === 'signed-in' && !!auth.user && auth.appActive;
  useEffect(() => {
    if (!advice) return;
    const timer = setTimeout(() => apiBackoff.refresh(),
      Math.min(MAX_RETRY_SECONDS * 1000, Math.max(1, advice.retryAt - Date.now())));
    return () => clearTimeout(timer);
  }, [advice, revision]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') apiBackoff.refresh();
    });
    return () => subscription.remove();
  }, []);
  const message = advice ? copy[language].wait : expired ? copy[language].ready : undefined;
  useEffect(() => {
    if (!visible || !message || lastAnnouncement.current === message) return;
    lastAnnouncement.current = message;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }, [message, visible]);
  return <Context.Provider value={{ waiting: !!advice, advice, expired, visible, language }}>{children}</Context.Provider>;
}

const copy = {
  en: {
    wait: 'Memy needs a short wait before another request. Your work has not been retried. You can go back or sign out.',
    ready: 'You can try again now. Choose the action when you are ready; nothing will be sent automatically.',
  },
  sv: {
    wait: 'Memy behöver en kort paus före nästa förfrågan. Ditt arbete har inte skickats igen. Du kan gå tillbaka eller logga ut.',
    ready: 'Du kan försöka igen nu. Välj åtgärden när du är redo. Ingenting skickas automatiskt.',
  },
};

/** One calm announcement on entry and expiry; no ticking live countdown. */
export function ApiBackoffBanner() {
  const { waiting, advice, language, expired, visible } = useApiBackoff();
  const message = waiting ? copy[language].wait : expired ? copy[language].ready : undefined;
  if (!visible || !message) return null;
  return <View testID="api-backoff-banner" style={styles.banner}>
    <Text accessibilityLanguage={accessibilityLanguages[language]} accessibilityLiveRegion="polite"
      allowFontScaling style={styles.text}>{message}</Text>
    {waiting && advice && <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.text}>
      {language === 'sv' ? 'Tjänsten begärde en paus på' : 'The service requested a pause of'} {advice.retryAfterSeconds} {language === 'sv' ? 'sekunder.' : 'seconds.'}
    </Text>}
  </View>;
}
const styles = StyleSheet.create({
  banner: { width: '100%', gap: 12, borderWidth: 2, borderColor: colors.forest,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper, padding: 18 },
  text: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
});
