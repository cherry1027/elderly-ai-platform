import type { Language } from './i18n';

export type IntroScene = 0 | 1 | 2;

// Adapted from the approved web introduction. The final scene describes a
// future draft from confirmed memories, rather than claiming one was created.
export const introCopy = {
  en: {
    scenes: [
      { eyebrow: 'Your memories', title: 'Every life has a story.', description: 'Start with the memories you want to tell.', caption: 'A little moment. A familiar place. Begin wherever you like.' },
      { eyebrow: 'Your voice, your words', title: 'Speak at your own pace.', description: 'Talk or type. Memy helps you tell your story.', caption: 'There is no rush. Your words are always the starting point.' },
      { eyebrow: 'A book that is yours', title: 'Your memories. Your autobiography.', description: 'Memy can help turn memories you have confirmed into a personal story draft.', caption: 'Review and edit your draft. You decide what belongs in your story.' },
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    enter: 'Enter Memy',
    replay: 'Replay Introduction',
    progress: (step: number) => `Introduction: step ${step} of 3`,
    illustration: 'Illustration only. No recording or story generation.',
    login: 'Log In',
    register: 'Create Account',
    guest: 'Continue as Guest',
    unavailable: 'Log in, account creation and guest access are not available yet.',
    storageNote: 'Your device could not save your preferences. You can continue, but the introduction may appear again next time.',
  },
  sv: {
    scenes: [
      { eyebrow: 'Dina minnen', title: 'Varje liv har en berättelse.', description: 'Börja med de minnen du vill berätta om.', caption: 'Ett litet ögonblick. En välbekant plats. Börja där du vill.' },
      { eyebrow: 'Din röst, dina ord', title: 'Prata i din egen takt.', description: 'Prata eller skriv. Memy hjälper dig att berätta din historia.', caption: 'Det är ingen brådska. Dina ord är alltid utgångspunkten.' },
      { eyebrow: 'En bok som är din', title: 'Dina minnen. Din självbiografi.', description: 'Memy kan hjälpa till att göra minnen som du har bekräftat till ett utkast till din egen berättelse.', caption: 'Granska och redigera ditt utkast. Du bestämmer vad som hör till din berättelse.' },
    ],
    next: 'Nästa',
    back: 'Tillbaka',
    skip: 'Hoppa över',
    enter: 'Öppna Memy',
    replay: 'Visa introduktionen igen',
    progress: (step: number) => `Introduktion: steg ${step} av 3`,
    illustration: 'Endast illustration. Ingen inspelning eller berättelse skapas.',
    login: 'Logga in',
    register: 'Skapa konto',
    guest: 'Fortsätt som gäst',
    unavailable: 'Inloggning, nya konton och gäståtkomst är inte tillgängliga ännu.',
    storageNote: 'Din enhet kunde inte spara dina val. Du kan fortsätta, men introduktionen kan visas igen nästa gång.',
  },
} satisfies Record<Language, unknown>;
