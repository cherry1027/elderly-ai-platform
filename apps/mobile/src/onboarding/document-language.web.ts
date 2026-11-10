import { accessibilityLanguages, type Language } from '../i18n';

export function setDocumentLanguage(language: Language) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = accessibilityLanguages[language];
  }
}
