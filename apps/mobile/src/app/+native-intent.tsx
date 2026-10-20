import type { NativeIntent } from 'expo-router';
import { receiveConfirmationLink } from '../auth/confirmation-link';

// The provisional confirmation route receives only a bounded in-memory code,
// never credentials in router params. Its service remains gated off for live use.
// Every other external link still uses the verified entrance decision.
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path }) =>
  receiveConfirmationLink(path) ? '/auth/confirm' : '/';
