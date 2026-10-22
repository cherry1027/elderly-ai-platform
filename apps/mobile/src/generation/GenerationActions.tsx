import { createContext, useContext, useLayoutEffect, useMemo, type PropsWithChildren } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../auth/AuthProvider';

export interface GenerationAction {
  key: string;
  input: { language: 'en' | 'sv'; style: 'warm'; confirm_generation: true };
  blocked?: boolean;
}
export function createGenerationStore(initialOwner: string | null = null) {
  let owner = initialOwner;
  const entries = new Map<string, GenerationAction>();
  return {
    activate(next: string) { if (owner !== next) { entries.clear(); owner = next; } },
    clear() { entries.clear(); owner = null; },
    get(expectedOwner: string, scope: string) { return owner === expectedOwner ? entries.get(scope) : undefined; },
    set(expectedOwner: string, scope: string, action: GenerationAction) {
      if (owner !== expectedOwner) return false;
      entries.set(scope, Object.freeze({ ...action, input: Object.freeze({ ...action.input }) })); return true;
    },
    remove(expectedOwner: string, scope: string) { if (owner === expectedOwner) entries.delete(scope); },
  };
}
export type GenerationStore = ReturnType<typeof createGenerationStore>;
const Context = createContext<GenerationStore | null>(null);

/** Beneath existing AuthProvider, above private views hidden during revalidation.
 * Only action UUID/payload metadata in RAM; never tokens, prose or source text. */
export function GenerationActionsProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const store = useMemo(() => createGenerationStore(), []);
  useLayoutEffect(() => {
    if (auth.status === 'signed-in' && auth.user) store.activate(auth.user.id);
    else if (['signed-out', 'blocked', 'busy'].includes(auth.status)) store.clear();
    // Checking/background hides private views but retains uncertain metadata
    // until this same account is reverified. Hidden views cannot start writes.
  }, [auth.status, auth.user, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useGenerationActions(ownerId: string) {
  const shared = useContext(Context);
  const isolated = useMemo(() => createGenerationStore(ownerId), [ownerId]);
  return shared ?? isolated;
}
export function createGenerationActionId(): string {
  try {
    const key = Crypto.randomUUID();
    if (/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(key)) return key;
  } catch { /* Native errors never enter UI or logs. */ }
  throw new Error('Secure generation identity is unavailable.');
}
