import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const appRoot = path.resolve(__dirname, '..');
const launcherPath = path.join(appRoot, 'scripts', 'run.cjs');
const launcherSource = fs.readFileSync(launcherPath, 'utf8');

class LauncherExit extends Error {
  constructor(readonly code: number) {
    super('Mock launcher exit');
  }
}

function runLauncher(
  action: string,
  forwarded: string[] = [],
  inherited: Record<string, string> = {},
  result: { status: number | null; error?: Error } = { status: 0 },
) {
  const spawnSync = jest.fn().mockReturnValue(result);
  const resolve = jest.fn((name: string) => name);
  const error = jest.fn();
  const log = jest.fn();
  const environment = { ...inherited };
  const mockRequire = Object.assign((name: string) => {
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync };
    throw new Error('Unexpected launcher import');
  }, { resolve });
  let exitCode: number | undefined;

  try {
    vm.runInNewContext(launcherSource, {
      __dirname: path.dirname(launcherPath),
      require: mockRequire,
      console: { error, log },
      process: {
        argv: ['node', launcherPath, action, ...forwarded],
        execPath: 'mock-local-node',
        env: environment,
        exit: (code: number) => { throw new LauncherExit(code); },
      },
    }, { filename: launcherPath });
  } catch (caught) {
    if (!(caught instanceof LauncherExit)) throw caught;
    exitCode = caught.code;
  }

  return { spawnSync, resolve, error, log, environment, exitCode };
}

const commands: [string, string, string[]][] = [
  ['start', 'expo/bin/cli', ['start', '--go', '--lan', '--port', '0', '--clear']],
  ['android', 'expo/bin/cli', ['start', '--go', '--lan', '--android', '--port', '0', '--clear']],
  ['preview-stories', 'expo/bin/cli', ['start', '--go', '--lan', '--port', '0', '--clear']],
  ['typecheck', 'typescript/bin/tsc', ['--noEmit']],
  ['test', 'jest/bin/jest', ['--runInBand']],
  ['lint', 'eslint/bin/eslint.js', ['--config', 'eslint.config.cjs', '.']],
  ['dependencies', 'expo/bin/cli', ['install', '--check']],
  ['config', 'expo/bin/cli', ['config', '--type', 'public', '--json']],
  ['bundle', 'expo/bin/cli', [
    'export', '--platform', 'android', '--output-dir', '.verification/android', '--no-bytecode',
  ]],
  ['bundle-ios', 'expo/bin/cli', [
    'export', '--platform', 'ios', '--output-dir', '.verification/ios', '--no-bytecode',
  ]],
];

