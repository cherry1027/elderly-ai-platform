import type { AuthSnapshot } from '../auth/client';

type ReplayAuth = Pick<AuthSnapshot, 'status' | 'user'> & { appActive: boolean };
/** Opaque RAM identity. A URL can never supply replay authority. */
export interface IntroductionReplayTicket { readonly identity: symbol }
interface ReplayLease {
  source: object;
  ownerId: string;
  ticket: IntroductionReplayTicket;
  phase: 'playing' | 'returned';
  createdAt: number;
}
// One bounded Settings intent; no private prose, tokens or durable storage.
export const INTRODUCTION_REPLAY_TTL_MS = 30 * 60 * 1_000;
let lease: ReplayLease | null = null;
function fresh(value: ReplayLease) {
  const age = Date.now() - value.createdAt;
  return age >= 0 && age < INTRODUCTION_REPLAY_TTL_MS;
}
function reconcile(auth: ReplayAuth) {
  if (!lease) return;
  if (!fresh(lease) || auth.status === 'busy' || auth.status === 'blocked' || auth.status === 'signed-out' ||
    (auth.user && auth.user.id !== lease.ownerId) || (auth.appActive && auth.status === 'signed-in' && !auth.user)) lease = null;
}
function verified(auth: ReplayAuth, ownerId: string) {
  return auth.appActive && auth.status === 'signed-in' && auth.user?.id === ownerId;
}
/** Owned by the existing authenticated route, never by a private child or URL. */
export function createIntroductionReplaySource() {
  const source = {};
  let alive = true;
  let ownerId: string | null = null;
  const returned = (auth: ReplayAuth) => alive && lease?.source === source &&
    lease.phase === 'returned' && fresh(lease) && verified(auth, lease.ownerId);
  return {
    sync(auth: ReplayAuth) {
      // Effect re-setup after StrictMode cleanup may reactivate this source;
      // dispose already revoked its ticket, so old callbacks stay invalid.
      alive = true;
      reconcile(auth);
      if (auth.status === 'signed-in' && auth.user) ownerId = auth.user.id;
      else if (auth.status !== 'checking') ownerId = null;
    },
    begin(auth: ReplayAuth): boolean {
      reconcile(auth);
      if (!alive || !ownerId || !verified(auth, ownerId) || lease) return false;
      lease = { source, ownerId, ticket: Object.freeze({ identity: Symbol('settings-replay') }), phase: 'playing', createdAt: Date.now() };
      return true;
    },
    hasReturn(auth: ReplayAuth): boolean { return returned(auth); },
    consumeReturn(auth: ReplayAuth): boolean {
      reconcile(auth);
      if (!returned(auth)) return false;
      lease = null;
      return true;
    },
    dispose() {
      alive = false;
      ownerId = null;
      if (lease?.source === source) lease = null;
    },
  };
}
export function readIntroductionReplay(auth: ReplayAuth): IntroductionReplayTicket | null {
  reconcile(auth);
  return lease?.phase === 'playing' && verified(auth, lease.ownerId) ? lease.ticket : null;
}
export function isIntroductionReplayCurrent(ticket: IntroductionReplayTicket, auth: ReplayAuth): boolean {
  if (lease?.ticket !== ticket) return false;
  reconcile(auth);
  return lease?.ticket === ticket && lease.phase === 'playing' && verified(auth, lease.ownerId);
}
export function finishIntroductionReplay(ticket: IntroductionReplayTicket, auth: ReplayAuth): boolean {
  if (!isIntroductionReplayCurrent(ticket, auth) || !lease) return false;
  lease.phase = 'returned';
  return true;
}