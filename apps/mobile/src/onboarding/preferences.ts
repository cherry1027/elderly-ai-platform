import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from '../i18n';

// This record is intentionally limited to non-sensitive display preferences.
export const PREFERENCES_KEY = 'memy.onboarding.preferences.v1';
export const STORAGE_TIMEOUT_MS = 2500;

export type OnboardingPreferences = {
  version: 1;
  language: Language;
  completed: boolean;
};

export const defaultPreferences: OnboardingPreferences = {
  version: 1,
  language: 'en',
  completed: false,
};

type PreferenceStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preference storage unavailable.')), STORAGE_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); reject(new Error('Preference storage unavailable.')); },
    );
  });
}

function decode(raw: string): OnboardingPreferences | null {
  if (raw.length > 256) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || (record.language !== 'en' && record.language !== 'sv') || typeof record.completed !== 'boolean') {
    return null;
  }
  // Return only the accepted fields; unrelated stored data never enters state.
  return { version: 1, language: record.language, completed: record.completed };
}

export async function readPreferences(storage: PreferenceStorage = AsyncStorage): Promise<{
  preferences: OnboardingPreferences | null;
  unavailable: boolean;
}> {
  try {
    const raw = await bounded(Promise.resolve().then(() => storage.getItem(PREFERENCES_KEY)));
    if (raw === null) return { preferences: null, unavailable: false };
    const preferences = decode(raw);
    return { preferences, unavailable: preferences === null };
  } catch {
    return { preferences: null, unavailable: true };
  }
}

export function createPreferencesWriter(storage: PreferenceStorage = AsyncStorage) {
  let queue = Promise.resolve();
  return (preferences: OnboardingPreferences): Promise<boolean> => {
    const snapshot = JSON.stringify({
      version: 1,
      language: preferences.language,
      completed: preferences.completed,
    });
    const write = queue.then(() => storage.setItem(PREFERENCES_KEY, snapshot));
    // Keep the native operations themselves serialized, even after a UI timeout.
    // A delayed older write must never land after a newer completion preference.
    queue = write.then(() => undefined, () => undefined);
    return bounded(write).then(() => true, () => false);
  };
}
