import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { Language } from './i18n';

type LanguageState = {
  language: Language;
  setLanguage: (language: Language) => void;
};
const LanguageContext = createContext<LanguageState | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguage] = useState<Language>('en');
  return <LanguageContext.Provider value={{ language, setLanguage }}>
    {children}
  </LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('LanguageProvider is required.');
  return context;
}
