import type { NativeIntent } from 'expo-router';

// This task has no external auth callbacks or content deep links. Both cold
// launches and new native links enter through the verified session/preferences
// decision at "/". In-app navigation (including Replay) does not use this hook.
// Future recovery/registration callbacks need an explicit policy before reuse.
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = () => '/';
