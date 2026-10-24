import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

const CACHE_DIRECTORY = 'memy-private-pdf-v1';
const MAX_BYTES = 2_000_000;
const MAX_FILES = 8;
const MAX_SCAN = 256;
const MAX_AGE_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNED_NAME = /^memy-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

export type NativePdfErrorKind = 'invalid' | 'unavailable' | 'storage' | 'cleanup' | 'revoked' | 'busy';
/** Only a fixed category survives native failures; paths and provider errors do not. */
export class NativePdfError extends Error {
  constructor(readonly kind: NativePdfErrorKind) {
    super('The private PDF operation could not be completed.');
    this.name = 'NativePdfError';
  }
}

/** An opaque, RAM-only capability. A cloned object is deliberately not usable. */
export type PrivatePdfHandle = Readonly<{ id: string }>;
export type PrivatePdfStore = {
  save(bytes: Uint8Array): Promise<PrivatePdfHandle>;
  share(handle: PrivatePdfHandle): Promise<void>;
  discard(handle: PrivatePdfHandle): Promise<void>;
  revoke(): Promise<void>;
};

type CacheFile = {
  readonly uri: string;
  readonly name: string;
  readonly exists: boolean;
  readonly size: number;
  create(): void;
  write(bytes: Uint8Array): Promise<void>;
  bytesSync(): Uint8Array;
  delete(): void;
};
type CacheDirectory = { readonly exists: boolean; create(): void; list(): (CacheFile | { uri: string; name: string })[] };
export type PrivatePdfDependencies = {
  directory(): CacheDirectory;
  file(name: string): CacheFile;
  isFile(value: unknown): value is CacheFile;
  uuid(): string;
  now(): number;
  available(): Promise<boolean>;
  share(uri: string): Promise<void>;
};

const nativeDependencies: PrivatePdfDependencies = {
  directory: () => new Directory(Paths.cache, CACHE_DIRECTORY),
  file: name => new File(new Directory(Paths.cache, CACHE_DIRECTORY), name),
  isFile: (value): value is File => value instanceof File,
  uuid: () => Crypto.randomUUID(),
  now: () => Date.now(),
  available: async () => {
    // An Expo Go binary lacking Sharing must not prevent the ordinary app from opening.
    try { return await nativeSharing().isAvailableAsync(); } catch { return false; }
  },
  share: async uri => {
    await nativeSharing().shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  },
};

function nativeSharing(): typeof import('expo-sharing') {
  // Static literal keeps Metro resolution, while deferring native-module access until a deliberate share.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-sharing') as typeof import('expo-sharing');
}

/** Mirrors the backend's bounded PDF signature checks, before any disk write. */
function validBytes(bytes: unknown): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > MAX_BYTES) return false;
  const prefix = [37, 80, 68, 70, 45]; // %PDF-
  if (!prefix.every((value, index) => bytes[index] === value)) return false;
  let end = bytes.length;
  while (end > 0 && [9, 10, 11, 12, 13, 32].includes(bytes[end - 1])) end--;
  return [37, 37, 69, 79, 70].every((value, index) => bytes[end - 5 + index] === value);
}

type Entry = { file: CacheFile; createdAt: number; leased: boolean; discarded: boolean; owner: object };

