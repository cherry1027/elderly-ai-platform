/** Admission advice contains no upstream message, request payload or credential. */
export interface RetryAdvice {
  code: 'RATE_LIMITED' | 'API_BUSY';
  retryAt: number;
  retryAfterSeconds: number;
}
export const MAX_RETRY_SECONDS = 86_400;

/** Only the two approved admission pairs use Retry-After delta-seconds.
 * Missing/malformed values use the contract defaults. Larger integer values
 * are bounded to one day; HTTP dates, fractions and signs are not accepted. */
export function parseRetryAdvice(status: number, code: unknown, value: string | null,
  now = Date.now()): RetryAdvice | undefined {
  if (!((status === 429 && code === 'RATE_LIMITED') || (status === 503 && code === 'API_BUSY')) ||
    !Number.isFinite(now)) return undefined;
  let seconds = code === 'RATE_LIMITED' ? 60 : 1;
  if (typeof value === 'string' && value.length > 0 && !/[^0-9]/.test(value)) {
    const canonical = value.replace(/^0+/, '') || '0';
    const parsed = canonical.length > 5 ? MAX_RETRY_SECONDS : Number(canonical);
    // Zero is treated conservatively as a one-second pause.
    seconds = Math.max(1, Math.min(MAX_RETRY_SECONDS, parsed));
  }
  return Object.freeze({ code, retryAfterSeconds: seconds, retryAt: now + seconds * 1000 });
}

export class BackoffWaitError extends Error {
  constructor(readonly advice: RetryAdvice) { super('The development service needs a short wait.'); this.name = 'BackoffWaitError'; }
}
export class BackoffScopeError extends Error {
  constructor() { super('The authenticated request scope is no longer current.'); this.name = 'BackoffScopeError'; }
}
export interface BackoffLease {
  assertReady: (origin: string) => void;
  record: (origin: string, advice: RetryAdvice) => void;
  isCurrent: () => boolean;
}

/** Owner-scoped RAM only. Navigation and temporary authentication checking do
 * not reset the deadline. A replaced account can never inherit old callbacks. */
export function createApiBackoffStore(now: () => number = () => Date.now()) {
  let owner: string | null = null, epoch = 0, revision = 0;
  const entries = new Map<string, RetryAdvice>();
  const expired = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => { revision++; for (const listener of listeners) listener(); };
  const advice = (origin: string) => {
    const value = entries.get(origin);
    return value && value.retryAt > now() ? value : undefined;
  };
  return {
    activate(nextOwner: string) {
      if (owner === nextOwner) return;
      owner = nextOwner; epoch++; entries.clear(); expired.clear(); changed();
    },
    clear() {
      if (owner === null && entries.size === 0 && expired.size === 0) return;
      owner = null; epoch++; entries.clear(); expired.clear(); changed();
    },
    getAdvice: advice,
    isExpired(origin: string) { return expired.has(origin) || !!(entries.get(origin) && entries.get(origin)!.retryAt <= now()); },
    getRevision: () => revision,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh() {
      for (const [origin, value] of entries) if (value.retryAt <= now()) {
        entries.delete(origin);
        if (expired.size >= 8) expired.delete(expired.values().next().value!);
        expired.add(origin);
      }
      // Refresh can follow a wall-clock adjustment. Notify even when the
      // deadline remains future so the provider rearms its one expiry timer.
      changed();
    },
    capture(): BackoffLease {
      const capturedOwner = owner, capturedEpoch = epoch;
      const isCurrent = () => capturedEpoch === epoch && capturedOwner === owner;
      return {
        isCurrent,
        assertReady(origin) {
          if (!isCurrent()) throw new BackoffScopeError();
          const value = capturedOwner === null ? undefined : advice(origin);
          if (value) throw new BackoffWaitError(value);
        },
        record(origin, value) {
          if (!isCurrent() || capturedOwner === null || !origin ||
            !['RATE_LIMITED', 'API_BUSY'].includes(value.code) || !Number.isFinite(value.retryAt) ||
            !Number.isInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 1 ||
            value.retryAfterSeconds > MAX_RETRY_SECONDS || value.retryAt <= now() ||
            value.retryAt > now() + MAX_RETRY_SECONDS * 1000) return;
          const prior = advice(origin);
          if (prior && prior.retryAt >= value.retryAt) return;
          // Current configuration permits one API origin. Bound stale origins
          // defensively without retaining any user content or durable state.
          if (!entries.has(origin) && entries.size >= 8) entries.delete(entries.keys().next().value!);
          expired.delete(origin); entries.set(origin, Object.freeze({ ...value })); changed();
        },
      };
    },
  };
}
export const apiBackoff = createApiBackoffStore();
