import type { Language } from './i18n';

export type RootTab = 'home' | 'stories' | 'settings';
export const rootNavigationCopy = {
  en: {
    tabs: { home: 'Home', stories: 'My Stories', settings: 'Settings' },
    navigation: 'Main navigation', navigationScrollHint: 'Scroll to reach all navigation choices.', homeTitle: 'Welcome to Memy',
    homeDescription: 'Your memories, at your pace.',
    openStories: 'Open My Stories', createStory: 'Start a new story',
    simulation: 'Development preview: transcription and AI story writing are simulated.',
    realAvailability: 'Real AI availability is checked when you open a story. Your recording is never replaced by a simulated transcript.',
    settingsTitle: 'Settings', settingsDescription: 'Make Memy feel comfortable for you.',
    languageTitle: 'Language', languageHelp: 'This changes the app language. Your stories keep their own language.',
    replay: 'How to use Memy', accountTitle: 'Your account', signOut: 'Sign Out',
    openStory: 'Open Story',
  },
  sv: {
    tabs: { home: 'Hem', stories: 'Mina berättelser', settings: 'Inställningar' },
    navigation: 'Huvudnavigering', navigationScrollHint: 'Rulla för att nå alla navigeringsval.', homeTitle: 'Välkommen till Mina Minnen',
    homeDescription: 'Dina minnen, i din takt.',
    openStories: 'Öppna Mina berättelser', createStory: 'Börja en ny berättelse',
    simulation: 'Utvecklingsversion: transkribering och AI-skrivande är simulerade.',
    realAvailability: 'Tillgången till verklig AI kontrolleras när du öppnar en berättelse. Din inspelning ersätts aldrig med en simulerad transkription.',
    settingsTitle: 'Inställningar', settingsDescription: 'Anpassa Mina Minnen så att det passar dig.',
    languageTitle: 'Språk', languageHelp: 'Detta ändrar appens språk. Dina berättelser behåller sitt eget språk.',
    replay: 'Så använder du Mina Minnen', accountTitle: 'Ditt konto', signOut: 'Logga ut',
    openStory: 'Öppna berättelse',
  },
} satisfies Record<Language, unknown>;
