import * as SecureStore from 'expo-secure-store';
import {
  createSecureSessionStorage,
  MAX_SESSION_LENGTH,
  MOBILE_AUTH_STORAGE_KEY,
  SECURE_STORAGE_TIMEOUT_MS,
} from '../src/auth/secure-storage';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const read = jest.mocked(SecureStore.getItemAsync);
const write = jest.mocked(SecureStore.setItemAsync);
const remove = jest.mocked(SecureStore.deleteItemAsync);
const pointerKey = `${MOBILE_AUTH_STORAGE_KEY}.pointer`;
const values = new Map<string, string>();
const message = 'Secure session storage is unavailable.';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let index = 0; index < 30 && !predicate(); index += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}

beforeEach(() => {
  values.clear();
  read.mockReset().mockImplementation(async (key) => values.get(key) ?? null);
  write.mockReset().mockImplementation(async (key, value) => { values.set(key, value); });
  remove.mockReset().mockImplementation(async (key) => { values.delete(key); });
});

afterEach(() => { jest.useRealTimers(); });

describe('development-project native secure session storage', () => {
  it('returns no session when no record exists', async () => {
    await expect(createSecureSessionStorage().getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(pointerKey, expect.objectContaining({
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    }));
    expect(write).not.toHaveBeenCalled();
  });

  it('round-trips a synthetic session using only native secure storage', async () => {
    const storage = createSecureSessionStorage();
    const value = JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, value);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe(value);
    expect(write).toHaveBeenLastCalledWith(pointerKey, expect.any(String), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    });
    expect(read.mock.calls.every(([, options]) => options?.keychainAccessible === SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY)).toBe(true);
  });

  it('chunks large records below the native per-item byte recommendation', async () => {
    const storage = createSecureSessionStorage();
    const value = 'å'.repeat(4000);
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, value);
    const chunks = write.mock.calls.filter(([key]) => key !== pointerKey);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(([, chunk]) => Buffer.byteLength(chunk, 'utf8') <= 1800)).toBe(true);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe(value);
  });

  it('does not split supplementary Unicode characters across chunks', async () => {
    const storage = createSecureSessionStorage();
    const value = `${'x'.repeat(599)}🌱${'🌱'.repeat(800)} Svenska`;
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, value);
    for (const [key, chunk] of write.mock.calls) {
      if (key !== pointerKey) expect(chunk).toBe(Buffer.from(chunk, 'utf8').toString('utf8'));
    }
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe(value);
  });

  it.each(['setItem', 'getItem', 'removeItem'] as const)('rejects unrelated keys for %s without touching native storage', async (method) => {
    const storage = createSecureSessionStorage();
    const result = method === 'setItem' ? storage.setItem('another-project', 'synthetic') : storage[method]('another-project');
    await expect(result).rejects.toThrow(message);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([['empty', ''], ['oversized', 'x'.repeat(MAX_SESSION_LENGTH + 1)]])('rejects a %s session before native access', async (_label, value) => {
    await expect(createSecureSessionStorage().setItem(MOBILE_AUTH_STORAGE_KEY, value)).rejects.toThrow(message);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['not-json', 'null', '[]', '{}', '{"version":2,"slot":"a","count":1,"length":1}',
    '{"version":1,"slot":"other","count":1,"length":1}',
    '{"version":1,"slot":"a","count":1000,"length":1}',
    '{"version":1,"slot":"a","count":1,"length":24001}',
    'x'.repeat(101)])('fails closed on corrupt pointer metadata: %s', async (raw) => {
    values.set(pointerKey, raw);
    await expect(createSecureSessionStorage().getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', 'truncated'])('fails closed on missing or truncated secure chunks', async (chunk) => {
    values.set(pointerKey, JSON.stringify({ version: 1, slot: 'a', count: 1, length: 20 }));
    if (chunk !== null) values.set(`${MOBILE_AUTH_STORAGE_KEY}.a.0`, chunk);
    await expect(createSecureSessionStorage().getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
  });

  it('preserves the previous complete record if writing a replacement chunk fails', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'old-synthetic-session');
    write.mockRejectedValueOnce(new Error('synthetic-private-native-detail'));
    await expect(storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-synthetic-session')).rejects.toThrow(message);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe('old-synthetic-session');
    await storage.clear();
    expect(values.size).toBe(0);
  });

  it('publishes complete records atomically then removes the previous chunks', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'old-synthetic-session');
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-synthetic-session');
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe('new-synthetic-session');
    expect(values.has(`${MOBILE_AUTH_STORAGE_KEY}.a.0`)).toBe(false);
    expect(JSON.parse(values.get(pointerKey)!).slot).toBe('b');
  });

  it('clears only its own project keys and remains usable after close', async () => {
    const storage = createSecureSessionStorage();
    values.set('unrelated-project', 'synthetic-unrelated');
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
    storage.close();
    await storage.clear();
    expect([...values.entries()]).toEqual([['unrelated-project', 'synthetic-unrelated']]);
    expect(remove.mock.calls.every(([key]) => key.startsWith(`${MOBILE_AUTH_STORAGE_KEY}.`))).toBe(true);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
    await expect(storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'late-session')).rejects.toThrow(message);
    await expect(storage.removeItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
  });

  it('SDK removeItem clears its own session', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
    await storage.removeItem(MOBILE_AUTH_STORAGE_KEY);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBeNull();
  });

  it('sanitizes native failures rather than leaking their details', async () => {
    read.mockRejectedValueOnce(new Error('synthetic-password synthetic-access-token'));
    await expect(createSecureSessionStorage().getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toEqual(new Error(message));
  });

  it('does not return a session if closed during an in-flight read', async () => {
    const storage = createSecureSessionStorage();
    const pending = deferred<string | null>();
    read.mockReturnValueOnce(pending.promise);
    const result = storage.getItem(MOBILE_AUTH_STORAGE_KEY);
    await until(() => read.mock.calls.length === 1);
    storage.close();
    pending.resolve(null);
    await expect(result).rejects.toThrow(message);
  });

  it('queues cleanup behind a late chunk write and prevents publishing after close', async () => {
    const storage = createSecureSessionStorage();
    const pending = deferred<void>();
    write.mockImplementationOnce(async (key, value) => { await pending.promise; values.set(key, value); });
    const result = storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
    await until(() => write.mock.calls.length === 1);
    storage.close();
    const cleanup = storage.clear();
    expect(remove).not.toHaveBeenCalled();
    pending.resolve();
    await expect(result).rejects.toThrow(message);
    await cleanup;
    expect(write).not.toHaveBeenCalledWith(pointerKey, expect.anything(), expect.anything());
    expect(values.size).toBe(0);
  });

  it('also clears a pointer whose native publication completes after close', async () => {
    const storage = createSecureSessionStorage();
    const pending = deferred<void>();
    write.mockImplementation(async (key, value) => {
      if (key === pointerKey) await pending.promise;
      values.set(key, value);
    });
    const result = storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
    await until(() => write.mock.calls.some(([key]) => key === pointerKey));
    storage.close();
    const cleanup = storage.clear();
    pending.resolve();
    await expect(result).rejects.toThrow(message);
    await cleanup;
    expect(values.size).toBe(0);
  });

  it('bounds hung native reads, fences the adapter and retains cleanup ordering', async () => {
    jest.useFakeTimers();
    const storage = createSecureSessionStorage();
    const pending = deferred<string | null>();
    read.mockReturnValueOnce(pending.promise);
    const result = storage.getItem(MOBILE_AUTH_STORAGE_KEY);
    const assertion = expect(result).rejects.toThrow(message);
    await jest.advanceTimersByTimeAsync(SECURE_STORAGE_TIMEOUT_MS);
    await assertion;
    const cleanup = storage.clear();
    expect(remove).not.toHaveBeenCalled();
    pending.resolve(null);
    await cleanup;
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
  });

  it('attempts chunk cleanup even if removing the pointer fails', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
    remove.mockRejectedValueOnce(new Error('synthetic-private-delete-detail'));
    await expect(storage.clear()).rejects.toEqual(new Error(message));
    expect(values.has(`${MOBILE_AUTH_STORAGE_KEY}.a.0`)).toBe(false);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
  });

  it('keeps cleanup ordered before writes from a replacement client', async () => {
    const first = createSecureSessionStorage();
    await first.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-first-account');
    const pending = deferred<void>();
    remove.mockImplementationOnce(async (key) => { await pending.promise; values.delete(key); });
    first.close();
    const cleanup = first.clear();
    await until(() => remove.mock.calls.length === 1);
    const second = createSecureSessionStorage();
    const replacement = second.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-second-account');
    expect(write).toHaveBeenCalledTimes(2);
    pending.resolve();
    await cleanup;
    await replacement;
    await expect(second.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe('synthetic-second-account');
    expect([...values.values()].join('')).not.toContain('synthetic-first-account');
    await expect(first.removeItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(message);
    await expect(second.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe('synthetic-second-account');
  });

  it('reports bounded cleanup failure without allowing its late deletion to race a newer write', async () => {
    jest.useFakeTimers();
    const storage = createSecureSessionStorage();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-first-account');
    const pending = deferred<void>();
    remove.mockImplementationOnce(async (key) => { await pending.promise; values.delete(key); });
    storage.close();
    const cleanup = storage.clear();
    const assertion = expect(cleanup).rejects.toThrow(message);
    await jest.advanceTimersByTimeAsync(SECURE_STORAGE_TIMEOUT_MS);
    await assertion;
    const second = createSecureSessionStorage();
    const replacement = second.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-second-account');
    pending.resolve();
    await replacement;
    await expect(second.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBe('synthetic-second-account');
  });
});
