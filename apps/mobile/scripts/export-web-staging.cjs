const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readWebStagingConfig, validateWebStagingConfig, WEB_STAGING_CONFIG_NAME } = require('./web-staging-config.cjs');
const { publicHostSettings, renderStaticBlueprint } = require('./web-host-settings.cjs');
const appRoot = path.resolve(__dirname, '..');
const OUTPUT = '.verification/web-staging';
const PUBLIC_ENV = ['MEMY_WEB_ORIGIN', 'MEMY_API_ORIGIN', 'MEMY_SUPABASE_URL', 'MEMY_SUPABASE_PUBLISHABLE_KEY'];
function exportEnvironment(environment) {
  if (Object.keys(environment).some(key => key.toUpperCase().startsWith('EXPO_PUBLIC_'))) throw new Error('Remove inherited EXPO_PUBLIC settings before building.');
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL'];
  const clean = Object.fromEntries(allowed.filter(key => typeof environment[key] === 'string').map(key => [key, environment[key]]));
  return { ...clean, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1', EXPO_NO_CLIENT_ENV_VARS: '1', EXPO_NO_TELEMETRY: '1',
    MEMY_MOBILE_AUTH_MODE: 'web-staging' };
}
function configuration(environment) {
  const supplied = PUBLIC_ENV.filter(key => Object.hasOwn(environment, key));
  if (supplied.length && supplied.length !== PUBLIC_ENV.length) throw new Error('Provide all four approved public web settings.');
  const value = supplied.length ? { webOrigin: environment.MEMY_WEB_ORIGIN, apiOrigin: environment.MEMY_API_ORIGIN,
    supabaseUrl: environment.MEMY_SUPABASE_URL, publishableKey: environment.MEMY_SUPABASE_PUBLISHABLE_KEY }
    : readWebStagingConfig(appRoot, 'web-staging');
  if (!validateWebStagingConfig(value)) throw new Error('Approved web staging client configuration is required.');
  return value;
}
function main() {
  const environment = exportEnvironment(process.env), config = configuration(process.env);
  const localPath = path.join(appRoot, WEB_STAGING_CONFIG_NAME);
  if (PUBLIC_ENV.some(key => Object.hasOwn(process.env, key)) && fs.existsSync(localPath)) throw new Error('Choose public build settings or the local configuration file, not both.');
  let temporary = false;
  try {
    if (!fs.existsSync(localPath)) { fs.writeFileSync(localPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' }); temporary = true; }
    const output = path.join(appRoot, OUTPUT);
    fs.rmSync(output, { recursive: true, force: true });
    const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', OUTPUT],
      { cwd: appRoot, stdio: 'inherit', shell: false, env: environment });
    if (result.error || result.status !== 0) throw new Error('Static web export failed.');
    const index = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    if (!index.includes('<html') || !index.includes('<script')) throw new Error('Static web export is incomplete.');
    const settings = publicHostSettings(config, index), artifacts = path.join(appRoot, '.verification/web-staging-host');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'staging-settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    fs.writeFileSync(path.join(artifacts, 'render-static.yaml'), `${JSON.stringify(renderStaticBlueprint(settings), null, 2)}\n`);
    fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('Static web export prepared. Configure the generated host headers and callback before inviting testers. No deployment was performed.');
  } finally { if (temporary) fs.unlinkSync(localPath); }
}
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error instanceof Error && /^(Remove inherited|Provide all four|Approved web staging|Choose public build|Static web export)/.test(error.message)
      ? error.message : 'The static web export could not be prepared.'); process.exitCode = 1;
  }
}
module.exports = { exportEnvironment, configuration, OUTPUT };
