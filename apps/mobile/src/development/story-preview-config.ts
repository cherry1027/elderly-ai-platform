import Constants from 'expo-constants';
import { Platform } from 'react-native';

function disabled(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).join(',') === 'enabled' && (value as Record<string, unknown>).enabled === false;
}

/** Only the explicit sample launcher enables this; URL parameters cannot. */
export function readStoryPreviewEnabled(): boolean {
  if (!__DEV__ || !['ios', 'android'].includes(Platform.OS)) return false;
  const extra = Constants.expoConfig?.extra;
  return extra?.memyStoryPreviewEnabled === true &&
    disabled(extra.memyDevelopmentAuth) && disabled(extra.memyDevelopmentApi);
}
