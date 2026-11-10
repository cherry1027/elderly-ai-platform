import AsyncStorage from '@react-native-async-storage/async-storage';

export type ConversationMode = 'write' | 'voice';
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
