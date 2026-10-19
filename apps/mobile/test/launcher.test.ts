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
      console: { error },
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

  return { spawnSync, resolve, error, environment, exitCode };
}

const commands: [string, string, string[]][] = [
  ['start', 'expo/bin/cli', ['start', '--go', '--lan']],
  ['android', 'expo/bin/cli', ['start', '--go', '--lan', '--android']],
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

  it.each(['start', 'android'])('clears inherited offline mode for %s LAN startup', (action) => {
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
