import { createRequire } from 'node:module';
import path from 'node:path';
import { normalizeMobileApiBaseUrl } from '../src/api/story-projects';

const load = createRequire(__filename);
const { readApiConfig, normalizeApiBaseUrl } = load('../scripts/api-config.cjs') as {
  readApiConfig: (root: string, mode: string, read?: jest.Mock) => unknown;
  normalizeApiBaseUrl: (value: unknown) => string | null;
};
const valid = ['http://192.168.20.30:8000', 'https://10.23.45.67', 'http://172.16.0.1/api/v1/', 'http://172.31.255.255:65535/', 'http://10.0.0.1:80'];
const invalid = ['', ' http://10.0.0.1', 'http://10.0.0.1 ', 'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://0.0.0.0', 'http://[::1]', 'http://169.254.169.254', 'http://8.8.8.8', 'https://example.test',
  'https://edbkuunyeyxnyenmmqud.supabase.co', 'http://172.15.1.1', 'http://172.32.1.1', 'http://192.169.1.1',
  'http://010.0.0.1', 'http://10.1', 'http://0x0a000001', 'http://167772161', 'http://10.0.0.256',
  'http://10.0.0.1:0', 'http://10.0.0.1:080', 'http://10.0.0.1:65536', 'http://10.0.0.1?x=1',
  'http://10.0.0.1/#token', 'http://user:pass@10.0.0.1', 'http://10.0.0.1/story-projects',
  'http://10.0.0.1/api/v1//', 'http://10.0.0.1/api/v1/../v1', 'file://10.0.0.1', null, {}, 10];

describe('mobile-local API configuration at launcher and runtime boundaries', () => {
  it.each(valid)('accepts an explicit private LAN endpoint consistently: %s', value => {
    expect(normalizeApiBaseUrl(value)).toBe(new URL(value).origin);
    expect(normalizeMobileApiBaseUrl(value)).toBe(normalizeApiBaseUrl(value));
  });
  it.each(invalid)('rejects unsafe or ambiguous configuration: %s', value => {
    expect(normalizeApiBaseUrl(value)).toBeNull();
    expect(() => normalizeMobileApiBaseUrl(value)).toThrow();
  });
  it('never opens a local file during verification or exports', () => {
    const read = jest.fn();
    for (const mode of ['verification', '', 'production']) expect(readApiConfig('/mobile', mode, read)).toEqual({ enabled: false });
    expect(read).not.toHaveBeenCalled();
  });
  it('opens only the explicit ignored API settings file, normalizing the optional prefix', () => {
    const read = jest.fn().mockReturnValue(JSON.stringify({ baseUrl: valid[2] }));
    expect(readApiConfig('/mobile', 'development', read)).toEqual({ enabled: true, baseUrl: 'http://172.16.0.1' });
    expect(read).toHaveBeenCalledWith(path.join('/mobile', 'development.api.local.json'), 'utf8');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(['not-json', '{}', 'null', '[]', JSON.stringify({ baseUrl: valid[0], token: 'synthetic' }),
    JSON.stringify({ baseUrl: '' }), 'x'.repeat(1025)])('fails closed without a fallback', raw => {
    expect(readApiConfig('/mobile', 'development', jest.fn().mockReturnValue(raw))).toEqual({ enabled: false });
  });
  it('keeps file errors private', () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(readApiConfig('/mobile', 'development', jest.fn(() => { throw new Error('synthetic-private-detail'); }))).toEqual({ enabled: false });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
