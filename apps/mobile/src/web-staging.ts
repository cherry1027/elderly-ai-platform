import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readApprovedStagingApiOrigin } from './api/story-projects';

function origin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value), host = url.hostname;
    return url.origin === value && !url.username && !url.password && host.includes('.') && host.length <= 253 &&
      !/^\d+(?:\.\d+){3}$/.test(host) && !/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) &&
      host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch { return false; }
}
/** Public web builds activate only at their exact reviewed HTTPS origin. */
export function readWebStaging(): { webOrigin: string; apiOrigin: string } | null {
  const value: unknown = Constants.expoConfig?.extra?.memyWebStaging;
  const location = globalThis.location;
  if (Platform.OS !== 'web' || !globalThis.isSecureContext || !location || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'apiOrigin,webOrigin' || !origin(row.webOrigin) || !origin(row.apiOrigin) ||
      row.webOrigin === row.apiOrigin || location.origin !== row.webOrigin || location.protocol !== 'https:') return null;
  try {
    if (readApprovedStagingApiOrigin() !== row.apiOrigin) return null;
    return { webOrigin: row.webOrigin, apiOrigin: row.apiOrigin };
  } catch { return null; }
}
