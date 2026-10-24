import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { createPrivatePdfCache, createPrivatePdfStore, NativePdfError, type PrivatePdfDependencies } from '../src/exports/native-pdf';

jest.unmock('../src/exports/native-pdf');
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///synthetic-cache/' } },
  File: jest.fn(), Directory: jest.fn(),
}));

const id = '50000000-0000-4000-8000-000000000001';
const privateRoot = 'file:///synthetic-cache/memy-private-pdf-v1/';
const ownedName = 'memy-' + id + '.pdf';
const pdf = () => new Uint8Array(Array.from('%PDF-1.4\nfictional test bytes\n%%EOF\n', character => character.charCodeAt(0)));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let now = 10_000;
  let nextId = 1;
  let directoryExists = false;
  const files = new Map<string, MemoryFile>();
  const extra: { name: string; uri: string }[] = [];
  class MemoryFile {
    data = new Uint8Array();
    exists = false;
    sizeOverride: number | undefined;
    uri: string;
    constructor(readonly name: string) { this.uri = privateRoot + name; }
    get size() { return this.sizeOverride ?? this.data.length; }
    create = jest.fn(() => { this.exists = true; });
    write = jest.fn(async (bytes: Uint8Array) => { this.data = new Uint8Array(bytes); });
    bytesSync = jest.fn(() => new Uint8Array(this.data));
    delete = jest.fn(() => { this.exists = false; this.data.fill(0); });
  }
  const file = jest.fn((name: string) => {
    if (!files.has(name)) files.set(name, new MemoryFile(name));
    return files.get(name)!;
  });
  const directory = {
    get exists() { return directoryExists; },
    create: jest.fn(() => { directoryExists = true; }),
    list: jest.fn(() => [...files.values()].filter(candidate => candidate.exists).concat(extra as never)),
  };
  const dependencies: PrivatePdfDependencies = {
    directory: jest.fn(() => directory), file,
    isFile: (value): value is MemoryFile => value instanceof MemoryFile,
    uuid: jest.fn(() => '50000000-0000-4000-8000-' + String(nextId++).padStart(12, '0')),
    now: jest.fn(() => now),
    available: jest.fn(async () => true), share: jest.fn(async () => {}),
  };
  const cache = createPrivatePdfCache(dependencies);
  const store = cache.createStore();
  const existing = (name: string, bytes = pdf()) => { directoryExists = true; const candidate = file(name); candidate.exists = true; candidate.data = bytes; return candidate; };
  return { cache, store, dependencies, directory, file, files, extra, existing, advance: (milliseconds: number) => { now += milliseconds; } };
}

test('validated bytes use a random private filename, remain unchanged and never share automatically', async () => {
  const f = fixture(); const bytes = pdf(); const before = Array.from(bytes);
  const handle = await f.store.save(bytes);
  expect(handle).toEqual({ id });
  expect(Object.isFrozen(handle)).toBe(true);
  expect(f.file).toHaveBeenCalledWith(ownedName);
  expect(f.directory.create).toHaveBeenCalledTimes(1);
  expect(Array.from(f.files.get(ownedName)!.data)).toEqual(before);
  expect(Array.from(bytes)).toEqual(before);
  expect(f.dependencies.share).not.toHaveBeenCalled();
  expect(JSON.stringify(handle)).not.toMatch(/file:|synthetic-cache|story|account/);
  await f.store.revoke();
});

test.each([
  new Uint8Array(), new Uint8Array(19), new Uint8Array(2_000_001),
  new Uint8Array(Array.from('<html>not a real PDF and secret</html>', character => character.charCodeAt(0))),
  new Uint8Array(Array.from('%PDF-1.4\nnot finalized and no EOF', character => character.charCodeAt(0))),
])('invalid or oversized bytes never create a file: case %#', async bytes => {
  const f = fixture();
  await expect(f.store.save(bytes)).rejects.toMatchObject({ kind: 'invalid' });
  expect(f.directory.create).not.toHaveBeenCalled(); expect(f.file).not.toHaveBeenCalled();
  expect(f.dependencies.uuid).not.toHaveBeenCalled(); expect(f.dependencies.share).not.toHaveBeenCalled();
});

