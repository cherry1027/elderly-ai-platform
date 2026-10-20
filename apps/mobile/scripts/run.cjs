const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const actions = {
  start: ['expo/bin/cli', ['start', '--go', '--lan']],
  android: ['expo/bin/cli', ['start', '--go', '--lan', '--android']],
  'preview-stories': ['expo/bin/cli', ['start', '--go', '--lan']],
  typecheck: ['typescript/bin/tsc', ['--noEmit']],
  test: ['jest/bin/jest', ['--runInBand']],
  lint: ['eslint/bin/eslint.js', ['--config', 'eslint.config.cjs', '.']],
  dependencies: ['expo/bin/cli', ['install', '--check']],
  config: ['expo/bin/cli', ['config', '--type', 'public', '--json']],
  bundle: ['expo/bin/cli', ['export', '--platform', 'android', '--output-dir', '.verification/android', '--no-bytecode']],
  'bundle-ios': ['expo/bin/cli', ['export', '--platform', 'ios', '--output-dir', '.verification/ios', '--no-bytecode']],
};
const actionName = process.argv[2];
const action = Object.hasOwn(actions, actionName) ? actions[actionName] : undefined;
if (!action) {
  console.error('Choose a supported mobile command.');
  process.exit(1);
}
const interactive = ['start', 'android', 'preview-stories'].includes(actionName);
let forwarded = process.argv.slice(3);
let toolArguments = action[1];
if (interactive) {
  let port;
  const remaining = [];
  const invalidPort = () => {
    console.error('Use one valid --port value between 0 and 65535.');
    process.exit(1);
  };
  for (let index = 0; index < forwarded.length; index += 1) {
    const argument = forwarded[index];
    if (argument === '--clear') continue;
    if (argument === '--port' || argument.startsWith('--port=')) {
      if (port !== undefined) invalidPort();
      const value = argument === '--port' ? forwarded[++index] : argument.slice('--port='.length);
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 65535) invalidPort();
      port = String(Number(value));
    } else if (argument.startsWith('--port') || argument.startsWith('-p')) invalidPort();
    else remaining.push(argument);
  }
  // Expo supports port 0 as a fresh available port, without reusing a busy
  // default. Clear Metro's bundle cache; native preferences/sessions are untouched.
  toolArguments = [...toolArguments, '--port', port ?? '0', '--clear'];
  forwarded = remaining;
}
const childEnv = {
  ...process.env,
  EXPO_NO_DOTENV: '1',
  EXPO_NO_CLIENT_ENV_VARS: '1',
  EXPO_NO_TELEMETRY: '1',
  // Explicit mobile-local client config; never enable general EXPO_PUBLIC loading.
  MEMY_MOBILE_AUTH_MODE: 'verification',
};
// No inherited EXPO_PUBLIC setting is approved for this app. Client-safe auth
// settings enter only through the validated mobile-local JSON configuration.
for (const key of Object.keys(childEnv)) {
  const normalized = key.toUpperCase();
  if (normalized.startsWith('EXPO_PUBLIC_') || ['MEMY_MOBILE_STORY_PREVIEW', 'MEMY_MOBILE_AUTH_MODE', 'EXPO_OFFLINE', 'RCT_METRO_PORT'].includes(normalized)) delete childEnv[key];
}
childEnv.MEMY_MOBILE_AUTH_MODE = 'verification';
// LAN hosting and Expo's offline option are mutually exclusive. Clear even an
// inherited offline setting for interactive startup; keep checks offline.
if (interactive) {
  delete childEnv.EXPO_OFFLINE;
  if (actionName === 'preview-stories') childEnv.MEMY_MOBILE_STORY_PREVIEW = '1';
  else childEnv.MEMY_MOBILE_AUTH_MODE = 'development';
} else {
  childEnv.EXPO_OFFLINE = '1';
}
if (interactive) {
  console.log(actionName === 'preview-stories' ? 'MEMY SAMPLE STORIES PREVIEW' : 'MEMY NORMAL APP');
  console.log('Scan the NEW QR code shown in this terminal. An older QR code can open a different running preview.');
}
const result = spawnSync(process.execPath, [
  require.resolve(path.join(appRoot, 'node_modules', action[0])), ...toolArguments, ...forwarded,
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
