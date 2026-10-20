import { redirectSystemPath } from '../src/app/+native-intent';

describe('native launch URL policy without external services', () => {
  const paths = [
    'exp://192.168.1.25:8083',
    'exp://192.168.1.25:8083/--/login',
    'exp://192.168.1.25:8083/--/authenticated?from=welcome',
    'memy-foundation://login',
    'memy-foundation:///authenticated',
    'memy-foundation:///welcome',
  ];

  it.each(paths)('routes cold native URL through the entrance: %s', async (path) => {
    await expect(Promise.resolve(redirectSystemPath({ path, initial: true }))).resolves.toBe('/');
  });

  it.each(paths)('routes a new warm native URL through the entrance: %s', async (path) => {
    await expect(Promise.resolve(redirectSystemPath({ path, initial: false }))).resolves.toBe('/');
  });

  it.each(['', 'not a valid link', '/login?loginRequested=true'])('fails closed to the entrance for an unusual path: %s', async (path) => {
    await expect(Promise.resolve(redirectSystemPath({ path, initial: true }))).resolves.toBe('/');
    await expect(Promise.resolve(redirectSystemPath({ path, initial: false }))).resolves.toBe('/');
  });

  it('normalizes without networking or logging the incoming path', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      await redirectSystemPath({ path: 'memy-foundation:///login?untrusted=value', initial: false });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { logs.forEach((log) => log.mockRestore()); }
  });
});
