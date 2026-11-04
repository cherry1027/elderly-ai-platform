import { createRequire } from 'node:module';
import Constants from 'expo-constants';
import { normalizeMobileApiBaseUrl } from '../src/api/story-projects';
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const load = createRequire(__filename);
const { readStagingConfig } = load('../scripts/staging-config.cjs') as {
  readStagingConfig(root: string, mode: string, read: jest.Mock): unknown;
};
const config = { apiOrigin: 'https://memy-staging.example.test', supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co',
  publishableKey: 'sb_publishable_synthetic_value_1234567890' };
it('keeps staging configuration out of ordinary verification and development', () => {
  const read = jest.fn();
  for (const mode of ['verification', 'development', 'production']) expect(readStagingConfig('/mobile', mode, read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('accepts only explicitly selected staging configuration', () => {
  expect(readStagingConfig('/mobile', 'staging', jest.fn(() => JSON.stringify(config)))).toEqual(config);
});
it.each(['http://public.example.test', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?key=value', 'https://localhost'])('rejects unsafe staging origin %s', apiOrigin => {
  expect(readStagingConfig('/mobile', 'staging', jest.fn(() => JSON.stringify({ ...config, apiOrigin })))).toBeNull();
});
it.each([{ secret: 'never-bundle' }, { publishableKey: 'sb_secret_never_bundle' }, { supabaseUrl: 'https://unapproved.supabase.co' }])('rejects secrets and unapproved Auth projects', patch => {
  expect(readStagingConfig('/mobile', 'staging', jest.fn(() => JSON.stringify({ ...config, ...patch })))).toBeNull();
});
it('pins transport requests to the single approved HTTPS origin', () => {
  const previous = Constants.expoConfig;
  Constants.expoConfig = { ...previous, extra: { memyStagingApiOrigin: config.apiOrigin } } as typeof Constants.expoConfig;
  try {
    expect(normalizeMobileApiBaseUrl(config.apiOrigin)).toBe(config.apiOrigin);
    expect(() => normalizeMobileApiBaseUrl('https://other.example.test')).toThrow();
    expect(() => normalizeMobileApiBaseUrl('http://public.example.test')).toThrow();
    expect(normalizeMobileApiBaseUrl('http://192.168.0.2:8000')).toBe('http://192.168.0.2:8000');
  } finally { Constants.expoConfig = previous; }
});
