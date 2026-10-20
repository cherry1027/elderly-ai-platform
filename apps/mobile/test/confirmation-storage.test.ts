import * as SecureStore from 'expo-secure-store';
import { CONFIRMATION_RECORD_KEY, CONFIRMATION_TTL_MS, createConfirmationStorage, REGISTRATION_STORAGE_KEY } from '../src/auth/confirmation-storage';

jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const values = new Map<string, string>();
const read = jest.mocked(SecureStore.getItemAsync);
const write = jest.mocked(SecureStore.setItemAsync);
const remove = jest.mocked(SecureStore.deleteItemAsync);
const email = 'synthetic@example.invalid';
const state = 'a'.repeat(64);
const verifier = JSON.stringify('a'.repeat(112));
const slot = `${REGISTRATION_STORAGE_KEY}-flow-12345678-code-verifier`;
beforeEach(() => {
  values.clear();
  read.mockImplementation(async key => values.get(key) ?? null);
  write.mockImplementation(async (key, value) => { values.set(key, value); });
  remove.mockImplementation(async key => { values.delete(key); });
});
afterEach(() => { jest.useRealTimers(); });

test('stores only pending email, time and PKCE in its separate fixed secure record', async () => {
  const storage = createConfirmationStorage();
  await storage.begin(email, state);
  await storage.setItem(slot, verifier);
  await storage.setItem(`${REGISTRATION_STORAGE_KEY}-flows-code-verifier`, JSON.stringify(['12345678']));
  await storage.setItem(`${REGISTRATION_STORAGE_KEY}-code-verifier`, verifier);
  expect(await storage.getItem(slot)).toBe(verifier);
  expect(await storage.pending()).toMatchObject({ email, state });
  expect([...values.keys()]).toEqual([CONFIRMATION_RECORD_KEY]);
  expect(write.mock.calls.every(([key, value, options]) => key === CONFIRMATION_RECORD_KEY &&
    Buffer.byteLength(value, 'utf8') <= 1800 && options?.keychainAccessible === SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY)).toBe(true);
});

test('SDK session and user keys stay in memory and disappear when the adapter closes', async () => {
  const storage = createConfirmationStorage();
  await storage.setItem(REGISTRATION_STORAGE_KEY, 'synthetic-access-token');
  await storage.setItem(`${REGISTRATION_STORAGE_KEY}-user`, 'synthetic-user');
  expect(await storage.getItem(REGISTRATION_STORAGE_KEY)).toBe('synthetic-access-token');
  expect(write).not.toHaveBeenCalled();
  storage.close();
  await expect(storage.getItem(REGISTRATION_STORAGE_KEY)).rejects.toThrow('Registration storage is unavailable.');
  expect(await createConfirmationStorage().getItem(REGISTRATION_STORAGE_KEY)).toBeNull();
});

test('restores one pending flow after creating a new adapter and blocks another signup', async () => {
  const first = createConfirmationStorage();
  await first.begin(email, state); await first.setItem(slot, verifier); first.close();
  const next = createConfirmationStorage();
  expect(await next.getItem(slot)).toBe(verifier);
  await expect(next.begin('other@example.invalid', state)).rejects.toMatchObject({ kind: 'pending' });
  expect(await next.pending()).toMatchObject({ email, state });
});

test('expiry deletes only the registration record, allowing a later attempt', async () => {
  jest.useFakeTimers();
  values.set('unrelated', 'untouched');
  const storage = createConfirmationStorage();
  await storage.begin(email, state);
  jest.setSystemTime(Date.now() + CONFIRMATION_TTL_MS);
  expect(await storage.pending()).toBeNull();
  expect([...values.entries()]).toEqual([['unrelated', 'untouched']]);
  await storage.begin(email, state);
  expect(await storage.pending()).toMatchObject({ email });
});

test.each(['memy.auth.edbkuunyeyxnyenmmqud.v1', 'other', `${REGISTRATION_STORAGE_KEY}-flow-../../evil-code-verifier`])('rejects an unrelated SDK key %s', async key => {
  const storage = createConfirmationStorage();
  await expect(storage.setItem(key, verifier)).rejects.toThrow('Registration storage is unavailable.');
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});

test.each(['not-json', '{}', '[]', 'x'.repeat(1801)])('rejects corrupt secure records safely', async value => {
  values.set(CONFIRMATION_RECORD_KEY, value);
  await expect(createConfirmationStorage().pending()).rejects.toThrow('Registration storage is unavailable.');
});

test('cannot add a second verifier flow or persist token-shaped values as PKCE', async () => {
  const storage = createConfirmationStorage(); await storage.begin(email, state); await storage.setItem(slot, verifier);
  await expect(storage.setItem(`${REGISTRATION_STORAGE_KEY}-flow-abcdefgh-code-verifier`, verifier)).rejects.toThrow();
  await expect(storage.setItem(`${REGISTRATION_STORAGE_KEY}-code-verifier`, JSON.stringify({ access_token: 'synthetic' }))).rejects.toThrow();
});

test('close fences queued writes and explicit clear remains ordered and usable', async () => {
  const storage = createConfirmationStorage(); await storage.begin(email, state);
  let finish!: () => void;
  write.mockImplementationOnce(async (key, value) => { await new Promise<void>(resolve => { finish = resolve; }); values.set(key, value); });
  const pending = storage.setItem(slot, verifier);
  for (let step = 0; step < 20 && !finish; step++) await Promise.resolve();
  expect(finish).toBeDefined(); storage.close(); const cleanup = storage.clear(); finish();
  await expect(pending).rejects.toThrow(); await cleanup;
  expect(values.has(CONFIRMATION_RECORD_KEY)).toBe(false);
  await expect(storage.setItem(slot, verifier)).rejects.toThrow();
});

test('native errors are sanitized and cleanup failure is reported', async () => {
  read.mockRejectedValueOnce(new Error('synthetic-private-data'));
  await expect(createConfirmationStorage().pending()).rejects.toThrow('Registration storage is unavailable.');
  remove.mockRejectedValueOnce(new Error('synthetic-private-data'));
  await expect(createConfirmationStorage().clear()).rejects.toThrow('Registration storage is unavailable.');
});