describe('mobile command launcher (mocked child processes)', () => {
  it.each(commands)('runs %s using only the app-local tool and directory', (action, module, args) => {
    const execution = runLauncher(action);
    const resolved = path.join(appRoot, 'node_modules', module);

    expect(execution.resolve).toHaveBeenCalledWith(resolved);
    expect(execution.spawnSync).toHaveBeenCalledTimes(1);
    expect(execution.spawnSync).toHaveBeenCalledWith('mock-local-node', [resolved, ...args], {
      cwd: appRoot,
      stdio: 'inherit',
      shell: false,
      env: expect.any(Object),
    });
    expect(execution.exitCode).toBe(0);
  });

  it.each(['start', 'android', 'preview-stories'])('clears inherited offline mode for %s LAN startup', (action) => {
    const execution = runLauncher(action, [], { EXPO_OFFLINE: '1' });
    const [, args, options] = execution.spawnSync.mock.calls[0];

    expect(args).toContain('--lan');
    expect(args).not.toContain('--offline');
    expect(args).not.toContain('--tunnel');
    expect(options.env).not.toHaveProperty('EXPO_OFFLINE');
    expect(execution.environment.EXPO_OFFLINE).toBe('1');
  });

  it.each(['typecheck', 'test', 'lint', 'dependencies', 'config', 'bundle', 'bundle-ios'])(
    'keeps %s verification offline',
    (action) => {
      const execution = runLauncher(action, [], { EXPO_OFFLINE: '0' });
      expect(execution.spawnSync.mock.calls[0][2].env.EXPO_OFFLINE).toBe('1');
      expect(execution.environment.EXPO_OFFLINE).toBe('0');
    },
  );

  it.each(commands)('forces credential-loading protections for %s', (action) => {
    const execution = runLauncher(action, [], {
      EXPO_NO_DOTENV: '0',
      EXPO_NO_CLIENT_ENV_VARS: '0',
      EXPO_NO_TELEMETRY: '0',
      PATH: 'mock-tool-path',
    });

    expect(execution.spawnSync.mock.calls[0][2].env).toEqual(expect.objectContaining({
      EXPO_NO_DOTENV: '1',
      EXPO_NO_CLIENT_ENV_VARS: '1',
      EXPO_NO_TELEMETRY: '1',
      PATH: 'mock-tool-path',
    }));
    expect(execution.environment.EXPO_NO_DOTENV).toBe('0');
  });

  it('forwards a chosen port and cache option without a shell', () => {
    const execution = runLauncher('start', ['--port', '8082', '--clear']);
    const [, args, options] = execution.spawnSync.mock.calls[0];
    expect(args.slice(1)).toEqual(['start', '--go', '--lan', '--port', '8082', '--clear']);
    expect(options.shell).toBe(false);
  });

  it.each(['start', 'android', 'preview-stories'])('starts a fresh %s server with one cache reset and a fixed mode label', action => {
    const execution = runLauncher(action);
    const args = execution.spawnSync.mock.calls[0][1] as string[];
    expect(args.filter(argument => argument === '--port')).toHaveLength(1);
    expect(args[args.indexOf('--port') + 1]).toBe('0');
    expect(args.filter(argument => argument === '--clear')).toHaveLength(1);
    expect(execution.log).toHaveBeenCalledWith(action === 'preview-stories' ? 'MEMY SAMPLE STORIES PREVIEW' : 'MEMY NORMAL APP');
    expect(execution.log).toHaveBeenCalledWith(expect.stringContaining('Scan the NEW QR code'));
  });

  it.each(['start', 'android', 'preview-stories'].flatMap(action => [
    ['--port', '0'], ['--port=0'], ['--port', '65535'], ['--port=8083'], ['--port', '08081'],
  ].map(args => ({ action, args }))))('honors one validated explicit port for $action (%#)', ({ action, args }) => {
    const execution = runLauncher(action, args);
    const actual = execution.spawnSync.mock.calls[0][1] as string[];
    expect(actual.filter(argument => argument === '--port')).toHaveLength(1);
    expect(actual[actual.indexOf('--port') + 1]).toBe(String(Number(args[0] === '--port' ? args[1] : args[0].slice('--port='.length))));
    expect(actual.some(argument => argument.startsWith('--port='))).toBe(false);
    expect(actual.filter(argument => argument === '--clear')).toHaveLength(1);
  });

  it.each([
    ['--port'], ['--port', ''], ['--port', '-1'], ['--port', '65536'], ['--port', '1.5'],
    ['--port', ' 8081 '], ['--port', '0x1f91'], ['--port', 'NaN'],
    ['--port='], ['--port=Infinity'], ['--port=8083.5'], ['--port8083'], ['-p', '8083'], ['-p=8083'], ['-p8083'],
    ['--port', '8083', '--port', '8084'], ['--port=8083', '--port=8084'], ['--port', '0', '--port=8084'],
  ].map(args => ({ args })))('rejects duplicate or malformed port options without launching or echoing them (%#)', ({ args }) => {
    const execution = runLauncher('start', args);
    expect(execution.spawnSync).not.toHaveBeenCalled(); expect(execution.resolve).not.toHaveBeenCalled();
    expect(execution.exitCode).toBe(1); expect(execution.log).not.toHaveBeenCalled();
    expect(execution.error).toHaveBeenCalledWith('Use one valid --port value between 0 and 65535.');
  });

  it.each(['android', 'preview-stories'])('rejects duplicate explicit ports in %s too', action => {
    const execution = runLauncher(action, ['--port=0', '--port', '8084']);
    expect(execution.spawnSync).not.toHaveBeenCalled(); expect(execution.exitCode).toBe(1);
  });

  it('does not duplicate a forwarded cache reset or expose environment/argument contents in launcher messages', () => {
    const execution = runLauncher('start', ['--clear', '--port', '8083', '--clear', '--max-workers', '2'], {
      SYNTHETIC_PRIVATE_SETTING: 'synthetic-private-environment-sentinel',
    });
    const args = execution.spawnSync.mock.calls[0][1] as string[];
    expect(args.filter(argument => argument === '--clear')).toHaveLength(1);
    expect(args.slice(-2)).toEqual(['--max-workers', '2']);
    const messages = JSON.stringify([...execution.log.mock.calls, ...execution.error.mock.calls]);
    expect(messages).not.toContain('synthetic-private-environment-sentinel');
    expect(messages).not.toContain('8083'); expect(messages).not.toContain('--max-workers');
  });

  it.each(commands)('scrubs inherited Windows Metro-port variants for %s without altering the parent environment', action => {
    const inherited = { RCT_METRO_PORT: '8081', rct_metro_port: '8083', RcT_MeTrO_PoRt: '8084' };
    const execution = runLauncher(action, [], inherited);
    const child = execution.spawnSync.mock.calls[0][2].env;
    expect(Object.keys(child).some(key => key.toUpperCase() === 'RCT_METRO_PORT')).toBe(false);
    expect(execution.environment).toEqual(inherited);
    if (!['start', 'android', 'preview-stories'].includes(action)) expect(execution.log).not.toHaveBeenCalled();
  });

  it.each(commands)('controls the mobile auth config mode for %s without enabling env injection', (action) => {
    const execution = runLauncher(action, [], { MEMY_MOBILE_AUTH_MODE: 'development', EXPO_PUBLIC_SUPABASE_KEY: 'synthetic-forbidden-injection' });
    const environment = execution.spawnSync.mock.calls[0][2].env;
    expect(environment.MEMY_MOBILE_AUTH_MODE).toBe(['start', 'android'].includes(action) ? 'development' : 'verification');
    expect(environment.EXPO_NO_DOTENV).toBe('1');
    expect(environment.EXPO_NO_CLIENT_ENV_VARS).toBe('1');
    expect(environment).not.toHaveProperty('EXPO_PUBLIC_SUPABASE_KEY');
  });

  it('starts the explicit sample preview on LAN with verification-only settings and no tunnel', () => {
    const execution = runLauncher('preview-stories', ['--port', '8082'], {
      EXPO_OFFLINE: '1', MEMY_MOBILE_AUTH_MODE: 'development', MEMY_MOBILE_STORY_PREVIEW: 'untrusted-inherited',
      EXPO_PUBLIC_SYNTHETIC_KEY: 'synthetic-never-pass',
    });
    const [, args, options] = execution.spawnSync.mock.calls[0];
    expect(args.slice(1)).toEqual(['start', '--go', '--lan', '--port', '8082', '--clear']);
    expect(args).not.toContain('--offline'); expect(args).not.toContain('--tunnel');
    expect(options.env.MEMY_MOBILE_AUTH_MODE).toBe('verification');
    expect(options.env.MEMY_MOBILE_STORY_PREVIEW).toBe('1');
    expect(options.env).not.toHaveProperty('EXPO_OFFLINE'); expect(options.env).not.toHaveProperty('EXPO_PUBLIC_SYNTHETIC_KEY');
    expect(options.env.EXPO_NO_DOTENV).toBe('1'); expect(options.env.EXPO_NO_CLIENT_ENV_VARS).toBe('1');
  });

  it.each(commands.filter(([action]) => action !== 'preview-stories'))('removes inherited sample-preview activation for normal %s', action => {
    const execution = runLauncher(action, [], { MEMY_MOBILE_STORY_PREVIEW: '1' });
    expect(execution.spawnSync.mock.calls[0][2].env).not.toHaveProperty('MEMY_MOBILE_STORY_PREVIEW');
    expect(execution.environment.MEMY_MOBILE_STORY_PREVIEW).toBe('1');
  });

  it.each(['memy_mobile_story_preview', 'MeMy_MoBiLe_StOrY_PrEvIeW'])('removes Windows case-insensitive inherited preview flag %s', key => {
    for (const action of ['start', 'config', 'bundle', 'bundle-ios']) {
      const execution = runLauncher(action, [], { [key]: '1' });
      const environment = execution.spawnSync.mock.calls[0][2].env;
      expect(Object.keys(environment).some(name => name.toUpperCase() === 'MEMY_MOBILE_STORY_PREVIEW')).toBe(false);
    }
    const preview = runLauncher('preview-stories', [], { [key]: '1' });
    expect(Object.keys(preview.spawnSync.mock.calls[0][2].env).filter(name => name.toUpperCase() === 'MEMY_MOBILE_STORY_PREVIEW'))
      .toEqual(['MEMY_MOBILE_STORY_PREVIEW']);
  });

  it.each<Record<string, string>>([
    { memy_mobile_auth_mode: 'development', expo_offline: '1' },
    { MeMy_MoBiLe_AuTh_MoDe: 'development', ExPo_OfFlInE: '1' },
  ])('uses canonical preview mode and LAN flags despite mixed-case Windows inheritance (%#)', inherited => {
    const preview = runLauncher('preview-stories', [], inherited);
    const environment = preview.spawnSync.mock.calls[0][2].env;
    expect(Object.keys(environment).filter(key => key.toUpperCase() === 'MEMY_MOBILE_AUTH_MODE')).toEqual(['MEMY_MOBILE_AUTH_MODE']);
    expect(environment.MEMY_MOBILE_AUTH_MODE).toBe('verification');
    expect(Object.keys(environment).some(key => key.toUpperCase() === 'EXPO_OFFLINE')).toBe(false);
    for (const action of ['start', 'config']) {
      const execution = runLauncher(action, [], inherited);
      const child = execution.spawnSync.mock.calls[0][2].env;
      expect(Object.keys(child).filter(key => key.toUpperCase() === 'MEMY_MOBILE_AUTH_MODE')).toEqual(['MEMY_MOBILE_AUTH_MODE']);
      expect(child.MEMY_MOBILE_AUTH_MODE).toBe(action === 'start' ? 'development' : 'verification');
      expect(Object.keys(child).filter(key => key.toUpperCase() === 'EXPO_OFFLINE')).toEqual(action === 'start' ? [] : ['EXPO_OFFLINE']);
    }
  });

  it.each(['unapproved-command', 'constructor', 'toString', '__proto__'])(
    'rejects unsupported action %s without launching a child process', (name) => {
    const execution = runLauncher(name);
    expect(execution.spawnSync).not.toHaveBeenCalled();
    expect(execution.resolve).not.toHaveBeenCalled();
    expect(execution.exitCode).toBe(1);
    expect(execution.error).toHaveBeenCalledWith('Choose a supported mobile command.');
  });

  it('reports a sanitized startup failure without exposing child error details', () => {
    const execution = runLauncher('start', [], {}, {
      status: null,
      error: new Error('synthetic-private-error-details'),
    });
    expect(execution.exitCode).toBe(1);
    expect(execution.error).toHaveBeenCalledWith(
      'The mobile tool could not start. Check the local installation.',
    );
    expect(JSON.stringify(execution.error.mock.calls)).not.toContain('synthetic-private-error-details');
  });

  it.each([2, null])('fails securely when a tool returns status %s', (status) => {
    const execution = runLauncher('typecheck', [], {}, { status });
    expect(execution.exitCode).toBe(status ?? 1);
  });
});
