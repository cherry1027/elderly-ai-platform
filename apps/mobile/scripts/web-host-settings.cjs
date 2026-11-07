const crypto = require('node:crypto');
const { validateWebStagingConfig } = require('./web-staging-config.cjs');

/** Static host settings use exact reviewed origins; there is no public API proxy. */
function publicHostSettings(config, html) {
  if (!validateWebStagingConfig(config) || typeof html !== 'string') throw new Error('Approved web staging configuration is required.');
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[2]).digest('base64')}'`);
  const headers = {
    'Content-Security-Policy': ["default-src 'none'", "base-uri 'none'", `script-src 'self' ${hashes.join(' ')}`.trim(),
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "media-src blob:",
      `connect-src 'self' ${config.apiOrigin} ${config.supabaseUrl}`, "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", 'upgrade-insecure-requests'].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
  return {
    webOrigin: config.webOrigin, apiOrigin: config.apiOrigin,
    authCallback: `${config.webOrigin}/auth/callback`,
    corsOrigins: [config.webOrigin],
    headers: Object.entries(headers).map(([name, value]) => ({ path: '/*', name, value })),
    routes: [
      { type: 'rewrite', source: '/auth/callback', destination: '/index.html' },
      { type: 'rewrite', source: '/*', destination: '/index.html' },
    ],
  };
}
function renderStaticBlueprint(settings) {
  return { services: [{ type: 'web', name: 'memy-pilot-web', runtime: 'static', rootDir: 'apps/mobile',
    buildCommand: 'npm ci --ignore-scripts --legacy-peer-deps && node scripts/export-web-staging.cjs',
    staticPublishPath: '.verification/web-staging', autoDeployTrigger: 'off',
    envVars: [
      { key: 'NODE_VERSION', value: '22.13.0' },
      ...['MEMY_WEB_ORIGIN', 'MEMY_API_ORIGIN', 'MEMY_SUPABASE_URL', 'MEMY_SUPABASE_PUBLISHABLE_KEY'].map(key => ({ key, sync: false })),
    ], headers: settings.headers, routes: settings.routes,
  }] };
}
module.exports = { publicHostSettings, renderStaticBlueprint };
