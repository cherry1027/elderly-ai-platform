import Constants from 'expo-constants';
import { AuthError } from './errors';
import { readWebStaging } from '../web-staging';

// This web-only pin does not change the native development/registration project.
export const WEB_PILOT_SUPABASE_URL = 'https://mrfzmlckmvgxweiiugmr.supabase.co';
// Shared auth code imports this compatibility name through platform resolution.
export const DEVELOPMENT_SUPABASE_URL = WEB_PILOT_SUPABASE_URL;
export type MobileAuthConfig = { supabaseUrl: string; publishableKey: string };
export function validateMobileAuthConfig(value: MobileAuthConfig): MobileAuthConfig {
  if (!value || value.supabaseUrl !== DEVELOPMENT_SUPABASE_URL || typeof value.publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey)) throw new AuthError('configuration');
  return { supabaseUrl: value.supabaseUrl, publishableKey: value.publishableKey };
}
export function readMobileAuthConfig(): MobileAuthConfig {
  const value: unknown = Constants.expoConfig?.extra?.memyDevelopmentAuth;
  if (!readWebStaging() || !value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('configuration');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'enabled,publishableKey,supabaseUrl' || row.enabled !== true ||
      typeof row.supabaseUrl !== 'string' || typeof row.publishableKey !== 'string') throw new AuthError('configuration');
  return validateMobileAuthConfig({ supabaseUrl: row.supabaseUrl, publishableKey: row.publishableKey });
}
