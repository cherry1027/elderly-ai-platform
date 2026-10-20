import { useCallback } from 'react';
import { useFocusEffect, useNavigation } from 'expo-router';
import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation';
import type { AuthSnapshot } from '../auth/client';

export function hasWelcomeDestination(completed: boolean, welcomeAvailable: boolean,
  auth: Pick<AuthSnapshot, 'status' | 'error'>): boolean {
  return completed || welcomeAvailable || auth.status === 'blocked' || auth.error === 'session';
}

// Replace only navigation history, retaining the focused screen's key and state.
// In particular, a native Back must not reveal an old Login or onboarding screen
// which immediately redirects back to this screen. No authentication is changed.
export function useEntranceRoot(enabled: boolean, name: 'welcome' | 'authenticated') {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    const state = navigation.getState();
    const current = state?.routes[state.index];
    if (!state || current?.name !== name || state.routes.length === 1) return;
    navigation.reset({ ...state, index: 0, routes: [current] });
  }, [enabled, name, navigation]));
}
