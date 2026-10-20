const fs = require('node:fs');
const path = require('node:path');

const LOCAL_API_CONFIG_NAME = 'development.api.local.json';

function normalizeApiBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 256 || value !== value.trim()) return null;
  // Only an explicitly approved private LAN IPv4 address is supported for now.
  // Reject alternate numeric spellings and DNS before URL canonicalization.
  const match = /^(https?):\/\/((?:\d{1,3}\.){3}\d{1,3})(?::([1-9]\d{0,4}))?(?:\/|\/api\/v1\/?)?$/.exec(value);
  if (!match) return null;
  const octets = match[2].split('.').map(Number);
  if (octets.some((part, index) => part > 255 || String(part) !== match[2].split('.')[index])) return null;
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))) return null;
  if (match[3] && Number(match[3]) > 65535) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function readApiConfig(appRoot, mode, read = fs.readFileSync) {
  // Offline checks and exports do not even open a developer's local file.
  if (mode !== 'development') return { enabled: false };
  try {
    const raw = read(path.join(appRoot, LOCAL_API_CONFIG_NAME), 'utf8');
    if (typeof raw !== 'string' || raw.length > 1024) return { enabled: false };
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'baseUrl') {
      return { enabled: false };
    }
    const baseUrl = normalizeApiBaseUrl(value.baseUrl);
    return baseUrl ? { enabled: true, baseUrl } : { enabled: false };
  } catch { return { enabled: false }; }
}

module.exports = { readApiConfig, normalizeApiBaseUrl, LOCAL_API_CONFIG_NAME };
