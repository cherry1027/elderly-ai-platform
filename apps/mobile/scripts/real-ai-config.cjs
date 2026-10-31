const fs = require('node:fs');
const path = require('node:path');
const { normalizeApiBaseUrl } = require('./api-config.cjs');

const LOCAL_REAL_AI_CONFIG_NAME = 'real-ai.api.local.json';
/** Explicit opt-in. Verification never reads developer configuration. No credentials belong here. */
function readRealAiConfig(appRoot, mode, read = fs.readFileSync) {
  if (mode !== 'development') return { enabled: false };
  try {
    const raw = read(path.join(appRoot, LOCAL_REAL_AI_CONFIG_NAME), 'utf8');
    if (typeof raw !== 'string' || raw.length > 1024) return { enabled: false };
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'apiContract,baseUrl' ||
      value.apiContract !== 'real-v2') return { enabled: false };
    const baseUrl = normalizeApiBaseUrl(value.baseUrl);
    return baseUrl ? { enabled: true, apiContract: 'real-v2', baseUrl } : { enabled: false };
  } catch { return { enabled: false }; }
}
module.exports = { readRealAiConfig, LOCAL_REAL_AI_CONFIG_NAME };
