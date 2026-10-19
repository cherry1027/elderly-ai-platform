import {
  accessibilityLanguages,
  copy,
  languageNames,
  type Language,
} from '../src/i18n';

describe('English and Swedish wording', () => {
  it('provides both languages using their own names', () => {
    expect(languageNames).toEqual({ en: 'English', sv: 'Svenska' });
  });

  it('provides the same complete set of translation keys', () => {
    expect(Object.keys(copy.en).sort()).toEqual(Object.keys(copy.sv).sort());
  });

  it.each<Language>(['en', 'sv'])('%s has no empty translations', (language) => {
    for (const value of Object.values(copy[language])) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['en', 'Welcome to Memy.', 'A place for your memories, in your own words.'],
    ['sv', 'Välkommen till Memy.', 'En plats för dina minnen, med dina egna ord.'],
  ] as const)('preserves the approved %s Welcome wording', (language, title, description) => {
    expect(copy[language].welcomeTitle).toBe(title);
    expect(copy[language].welcomeDescription).toBe(description);
  });

  it.each([
    ['en', 'Continue', 'Change language', 'en-GB'],
    ['sv', 'Fortsätt', 'Byt språk', 'sv-SE'],
  ] as const)('provides %s navigation and screen-reader language', (language, next, back, locale) => {
    expect(copy[language].continue).toBe(next);
    expect(copy[language].changeLanguage).toBe(back);
    expect(accessibilityLanguages[language]).toBe(locale);
  });
});
