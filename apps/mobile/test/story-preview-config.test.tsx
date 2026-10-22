import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform, Text } from 'react-native';
import { Stack } from 'expo-router';
import RootLayout from '../src/app/_layout';
import { GenerationActionsProvider } from '../src/generation/GenerationActions';
import { AuthProvider } from '../src/auth/AuthProvider';
import { RegistrationProvider } from '../src/auth/RegistrationProvider';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { LanguageProvider } from '../src/language';
import { LoginNavigationProvider } from '../src/navigation/LoginNavigation';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => { throw new Error('Secure storage must not be used in sample preview.'); }),
  setItemAsync: jest.fn(() => { throw new Error('Secure storage must not be used in sample preview.'); }),
  deleteItemAsync: jest.fn(() => { throw new Error('Secure storage must not be used in sample preview.'); }),
}));
jest.mock('expo-router', () => ({ Stack: Object.assign(jest.fn(() => {
  throw new Error('Account routing must not mount in sample preview.');
}), { Screen: () => null }) }));
jest.mock('../src/language', () => ({ LanguageProvider: jest.fn(() => { throw new Error('Preference provider must not mount in sample preview.'); }) }));
jest.mock('../src/generation/GenerationActions', () => ({ GenerationActionsProvider: jest.fn(() => { throw new Error('Generation retry provider must not mount in sample preview.'); }) }));
jest.mock('../src/auth/AuthProvider', () => ({ AuthProvider: jest.fn(() => { throw new Error('Auth provider must not mount in sample preview.'); }) }));
jest.mock('../src/auth/RegistrationProvider', () => ({ RegistrationProvider: jest.fn(() => { throw new Error('Registration provider must not mount in sample preview.'); }) }));
jest.mock('../src/navigation/LoginNavigation', () => ({ LoginNavigationProvider: jest.fn(() => { throw new Error('Login provider must not mount in sample preview.'); }) }));

const enabled = {
  memyStoryPreviewEnabled: true,
  memyDevelopmentAuth: { enabled: false },
  memyDevelopmentApi: { enabled: false },
};
const normalReady = {
  memyStoryPreviewEnabled: false,
  memyDevelopmentAuth: { enabled: true, supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co',
    publishableKey: 'sb_publishable_synthetic_configuration_for_tests' },
  memyDevelopmentApi: { enabled: true, baseUrl: 'http://192.168.20.30:8000' },
};
function withExtra(extra: unknown, check: () => void, platformName: typeof Platform.OS = 'ios', metadata: Record<string, unknown> = {}) {
  const previous = Constants.expoConfig;
  const platform = jest.replaceProperty(Platform, 'OS', platformName);
  Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: { ...metadata, extra } });
  try { check(); }
  finally { Object.defineProperty(Constants, 'expoConfig', { configurable: true, value: previous }); platform.restore(); }
}
function expectPersistentDataUntouched() {
  expect(AsyncStorage.setItem).not.toHaveBeenCalled(); expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(AsyncStorage.clear).not.toHaveBeenCalled(); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
}
function renderNormalRoot(extra: unknown = normalReady, metadata: Record<string, unknown> = {}) {
  // Root selection only: real-provider session/preference behavior is covered
  // separately by the authentication and onboarding regression suites.
  const providers = [LanguageProvider, AuthProvider, GenerationActionsProvider, RegistrationProvider, LoginNavigationProvider];
  for (const provider of providers) jest.mocked(provider).mockImplementation(({ children }: PropsWithChildren) => <>{children}</>);
  const stack = Stack as unknown as jest.Mock;
  stack.mockImplementation(() => <Text>Normal application stack</Text>);
  try {
    withExtra(extra, () => {
      const view = render(<RootLayout />);
      try {
        expect(screen.getByText('Normal application stack')).toBeOnTheScreen();
        expect(screen.queryByText('SAMPLE STORIES. Nothing is saved.')).toBeNull();
        expect(screen.queryByText('EXEMPELBERÄTTELSER. Inget sparas.')).toBeNull();
        for (const provider of providers) expect(provider).toHaveBeenCalledTimes(1);
        expect(stack).toHaveBeenCalledTimes(1);
        expectPersistentDataUntouched();
        expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
      } finally { view.unmount(); }
    }, 'ios', metadata);
  } finally {
    for (const provider of providers) jest.mocked(provider).mockImplementation(() => {
      throw new Error('Account or preference providers must not mount in sample preview.');
    });
    stack.mockImplementation(() => { throw new Error('Account routing must not mount in sample preview.'); });
  }
}

