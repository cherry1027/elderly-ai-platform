import { createRequire } from 'node:module';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readRealAiConfig } from '../src/real-ai/config';
const load = createRequire(__filename);
const script = load('../scripts/real-ai-config.cjs') as { readRealAiConfig(root: string, mode: string, read: jest.Mock): unknown };
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
const base = { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' };
afterEach(() => jest.restoreAllMocks());
describe('explicit real API mode separate from v1 simulation and secret configuration', () => {
  it('does not read private developer configuration in any verification/export mode', () => {
    const read = jest.fn(() => { throw new Error('must not open local file'); });
    for (const mode of ['verification', 'production', 'preview', '']) expect(script.readRealAiConfig('/mobile', mode, read)).toEqual({ enabled: false });
    expect(read).not.toHaveBeenCalled();
  });
  it('requires one exact explicit contract marker and client-safe private URL', () => {
    expect(script.readRealAiConfig('/mobile', 'development', jest.fn(() => JSON.stringify(base)))).toEqual({ ...base, enabled: true });
  });
  it.each([{}, { baseUrl: base.baseUrl }, { ...base, apiContract: 'mock-v1' }, { ...base, token: 'forbidden' },
    { ...base, baseUrl: 'http://127.0.0.1:8000' }, { ...base, baseUrl: 'https://public.example.test' }])('fails closed for malformed local settings %#', value => {
    expect(script.readRealAiConfig('/mobile', 'development', jest.fn(() => JSON.stringify(value)))).toEqual({ enabled: false });
  });
  it('reads only the explicit runtime real contract; never guesses from a v1 backend URL', () => {
    const old = Constants.expoConfig, platform = jest.replaceProperty(Platform, 'OS', 'ios');
    try {
      Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: { memyDevelopmentApi: { enabled: true, baseUrl: base.baseUrl } } } });
      expect(readRealAiConfig()).toBeNull();
      Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: { memyRealAiApi: { ...base, enabled: true } } } });
      expect(readRealAiConfig()).toEqual(base);
      Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { extra: { memyRealAiApi: { ...base, enabled: true, secret: 'forbidden' } } } });
      expect(readRealAiConfig()).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { platform.restore(); Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: old }); }
  });
});
