import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import * as Crypto from 'expo-crypto';

export interface ConversationAction {
  key: string;
  sourceId: string;
  language: 'en' | 'sv';
  status: 'pending' | 'confirmed' | 'blocked';
  assistantId?: string;
}
type Actions = { ownerId: string; entries: Map<string, ConversationAction> };
const Context = createContext<Actions | null>(null);

/** Account-scoped RAM only: no tokens, source text or persistent retry queue. */
export function ConversationActionsProvider({ ownerId, children }: PropsWithChildren<{ ownerId: string }>) {
  const value = useMemo(() => ({ ownerId, entries: new Map<string, ConversationAction>() }), [ownerId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useConversationActions(ownerId: string) {
  const context = useContext(Context);
  const local = useMemo(() => ({ ownerId, entries: new Map<string, ConversationAction>() }), [ownerId]);
  return context?.ownerId === ownerId ? context.entries : local.entries;
}


/** A distinct cryptographic action UUID; never derived from a recording or transcript. */
export function createConversationActionId(): string {
  try {
    const value = Crypto.randomUUID();
    if (/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) return value;
  } catch { /* never expose native exceptions */ }
  throw new Error('Secure conversation identity is unavailable.');
}
