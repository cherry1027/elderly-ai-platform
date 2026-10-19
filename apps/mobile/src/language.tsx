import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { Language } from './i18n';
import { createPreferencesWriter, defaultPreferences, readPreferences } from './onboarding/preferences';

type LanguageState = {
  language: Language;
  setLanguage: (language: Language) => void;
  ready: boolean;
  completed: boolean;
  completeIntroduction: () => Promise<void>;
  storageUnavailable: boolean;
};
const LanguageContext = createContext<LanguageState | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [write] = useState(() => createPreferencesWriter());
  const current = useRef(defaultPreferences);
  const hydrated = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void readPreferences().then((result) => {
      if (!active) return;
      current.current = result.preferences ?? defaultPreferences;
      setPreferences(current.current);
      setStorageUnavailable(result.unavailable);
      hydrated.current = true;
      setReady(true);
    });
    return () => { active = false; mounted.current = false; };
  }, []);

  const persist = useCallback(async () => {
    const saved = await write(current.current);
    if (!saved && mounted.current) setStorageUnavailable(true);
  }, [write]);

  const setLanguage = useCallback((language: Language) => {
    if (!hydrated.current || (language !== 'en' && language !== 'sv')) return;
    current.current = { ...current.current, language };
    setPreferences(current.current);
    void persist();
  }, [persist]);

  const completeIntroduction = useCallback(async () => {
    if (!hydrated.current) return;
    current.current = { ...current.current, completed: true };
    setPreferences(current.current);
    await persist();
  }, [persist]);

  return <LanguageContext.Provider value={{
    language: preferences.language,
    setLanguage,
    ready,
    completed: preferences.completed,
    completeIntroduction,
    storageUnavailable,
  }}>
    {children}
  </LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('LanguageProvider is required.');
  return context;
}
