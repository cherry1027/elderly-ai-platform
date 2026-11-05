const fs = require('node:fs');
const path = require('node:path');
const { DEVELOPMENT_SUPABASE_URL } = require('./auth-config.cjs');
function validApiOrigin(value) {
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('https://')) return false;
  const url = new URL(value), host = url.hostname;
  return url.origin === value && url.protocol === 'https:' && host.includes('.') && host.length <= 253 &&
    !/^\d+(?:\.\d+){3}$/.test(host) && !/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function readStagingConfig(root, mode, read = fs.readFileSync) {
  if (mode !== 'staging') return null;
  try {
    const raw = read(path.join(root, 'staging.client.local.json'), 'utf8');
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'apiOrigin,publishableKey,supabaseUrl' ||
      value.supabaseUrl !== DEVELOPMENT_SUPABASE_URL || typeof value.publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey) ||
      !validApiOrigin(value.apiOrigin)) return null;
    return value;
  } catch { return null; }
}
module.exports = { readStagingConfig };
