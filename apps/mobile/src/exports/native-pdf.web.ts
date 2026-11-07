/** Browser-only adapter. Documents remain in RAM until an explicit download. */
import { randomUUID } from 'expo-crypto';
import type { NativePdfErrorKind, PrivatePdfHandle, PrivatePdfStore } from './native-pdf';
export type { NativePdfErrorKind, PrivatePdfHandle, PrivatePdfStore } from './native-pdf';

export class NativePdfError extends Error {
  constructor(readonly kind: NativePdfErrorKind) {
    super('The private PDF operation could not be completed.'); this.name = 'NativePdfError';
  }
}
const MAX_BYTES = 2_000_000, MAX_FILES = 8, MAX_AGE_MS = 3_600_000;
type Entry = { owner: object; bytes: Uint8Array; created: number; urls: Set<string> };
const entries = new Map<PrivatePdfHandle, Entry>();
function available() { return typeof document !== 'undefined' && document.visibilityState !== 'hidden' && typeof URL.createObjectURL === 'function'; }
function valid(bytes: unknown): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > MAX_BYTES ||
      String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return false;
  let end = bytes.length;
  while (end && [9, 10, 11, 12, 13, 32].includes(bytes[end - 1])) end--;
  return String.fromCharCode(...bytes.subarray(end - 5, end)) === '%%EOF';
}
function remove(handle: PrivatePdfHandle, entry: Entry) {
  for (const url of entry.urls) URL.revokeObjectURL(url);
  entry.urls.clear(); entry.bytes.fill(0); entries.delete(handle);
}
export async function purgeOwnedPdfCache(): Promise<void> {
  for (const [handle, entry] of entries) if (Date.now() - entry.created > MAX_AGE_MS) remove(handle, entry);
}
export function createPrivatePdfStore(): PrivatePdfStore {
  const owner = {}; let active = true;
  function owned(handle: PrivatePdfHandle): Entry {
    const entry = entries.get(handle);
    if (!active || !entry || entry.owner !== owner) throw new NativePdfError('revoked');
    if (!available()) throw new NativePdfError('unavailable');
    if (!valid(entry.bytes) || Date.now() - entry.created > MAX_AGE_MS) { remove(handle, entry); throw new NativePdfError('invalid'); }
    return entry;
  }
  const revoke = async () => {
    active = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
    for (const [handle, entry] of entries) if (entry.owner === owner) remove(handle, entry);
  };
  const background = () => { if (document.visibilityState === 'hidden') void revoke(); };
  const pageHide = () => { void revoke(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);
  return {
    async save(bytes) {
      if (!active) throw new NativePdfError('revoked');
      if (!available()) throw new NativePdfError('unavailable');
      if (!valid(bytes)) throw new NativePdfError('invalid');
      // Copy before any await; caller-owned buffers may be cleared immediately.
      const copy = Uint8Array.from(bytes);
      try {
        await purgeOwnedPdfCache();
        if (!active) throw new NativePdfError('revoked');
        if (entries.size >= MAX_FILES) throw new NativePdfError('storage');
        const handle = Object.freeze({ id: randomUUID() });
        entries.set(handle, { owner, bytes: copy, created: Date.now(), urls: new Set() });
        return handle;
      } catch (error) { copy.fill(0); throw error; }
    },
    async share(handle) {
      const entry = owned(handle), copy = new Uint8Array(entry.bytes.length); copy.set(entry.bytes);
      let url: string | undefined;
      try {
        const blob = new Blob([copy.buffer], { type: 'application/pdf' });
        url = URL.createObjectURL(blob); entry.urls.add(url);
        owned(handle);
        const link = document.createElement('a');
        link.href = url; link.download = 'Memy-story.pdf'; link.rel = 'noopener';
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); }
        // Allow the browser to consume the URL before the owning screen discards it.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      } catch { throw new NativePdfError('unavailable'); }
      finally { copy.fill(0); if (url) { URL.revokeObjectURL(url); entry.urls.delete(url); } }
    },
    async discard(handle) { const entry = entries.get(handle); if (entry?.owner === owner) remove(handle, entry); },
    revoke,
  };
}
