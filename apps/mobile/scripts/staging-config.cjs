const fs = require('node:fs');
const path = require('node:path');
const { DEVELOPMENT_SUPABASE_URL } = require('./auth-config.cjs');
function readStagingConfig(root, mode, read = fs.readFileSync) {
  if (mode !== 'staging') return null;
  try {
    const raw = read(path.join(root, 'staging.client.local.json'), 'utf8');
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'apiOrigin,publishableKey,supabaseUrl' ||
      value.supabaseUrl !== DEVELOPMENT_SUPABASE_URL || !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey || '') ||
      typeof value.apiOrigin !== 'string' || !/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.apiOrigin) ||
      !value.apiOrigin.slice(8).includes('.') || new URL(value.apiOrigin).origin !== value.apiOrigin) return null;
    return value;
  } catch { return null; }
}
module.exports = { readStagingConfig };
