import { act, fireEvent, screen } from '@testing-library/react-native';
import type { Language } from '../src/i18n';
import { rootNavigationCopy } from '../src/root-navigation-copy';

/** Intentional navigation: successful sign-in itself must never read the list. */
export async function openMyStories(language: Language = 'en') {
  const tab = await screen.findByRole('tab', { name: rootNavigationCopy[language].tabs.stories });
  await act(async () => { fireEvent.press(tab); });
}
export async function openSettings(language: Language = 'en') {
  const tab = await screen.findByRole('tab', { name: rootNavigationCopy[language].tabs.settings });
  await act(async () => { fireEvent.press(tab); });
  await screen.findByRole('header', { name: rootNavigationCopy[language].settingsTitle });
}
