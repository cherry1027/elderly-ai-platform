/** Explicit staging is pinned to one HTTPS origin, never a development fallback. */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, normalizeMobileApiBaseUrl } from '../src/api/story-projects';
import { readRealAiConfig, readRealAiRequested } from '../src/real-ai/config';
import { sendRealMessage } from '../src/real-ai/api';
import { realIds as ids, realScope } from './real-ai-fixtures';
import { DEVELOPMENT_SUPABASE_URL, readMobileAuthConfig } from '../src/auth/config';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));
const origin = 'https://memy-staging.example.test';
const lan = 'http://192.168.20.40:8000';
function extra(baseUrl: string) {
  return { memyDevelopmentApi: { enabled: true, baseUrl },
    memyRealAiApi: { enabled: true, baseUrl, apiContract: 'real-v2' } };
}
function withRuntime(value: Record<string, unknown>, development: boolean, check: () => void, platformName = 'ios') {
  const previous = Constants.expoConfig, dev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  const platform = jest.replaceProperty(Platform, 'OS', platformName as typeof Platform.OS);
  Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: value } });
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: development });
  try { check(); } finally {
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous });
    if (dev) Object.defineProperty(globalThis, '__DEV__', dev); else Reflect.deleteProperty(globalThis, '__DEV__');
    platform.restore();
  }
}

it.each([false, true])('pins both API readers to the exact staging HTTPS origin with __DEV__=%s', development => {
  withRuntime({ ...extra(origin), memyStagingApiOrigin: origin }, development, () => {
    expect(readMobileApiConfig()).toEqual({ baseUrl: origin });
    expect(readRealAiConfig()).toEqual({ baseUrl: origin, apiContract: 'real-v2' });
    expect(readRealAiRequested()).toBe(true);
    expect(normalizeMobileApiBaseUrl(origin)).toBe(origin);
  });
});

it.each([false, true].flatMap(development =>
  [lan, 'https://192.168.20.40:8000', 'https://other.example.test', `${origin}/api/v1`, `${origin}/`]
    .map(baseUrl => [development, baseUrl] as const)))(
  'rejects stale or mismatched API extras with __DEV__=%s: %s', (development, baseUrl) => {
    withRuntime({ ...extra(baseUrl), memyStagingApiOrigin: origin }, development, () => {
      expect(readMobileApiConfig()).toBeNull();
      expect(readRealAiConfig()).toBeNull();
      expect(readRealAiRequested()).toBe(false);
      expect(() => normalizeMobileApiBaseUrl(baseUrl)).toThrow();
    });
  });

it.each([false, true].flatMap(development => [undefined, null, false, 0, '', 'http://staging.example.test', 'https://127.0.0.1',
  'https://192.168.20.40', 'https://localhost', 'https://staging.local', 'https://user:secret@example.test',
  `${origin}/path`, `${origin}?key=value`, `${origin}#fragment`, 'https://invalid-.example.test',
  `https://${'a'.repeat(64)}.example.test`].map(marker => [development, marker] as const)))(
  'fails closed for malformed present staging marker %#', (development, marker) => {
  withRuntime({ ...extra(lan), memyRealAiRequested: true, memyStagingApiOrigin: marker }, development, () => {
    expect(readMobileApiConfig()).toBeNull();
    expect(readRealAiConfig()).toBeNull();
    expect(readRealAiRequested()).toBe(false);
    expect(() => normalizeMobileApiBaseUrl(lan)).toThrow();
  });
});

it('preserves explicit development LAN behavior only when no staging marker is present', () => {
  withRuntime(extra(lan), true, () => {
    expect(readMobileApiConfig()).toEqual({ baseUrl: lan });
    expect(readRealAiConfig()).toEqual({ baseUrl: lan, apiContract: 'real-v2' });
    expect(normalizeMobileApiBaseUrl(`${lan}/api/v1/`)).toBe(lan);
  });
  withRuntime(extra(lan), false, () => {
    expect(readMobileApiConfig()).toBeNull();
    expect(readRealAiConfig()).toBeNull();
    expect(readRealAiRequested()).toBe(false);
  });
});

it('keeps an explicitly requested valid staging setup visible when its API extras are absent', () => {
  withRuntime({ memyStagingApiOrigin: origin, memyRealAiRequested: true }, false, () => {
    expect(readRealAiRequested()).toBe(true);
    expect(readRealAiConfig()).toBeNull();
  });
});

it('never activates native staging configuration on web', () => {
  withRuntime({ ...extra(origin), memyStagingApiOrigin: origin }, false, () => {
    expect(readMobileApiConfig()).toBeNull();
    expect(readRealAiConfig()).toBeNull();
    expect(readRealAiRequested()).toBe(false);
  }, 'web');
});

it('rejects stale LAN transport before reading a token or making either v1/v2 requests', async () => {
  const getAccessToken = jest.fn(async () => 'synthetic.access-token.signature');
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  let projectRead: Promise<unknown> | undefined, realWrite: Promise<unknown> | undefined;
  withRuntime({ ...extra(lan), memyStagingApiOrigin: origin }, true, () => {
    projectRead = listStoryProjects({ baseUrl: lan, getAccessToken, request });
    realWrite = sendRealMessage({ ...realScope(), baseUrl: lan, getAccessToken, request },
      { source_transcript_id: ids.transcript }, ids.key);
  });
  await expect(projectRead).rejects.toMatchObject({ kind: 'configuration' });
  await expect(realWrite).rejects.toMatchObject({ kind: 'configuration' });
  expect(getAccessToken).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([false, true])('uses the validated staging marker for Auth with __DEV__=%s', development => {
  const auth = { supabaseUrl: DEVELOPMENT_SUPABASE_URL,
    publishableKey: 'sb_publishable_synthetic_mobile_key_for_tests' };
  withRuntime({ memyStagingApiOrigin: origin, memyDevelopmentAuth: { ...auth, enabled: true } }, development, () => {
    expect(readMobileAuthConfig()).toEqual(auth);
  });
  for (const marker of [undefined, null, false, '', 'http://staging.example.test', 'https://192.168.20.40']) {
    withRuntime({ memyStagingApiOrigin: marker, memyDevelopmentAuth: { ...auth, enabled: true } }, development, () => {
      expect(() => readMobileAuthConfig()).toThrow('Authentication configuration.');
    });
  }
  withRuntime({ memyDevelopmentAuth: { ...auth, enabled: true } }, development, () => {
    if (development) expect(readMobileAuthConfig()).toEqual(auth);
    else expect(() => readMobileAuthConfig()).toThrow('Authentication configuration.');
  });
});

afterEach(() => expect(globalThis.fetch).not.toHaveBeenCalled());
