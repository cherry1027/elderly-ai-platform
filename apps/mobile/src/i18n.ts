export type Language = 'en' | 'sv';

export const languageNames: Record<Language, string> = {
  en: 'English',
  sv: 'Svenska',
};

export const accessibilityLanguages: Record<Language, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
};

export const copy = {
  en: {
    languageTitle: 'Choose your language',
    languageDescription: 'Choose the language you feel most comfortable with.',
    languageGroup: 'Language',
    selected: 'Selected',
    continue: 'Continue',
    welcomeEyebrow: 'Your story starts with you',
    welcomeTitle: 'Welcome to Memy.',
    welcomeDescription: 'A place for your memories, in your own words.',
    changeLanguage: 'Change language',
    footer: 'Your memories. Your words. Your story.',
  },
  sv: {
    languageTitle: 'Välj ditt språk',
    languageDescription: 'Välj det språk som känns bäst för dig.',
    languageGroup: 'Språk',
    selected: 'Valt',
    continue: 'Fortsätt',
    welcomeEyebrow: 'Din berättelse börjar med dig',
    welcomeTitle: 'Välkommen till Memy.',
    welcomeDescription: 'En plats för dina minnen, med dina egna ord.',
    changeLanguage: 'Byt språk',
    footer: 'Dina minnen. Dina ord. Din berättelse.',
  },
} as const;
