const fs = require('node:fs');
const path = require('node:path');
// Browser pilot only. Native development and registration stay on the original project.
const WEB_PILOT_SUPABASE_URL = 'https://mrfzmlckmvgxweiiugmr.supabase.co';

const WEB_STAGING_CONFIG_NAME = 'staging.web.client.local.json';
function validPublicOrigin(value) {
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value), host = url.hostname;
    return url.origin === value && !url.username && !url.password && url.protocol === 'https:' &&
      host.includes('.') && host.length <= 253 && !/^\d+(?:\.\d+){3}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) &&
      host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch { return false; }
}
function validateWebStagingConfig(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'apiOrigin,publishableKey,supabaseUrl,webOrigin' &&
    validPublicOrigin(value.apiOrigin) && validPublicOrigin(value.webOrigin) && value.apiOrigin !== value.webOrigin &&
    value.supabaseUrl === WEB_PILOT_SUPABASE_URL && typeof value.publishableKey === 'string' &&
    /^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey);
}
function readWebStagingConfig(root, mode, read = fs.readFileSync) {
  if (mode !== 'web-staging') return null;
  try {
    const raw = read(path.join(root, WEB_STAGING_CONFIG_NAME), 'utf8');
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    const value = JSON.parse(raw);
    return validateWebStagingConfig(value) ? value : null;
  } catch { return null; }
}
module.exports = { WEB_PILOT_SUPABASE_URL, WEB_STAGING_CONFIG_NAME, readWebStagingConfig, validateWebStagingConfig, validPublicOrigin };
