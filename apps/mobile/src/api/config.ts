import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { normalizeMobileApiBaseUrl, StoryProjectsError } from './story-projects';

export interface MobileApiConfig { baseUrl: string }

export function validateMobileApiConfig(value: unknown): MobileApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).join(',') !== 'baseUrl') throw new StoryProjectsError('configuration');
  return { baseUrl: normalizeMobileApiBaseUrl((value as Record<string, unknown>).baseUrl) };
}

/** No default address, credentials, environment fallback or live settings during checks. */
export function readMobileApiConfig(): MobileApiConfig | null {
  if (!__DEV__ || !['ios', 'android'].includes(Platform.OS)) return null;
  const value: unknown = Constants.expoConfig?.extra?.memyDevelopmentApi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'baseUrl,enabled' || record.enabled !== true) return null;
  try { return validateMobileApiConfig({ baseUrl: record.baseUrl }); } catch { return null; }
}
