import { createRequire } from 'node:module';
import path from 'node:path';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { DEVELOPMENT_SUPABASE_URL, readMobileAuthConfig, validateMobileAuthConfig } from '../src/auth/config';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

const load = createRequire(__filename);
const { readClientConfig } = load('../scripts/auth-config.cjs') as {
  readClientConfig: (root: string, mode: string, read?: jest.Mock) => unknown;
};
const settings = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: 'sb_publishable_synthetic_mobile_key_for_tests' };

describe('approved mobile configuration boundary', () => {
  it('accepts only the fixed development project and publishable client key', () => {
    expect(validateMobileAuthConfig(settings)).toEqual(settings);
  });
  it.each(['https://legacy.supabase.co', DEVELOPMENT_SUPABASE_URL + '/', DEVELOPMENT_SUPABASE_URL + '/auth/v1', 'http://edbkuunyeyxnyenmmqud.supabase.co'])('rejects alternate endpoint %s', (supabaseUrl) => {
    expect(() => validateMobileAuthConfig({ ...settings, supabaseUrl })).toThrow('Authentication configuration.');
  });
  it.each(['', 'service_role', 'sb_secret_synthetic_never_allowed', 'eyJ.synthetic.jwt', 'REPLACE_WITH_DEVELOPMENT_PUBLISHABLE_KEY'])('rejects unsupported key format %s', (publishableKey) => {
    expect(() => validateMobileAuthConfig({ ...settings, publishableKey })).toThrow('Authentication configuration.');
  });
  it('never reads configuration during checks or build exports', () => {
    const read = jest.fn();
    for (const mode of ['verification', '', 'production']) expect(readClientConfig('/mobile', mode, read)).toEqual({ enabled: false });
    expect(read).not.toHaveBeenCalled();
  });
  it('reads only the mobile-local JSON file with the two approved client fields', () => {
    const read = jest.fn().mockReturnValue(JSON.stringify(settings));
    expect(readClientConfig('/mobile', 'development', read)).toEqual({ enabled: true, ...settings });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(path.join('/mobile', 'development.auth.local.json'), 'utf8');
  });
  it.each(['not-json', 'null', '[]', '{}', JSON.stringify({ ...settings, serviceRole: 'synthetic forbidden field' }), 'x'.repeat(2049)])('fails closed for malformed or unexpected config', (raw) => {
    expect(readClientConfig('/mobile', 'development', jest.fn().mockReturnValue(raw))).toEqual({ enabled: false });
  });
  it('does not leak file errors or their content', () => {
    expect(readClientConfig('/mobile', 'development', jest.fn(() => { throw new Error('synthetic private detail'); }))).toEqual({ enabled: false });
  });
  it('has no actual configuration by default in automated tests', () => {
    expect(() => readMobileAuthConfig()).toThrow('Authentication configuration.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('validates Expo public config again at runtime', () => {
    const previous = Constants.expoConfig;
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: { memyDevelopmentAuth: { enabled: true, ...settings } } } });
    try { expect(readMobileAuthConfig()).toEqual(settings); }
    finally { Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous }); platform.restore(); }
  });
});
