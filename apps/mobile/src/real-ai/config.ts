import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { normalizeMobileApiBaseUrl, readApprovedStagingApiOrigin } from '../api/story-projects';

export interface RealAiConfig { baseUrl: string; apiContract: 'real-v2' }
export function readRealAiRequested(): boolean {
  let approved: string | null;
  try { approved = readApprovedStagingApiOrigin(); } catch { return false; }
  return (__DEV__ || approved !== null) && ['ios', 'android'].includes(Platform.OS) &&
    (Constants.expoConfig?.extra?.memyRealAiRequested === true || readRealAiConfig() !== null);
}
export function readRealAiConfig(): RealAiConfig | null {
  try {
    if ((!__DEV__ && !readApprovedStagingApiOrigin()) || !['ios', 'android'].includes(Platform.OS)) return null;
  } catch { return null; }
  const value: unknown = Constants.expoConfig?.extra?.memyRealAiApi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'apiContract,baseUrl,enabled' || row.enabled !== true || row.apiContract !== 'real-v2') return null;
  try { return { baseUrl: normalizeMobileApiBaseUrl(row.baseUrl), apiContract: 'real-v2' }; } catch { return null; }
}