test('PDF trailing whitespace is accepted within the backend limit', async () => {
  const f = fixture(); const content = new Uint8Array(2_000_000); content.fill(32); content.set(pdf());
  await f.store.save(content); expect(f.files.get(ownedName)!.size).toBe(2_000_000);
  await f.store.revoke();
});

test.each(['../private', 'file:///elsewhere', '50000000-0000-1000-8000-000000000001', 'not-a-uuid'])('unsafe native randomness never creates a file: %s', async invalid => {
  const f = fixture(); jest.mocked(f.dependencies.uuid).mockReturnValue(invalid);
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'storage' });
  expect(f.file).not.toHaveBeenCalled(); expect(f.directory.create).not.toHaveBeenCalled();
});

test('the caller cannot mutate an in-flight save after initial validation', async () => {
  const f = fixture(); const bytes = pdf(); const valid = Array.from(bytes); const pending = f.store.save(bytes);
  bytes.fill(0);
  await pending; expect(Array.from(f.files.get(ownedName)!.data)).toEqual(valid);
  await f.store.revoke();
});

test('SDK 58 async writing finishes before inspection, capability return or private-buffer clearing', async () => {
  const f = fixture(); const file = f.file(ownedName); const gate = deferred<void>();
  const bytes = pdf(); const expected = Array.from(bytes);
  file.write.mockImplementationOnce(async value => {
    await gate.promise;
    file.data = new Uint8Array(value);
  });
  let settled = false;
  const save = f.store.save(bytes);
  void save.then(() => { settled = true; }, () => { settled = true; });
  bytes.fill(0); // only the cache-owned copy may be used after the first await
  for (let turn = 0; turn < 20 && !file.write.mock.calls.length; turn++) await Promise.resolve();
  expect(file.write).toHaveBeenCalledTimes(1);
  const buffered = file.write.mock.calls[0][0];
  expect(Array.from(buffered)).toEqual(expected);
  expect(file.bytesSync).not.toHaveBeenCalled(); expect(settled).toBe(false);
  expect(file.delete).not.toHaveBeenCalled(); expect(f.dependencies.share).not.toHaveBeenCalled();
  gate.resolve();
  const handle = await save;
  expect(handle).toEqual({ id }); expect(Array.from(file.data)).toEqual(expected);
  expect(file.bytesSync).toHaveBeenCalled(); expect(buffered.every(value => value === 0)).toBe(true);
  await f.store.revoke();
});

test('revocation during an async write closes authorization immediately and waits before deleting its file', async () => {
  const f = fixture(); const file = f.file(ownedName); const gate = deferred<void>();
  file.write.mockImplementationOnce(async value => {
    await gate.promise;
    file.data = new Uint8Array(value);
  });
  const save = f.store.save(pdf()); const checked = expect(save).rejects.toMatchObject({ kind: 'revoked' });
  for (let turn = 0; turn < 20 && !file.write.mock.calls.length; turn++) await Promise.resolve();
  expect(file.write).toHaveBeenCalledTimes(1);
  const buffered = file.write.mock.calls[0][0];
  const cleanup = f.store.revoke();
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'revoked' });
  expect(file.exists).toBe(true); expect(file.delete).not.toHaveBeenCalled();
  expect(Array.from(buffered)).toEqual(Array.from(pdf()));
  gate.resolve(); await checked; await cleanup;
  expect(file.exists).toBe(false); expect(file.delete).toHaveBeenCalledTimes(1);
  expect(buffered.every(value => value === 0)).toBe(true);
  expect(f.dependencies.share).not.toHaveBeenCalled(); expect(file.bytesSync).not.toHaveBeenCalled();
});

