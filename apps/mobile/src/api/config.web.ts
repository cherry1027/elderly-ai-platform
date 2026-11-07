import Constants from 'expo-constants';
import { normalizeMobileApiBaseUrl, StoryProjectsError } from './story-projects';
import { readWebStaging } from '../web-staging';
export interface MobileApiConfig { baseUrl: string }
export function validateMobileApiConfig(value: unknown): MobileApiConfig {
  const staging = readWebStaging();
  if (!staging || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'baseUrl' ||
      (value as Record<string, unknown>).baseUrl !== staging.apiOrigin) throw new StoryProjectsError('configuration');
  return { baseUrl: normalizeMobileApiBaseUrl(staging.apiOrigin) };
}
export function readMobileApiConfig(): MobileApiConfig | null {
  const value: unknown = Constants.expoConfig?.extra?.memyDevelopmentApi;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'baseUrl,enabled' || row.enabled !== true) return null;
  try { return validateMobileApiConfig({ baseUrl: row.baseUrl }); } catch { return null; }
}
