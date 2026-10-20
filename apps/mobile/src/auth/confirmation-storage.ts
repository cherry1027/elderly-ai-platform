import * as SecureStore from 'expo-secure-store';

export const REGISTRATION_STORAGE_KEY = 'memy.registration.edbkuunyeyxnyenmmqud.v1';
export const CONFIRMATION_RECORD_KEY = `${REGISTRATION_STORAGE_KEY}.pkce`;
export const CONFIRMATION_TTL_MS = 60 * 60 * 1000;
const MAX_RECORD_BYTES = 1800;
const TIMEOUT_MS = 4000;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false,
};
type RecordValue = { version: 1; email: string; state: string; createdAt: number; values: Record<string, string> };
export class ConfirmationStorageError extends Error {
  constructor(readonly kind: 'pending' | 'storage') { super('Registration storage is unavailable.'); }
}
export interface ConfirmationStorage {
  begin(email: string, state: string): Promise<void>;
  pending(): Promise<{ email: string; state: string; createdAt: number } | null>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  close(): void;
  clear(): Promise<void>;
}
let nativeQueue: Promise<void> = Promise.resolve();
const fail = () => new ConfirmationStorageError('storage');
const bytes = (value: string) => new TextEncoder().encode(value).length;
const verifierKey = `${REGISTRATION_STORAGE_KEY}-code-verifier`;
const indexKey = `${REGISTRATION_STORAGE_KEY}-flows-code-verifier`;
const slotPrefix = `${REGISTRATION_STORAGE_KEY}-flow-`;
const slotSuffix = '-code-verifier';

function pkceKey(key: string): boolean {
  return key === verifierKey || key === indexKey || (key.startsWith(slotPrefix) && key.endsWith(slotSuffix) &&
    /^[A-Za-z0-9_-]{8,64}$/.test(key.slice(slotPrefix.length, -slotSuffix.length)));
}
function validValue(key: string, value: string): boolean {
  if (!pkceKey(key) || typeof value !== 'string' || value.length > 256) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return key === indexKey ? Array.isArray(parsed) && parsed.length <= 1 &&
      parsed.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)) :
      typeof parsed === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(parsed);
  } catch { return false; }
}
function parse(raw: string | null): RecordValue | null {
  if (raw === null) return null;
  if (bytes(raw) > MAX_RECORD_BYTES) throw fail();
  const value = JSON.parse(raw) as Partial<RecordValue>;
  if (!value || value.version !== 1 || typeof value.email !== 'string' || value.email.length > 254 ||
      typeof value.state !== 'string' || !/^[a-f0-9]{64}$/.test(value.state) ||
      !Number.isFinite(value.createdAt) || typeof value.createdAt !== 'number' || value.createdAt > Date.now() + 30_000 ||
      !value.values || Array.isArray(value.values) || typeof value.values !== 'object' ||
      Object.keys(value.values).length > 3 ||
      Object.entries(value.values).some(([key, item]) => !validValue(key, item))) throw fail();
  return value as RecordValue;
}

export function createConfirmationStorage(): ConfirmationStorage {
  let closed = false;
  const memory = new Map<string, string>();
  const open = () => { if (closed) throw fail(); };
  function run<T>(work: () => Promise<T>, afterClose = false): Promise<T> {
    if (closed && !afterClose) return Promise.reject(fail());
    const actual = nativeQueue.then(async () => {
      if (!afterClose) open();
      return work();
    });
    nativeQueue = actual.then(() => {}, () => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([actual, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { closed = true; reject(fail()); }, TIMEOUT_MS);
    })]).catch(error => { throw error instanceof ConfirmationStorageError ? error : fail(); })
      .finally(() => clearTimeout(timer));
  }
  async function read(): Promise<RecordValue | null> {
    const record = parse(await SecureStore.getItemAsync(CONFIRMATION_RECORD_KEY, options));
    open();
    if (record && Date.now() - record.createdAt >= CONFIRMATION_TTL_MS) {
      await SecureStore.deleteItemAsync(CONFIRMATION_RECORD_KEY, options);
      open();
      return null;
    }
    return record;
  }
  async function write(record: RecordValue) {
    open();
    const raw = JSON.stringify(record);
    if (bytes(raw) > MAX_RECORD_BYTES) throw fail();
    await SecureStore.setItemAsync(CONFIRMATION_RECORD_KEY, raw, options);
    open();
  }
  const memoryKey = (key: string) => key === REGISTRATION_STORAGE_KEY || key === `${REGISTRATION_STORAGE_KEY}-user`;
  return {
    begin(email, state) {
      return run(async () => {
        if (await read()) throw new ConfirmationStorageError('pending');
        if (typeof email !== 'string' || email.length > 254 || !/^[a-f0-9]{64}$/.test(state)) throw fail();
        await write({ version: 1, email, state, createdAt: Date.now(), values: {} });
      });
    },
    pending() { return run(async () => { const value = await read(); return value ? { email: value.email, state: value.state, createdAt: value.createdAt } : null; }); },
    getItem(key) {
      if (memoryKey(key)) return closed ? Promise.reject(fail()) : Promise.resolve(memory.get(key) ?? null);
      return run(async () => { if (!pkceKey(key)) throw fail(); return (await read())?.values[key] ?? null; });
    },
    setItem(key, value) {
      if (memoryKey(key)) {
        if (closed || typeof value !== 'string' || value.length > 24000) return Promise.reject(fail());
        memory.set(key, value); return Promise.resolve();
      }
      return run(async () => {
        if (!validValue(key, value)) throw fail();
        const record = await read();
        if (!record) throw fail();
        const values = { ...record.values, [key]: value };
        const slots = Object.keys(values).filter(item => item.startsWith(slotPrefix));
        if (slots.length > 1 || Object.keys(values).length > 3) throw fail();
        await write({ ...record, values });
      });
    },
    removeItem(key) {
      if (memoryKey(key)) { if (closed) return Promise.reject(fail()); memory.delete(key); return Promise.resolve(); }
      return run(async () => {
        if (!pkceKey(key)) throw fail();
        const record = await read();
        if (!record) return;
        const values = { ...record.values }; delete values[key];
        await write({ ...record, values });
      });
    },
    close() { closed = true; memory.clear(); },
    clear() { memory.clear(); return run(() => SecureStore.deleteItemAsync(CONFIRMATION_RECORD_KEY, options), true); },
  };
}