test('an asynchronous native write rejection is sanitized and cleans the partial file and private buffer', async () => {
  const f = fixture(); const file = f.file(ownedName);
  file.write.mockRejectedValueOnce(new Error('file:///private/path sensitive-provider-message'));
  const error = await f.store.save(pdf()).catch(value => value);
  expect(error).toBeInstanceOf(NativePdfError); expect(error.kind).toBe('storage');
  expect(error.message).not.toMatch(/file:|path|sensitive|provider/);
  expect(file.delete).toHaveBeenCalledTimes(1); expect(file.exists).toBe(false);
  expect(file.bytesSync).not.toHaveBeenCalled(); expect(f.dependencies.share).not.toHaveBeenCalled();
  expect(file.write.mock.calls[0][0].every(value => value === 0)).toBe(true);
});

test('orphan purging remains serialized behind an outstanding async write', async () => {
  const f = fixture(); const file = f.file(ownedName); const gate = deferred<void>();
  file.write.mockImplementationOnce(async value => {
    await gate.promise;
    file.data = new Uint8Array(value);
  });
  const save = f.store.save(pdf());
  for (let turn = 0; turn < 20 && !file.write.mock.calls.length; turn++) await Promise.resolve();
  expect(file.write).toHaveBeenCalledTimes(1);
  const scans = f.directory.list.mock.calls.length;
  let purged = false;
  const purge = f.cache.purge().then(() => { purged = true; });
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  expect(purged).toBe(false); expect(f.directory.list).toHaveBeenCalledTimes(scans);
  expect(file.delete).not.toHaveBeenCalled();
  gate.resolve(); const handle = await save; await purge;
  expect(purged).toBe(true); expect(file.exists).toBe(true); expect(file.delete).not.toHaveBeenCalled();
  await f.store.share(handle); expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await f.store.revoke();
});

test('an existing UUID collision is never overwritten or deleted by save', async () => {
  const f = fixture(); const first = await f.store.save(pdf());
  jest.mocked(f.dependencies.uuid).mockReturnValue(id);
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'storage' });
  expect(f.files.get(ownedName)!.write).toHaveBeenCalledTimes(1);
  expect(f.files.get(ownedName)!.delete).not.toHaveBeenCalled();
  await f.store.share(first); await f.store.revoke();
});

test('explicit sharing checks availability and shares only the exact prepared file', async () => {
  const f = fixture(); const handle = await f.store.save(pdf());
  await f.store.share(handle);
  expect(f.dependencies.available).toHaveBeenCalledTimes(1);
  expect(f.dependencies.share).toHaveBeenCalledWith(privateRoot + ownedName);
  expect(jest.mocked(f.dependencies.available).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(f.dependencies.share).mock.invocationCallOrder[0]);
  await f.store.revoke();
});

test.each([false, 'failure'] as const)('unavailable or failing native sharing exposes no path or raw details: %s', async availability => {
  const f = fixture(); const handle = await f.store.save(pdf());
  if (availability === false) jest.mocked(f.dependencies.available).mockResolvedValue(false);
  else jest.mocked(f.dependencies.available).mockRejectedValue(new Error('private account file:///sensitive/path token'));
  const error = await f.store.share(handle).catch(value => value);
  expect(error).toBeInstanceOf(NativePdfError); expect(error.kind).toBe('unavailable');
  expect(error.message).not.toMatch(/account|file:|token|sensitive/);
  expect(f.dependencies.share).not.toHaveBeenCalled();
  await f.store.revoke();
});

test('a failed share is sanitized and can be retried only by another explicit action', async () => {
  const f = fixture(); const handle = await f.store.save(pdf());
  jest.mocked(f.dependencies.share).mockRejectedValueOnce(new Error('file:///private account-token'));
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'unavailable' });
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await f.store.share(handle); expect(f.dependencies.share).toHaveBeenCalledTimes(2);
  await f.store.revoke();
});

