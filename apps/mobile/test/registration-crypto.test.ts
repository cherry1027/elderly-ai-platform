import { webcrypto } from 'node:crypto';
import { assertRegistrationCrypto, createRegistrationState, type RegistrationCrypto } from '../src/auth/registration-crypto';

const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterEach(() => { if (original) Object.defineProperty(globalThis, 'crypto', original); else Reflect.deleteProperty(globalThis, 'crypto'); });
const set = (provider: unknown) => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: provider });

test('accepts the injected test runtime CSPRNG and S256 provider', async () => {
  set(webcrypto);
  await expect(assertRegistrationCrypto(webcrypto as unknown as RegistrationCrypto)).resolves.toBeUndefined();
});
test('creates distinct 256-bit public correlation states with the approved test CSPRNG', () => {
  set(webcrypto);
  const first = createRegistrationState(webcrypto as unknown as RegistrationCrypto);
  const next = createRegistrationState(webcrypto as unknown as RegistrationCrypto);
  expect(first).toMatch(/^[a-f0-9]{64}$/); expect(next).not.toBe(first);
});
test('rejects a provider different from the SDK global crypto', async () => {
  set(undefined);
  await expect(assertRegistrationCrypto(webcrypto as unknown as RegistrationCrypto)).rejects.toThrow('Registration cryptography is unavailable.');
});
test.each([
  { getRandomValues: () => new Uint8Array(32) },
  { getRandomValues: () => new Uint8Array(32), subtle: { digest: async () => new ArrayBuffer(32) } },
  { getRandomValues: () => new Uint8Array(32).fill(1), subtle: { digest: async () => new ArrayBuffer(32) } },
])('rejects missing, weak or incorrect crypto capabilities', async provider => {
  set(provider);
  await expect(assertRegistrationCrypto(provider as unknown as RegistrationCrypto)).rejects.toThrow('Registration cryptography is unavailable.');
});
