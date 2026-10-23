import { BackoffScopeError, BackoffWaitError, createApiBackoffStore, MAX_RETRY_SECONDS, parseRetryAdvice } from '../src/api/backoff';

const time = 1_000_000, origin = 'http://192.168.1.30:8000';
it.each([
  [429, 'RATE_LIMITED', null, 60], [503, 'API_BUSY', null, 1],
  [429, 'RATE_LIMITED', '75', 75], [503, 'API_BUSY', '90', 90],
  [429, 'RATE_LIMITED', '0', 1], [503, 'API_BUSY', '000002', 2],
  [429, 'RATE_LIMITED', '86400', 86400], [503, 'API_BUSY', '86401', 86400],
  [429, 'RATE_LIMITED', '9'.repeat(100), MAX_RETRY_SECONDS],
] as const)('parses approved admission %s/%s/%s', (status, code, header, expected) => {
  expect(parseRetryAdvice(status, code, header, time)).toEqual({ code, retryAfterSeconds: expected, retryAt: time + expected * 1000 });
});
it.each(['', '-1', '+1', '1.5', 'Infinity', 'NaN', '1e3', ' 60 ', 'Fri, 23 Oct 2026 10:00:00 GMT', '60\n'])('uses defaults for malformed header %s', header => {
  expect(parseRetryAdvice(429, 'RATE_LIMITED', header, time)?.retryAfterSeconds).toBe(60);
  expect(parseRetryAdvice(503, 'API_BUSY', header, time)?.retryAfterSeconds).toBe(1);
});
it.each([[503, 'RATE_LIMITED'], [429, 'API_BUSY'], [500, 'API_BUSY'], [429, 'AUDIO_BUSY'], [503, 'SUPABASE_UNAVAILABLE'], [401, 'API_BUSY'], [200, 'RATE_LIMITED'], [429, undefined]])('ignores unrelated status/code %s/%s', (status, code) => {
  expect(parseRetryAdvice(status as number, code, '30', time)).toBeUndefined();
});
it('does not parse against a broken clock', () => { expect(parseRetryAdvice(429, 'RATE_LIMITED', '3', NaN)).toBeUndefined(); });
it('isolates pure client calls when no owner has been activated', () => {
  const store = createApiBackoffStore(() => time), lease = store.capture();
  lease.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '10', time)!);
  expect(store.getAdvice(origin)).toBeUndefined(); expect(() => lease.assertReady(origin)).not.toThrow();
});
it('blocks only the matching origin and expires without calling any request', () => {
  let now = time;
  const store = createApiBackoffStore(() => now), listener = jest.fn(); store.subscribe(listener); store.activate('owner');
  const lease = store.capture(); lease.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '10', now)!);
  expect(() => lease.assertReady(origin)).toThrow(BackoffWaitError);
  expect(() => lease.assertReady('http://192.168.1.31:8000')).not.toThrow();
  now += 10_000; store.refresh();
  expect(() => lease.assertReady(origin)).not.toThrow(); expect(store.getAdvice(origin)).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(3);
});
it('preserves a longer existing wait instead of extending or shortening it on a local refusal', () => {
  const store = createApiBackoffStore(() => time); store.activate('owner');
  const lease = store.capture(), first = parseRetryAdvice(429, 'RATE_LIMITED', '60', time)!;
  lease.record(origin, first); lease.record(origin, parseRetryAdvice(503, 'API_BUSY', '1', time)!);
  expect(store.getAdvice(origin)).toEqual(first);
});
it('uses a new longer server deadline and keeps immutable safe metadata only', () => {
  const store = createApiBackoffStore(() => time); store.activate('owner'); const lease = store.capture();
  lease.record(origin, parseRetryAdvice(503, 'API_BUSY', '1', time)!);
  lease.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '60', time)!);
  expect(store.getAdvice(origin)?.retryAfterSeconds).toBe(60); expect(Object.isFrozen(store.getAdvice(origin))).toBe(true);
  expect(Object.keys(store.getAdvice(origin)!)).toEqual(['code', 'retryAfterSeconds', 'retryAt']);
});
it.each(['clear', 'switch'] as const)('revokes old leases on %s and prevents late cooldown leakage', action => {
  const store = createApiBackoffStore(() => time); store.activate('first'); const stale = store.capture();
  stale.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '60', time)!);
  if (action === 'clear') store.clear(); else store.activate('second');
  expect(stale.isCurrent()).toBe(false); expect(() => stale.assertReady(origin)).toThrow(BackoffScopeError);
  stale.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '99', time)!);
  expect(store.getAdvice(origin)).toBeUndefined(); expect(() => store.capture().assertReady(origin)).not.toThrow();
});
it('keeps the same-owner lease and deadline during repeated activation', () => {
  const store = createApiBackoffStore(() => time); store.activate('owner'); const lease = store.capture();
  lease.record(origin, parseRetryAdvice(429, 'RATE_LIMITED', '60', time)!); store.activate('owner');
  expect(lease.isCurrent()).toBe(true); expect(() => store.capture().assertReady(origin)).toThrow(BackoffWaitError);
});
it.each([0, -1, Infinity, 86401, 0.5])('rejects malformed advice delays %s', retryAfterSeconds => {
  const store = createApiBackoffStore(() => time); store.activate('owner');
  store.capture().record(origin, { code: 'API_BUSY', retryAfterSeconds, retryAt: time + 1000 });
  expect(store.getAdvice(origin)).toBeUndefined();
});