test('foreign and cloned capabilities cannot open another store file', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const other = f.cache.createStore();
  await expect(other.share(handle)).rejects.toMatchObject({ kind: 'revoked' });
  await expect(f.store.share({ ...handle })).rejects.toMatchObject({ kind: 'revoked' });
  await other.discard(handle);
  expect(f.files.get(ownedName)!.delete).not.toHaveBeenCalled();
  expect(f.dependencies.share).not.toHaveBeenCalled();
  await f.store.revoke(); await other.revoke();
});

test('discard removes only an exact owned capability and is idempotent', async () => {
  const f = fixture(); const handle = await f.store.save(pdf());
  await f.store.discard({ id: '../recording.m4a' });
  expect(f.files.get(ownedName)!.delete).not.toHaveBeenCalled();
  await f.store.discard(handle); await f.store.discard(handle);
  expect(f.files.get(ownedName)!.delete).toHaveBeenCalledTimes(1);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'revoked' });
});

test('revoke closes authorization synchronously and removes all this store files', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); await f.store.save(pdf());
  const cleanup = f.store.revoke();
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'revoked' });
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'revoked' });
  await cleanup; await f.store.revoke();
  for (const candidate of f.files.values()) expect(candidate.exists).toBe(false);
  expect(f.dependencies.share).not.toHaveBeenCalled();
});

test('account cleanup leaves another active owner file untouched and cannot share it', async () => {
  const f = fixture(); const first = await f.store.save(pdf()); const other = f.cache.createStore();
  const second = await other.save(pdf()); const otherName = 'memy-' + second.id + '.pdf';
  await f.store.revoke(); await f.cache.purge();
  expect(f.files.get(ownedName)!.exists).toBe(false); expect(f.files.get(otherName)!.exists).toBe(true);
  await expect(other.share(first)).rejects.toMatchObject({ kind: 'revoked' });
  await other.share(second); expect(f.dependencies.share).toHaveBeenCalledWith(privateRoot + otherName);
  await other.revoke();
});

test('revocation before a queued write creates no stale owner file', async () => {
  const f = fixture(); const save = f.store.save(pdf()); const checked = expect(save).rejects.toMatchObject({ kind: 'revoked' });
  await f.store.revoke(); await checked;
  expect(f.directory.create).not.toHaveBeenCalled(); expect(f.dependencies.share).not.toHaveBeenCalled();
});

test('revocation while availability is pending cannot open a new share sheet', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const available = deferred<boolean>();
  jest.mocked(f.dependencies.available).mockReturnValue(available.promise);
  const share = f.store.share(handle); const checked = expect(share).rejects.toMatchObject({ kind: 'revoked' });
  await Promise.resolve(); await Promise.resolve(); await f.store.revoke();
  expect(f.files.get(ownedName)!.exists).toBe(true);
  available.resolve(true); await checked;
  expect(f.dependencies.share).not.toHaveBeenCalled(); expect(f.files.get(ownedName)!.exists).toBe(false);
});

test('iOS background/revoke cannot delete a file leased by the open share sheet', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const sheet = deferred<void>();
  jest.mocked(f.dependencies.share).mockReturnValue(sheet.promise);
  const share = f.store.share(handle);
  for (let turn = 0; turn < 12 && !jest.mocked(f.dependencies.share).mock.calls.length; turn++) await Promise.resolve();
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await f.store.revoke(); await f.cache.purge();
  expect(f.files.get(ownedName)!.exists).toBe(true);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'revoked' });
  sheet.resolve(); await share;
  expect(f.files.get(ownedName)!.exists).toBe(false);
});

test('repeat taps while sharing cannot open duplicate sheets', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const sheet = deferred<void>();
  jest.mocked(f.dependencies.share).mockReturnValue(sheet.promise);
  const share = f.store.share(handle);
  for (let turn = 0; turn < 12 && !jest.mocked(f.dependencies.share).mock.calls.length; turn++) await Promise.resolve();
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'busy' });
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  sheet.resolve(); await share; await f.store.revoke();
});