describe('explicit sample-story native configuration gate', () => {
  it.each(['ios', 'android'] as const)('accepts only the exact disabled-service configuration on native %s', platform => {
    withExtra(enabled, () => expect(readStoryPreviewEnabled()).toBe(true), platform);
  });
  it('rejects web even with otherwise valid sample configuration', () => {
    withExtra(enabled, () => expect(readStoryPreviewEnabled()).toBe(false), 'web');
  });
  it('rejects production execution even with otherwise valid sample configuration', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
    Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
    try { withExtra(enabled, () => expect(readStoryPreviewEnabled()).toBe(false)); }
    finally { if (descriptor) Object.defineProperty(globalThis, '__DEV__', descriptor); else Reflect.deleteProperty(globalThis, '__DEV__'); }
  });
  it.each([undefined, null, {}, [], false, 'preview',
    { ...enabled, memyStoryPreviewEnabled: false }, { ...enabled, memyStoryPreviewEnabled: 'true' },
    { ...enabled, memyStoryPreviewEnabled: 1 }, { memyStoryPreviewEnabled: true },
  ])('rejects missing, false or malformed preview configuration %#', extra => {
    withExtra(extra, () => expect(readStoryPreviewEnabled()).toBe(false));
  });
  it.each((['memyDevelopmentAuth', 'memyDevelopmentApi'] as const).flatMap(key => [
    undefined, null, false, [], {}, 'disabled', { enabled: true }, { enabled: 0 }, { enabled: 'false' },
    { enabled: false, unexpected: true },
  ].map(value => ({ key, value }))))('requires an exact disabled record for $key (%#)', ({ key, value }) => {
    withExtra({ ...enabled, [key]: value }, () => expect(readStoryPreviewEnabled()).toBe(false));
  });
  it.each([
    { ...enabled, memyDevelopmentAuth: { enabled: true, supabaseUrl: 'https://development.example.invalid', publishableKey: 'synthetic-never-read' } },
    { ...enabled, memyDevelopmentApi: { enabled: true, baseUrl: 'http://192.168.20.30:8000' } },
    { ...enabled, memyDevelopmentAuth: { enabled: false, publishableKey: 'synthetic-never-read' } },
    { ...enabled, memyDevelopmentApi: { enabled: false, baseUrl: 'http://192.168.20.30:8000' } },
  ])('rejects a credential-bearing or enabled service record %#', extra => {
    withExtra(extra, () => expect(readStoryPreviewEnabled()).toBe(false));
  });
  it('cannot be enabled merely by URL-like or query-parameter values', () => {
    withExtra({ ...enabled, memyStoryPreviewEnabled: false,
      url: 'exp://192.168.20.30:8081/--/?memyStoryPreviewEnabled=true',
      queryParams: { memyStoryPreviewEnabled: true },
    }, () => expect(readStoryPreviewEnabled()).toBe(false));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('renders the actual sample UI without mounting account/preference providers or using persistent stores', () => {
    withExtra(enabled, () => {
      const view = render(<RootLayout />);
      try {
        expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
        for (const provider of [LanguageProvider, AuthProvider, GenerationActionsProvider, RegistrationProvider, LoginNavigationProvider]) {
          expect(provider).not.toHaveBeenCalled();
        }
        expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        expect(SecureStore.getItemAsync).not.toHaveBeenCalled(); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
        expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
        expect(globalThis.WebSocket).not.toHaveBeenCalled();
      } finally { view.unmount(); }
    });
  });
  it('mounts only normal routing/providers for ready development configuration without clearing any stored data', () => {
    renderNormalRoot();
  });
  it.each([
    { initialUrl: 'exp://192.168.20.30:8081/--/login?memyStoryPreviewEnabled=true', restoredRoute: '/login' },
    { initialUrl: 'memy-foundation:///authenticated?preview-stories=1', restoredRoute: '/authenticated' },
    { queryParams: { memyStoryPreviewEnabled: true }, linkingUri: 'exp://192.168.20.30:8081/--/welcome' },
  ])('does not select samples from restored-route/query metadata on normal configuration (%#)', metadata => {
    renderNormalRoot(normalReady, metadata);
  });
  it('reopens the normal application after a full sample remount without carrying its gate or clearing stores', () => {
    withExtra(enabled, () => {
      const view = render(<RootLayout />);
      expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
      for (const provider of [LanguageProvider, AuthProvider, GenerationActionsProvider, RegistrationProvider, LoginNavigationProvider]) {
        expect(provider).not.toHaveBeenCalled();
      }
      view.unmount();
    });
    renderNormalRoot();
    expectPersistentDataUntouched();
  });
});

const appRoot = path.resolve(__dirname, '..');
const configSource = fs.readFileSync(path.join(appRoot, 'app.config.cjs'), 'utf8');
const authSource = fs.readFileSync(path.join(appRoot, 'scripts/auth-config.cjs'), 'utf8');
const apiSource = fs.readFileSync(path.join(appRoot, 'scripts/api-config.cjs'), 'utf8');
const launcherSource = fs.readFileSync(path.join(appRoot, 'scripts/run.cjs'), 'utf8');
const identity = { name: 'Synthetic app', slug: 'synthetic-memy', scheme: 'memy-foundation' };

function evaluateAppConfig(environment: Record<string, string>, read: jest.Mock = jest.fn(() => { throw new Error('No real local configuration may be read.'); })) {
  function load(source: string, dependencies: Record<string, unknown>) {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports, __dirname: appRoot, URL,
      process: { env: { ...environment } }, require: (name: string) => {
        if (!(name in dependencies)) throw new Error('Unexpected configuration import.');
        return dependencies[name];
      } });
    return module.exports;
  }
  const modules = { 'node:fs': { readFileSync: read }, 'node:path': path };
  const configure = load(configSource, {
    './scripts/auth-config.cjs': load(authSource, modules),
    './scripts/api-config.cjs': load(apiSource, modules),
  }) as (input: { config: typeof identity & { extra: unknown } }) => typeof identity & { extra: Record<string, unknown> };
  const result = configure({ config: { ...identity, extra: { unapprovedInheritedSetting: true } } });
  return { result, read };
}
function syntheticLocalRead() {
  return jest.fn((filename: string) => {
    if (filename === path.join(appRoot, 'development.auth.local.json')) return JSON.stringify({
      supabaseUrl: normalReady.memyDevelopmentAuth.supabaseUrl,
      publishableKey: normalReady.memyDevelopmentAuth.publishableKey,
    });
    if (filename === path.join(appRoot, 'development.api.local.json')) return JSON.stringify({ baseUrl: normalReady.memyDevelopmentApi.baseUrl });
    throw new Error('Unexpected local configuration path.');
  });
}
function launchEnvironment(action: string, inherited: Record<string, string>) {
  const spawnSync = jest.fn(() => ({ status: 0 }));
  const exit = new Error('Synthetic launcher exit.');
  const requireModule = Object.assign((name: string) => {
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync };
    throw new Error('Unexpected launcher import.');
  }, { resolve: jest.fn((filename: string) => filename) });
  const error = jest.fn(); const log = jest.fn();
  try {
    vm.runInNewContext(launcherSource, {
      __dirname: path.join(appRoot, 'scripts'), require: requireModule, console: { error, log },
      process: { argv: ['synthetic-node', 'scripts/run.cjs', action], env: { ...inherited }, execPath: 'synthetic-node',
        exit: (code: number) => { expect(code).toBe(0); throw exit; } },
    });
  } catch (failure) { if (failure !== exit) throw failure; }
  expect(spawnSync).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
  const [, args, options] = spawnSync.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; cwd: string; shell: boolean }];
  expect(options.cwd).toBe(appRoot); expect(options.shell).toBe(false);
  expect(options.env.EXPO_NO_DOTENV).toBe('1'); expect(options.env.EXPO_NO_CLIENT_ENV_VARS).toBe('1');
  expect(Object.keys(options.env).some(key => key.toUpperCase().startsWith('EXPO_PUBLIC_'))).toBe(false);
  return { environment: options.env, args, log };
}