/** A single serialized coordinator keeps cleanup from racing file preparation or a share lease. */
export function createPrivatePdfCache(dependencies: PrivatePdfDependencies = nativeDependencies) {
  const entries = new Map<PrivatePdfHandle, Entry>();
  let queue = Promise.resolve();
  function serial<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }
  function remove(handle: PrivatePdfHandle, entry: Entry) {
    if (entry.leased) return;
    try {
      if (entry.file.exists) entry.file.delete();
      entries.delete(handle);
    } catch { throw new NativePdfError('cleanup'); }
  }
  function purge() {
    return serial(() => {
      try {
        for (const [handle, entry] of entries) {
          if (!entry.leased && (entry.discarded || !entry.file.exists || dependencies.now() - entry.createdAt > MAX_AGE_MS)) {
            remove(handle, entry);
          }
        }
        const directory = dependencies.directory();
        if (!directory.exists) return;
        const files = directory.list();
        if (files.length > MAX_SCAN) throw new NativePdfError('cleanup');
        let failed = false;
        for (const candidate of files) {
          if (!dependencies.isFile(candidate) || !OWNED_NAME.test(candidate.name)) continue;
          const expected = dependencies.file(candidate.name);
          if (candidate.uri !== expected.uri) continue;
          const match = [...entries].find(([, entry]) => entry.file.uri === candidate.uri);
          if (match && (match[1].leased || (!match[1].discarded && dependencies.now() - match[1].createdAt <= MAX_AGE_MS))) continue;
          try {
            if (match) remove(match[0], match[1]);
            else if (candidate.exists) candidate.delete();
          } catch { failed = true; }
        }
        if (failed) throw new NativePdfError('cleanup');
      } catch { throw new NativePdfError('cleanup'); }
    });
  }

  function createStore(): PrivatePdfStore {
    const owner = {};
    let active = true;
    function owned(handle: PrivatePdfHandle): Entry {
      const entry = entries.get(handle);
      if (!active || !entry || entry.owner !== owner || entry.discarded) throw new NativePdfError('revoked');
      return entry;
    }
    function inspect(entry: Entry) {
      if (!entry.file.exists || entry.file.size < 20 || entry.file.size > MAX_BYTES ||
        dependencies.now() - entry.createdAt > MAX_AGE_MS || !validBytes(entry.file.bytesSync())) {
        throw new NativePdfError('invalid');
      }
    }
    return {
      async save(bytes) {
        if (!active) throw new NativePdfError('revoked');
        if (!validBytes(bytes)) throw new NativePdfError('invalid');
        // Own the bytes before the first await; callers cannot mutate an in-flight write.
        const copy = new Uint8Array(bytes);
        try { await purge(); } catch (error) { copy.fill(0); throw error; }
        return serial(async () => {
          let handle: PrivatePdfHandle | undefined;
          let entry: Entry | undefined;
          try {
            if (!active) throw new NativePdfError('revoked');
            if (entries.size >= MAX_FILES) throw new NativePdfError('storage');
            const id = dependencies.uuid();
            if (!UUID.test(id)) throw new NativePdfError('storage');
            const directory = dependencies.directory();
            if (!directory.exists) directory.create();
            const file = dependencies.file('memy-' + id + '.pdf');
            if (file.exists) throw new NativePdfError('storage');
            handle = Object.freeze({ id });
            entry = { file, createdAt: dependencies.now(), leased: false, discarded: false, owner };
            entries.set(handle, entry);
            file.create();
            // SDK 58 writes asynchronously. Keep the queue lease and private
            // bytes until native writing settles, including during revocation.
            await file.write(copy);
            if (!active) throw new NativePdfError('revoked');
            inspect(entry);
            const written = file.bytesSync();
            if (file.size !== copy.length || written.length !== copy.length ||
              written.some((value, index) => value !== copy[index])) throw new NativePdfError('storage');
            return handle;
          } catch (error) {
            if (handle && entry) {
              entry.discarded = true;
              remove(handle, entry);
            }
            throw error instanceof NativePdfError ? error : new NativePdfError('storage');
          } finally { copy.fill(0); }
        });
      },
      async share(handle) {
        const entry = await serial(() => {
          const current = owned(handle);
          if (current.leased) throw new NativePdfError('busy');
          try { inspect(current); } catch (error) {
            current.discarded = true;
            remove(handle, current);
            throw error instanceof NativePdfError ? error : new NativePdfError('storage');
          }
          current.leased = true;
          return current;
        });
        try {
          if (!await dependencies.available()) throw new NativePdfError('unavailable');
          // Account revocation during the availability await may never open a new sheet.
          owned(handle);
          await dependencies.share(entry.file.uri);
        } catch (error) {
          throw error instanceof NativePdfError ? error : new NativePdfError('unavailable');
        } finally {
          await serial(() => {
            entry.leased = false;
            if (!active || entry.discarded) remove(handle, entry);
          });
        }
      },
      discard(handle) {
        return serial(() => {
          const entry = entries.get(handle);
          if (!entry || entry.owner !== owner) return;
          entry.discarded = true;
          remove(handle, entry);
        });
      },
      revoke() {
        // Synchronous revocation closes the gate even while a native share promise is pending.
        active = false;
        return serial(() => {
          let failed = false;
          for (const [handle, entry] of entries) if (entry.owner === owner) {
            entry.discarded = true;
            try { remove(handle, entry); } catch { failed = true; }
          }
          if (failed) throw new NativePdfError('cleanup');
        });
      },
    };
  }
  return { createStore, purge };
}

const privateCache = createPrivatePdfCache();
export const createPrivatePdfStore = () => privateCache.createStore();
/** Startup orphan cleanup touches only recognized files in our dedicated app-cache directory. */
export const purgeOwnedPdfCache = () => privateCache.purge();
