import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readMobileApiConfig, validateMobileApiConfig } from '../src/api/config';
import { StoryProjectsError } from '../src/api/story-projects';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const settings = { baseUrl: 'http://192.168.20.40:8000' };

function withConfig(value: unknown, check: () => void, platformName = 'ios') {
  const previous = Constants.expoConfig;
  const platform = jest.replaceProperty(Platform, 'OS', platformName as typeof Platform.OS);
  Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: { memyDevelopmentApi: value } } });
  try { check(); } finally {
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous }); platform.restore();
  }
}

describe('explicit native development API configuration', () => {
  it('validates only the one client-safe URL field and normalizes its prefix', () => {
    expect(validateMobileApiConfig({ baseUrl: `${settings.baseUrl}/api/v1/` })).toEqual(settings);
  });
  it.each([null, undefined, [], {}, { baseUrl: null }, { ...settings, key: 'synthetic-forbidden' },
    { ...settings, enabled: true }, { baseUrl: 'https://public.example.test' }].map(value => [value] as const))('rejects malformed explicit config %#', value => {
    expect(() => validateMobileApiConfig(value)).toThrow(new StoryProjectsError('configuration'));
  });
  it('has no default endpoint and does not make a request', () => {
    expect(readMobileApiConfig()).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['ios', 'android'])('allows explicitly enabled validated settings on development %s', platform => {
    withConfig({ enabled: true, ...settings }, () => { expect(readMobileApiConfig()).toEqual(settings); }, platform);
  });
  it.each([null, {}, [], { ...settings }, { enabled: false, ...settings }, { enabled: 'true', ...settings },
    { enabled: true, baseUrl: 'http://127.0.0.1:8000' }, { enabled: true, ...settings, apiKey: 'synthetic-forbidden' }].map(value => [value] as const))(
    'fails closed for missing, disabled, unsafe or extra runtime settings %#', value => {
      withConfig(value, () => { expect(readMobileApiConfig()).toBeNull(); });
    });
  it('does not activate on web', () => {
    withConfig({ enabled: true, ...settings }, () => { expect(readMobileApiConfig()).toBeNull(); }, 'web');
  });
  it('does not activate in a release runtime even with enabled settings', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
    Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
    try { withConfig({ enabled: true, ...settings }, () => { expect(readMobileApiConfig()).toBeNull(); }); }
    finally { if (descriptor) Object.defineProperty(globalThis, '__DEV__', descriptor); else Reflect.deleteProperty(globalThis, '__DEV__'); }
  });
  it('never consults legacy authentication configuration as an API fallback', () => {
    const previous = Constants.expoConfig;
    Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: {
      extra: { memyDevelopmentAuth: { enabled: true, supabaseUrl: 'https://legacy.supabase.co', publishableKey: 'synthetic' } },
    } });
    try { expect(readMobileApiConfig()).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled(); }
    finally { Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous }); }
  });
});
