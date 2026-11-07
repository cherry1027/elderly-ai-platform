import { createRequire } from 'node:module';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readWebStaging } from '../src/web-staging';
import { readMobileAuthConfig } from '../src/auth/config.web';
import { readMobileApiConfig } from '../src/api/config.web';
import { readRealAiConfig, readRealAiRequested } from '../src/real-ai/config.web';
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const load = createRequire(__filename);
const { readWebStagingConfig } = load('../scripts/web-staging-config.cjs');
const { exportEnvironment } = load('../scripts/export-web-staging.cjs');
const { publicHostSettings, renderStaticBlueprint } = load('../../../web-preview/staging.cjs');
const config = { webOrigin: 'https://memy-web.example.test', apiOrigin: 'https://memy-api.example.test',
  supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_value_1234567890' };
const previousPlatform = Platform.OS, previousConstants = Constants.expoConfig;
const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location'), oldSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
function install() {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(config.webOrigin) });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Constants.expoConfig = { name: 'Memy', slug: 'memy-mobile', extra: { memyWebStaging: { webOrigin: config.webOrigin, apiOrigin: config.apiOrigin },
    memyStagingApiOrigin: config.apiOrigin,
    memyDevelopmentAuth: { enabled: true, supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey },
    memyDevelopmentApi: { enabled: true, baseUrl: config.apiOrigin },
    memyRealAiRequested: true, memyRealAiApi: { enabled: true, baseUrl: config.apiOrigin, apiContract: 'real-v2' },
  } } as typeof Constants.expoConfig;
}
beforeEach(install);
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: previousPlatform }); Constants.expoConfig = previousConstants;
  if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else Reflect.deleteProperty(globalThis, 'location');
  if (oldSecure) Object.defineProperty(globalThis, 'isSecureContext', oldSecure); else Reflect.deleteProperty(globalThis, 'isSecureContext');
});
it('never reads real staging settings during native checks or ordinary development', () => {
  const read = jest.fn();
  for (const mode of ['verification', 'development', 'staging', 'production']) expect(readWebStagingConfig('/mobile', mode, read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(readWebStagingConfig('/mobile', 'web-staging', jest.fn(() => JSON.stringify(config)))).toEqual(config);
});
it.each(['http://site.example.test', 'https://127.0.0.1', 'https://192.168.1.2', 'https://localhost',
  'https://site.local', 'https://name:password@site.example.test', 'https://site.example.test/path', 'https://site.example.test/',
  'https://site.example.test?token=value', 'https://bad-.example.test'])('rejects unsafe origins %s', value => {
  for (const key of ['webOrigin', 'apiOrigin']) expect(readWebStagingConfig('/mobile', 'web-staging', jest.fn(() => JSON.stringify({ ...config, [key]: value })))).toBeNull();
});
it.each([{ secretKey: 'never' }, { publishableKey: 'sb_secret_never' }, { supabaseUrl: 'https://wrong.supabase.co' },
  { apiOrigin: config.webOrigin }])('rejects unapproved configuration %#', patch => {
  expect(readWebStagingConfig('/mobile', 'web-staging', jest.fn(() => JSON.stringify({ ...config, ...patch })))).toBeNull();
});
it('activates only the exact secure frontend and API origin, with the pinned project', () => {
  expect(readWebStaging()).toEqual({ webOrigin: config.webOrigin, apiOrigin: config.apiOrigin });
  expect(readMobileAuthConfig().supabaseUrl).toBe(config.supabaseUrl);
  expect(readMobileApiConfig()).toEqual({ baseUrl: config.apiOrigin });
  expect(readRealAiConfig()).toEqual({ baseUrl: config.apiOrigin, apiContract: 'real-v2' }); expect(readRealAiRequested()).toBe(true);
});
it.each(['https://other.example.test', 'http://memy-web.example.test', 'http://127.0.0.1:8768'])('fails closed when served from %s', href => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(href) });
  expect(readWebStaging()).toBeNull(); expect(() => readMobileAuthConfig()).toThrow();
  expect(readMobileApiConfig()).toBeNull(); expect(readRealAiConfig()).toBeNull(); expect(readRealAiRequested()).toBe(false);
});
it('refuses insecure contexts, malformed markers and native platforms', () => {
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false }); expect(readWebStaging()).toBeNull(); install();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' }); expect(readWebStaging()).toBeNull(); install();
  Constants.expoConfig!.extra!.memyStagingApiOrigin = 'https://other.example.test'; expect(readWebStaging()).toBeNull();
});
it('strips backend/provider/process configuration and rejects inherited Expo public values', () => {
  const env = exportEnvironment({ PATH: '/synthetic', HOME: '/synthetic', OPENAI_API_KEY: 'never', SUPABASE_SECRET_KEY: 'never',
    NODE_OPTIONS: '--require secret', MEMY_MOBILE_AUTH_MODE: 'development', MEMY_WEB_ORIGIN: config.webOrigin });
  expect(env).toMatchObject({ PATH: '/synthetic', EXPO_NO_DOTENV: '1', EXPO_NO_CLIENT_ENV_VARS: '1', MEMY_MOBILE_AUTH_MODE: 'web-staging' });
  expect(JSON.stringify(env)).not.toContain('never'); expect(env.NODE_OPTIONS).toBeUndefined(); expect(env.MEMY_WEB_ORIGIN).toBeUndefined();
  expect(() => exportEnvironment({ EXPO_PUBLIC_SECRET: 'never' })).toThrow('Remove inherited');
});
it('generates exact host CSP, HTTPS callback rewrites and disabled automatic deployment', () => {
  const settings = publicHostSettings(config, '<html><script>globalThis.synthetic=true</script></html>');
  const headers = Object.fromEntries(settings.headers.map((item: {name: string; value: string}) => [item.name, item.value]));
  expect(headers['Content-Security-Policy']).toContain(`connect-src 'self' ${config.apiOrigin} ${config.supabaseUrl}`);
  expect(headers['Content-Security-Policy']).toContain("'sha256-"); expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
  expect(headers['Referrer-Policy']).toBe('no-referrer'); expect(headers['Permissions-Policy']).toContain('microphone=(self)');
  expect(settings.authCallback).toBe(`${config.webOrigin}/auth/callback`);
  expect(settings.routes[0]).toEqual({ type: 'rewrite', source: '/auth/callback', destination: '/index.html' });
  const blueprint = renderStaticBlueprint(settings); expect(blueprint.services[0].autoDeployTrigger).toBe('off');
  expect(blueprint.services[0].rootDir).toBe('apps/mobile');
  expect(blueprint.services[0].buildCommand).toContain('node scripts/export-web-staging.cjs');
  expect(JSON.stringify(blueprint)).not.toContain(config.publishableKey);
});
