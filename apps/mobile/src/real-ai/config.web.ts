import Constants from 'expo-constants';
import { normalizeMobileApiBaseUrl } from '../api/story-projects';
import { readWebStaging } from '../web-staging';
export interface RealAiConfig { baseUrl: string; apiContract: 'real-v2' }
export function readRealAiRequested(): boolean {
  return readWebStaging() !== null && (Constants.expoConfig?.extra?.memyRealAiRequested === true || readRealAiConfig() !== null);
}
export function readRealAiConfig(): RealAiConfig | null {
  const staging = readWebStaging(), value: unknown = Constants.expoConfig?.extra?.memyRealAiApi;
  if (!staging || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'apiContract,baseUrl,enabled' || row.enabled !== true ||
      row.apiContract !== 'real-v2' || row.baseUrl !== staging.apiOrigin) return null;
  try { return { baseUrl: normalizeMobileApiBaseUrl(staging.apiOrigin), apiContract: 'real-v2' }; } catch { return null; }
}
