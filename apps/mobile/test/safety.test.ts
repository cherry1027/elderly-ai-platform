import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');
function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(directory, item.name);
    return item.isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(item.name) ? [full] : [];
  });
}
const sources = sourceFiles(path.join(appRoot, 'src'));
const source = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8')).expo;

describe('isolated offline foundation boundaries', () => {
  it('imports only local native UI, Router and platform modules', () => {
    const allowed = new Set(['react', 'react-native', 'react-native-svg', 'react-native-safe-area-context', 'expo-router', 'expo-status-bar']);
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(name.startsWith('.') || allowed.has(name)).toBe(true);
  });

  it('does not read environment credentials or browser state', () => {
    expect(source).not.toMatch(/process\.env|import\.meta|localStorage|sessionStorage|\bwindow\b|\bdocument\b/);
  });

  it('contains no application endpoints, microphone or transport calls', () => {
    expect(source).not.toMatch(/https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|getUserMedia|supabase|fastapi|expo-audio|expo-av/i);
  });

  it('does not import files outside the mobile source tree', () => {
    for (const file of sources) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        expect(resolved.startsWith(path.join(appRoot, 'src') + path.sep)).toBe(true);
      }
    }
  });

  it('uses only the native Router configuration plugin', () => {
    expect(config.plugins).toEqual(['expo-router']);
    expect(config.platforms).toEqual(['android', 'ios']);
    expect(config.extra).toBeUndefined();
    expect(config.updates).toBeUndefined();
  });

  it('requests no additional device permissions and blocks microphone access', () => {
    expect(config.android.permissions).toEqual([]);
    expect(config.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
    expect(config.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
  });

  it('keeps the app private and excludes backend SDKs', () => {
    expect(manifest.private).toBe(true);
    expect(manifest.main).toBe('expo-router/entry');
    for (const name of ['@supabase/supabase-js', '@lovable.dev/mcp-js', 'expo-audio', 'expo-av']) {
      expect(manifest.dependencies).not.toHaveProperty(name);
    }
  });

  it('forces disabled dotenv loading and client env injection for every tool', () => {
    const launcher = fs.readFileSync(path.join(appRoot, 'scripts/run.cjs'), 'utf8');
    expect(launcher).toContain("EXPO_NO_DOTENV: '1'");
    expect(launcher).toContain("EXPO_NO_CLIENT_ENV_VARS: '1'");
    expect(launcher).toContain("EXPO_NO_TELEMETRY: '1'");
    expect(launcher).toContain('delete childEnv.EXPO_OFFLINE');
    expect(launcher).toContain("childEnv.EXPO_OFFLINE = '1'");
    expect(launcher).toContain('shell: false');
    for (const command of Object.values(manifest.scripts)) expect(command).toMatch(/^node scripts\/run\.cjs /);
  });

  it('disables native route animations', () => {
    expect(fs.readFileSync(path.join(appRoot, 'src/app/_layout.tsx'), 'utf8')).toContain("animation: 'none'");
  });
});
