import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const appRoot = path.resolve(__dirname, '..');
function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(directory, item.name);
    return item.isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(item.name) ? [full] : [];
  });
}
const sources = sourceFiles(path.join(appRoot, 'src'));
const source = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const authSources = sources.filter((file) => file.startsWith(path.join(appRoot, 'src/auth') + path.sep));
const authSource = authSources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const apiSources = sources.filter((file) => file.startsWith(path.join(appRoot, 'src/api') + path.sep));
const apiSource = apiSources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const presentationSource = sources.filter((file) => !authSources.includes(file) && !apiSources.includes(file) && !file.endsWith(path.join('audio', 'native-recorder.ts'))).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8')).expo;

// Inspect executable identifiers, so friendly "sharing window" wording and
// comments about PDF documents cannot be confused with browser globals.
function browserStateReferences(text: string): string[] {
  const references: string[] = [];
  const parsed = ts.createSourceFile('mobile.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ['window', 'document', 'localStorage', 'sessionStorage'].includes(node.text)) references.push(node.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) &&
      ['window', 'document', 'localStorage', 'sessionStorage'].includes(node.argumentExpression.text)) references.push(node.argumentExpression.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return references;
}

describe('development-only mobile application boundaries', () => {
  it('imports only local native UI, Router and platform modules', () => {
    // Expo Router's published navigation types describe the existing native stack;
    // permit this exact SDK subpath, without allowing arbitrary external imports.
    const allowed = new Set(['react', 'react-native', 'react-native-svg', 'react-native-safe-area-context', 'expo-router', 'expo-router/react-navigation', 'expo-status-bar', 'expo-constants', 'expo-secure-store', 'expo-audio', 'expo-file-system', 'expo-crypto', '@supabase/supabase-js', '@react-native-async-storage/async-storage']);
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(name.startsWith('.') || allowed.has(name)).toBe(true);
  });

  it('does not read environment credentials or browser state', () => {
    // The only runtime environment lookup is the test-only registration seam.
    // It cannot enable native registration or read any credential setting.
    expect(source.replaceAll('process.env.NODE_ENV', "'runtime-mode'"))
      .not.toMatch(/process\.env|import\.meta/);
    expect(browserStateReferences(source)).toEqual([]);
  });

  it.each(['window.location', 'document.cookie', 'localStorage.getItem("key")', 'sessionStorage.clear()',
    'globalThis["window"].location', 'globalThis["document"].cookie'])
    ('detects actual browser state access: %s', code => {
      expect(browserStateReferences(code)).not.toEqual([]);
    });

  it('permits ordinary interface wording without allowing browser globals', () => {
    expect(browserStateReferences('const label = "The sharing window has closed"; // private document\n')).toEqual([]);
  });

  it('keeps transports outside presentation and confines microphone operations to the approved adapter', () => {
    expect(presentationSource).not.toMatch(/https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|getUserMedia|supabase|fastapi|expo-audio|expo-av/i);
    expect(source).not.toMatch(/getUserMedia|fastapi|expo-av|resetPasswordForEmail/i);
    expect(fs.readFileSync(path.join(appRoot, 'src/auth/client.ts'), 'utf8')).not.toMatch(/signUp\s*\(/);
    expect(authSource).not.toMatch(/\b(?:client|supabase)\.(?:from|storage|functions|channel|rpc)\b/);
    expect(authSource).not.toContain('@react-native-async-storage/async-storage');
    expect(apiSource).not.toMatch(/@supabase|secure-store|async-storage|console\.|method:\s*['"](?:PUT|DELETE)['"]/i);
    expect(apiSource).toContain("'GET'");
    expect(apiSource).toContain("'POST'");
    expect(apiSource).toContain("'PATCH'");
    expect(apiSource).not.toMatch(/\/sessions|user_id/);
  });

  it('keeps live registration closed independently of development login configuration', () => {
    const registration = fs.readFileSync(path.join(appRoot, 'src/auth/registration.ts'), 'utf8');
    const provider = fs.readFileSync(path.join(appRoot, 'src/auth/RegistrationProvider.tsx'), 'utf8');
    expect(registration).toContain("process.env.NODE_ENV === 'test'");
    expect(provider).toContain('createRegistration()');
    expect(provider).toContain('enabled: false');
    expect(provider).not.toMatch(/readMobileAuthConfig|testHarness|EXPO_PUBLIC/);
  });

  it('does not import files outside the mobile source tree', () => {
    for (const file of sources) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        expect(resolved.startsWith(path.join(appRoot, 'src') + path.sep)).toBe(true);
      }
    }
  });

  it('uses Router and foreground-only audio configuration', () => {
    expect(config.plugins).toEqual(['expo-router', ['expo-audio', expect.objectContaining({
      recordAudioAndroid: true, enableBackgroundRecording: false, enableBackgroundPlayback: false,
      microphonePermission: expect.any(String),
    })]]);
    expect(config.platforms).toEqual(['android', 'ios']);
    expect(config.extra).toBeUndefined();
    expect(config.updates).toBeUndefined();
  });

  it('permits only the approved foreground microphone capability', () => {
    expect(config.android.permissions).toEqual([]);
    expect(config.android.blockedPermissions).not.toContain('android.permission.RECORD_AUDIO');
    for (const name of ['CAMERA', 'READ_CONTACTS', 'ACCESS_FINE_LOCATION']) {
      expect(config.android.blockedPermissions).toContain('android.permission.' + name);
    }
    expect(config.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
  });

  it('keeps the app private and excludes unrelated backend and voice SDKs', () => {
    expect(manifest.private).toBe(true);
    expect(manifest.main).toBe('expo-router/entry');
    for (const name of ['@lovable.dev/mcp-js', 'expo-av']) {
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
