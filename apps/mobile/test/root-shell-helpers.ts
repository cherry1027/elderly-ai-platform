import { fireEvent, screen } from '@testing-library/react-native';
import type { Language } from '../src/i18n';
import { rootNavigationCopy } from '../src/root-navigation-copy';

/** A missing action fails the test; optional callbacks are never silently skipped. */
export function requireCallback<Callback extends (...args: never[]) => unknown>(callback: Callback | undefined): Callback {
  if (typeof callback !== 'function') throw new Error('Expected a defined component action.');
  return callback;
}

/** Intentional navigation: successful sign-in itself must never read the list. */
export async function openMyStories(language: Language = 'en') {
  const tab = await screen.findByRole('tab', { name: rootNavigationCopy[language].tabs.stories });
  await fireEvent.press(tab);
}
export async function openSettings(language: Language = 'en') {
  const tab = await screen.findByRole('tab', { name: rootNavigationCopy[language].tabs.settings });
  await fireEvent.press(tab);
  await screen.findByRole('header', { name: rootNavigationCopy[language].settingsTitle });
}
