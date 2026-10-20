const fs = require('node:fs');
const path = require('node:path');

const DEVELOPMENT_SUPABASE_URL = 'https://edbkuunyeyxnyenmmqud.supabase.co';
const LOCAL_CONFIG_NAME = 'development.auth.local.json';

function readClientConfig(appRoot, mode, read = fs.readFileSync) {
  // Verification/builds never open the developer's real local configuration.
  if (mode !== 'development') return { enabled: false };
  try {
    const raw = read(path.join(appRoot, LOCAL_CONFIG_NAME), 'utf8');
    if (typeof raw !== 'string' || raw.length > 2048) return { enabled: false };
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        Object.keys(value).sort().join(',') !== 'publishableKey,supabaseUrl' ||
        value.supabaseUrl !== DEVELOPMENT_SUPABASE_URL ||
        typeof value.publishableKey !== 'string' ||
        !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey)) {
      return { enabled: false };
    }
    return { enabled: true, supabaseUrl: value.supabaseUrl, publishableKey: value.publishableKey };
  } catch {
    // No file contents or configuration values enter logs or error messages.
    return { enabled: false };
  }
}

module.exports = { readClientConfig, DEVELOPMENT_SUPABASE_URL, LOCAL_CONFIG_NAME };