test('discard during an open sheet defers exact-file deletion until the lease ends', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const sheet = deferred<void>();
  jest.mocked(f.dependencies.share).mockReturnValue(sheet.promise); const share = f.store.share(handle);
  for (let turn = 0; turn < 12 && !jest.mocked(f.dependencies.share).mock.calls.length; turn++) await Promise.resolve();
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await f.store.discard(handle); expect(f.files.get(ownedName)!.exists).toBe(true);
  sheet.resolve(); await share; expect(f.files.get(ownedName)!.exists).toBe(false);
});

test('startup cleanup touches only recognized files in the dedicated directory', async () => {
  const f = fixture(); const old = f.existing(ownedName); const recording = f.existing('recording-' + id + '.m4a');
  const unknown = f.existing('notes.pdf'); const unsafe = f.existing('memy-50000000-0000-4000-8000-000000000002.pdf');
  unsafe.uri = 'file:///unrelated/' + unsafe.name;
  f.dependencies.file = jest.fn(name => name === unsafe.name ? { ...unsafe, uri: privateRoot + name, size: unsafe.size } : f.file(name));
  f.extra.push({ name: 'memy-50000000-0000-4000-8000-000000000003.pdf', uri: privateRoot + 'nested-directory' });
  await f.cache.purge();
  expect(old.delete).toHaveBeenCalledTimes(1); expect(recording.delete).not.toHaveBeenCalled();
  expect(unknown.delete).not.toHaveBeenCalled(); expect(unsafe.delete).not.toHaveBeenCalled();
});

test('startup cleanup skips a still-active store file, but expiry removes it', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); await f.cache.purge();
  expect(f.files.get(ownedName)!.exists).toBe(true);
  f.advance(3_600_001); await f.cache.purge(); expect(f.files.get(ownedName)!.exists).toBe(false);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'revoked' });
});

test('expired files cannot be shared before the next purge', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); f.advance(3_600_001);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'invalid' });
  expect(f.dependencies.share).not.toHaveBeenCalled(); expect(f.files.get(ownedName)!.exists).toBe(false);
});

test.each(['missing', 'size', 'signature'] as const)('a damaged private file fails closed before sharing: %s', async damage => {
  const f = fixture(); const handle = await f.store.save(pdf()); const file = f.files.get(ownedName)!;
  if (damage === 'missing') file.exists = false;
  if (damage === 'size') file.sizeOverride = 2_000_001;
  if (damage === 'signature') file.data.fill(0);
  await expect(f.store.share(handle)).rejects.toMatchObject({ kind: 'invalid' });
  expect(f.dependencies.available).not.toHaveBeenCalled(); expect(f.dependencies.share).not.toHaveBeenCalled();
});

test('failed writes clean their partial file and native exceptions never escape', async () => {
  const f = fixture(); const file = f.file(ownedName);
  file.write.mockImplementationOnce(() => { throw new Error('file:///private/path bearer-secret'); });
  const error = await f.store.save(pdf()).catch(value => value);
  expect(error).toMatchObject({ kind: 'storage' }); expect(error.message).not.toMatch(/file:|bearer|path/);
  expect(file.delete).toHaveBeenCalledTimes(1); expect(file.exists).toBe(false);
});

test('partial creation failures are cleaned using only the reserved random path', async () => {
  const f = fixture(); const file = f.file(ownedName);
  file.create.mockImplementationOnce(() => { file.exists = true; throw new Error('private native details'); });
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'storage' });
  expect(file.delete).toHaveBeenCalledTimes(1); expect(file.write).not.toHaveBeenCalled();
});

test('incorrectly persisted bytes are never offered to sharing', async () => {
  const f = fixture(); const file = f.file(ownedName);
  file.write.mockImplementationOnce(async () => { file.data = pdf(); file.data[12] = 0; });
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'storage' });
  expect(file.exists).toBe(false); expect(f.dependencies.share).not.toHaveBeenCalled();
});