describe('sample app configuration with mocked filesystem only', () => {
  it('enables samples only in explicit verification mode and disables both services before any local-file read', () => {
    const { result, read } = evaluateAppConfig({ MEMY_MOBILE_AUTH_MODE: 'verification', MEMY_MOBILE_STORY_PREVIEW: '1' });
    expect(result.extra).toEqual(enabled); expect(read).not.toHaveBeenCalled();
    expect(result.name).toBe(`${identity.name} (Sample Stories)`);
    expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
  });
  it.each<Record<string, string>>([{}, { MEMY_MOBILE_AUTH_MODE: 'verification' },
    { MEMY_MOBILE_AUTH_MODE: 'verification', MEMY_MOBILE_STORY_PREVIEW: 'true' },
    { MEMY_MOBILE_AUTH_MODE: 'verification', MEMY_MOBILE_STORY_PREVIEW: '0' },
  ])('keeps preview disabled by default or for a malformed flag (%#)', environment => {
    const { result, read } = evaluateAppConfig(environment);
    expect(result.extra).toEqual({ ...enabled, memyStoryPreviewEnabled: false }); expect(read).not.toHaveBeenCalled();
    expect(result.name).toBe(identity.name); expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
  });
  it('does not enable preview alongside a development-mode configuration', () => {
    const read = jest.fn((filename: string) => filename.endsWith('development.auth.local.json')
      ? JSON.stringify({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_configuration_for_tests' })
      : JSON.stringify({ baseUrl: 'http://192.168.20.30:8000' }));
    const { result } = evaluateAppConfig({ MEMY_MOBILE_AUTH_MODE: 'development', MEMY_MOBILE_STORY_PREVIEW: '1' }, read);
    expect(result.extra.memyStoryPreviewEnabled).toBe(false);
    expect(result.extra.memyDevelopmentAuth).toEqual(expect.objectContaining({ enabled: true }));
    expect(result.extra.memyDevelopmentApi).toEqual(expect.objectContaining({ enabled: true }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.name).toBe(identity.name); expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
  });
});

describe('protected launcher to app-config handoff with synthetic local settings only', () => {
  const inherited = {
    MEMY_MOBILE_STORY_PREVIEW: '1', memy_mobile_story_preview: '1',
    MEMY_MOBILE_AUTH_MODE: 'verification', memy_mobile_auth_mode: 'development',
    EXPO_PUBLIC_UNAPPROVED: 'synthetic-should-be-removed', expo_public_other: 'synthetic-should-be-removed', EXPO_OFFLINE: '1',
  };
  it.each(['start', 'android'])('%s selects normal configuration despite inherited sample flags', action => {
    const { environment, args } = launchEnvironment(action, inherited);
    expect(environment.MEMY_MOBILE_AUTH_MODE).toBe('development');
    expect(Object.keys(environment).filter(key => key.toUpperCase() === 'MEMY_MOBILE_STORY_PREVIEW')).toEqual([]);
    expect(environment).not.toHaveProperty('EXPO_OFFLINE');
    expect(args).toEqual(expect.arrayContaining(['start', '--go', '--lan', '--clear', '--port', '0']));
    const read = syntheticLocalRead(); const { result } = evaluateAppConfig(environment, read);
    expect(result.extra).toEqual(normalReady); expect(result.name).toBe(identity.name);
    expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
    expect(read.mock.calls.map(([filename]) => filename).sort()).toEqual([
      path.join(appRoot, 'development.api.local.json'), path.join(appRoot, 'development.auth.local.json'),
    ].sort());
    withExtra(result.extra, () => expect(readStoryPreviewEnabled()).toBe(false));
  });
  it('enables samples only for explicit preview startup, without opening either local setting or changing app identity', () => {
    const { environment, args } = launchEnvironment('preview-stories', inherited);
    expect(environment.MEMY_MOBILE_AUTH_MODE).toBe('verification'); expect(environment.MEMY_MOBILE_STORY_PREVIEW).toBe('1');
    expect(Object.keys(environment).filter(key => key.toUpperCase() === 'MEMY_MOBILE_STORY_PREVIEW')).toEqual(['MEMY_MOBILE_STORY_PREVIEW']);
    expect(environment).not.toHaveProperty('EXPO_OFFLINE');
    expect(args).toEqual(expect.arrayContaining(['start', '--go', '--lan', '--clear', '--port', '0']));
    const read = syntheticLocalRead(); const { result } = evaluateAppConfig(environment, read);
    expect(result.extra).toEqual(enabled); expect(read).not.toHaveBeenCalled();
    expect(result.name).toBe(`${identity.name} (Sample Stories)`); expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
    withExtra(result.extra, () => expect(readStoryPreviewEnabled()).toBe(true));
  });
  it('keeps offline verification separate from explicit sample startup and never opens local settings', () => {
    const { environment } = launchEnvironment('test', inherited);
    expect(environment.MEMY_MOBILE_AUTH_MODE).toBe('verification'); expect(environment.EXPO_OFFLINE).toBe('1');
    expect(environment).not.toHaveProperty('MEMY_MOBILE_STORY_PREVIEW');
    const read = syntheticLocalRead(); const { result } = evaluateAppConfig(environment, read);
    expect(result.extra).toEqual({ ...enabled, memyStoryPreviewEnabled: false }); expect(read).not.toHaveBeenCalled();
    expect(result.name).toBe(identity.name); expect(result.slug).toBe(identity.slug); expect(result.scheme).toBe(identity.scheme);
    expectPersistentDataUntouched();
  });
});
