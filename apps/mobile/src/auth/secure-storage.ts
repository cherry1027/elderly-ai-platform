import * as SecureStore from 'expo-secure-store';

export const MOBILE_AUTH_STORAGE_KEY = 'memy.auth.edbkuunyeyxnyenmmqud.v1';
export const SECURE_STORAGE_TIMEOUT_MS = 4000;
export const MAX_SESSION_LENGTH = 24000;
const CHUNK_LENGTH = 600;
const MAX_CHUNKS = Math.ceil(MAX_SESSION_LENGTH / (CHUNK_LENGTH - 1));
const POINTER_KEY = `${MOBILE_AUTH_STORAGE_KEY}.pointer`;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
const MESSAGE = 'Secure session storage is unavailable.';
type Slot = 'a' | 'b';
type Pointer = { version: 1; slot: Slot; count: number; length: number };

export interface SecureSessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  close(): void;
  clear(): Promise<void>;
}

// Keep the actual native operations ordered across client replacements. A timeout
// cannot cancel a native operation, so it must not release this queue early.
let nativeQueue: Promise<void> = Promise.resolve();

function bounded<T>(operation: Promise<T>, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(MESSAGE));
    }, SECURE_STORAGE_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); reject(new Error(MESSAGE)); },
    );
  });
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const operation = nativeQueue.then(work);
  nativeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function chunkKey(slot: Slot, index: number): string {
  return `${MOBILE_AUTH_STORAGE_KEY}.${slot}.${index}`;
}

function parsePointer(raw: string | null): Pointer | null {
  if (raw === null) return null;
  if (raw.length > 100) throw new Error(MESSAGE);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error(MESSAGE);
  const pointer = value as Partial<Pointer>;
  if (pointer.version !== 1 || (pointer.slot !== 'a' && pointer.slot !== 'b')
    || !Number.isInteger(pointer.length) || !Number.isInteger(pointer.count)
    || !pointer.length || pointer.length < 1 || pointer.length > MAX_SESSION_LENGTH
    || !pointer.count || pointer.count < Math.ceil(pointer.length / CHUNK_LENGTH)
    || pointer.count > Math.ceil(pointer.length / (CHUNK_LENGTH - 1))) {
    throw new Error(MESSAGE);
  }
  return pointer as Pointer;
}

function checkKey(key: string): void {
  if (key !== MOBILE_AUTH_STORAGE_KEY) throw new Error(MESSAGE);
}

function splitChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + CHUNK_LENGTH, value.length);
    // Keep surrogate pairs together across the native string bridge.
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function createSecureSessionStorage(): SecureSessionStorage {
  let closed = false;
  const checkOpen = () => { if (closed) throw new Error(MESSAGE); };
  const run = <T>(work: () => Promise<T>): Promise<T> => closed
    ? Promise.reject(new Error(MESSAGE))
    : bounded(enqueue(work), () => { closed = true; });

  // Deleting the pointer first makes interrupted cleanup fail closed. Only this
  // adapter's fixed development-project namespace is ever touched.
  async function erase(check: () => void) {
    check();
    let failed = false;
    try { await SecureStore.deleteItemAsync(POINTER_KEY, OPTIONS); } catch { failed = true; }
    check();
    const keys = (['a', 'b'] as const).flatMap((slot) =>
      Array.from({ length: MAX_CHUNKS }, (_, index) => chunkKey(slot, index)));
    const results = await Promise.allSettled(keys.map(async (key) => {
      check();
      await SecureStore.deleteItemAsync(key, OPTIONS);
    }));
    check();
    if (failed || results.some((result) => result.status === 'rejected')) throw new Error(MESSAGE);
  }
  const clear = () => bounded(enqueue(() => erase(() => undefined)));

  return {
    getItem(key) {
      return run(async () => {
        checkKey(key);
        checkOpen();
        const pointer = parsePointer(await SecureStore.getItemAsync(POINTER_KEY, OPTIONS));
        checkOpen();
        if (!pointer) return null;
        const chunks: string[] = [];
        for (let index = 0; index < pointer.count; index += 1) {
          const chunk = await SecureStore.getItemAsync(chunkKey(pointer.slot, index), OPTIONS);
          checkOpen();
          if (typeof chunk !== 'string' || chunk.length < 1 || chunk.length > CHUNK_LENGTH
            || (index < pointer.count - 1 && chunk.length < CHUNK_LENGTH - 1)) throw new Error(MESSAGE);
          chunks.push(chunk);
        }
        const value = chunks.join('');
        if (value.length !== pointer.length) throw new Error(MESSAGE);
        return value;
      });
    },
    setItem(key, value) {
      return run(async () => {
        checkKey(key);
        checkOpen();
        if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SESSION_LENGTH) {
          throw new Error(MESSAGE);
        }
        const previous = parsePointer(await SecureStore.getItemAsync(POINTER_KEY, OPTIONS));
        checkOpen();
        const slot = previous?.slot === 'a' ? 'b' : 'a';
        const chunks = splitChunks(value);
        const count = chunks.length;
        for (let index = 0; index < count; index += 1) {
          await SecureStore.setItemAsync(chunkKey(slot, index), chunks[index], OPTIONS);
          checkOpen();
        }
        // Publish only a complete new record; the previous record survives a
        // failed chunk write. The auth service clears storage on any failure.
        await SecureStore.setItemAsync(POINTER_KEY, JSON.stringify({ version: 1, slot, count, length: value.length }), OPTIONS);
        checkOpen();
        if (previous) {
          for (let index = 0; index < previous.count; index += 1) {
            await SecureStore.deleteItemAsync(chunkKey(previous.slot, index), OPTIONS);
            checkOpen();
          }
        }
      });
    },
    removeItem(key) {
      return run(async () => {
        checkKey(key);
        // Keep the SDK operation inside its generation fence. Explicit clear()
        // is reserved for the service's ordered cleanup after close().
        await erase(checkOpen);
      });
    },
    close() { closed = true; },
    clear,
  };
}