test('cleanup failures are explicit and can be retried without broadening ownership', async () => {
  const f = fixture(); await f.store.save(pdf()); const file = f.files.get(ownedName)!;
  file.delete.mockImplementationOnce(() => { throw new Error('file:///private cleanup error'); });
  await expect(f.store.revoke()).rejects.toMatchObject({ kind: 'cleanup' });
  expect(file.exists).toBe(true); await f.store.revoke(); expect(file.exists).toBe(false);
  expect(file.delete).toHaveBeenCalledTimes(2);
});

test('startup cleanup failure stops new private-file preparation', async () => {
  const f = fixture(); const orphan = f.existing(ownedName);
  orphan.delete.mockImplementationOnce(() => { throw new Error('private cleanup failure'); });
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'cleanup' });
  expect(f.dependencies.uuid).not.toHaveBeenCalled(); expect(orphan.write).not.toHaveBeenCalled();
  await f.cache.purge(); expect(orphan.exists).toBe(false);
});

test('share completion reports deferred cleanup failure rather than claiming private deletion succeeded', async () => {
  const f = fixture(); const handle = await f.store.save(pdf()); const sheet = deferred<void>();
  jest.mocked(f.dependencies.share).mockReturnValue(sheet.promise); const share = f.store.share(handle);
  const checked = expect(share).rejects.toMatchObject({ kind: 'cleanup' });
  for (let turn = 0; turn < 12 && !jest.mocked(f.dependencies.share).mock.calls.length; turn++) await Promise.resolve();
  expect(f.dependencies.share).toHaveBeenCalledTimes(1);
  await f.store.revoke(); f.files.get(ownedName)!.delete.mockImplementationOnce(() => { throw new Error('native failure'); });
  sheet.resolve(); await checked;
  await f.cache.purge(); expect(f.files.get(ownedName)!.exists).toBe(false);
});

test('private cache capacity is bounded without deleting another active file', async () => {
  const f = fixture(); for (let index = 0; index < 8; index++) await f.store.save(pdf());
  await expect(f.store.save(pdf())).rejects.toMatchObject({ kind: 'storage' });
  for (const file of f.files.values()) expect(file.delete).not.toHaveBeenCalled();
  await f.store.revoke();
});

test('suspiciously large cache inventory fails closed without traversing or deleting it', async () => {
  const f = fixture(); f.existing('notes.pdf');
  for (let index = 0; index < 256; index++) f.extra.push({ name: 'unknown-' + index, uri: 'file:///unrelated' });
  await expect(f.cache.purge()).rejects.toMatchObject({ kind: 'cleanup' });
  for (const file of f.files.values()) expect(file.delete).not.toHaveBeenCalled();
});

test('default native adapter uses SDK File/Directory, Expo Crypto and explicit native PDF sharing', async () => {
  let exists = false; let bytes = new Uint8Array();
  const file = { uri: privateRoot + ownedName, name: ownedName, get exists() { return exists; },
    get size() { return bytes.length; }, create: jest.fn(() => { exists = true; }),
    write: jest.fn(async (value: Uint8Array) => { bytes = new Uint8Array(value); }),
    bytesSync: jest.fn(() => new Uint8Array(bytes)), delete: jest.fn(() => { exists = false; }) };
  const directory = { exists: true, create: jest.fn(), list: jest.fn(() => []) };
  jest.mocked(Directory).mockImplementation(() => directory as unknown as Directory);
  jest.mocked(File).mockImplementation(() => file as unknown as File);
  jest.mocked(Crypto.randomUUID).mockReturnValue(id);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  const store = createPrivatePdfStore(); const handle = await store.save(pdf()); await store.share(handle);
  expect(Directory).toHaveBeenCalledWith(Paths.cache, 'memy-private-pdf-v1');
  expect(File).toHaveBeenCalledWith(directory, ownedName);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(privateRoot + ownedName, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  jest.mocked(Sharing.isAvailableAsync).mockRejectedValueOnce(new Error('Native Sharing is absent in this Expo Go binary.'));
  await expect(store.share(handle)).rejects.toMatchObject({ kind: 'unavailable' });
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  await store.revoke(); expect(file.delete).toHaveBeenCalledTimes(1);
});
