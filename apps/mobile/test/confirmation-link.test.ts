import {
  clearConfirmationLink,
  inspectConfirmationLink,
  receiveConfirmationLink,
  REGISTRATION_CONFIRMATION_REDIRECT,
  subscribeConfirmationLink,
  takeConfirmationLink,
} from '../src/auth/confirmation-link';

const STATE = 'a'.repeat(64);
const link = (code = 'synthetic-code_123', state = STATE) => `${REGISTRATION_CONFIRMATION_REDIRECT}?code=${code}&state=${state}`;

describe('isolated native registration callback validation', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); clearConfirmationLink(); });
  afterEach(() => { clearConfirmationLink(); jest.useRealTimers(); });

  it('accepts only a bounded opaque code at the provisional native callback', () => {
    expect(inspectConfirmationLink(link())).toEqual({ kind: 'code', code: 'synthetic-code_123', state: STATE });
    expect(inspectConfirmationLink(link('a'.repeat(1024)))).toEqual({ kind: 'code', code: 'a'.repeat(1024), state: STATE });
    expect(inspectConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?state=${STATE}&code=synthetic-code_123`))
      .toEqual({ kind: 'code', code: 'synthetic-code_123', state: STATE });
  });

  it('preserves a syntactically valid changed state for service binding, never authenticating it here', () => {
    const changed = `b${STATE.slice(1)}`;
    receiveConfirmationLink(link('synthetic', changed));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'synthetic', state: changed });
  });

  it.each([
    '', '/auth/confirm?code=synthetic', 'not a URL',
    'https://auth/confirm?code=synthetic', 'https://example.test/auth/confirm?code=synthetic',
    'exp://192.0.2.1:8081/--/auth/confirm?code=synthetic',
    'memy-foundation://login', 'memy-foundation:///auth/confirm?code=synthetic',
    'memy-foundation://auth.evil.test/confirm?code=synthetic',
  ])('does not treat an unrelated link as confirmation: %s', (value) => {
    expect(inspectConfirmationLink(value)).toEqual({ kind: 'unrelated' });
    expect(receiveConfirmationLink(value)).toBe(false);
    expect(takeConfirmationLink()).toBeNull();
  });

  it.each([
    'memy-foundation://auth/confirm', 'memy-foundation://auth/confirm?',
    'memy-foundation://auth/confirm?code=missing-state',
    `memy-foundation://auth/confirm?state=${STATE}`,
    `memy-foundation://auth/confirm?code=a&state=${STATE}&state=${STATE}`,
    `memy-foundation://auth/confirm?code=a&code=b&state=${STATE}`,
    `memy-foundation://auth/confirm?code=a&state=${STATE}&extra=b`,
    `memy-foundation://auth/confirm?code=a&%73tate=${STATE}`,
    `memy-foundation://auth/confirm?%63ode=a&state=${STATE}`,
    `memy-foundation://auth/confirm?code=a&state=${STATE}#access_token=sensitive`,
    `memy-foundation://auth/confirm?code=a&state=${STATE}&access_token=sensitive`,
    link('a', ''), link('a', 'a'.repeat(63)), link('a', 'a'.repeat(65)),
    link('a', 'A'.repeat(64)), link('a', 'g'.repeat(64)),
    link('a', `${'a'.repeat(63)}%61`), link('a', `${'a'.repeat(63)} `),
    link('has%20space'), link('has+space'), link('with%2Fslash'), link('bad%00value'),
    `${REGISTRATION_CONFIRMATION_REDIRECT}?state=${STATE}&code=synthetic&`,
    `memy-foundation://auth:443/confirm?code=a&state=${STATE}`,
    `memy-foundation://user:password@auth/confirm?code=a&state=${STATE}`,
    `memy-foundation://auth/other/../confirm?code=a&state=${STATE}`,
    `memy-foundation://auth/%63onfirm?code=a&state=${STATE}`,
    `MEMY-FOUNDATION://auth/confirm?code=a&state=${STATE}`,
    `memy-foundation://AUTH/confirm?code=a&state=${STATE}`,
    'memy-foundation://auth/confirm?code=', 'memy-foundation://auth/confirm?code=a&code=b',
    'memy-foundation://auth/confirm?code=a&extra=b',
    'memy-foundation://auth/confirm?error=access_denied&error_description=sensitive',
    'memy-foundation://auth/confirm?access_token=sensitive&refresh_token=sensitive',
    'memy-foundation://auth/confirm?code=a#access_token=sensitive',
    'memy-foundation://auth/confirm?code=a#',
    'memy-foundation://auth/confirm?code=a&',
    'memy-foundation://auth/confirm?code=has%20space',
    'memy-foundation://auth/confirm?code=has+space',
    'memy-foundation://auth/confirm?code=with%2Fslash',
    'memy-foundation://auth/confirm?code=bad%00value',
    'memy-foundation://auth/confirm?code=%zz',
    'memy-foundation://auth/confirm?code= leading',
    'memy-foundation://auth/confirm?code=trailing\n',
    'memy-foundation://auth/confirm?code=unicodeå',
    'memy-foundation://auth:443/confirm?code=a',
    'memy-foundation://user:password@auth/confirm?code=a',
    'memy-foundation://auth/other?code=a',
    'memy-foundation://auth/other/../confirm?code=a',
    'memy-foundation://auth/%63onfirm?code=a',
    'memy-foundation://auth/confirm/extra?code=a',
    'MEMY-FOUNDATION://auth/confirm?code=a',
    'memy-foundation://AUTH/confirm?code=a',
    link('a'.repeat(1025)), link('a'.repeat(4096)),
  ])('fails closed for an invalid recognized callback: %s', (value) => {
    expect(inspectConfirmationLink(value)).toEqual({ kind: 'invalid' });
    expect(receiveConfirmationLink(value)).toBe(true);
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
    expect(takeConfirmationLink()).toBeNull();
  });

  it('consumes the code once without putting it in a route parameter', () => {
    expect(receiveConfirmationLink(link())).toBe(true);
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'synthetic-code_123', state: STATE });
    expect(takeConfirmationLink()).toBeNull();
    expect(receiveConfirmationLink(link())).toBe(true);
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
  });

  it('preserves the first pending valid callback against replacement or invalid links', () => {
    receiveConfirmationLink(link('first'));
    receiveConfirmationLink(link('second'));
    receiveConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?error=expired`);
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'first', state: STATE });
  });

  it('allows a valid callback after an invalid callback without retaining the invalid URL', () => {
    receiveConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?error_description=sensitive`);
    receiveConfirmationLink(link());
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'synthetic-code_123', state: STATE });
  });

  it('expires a callback at 60 seconds and permits a subsequent fresh callback', () => {
    receiveConfirmationLink(link());
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(60_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
    receiveConfirmationLink(link('fresh'));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'fresh', state: STATE });
  });

  it('fails closed if the device clock moves backward', () => {
    receiveConfirmationLink(link());
    jest.setSystemTime(99_999);
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
  });

  it('clears only the in-memory callback state', () => {
    receiveConfirmationLink(link());
    expect(jest.getTimerCount()).toBe(1);
    clearConfirmationLink();
    expect(jest.getTimerCount()).toBe(0);
    expect(takeConfirmationLink()).toBeNull();
    receiveConfirmationLink(link('new-attempt'));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'new-attempt', state: STATE });
  });

  it('keeps only one bounded public-state expiry after consumption', () => {
    receiveConfirmationLink(link());
    takeConfirmationLink();
    expect(jest.getTimerCount()).toBe(1);
    clearConfirmationLink();
    receiveConfirmationLink(link('next'));
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(59_999);
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'next', state: STATE });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(takeConfirmationLink()).toBeNull();
  });

  it('accepts a different state immediately after consumption while rejecting duplicate-state events', () => {
    const stateB = 'b'.repeat(64);
    receiveConfirmationLink(link('old-attempt', STATE));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'old-attempt', state: STATE });
    receiveConfirmationLink(link('duplicate-old-attempt', STATE));
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
    receiveConfirmationLink(link('current-attempt', stateB));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'current-attempt', state: stateB });
    expect(jest.getTimerCount()).toBe(1);
    receiveConfirmationLink(link('duplicate-current-attempt', stateB));
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
  });

  it('erases the last public deduplication state on expiry', () => {
    receiveConfirmationLink(link());
    takeConfirmationLink();
    jest.advanceTimersByTime(60_000);
    expect(jest.getTimerCount()).toBe(0);
    receiveConfirmationLink(link('same-state-after-expiry'));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'same-state-after-expiry', state: STATE });
  });

  it('cancels the old attempt timer when a different public state is accepted', () => {
    const stateB = 'b'.repeat(64);
    receiveConfirmationLink(link());
    takeConfirmationLink();
    jest.advanceTimersByTime(30_000);
    receiveConfirmationLink(link('current', stateB));
    takeConfirmationLink();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(30_000);
    receiveConfirmationLink(link('duplicate-current', stateB));
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(30_000);
    expect(jest.getTimerCount()).toBe(0);
    receiveConfirmationLink(link('after-current-expiry', stateB));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'after-current-expiry', state: stateB });
  });

  it('does not let an invalid callback cancel expiry of the last public state', () => {
    receiveConfirmationLink(link());
    takeConfirmationLink();
    receiveConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?error=expired`);
    expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(60_000);
    expect(jest.getTimerCount()).toBe(0);
    receiveConfirmationLink(link('fresh'));
    expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'fresh', state: STATE });
  });

  it('notifies mounted routes of warm recognized callbacks and unsubscribes safely', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeConfirmationLink(listener);
    try {
      receiveConfirmationLink('memy-foundation://login');
      expect(listener).not.toHaveBeenCalled();
      receiveConfirmationLink(link());
      expect(listener).toHaveBeenCalledTimes(1);
      takeConfirmationLink();
      receiveConfirmationLink(link());
      expect(listener).toHaveBeenCalledTimes(2);
      expect(takeConfirmationLink()).toEqual({ kind: 'invalid' });
      unsubscribe();
      receiveConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?error=expired`);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); }
  });

  it('does not let a subscriber failure escape the native-link handler', () => {
    const unsubscribe = subscribeConfirmationLink(() => { throw new Error('synthetic subscriber failure'); });
    try {
      expect(() => receiveConfirmationLink(link())).not.toThrow();
      expect(takeConfirmationLink()).toEqual({ kind: 'code', code: 'synthetic-code_123', state: STATE });
    } finally { unsubscribe(); }
  });

  it('performs no networking and never logs incoming codes or malformed credentials', () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      receiveConfirmationLink(link());
      takeConfirmationLink();
      receiveConfirmationLink(`${REGISTRATION_CONFIRMATION_REDIRECT}?access_token=sensitive`);
      takeConfirmationLink();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { logs.forEach((log) => log.mockRestore()); }
  });
});
