import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { AuthError } from './errors';

export const DEVELOPMENT_SUPABASE_URL = 'https://edbkuunyeyxnyenmmqud.supabase.co';
export type MobileAuthConfig = { supabaseUrl: string; publishableKey: string };

export function validateMobileAuthConfig(value: MobileAuthConfig): MobileAuthConfig {
  if (value.supabaseUrl !== DEVELOPMENT_SUPABASE_URL ||
      typeof value.publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value.publishableKey)) {
    throw new AuthError('configuration');
  }
  return { supabaseUrl: value.supabaseUrl, publishableKey: value.publishableKey };
}

export function readMobileAuthConfig(): MobileAuthConfig {
  const value: unknown = Constants.expoConfig?.extra?.memyDevelopmentAuth;
  if (!__DEV__ || !['ios', 'android'].includes(Platform.OS) || !value || typeof value !== 'object') {
    throw new AuthError('configuration');
  }
  const record = value as Record<string, unknown>;
  if (record.enabled !== true || typeof record.supabaseUrl !== 'string' || typeof record.publishableKey !== 'string') {
    throw new AuthError('configuration');
  }
  return validateMobileAuthConfig({ supabaseUrl: record.supabaseUrl, publishableKey: record.publishableKey });
}
