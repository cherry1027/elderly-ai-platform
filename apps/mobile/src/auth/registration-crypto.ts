// No native crypto provider is approved for registration yet. This narrow
// capability is exercised only by the explicitly gated, offline test harness.
export type RegistrationCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
};

export function createRegistrationState(provider: RegistrationCrypto): string {
  if (!provider || provider !== (globalThis.crypto as unknown) || typeof provider.getRandomValues !== 'function') {
    throw new Error('Registration cryptography is unavailable.');
  }
  const bytes = provider.getRandomValues(new Uint8Array(32));
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32 || !bytes.some(value => value !== 0)) {
    throw new Error('Registration cryptography is unavailable.');
  }
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export async function assertRegistrationCrypto(provider: RegistrationCrypto): Promise<void> {
  // The SDK reads global crypto directly. Checking a different injected object
  // would leave its Math.random/plain fallback active.
  if (!provider || provider !== (globalThis.crypto as unknown) ||
      typeof provider.getRandomValues !== 'function' || typeof provider.subtle?.digest !== 'function') {
    throw new Error('Registration cryptography is unavailable.');
  }
  try {
    const random = provider.getRandomValues(new Uint8Array(32));
    if (!(random instanceof Uint8Array) || !random.some(value => value !== 0)) throw new Error();
    const hash = new Uint8Array(await provider.subtle.digest('SHA-256', new Uint8Array([97, 98, 99])));
    const actual = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error();
  } catch { throw new Error('Registration cryptography is unavailable.'); }
}
