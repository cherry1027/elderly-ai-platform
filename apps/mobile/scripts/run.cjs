const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const actions = {
  start: ['expo/bin/cli', ['start', '--go', '--lan']],
  android: ['expo/bin/cli', ['start', '--go', '--lan', '--android']],
  typecheck: ['typescript/bin/tsc', ['--noEmit']],
  test: ['jest/bin/jest', ['--runInBand']],
  lint: ['eslint/bin/eslint.js', ['--config', 'eslint.config.cjs', '.']],
  dependencies: ['expo/bin/cli', ['install', '--check']],
  config: ['expo/bin/cli', ['config', '--type', 'public', '--json']],
  bundle: ['expo/bin/cli', ['export', '--platform', 'android', '--output-dir', '.verification/android', '--no-bytecode']],
};
const actionName = process.argv[2];
const action = Object.hasOwn(actions, actionName) ? actions[actionName] : undefined;
if (!action) {
  console.error('Choose a supported mobile command.');
  process.exit(1);
}
const childEnv = {
  ...process.env,
  EXPO_NO_DOTENV: '1',
  EXPO_NO_CLIENT_ENV_VARS: '1',
  EXPO_NO_TELEMETRY: '1',
};
// LAN hosting and Expo's offline option are mutually exclusive. Clear even an
// inherited offline setting for interactive startup; keep checks offline.
if (actionName === 'start' || actionName === 'android') {
  delete childEnv.EXPO_OFFLINE;
} else {
  childEnv.EXPO_OFFLINE = '1';
}
const result = spawnSync(process.execPath, [
  require.resolve(path.join(appRoot, 'node_modules', action[0])), ...action[1], ...process.argv.slice(3),
], {
  cwd: appRoot,
  stdio: 'inherit',
  shell: false,
  env: childEnv,
});
if (result.error) {
  console.error('The mobile tool could not start. Check the local installation.');
  process.exit(1);
}
process.exit(result.status ?? 1);
