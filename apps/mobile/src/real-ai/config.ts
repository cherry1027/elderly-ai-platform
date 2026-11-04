import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { normalizeMobileApiBaseUrl } from '../api/story-projects';

export interface RealAiConfig { baseUrl: string; apiContract: 'real-v2' }
export function readRealAiRequested(): boolean {
  return (__DEV__ || !!Constants.expoConfig?.extra?.memyStagingApiOrigin) && ['ios', 'android'].includes(Platform.OS) &&
    (Constants.expoConfig?.extra?.memyRealAiRequested === true || readRealAiConfig() !== null);
}
export function readRealAiConfig(): RealAiConfig | null {
  if ((!__DEV__ && !Constants.expoConfig?.extra?.memyStagingApiOrigin) || !['ios', 'android'].includes(Platform.OS)) return null;
  const value: unknown = Constants.expoConfig?.extra?.memyRealAiApi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'apiContract,baseUrl,enabled' || row.enabled !== true || row.apiContract !== 'real-v2') return null;
  try { return { baseUrl: normalizeMobileApiBaseUrl(row.baseUrl), apiContract: 'real-v2' }; } catch { return null; }
}
