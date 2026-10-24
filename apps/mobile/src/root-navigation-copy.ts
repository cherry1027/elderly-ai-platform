import type { Language } from './i18n';

export type RootTab = 'home' | 'stories' | 'settings';
export const rootNavigationCopy = {
  en: {
    tabs: { home: 'Home', stories: 'My Stories', settings: 'Settings' },
    navigation: 'Main navigation', navigationScrollHint: 'Scroll to reach all navigation choices.', homeTitle: 'Welcome to Memy',
    homeDescription: 'Your memories, at your pace.',
    openStories: 'Open My Stories', createStory: 'Create My Story',
    simulation: 'Development preview: transcription and AI story writing are simulated.',
    settingsTitle: 'Settings', settingsDescription: 'Make Memy feel comfortable for you.',
    languageTitle: 'App language', languageHelp: 'This changes the app language. Your stories keep their own language.',
    replay: 'Replay Introduction', accountTitle: 'Your account', signOut: 'Sign Out',
    openStory: 'Open Story',
  },
  sv: {
    tabs: { home: 'Hem', stories: 'Mina berättelser', settings: 'Inställningar' },
    navigation: 'Huvudnavigering', navigationScrollHint: 'Rulla för att nå alla navigeringsval.', homeTitle: 'Välkommen till Memy',
    homeDescription: 'Dina minnen, i din takt.',
    openStories: 'Öppna Mina berättelser', createStory: 'Skapa min berättelse',
    simulation: 'Utvecklingsversion: transkribering och AI-skrivande är simulerade.',
    settingsTitle: 'Inställningar', settingsDescription: 'Gör Memy bekvämt för dig.',
    languageTitle: 'Appens språk', languageHelp: 'Detta ändrar appens språk. Dina berättelser behåller sitt eget språk.',
    replay: 'Visa introduktionen igen', accountTitle: 'Ditt konto', signOut: 'Logga ut',
    openStory: 'Öppna berättelse',
  },
} satisfies Record<Language, unknown>;
