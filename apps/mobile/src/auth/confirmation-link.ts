// Provisional until the exact redirect, email template and native build have
// been approved. Parsing a link does not verify an account or enable signup.
export const REGISTRATION_CONFIRMATION_REDIRECT = 'memy-foundation://auth/confirm';

export type ConfirmationLink = { kind: 'code'; code: string; state: string } | { kind: 'invalid' };
export type ConfirmationLinkInspection = ConfirmationLink | { kind: 'unrelated' };

const MAX_LINK_LENGTH = 4096;
const MAX_CODE_LENGTH = 1024;
const INBOX_TTL_MS = 60_000;

/** Only the approved-shaped native callback is recognized, never implicit tokens. */
export function inspectConfirmationLink(path: string): ConfirmationLinkInspection {
  // Classify malformed callbacks safely without retaining or reporting the URL.
  const ownAuthority = /^memy-foundation:\/\/(?:[^/?#]*@)?auth(?=[:/?#]|$)/i.test(path);
  if (!ownAuthority) return { kind: 'unrelated' };
  if (path.length > MAX_LINK_LENGTH || /\s/.test(path)) return { kind: 'invalid' };

  // Literal matching needs no platform URL implementation and cannot normalize
  // dot segments, encoded keys, extra parameters or a different authority into
  // an accepted callback. Codes are opaque; server verification is still needed.
  const prefix = `${REGISTRATION_CONFIRMATION_REDIRECT}?`;
  if (!path.startsWith(prefix)) return { kind: 'invalid' };
  const parameters = path.slice(prefix.length).split('&');
  if (parameters.length !== 2) return { kind: 'invalid' };
  const code = parameters.find(value => value.startsWith('code='))?.slice(5);
  const state = parameters.find(value => value.startsWith('state='))?.slice(6);
  if (!code || code.length > MAX_CODE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(code)
    || !state || !/^[a-f0-9]{64}$/.test(state)) return { kind: 'invalid' };
  // This public state is only syntax-checked here. The registration service
  // must compare it to its securely generated pending attempt BEFORE exchange.
  return { kind: 'code', code, state };
}

let inbox: { entry: ConfirmationLink; receivedAt: number } | null = null;
let consumedUntil = 0;
let consumedState: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function cancelExpiry(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
}

/** The mounted confirmation route also receives warm links to the same route. */
export function subscribeConfirmationLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* Never propagate a native link or subscriber error. */ }
  }
}

/**
 * Receives a native link before routing to /auth/confirm without code parameters.
 * The boolean means recognized, not authenticated. A live pending code cannot
 * be overwritten; a short cooldown rejects duplicates of its public state only,
 * allowing a different registration attempt to arrive after inbox consumption.
 * Only one bounded entry is held in memory, never a full URL or persisted code.
 */
export function receiveConfirmationLink(path: string): boolean {
  const entry = inspectConfirmationLink(path);
  if (entry.kind === 'unrelated') return false;
  const now = Date.now();
  if (inbox?.entry.kind === 'code' && now >= inbox.receivedAt
    && now - inbox.receivedAt < INBOX_TTL_MS) {
    notifyListeners();
    return true;
  }

  if (entry.kind === 'code') {
    if (entry.state === consumedState && now < consumedUntil) {
      inbox = { entry: { kind: 'invalid' }, receivedAt: now };
    } else {
      cancelExpiry();
      inbox = { entry, receivedAt: now };
      consumedUntil = now + INBOX_TTL_MS;
      consumedState = entry.state;
      // This single timer captures no code or state. It erases any unconsumed
      // code and the last public deduplication state after their bounded life.
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        consumedState = null;
        consumedUntil = 0;
        if (inbox?.entry.kind === 'code') inbox = { entry: { kind: 'invalid' }, receivedAt: Date.now() };
      }, INBOX_TTL_MS);
    }
  } else {
    inbox = { entry, receivedAt: now };
  }
  notifyListeners();
  return true;
}

/** Consuming a callback does not authenticate it; the isolated SDK must verify it. */
export function takeConfirmationLink(): ConfirmationLink | null {
  const pending = inbox;
  inbox = null;
  if (!pending) return null;
  const age = Date.now() - pending.receivedAt;
  return age < 0 || age >= INBOX_TTL_MS ? { kind: 'invalid' } : pending.entry;
}

/** Clears this module's temporary inbox only, never an ordinary login session. */
export function clearConfirmationLink(): void {
  inbox = null;
  consumedUntil = 0;
  consumedState = null;
  cancelExpiry();
}
