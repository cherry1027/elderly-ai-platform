/** RAM-only auth adapter for the approved browser app.
 * No credentials are written to localStorage, sessionStorage, cookies or disk.
 * Refreshing the preview clears this module and requires signing in again.
 */
export const MOBILE_AUTH_STORAGE_KEY = 'memy.auth.edbkuunyeyxnyenmmqud.v1';
export const SECURE_STORAGE_TIMEOUT_MS = 4000;
export const MAX_SESSION_LENGTH = 24000;
export interface SecureSessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  close(): void;
  clear(): Promise<void>;
}
let savedSession: string | null = null;
const unavailable = () => new Error('Secure session storage is unavailable.');
export function createSecureSessionStorage(): SecureSessionStorage {
  let closed = false;
  const check = (key: string) => { if (closed || key !== MOBILE_AUTH_STORAGE_KEY) throw unavailable(); };
  return {
    async getItem(key) { check(key); return savedSession; },
    async setItem(key, value) {
      check(key);
      if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SESSION_LENGTH) throw unavailable();
      savedSession = value;
    },
    async removeItem(key) { check(key); savedSession = null; },
    close() { closed = true; },
    // The auth service deliberately revokes an engine before ordered cleanup.
    async clear() { savedSession = null; },
  };
}
