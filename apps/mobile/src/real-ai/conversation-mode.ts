import AsyncStorage from '@react-native-async-storage/async-storage';

export type ConversationMode = 'write' | 'voice';

export const conversationModeCopy = {
  en: {
    switchToWrite: 'Switch to writing',
    switchToVoice: 'Switch to speaking',
    finishAndOpenStory: 'Finish and go to My Story',
    finishWaiting: 'My Story will open when the current step finishes.',
    reviewQuestions: 'Use Yes, Change, or Leave out in Memories to save your answer about a detail.',
  },
  sv: {
    switchToWrite: 'Byt till att skriva',
    switchToVoice: 'Byt till att berätta',
    finishAndOpenStory: 'Avsluta och gå till Min berättelse',
    finishWaiting: 'Min berättelse öppnas när det pågående steget är klart.',
    reviewQuestions: 'Välj Ja, Ändra eller Utelämna under Minnen för att spara ditt svar om en detalj.',
  },
} as const;

const key = 'memy.conversation-mode.v1';
let writes: Promise<void> = Promise.resolve();

export async function readConversationMode(): Promise<ConversationMode | null> {
  try {
    await writes;
    const stored = await AsyncStorage.getItem(key);
    return stored === 'write' || stored === 'voice' ? stored : null;
  } catch {
    return null;
  }
}

export function saveConversationMode(mode: ConversationMode): void {
  writes = writes.then(() => AsyncStorage.setItem(key, mode)).catch(() => {});
}
