import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { act, renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';
import RootLayout from '../src/app/_layout';
import EntryRoute from '../src/app/index';
import LanguageRoute from '../src/app/language';
import IntroductionRoute from '../src/app/introduction';
import WelcomeRoute from '../src/app/welcome';
import LoginRoute from '../src/app/login';
import AuthenticatedRoute from '../src/app/authenticated';
import { copy, type Language } from '../src/i18n';
import { introCopy } from '../src/intro-copy';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';

const routes = { _layout: RootLayout, index: EntryRoute, language: LanguageRoute, introduction: IntroductionRoute,
  welcome: WelcomeRoute, login: LoginRoute, authenticated: AuthenticatedRoute };

async function openFlow(initialUrl = '/') {
  const flow = renderRouter(routes, { initialUrl });
  await screen.findByRole('header');
  return flow;
}
async function welcome(language: Language = 'en') {
  fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' }));
  fireEvent.press(screen.getByRole('button', { name: copy[language].continue }));
  await screen.findByRole('header', { name: introCopy[language].scenes[0].title });
  fireEvent.press(screen.getByRole('button', { name: introCopy[language].skip }));
  await screen.findByRole('header', { name: copy[language].welcomeTitle });
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  // Route tests use OS reduced-motion mode; native animation behavior is covered
  // independently by artwork/motion tests without background animation timers.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

describe('actual native router flow', () => {
  it('launches directly at language selection on first use', async () => {
    const flow = await openFlow();
    expect(flow.getPathname()).toBe('/language');
    expect(screen.getByRole('header', { name: copy.en.languageTitle })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  it.each<Language>(['en', 'sv'])('continues and returns in %s without losing the selected language', async (language) => {
    const flow = await openFlow();
    await welcome(language);
    expect(flow.getPathname()).toBe('/welcome');
    fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
    await screen.findByRole('header', { name: copy[language].languageTitle });
    expect(flow.getPathname()).toBe('/language');
    expect(screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' })).toBeChecked();
  });

  it('lets the user change language after returning without forcing introduction again', async () => {
    await openFlow();
    await welcome();
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
    expect(await screen.findByRole('header', { name: copy.sv.welcomeTitle })).toBeVisible();
  });

  it('supports native router Back after changing language and returning to Welcome', async () => {
    const flow = await openFlow();
    await welcome();
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    act(() => router.back());
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(flow.getPathname()).toBe('/language');
  });

  it('does not stack duplicate introduction screens after repeated Continue activation', async () => {
    const flow = await openFlow();
    const next = screen.getByRole('button', { name: copy.en.continue });
    act(() => { fireEvent.press(next); fireEvent.press(next); });
    await screen.findByRole('header', { name: introCopy.en.scenes[0].title });
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(flow.getPathname()).toBe('/language');
  });

  it('can reach language selection if Welcome was opened without history', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    const flow = await openFlow('/welcome');
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    await screen.findByRole('header', { name: copy.en.languageTitle });
    expect(flow.getPathname()).toBe('/language');
  });

  it('persists the selected language across application remount', async () => {
    const first = await openFlow();
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!).language).toBe('sv'));
    first.unmount();
    await openFlow();
    expect(screen.getByRole('radio', { name: 'Svenska' })).toBeChecked();
  });

  it('does not contact authentication or backend services during the complete flow', async () => {
    await openFlow();
    await welcome('sv');
    fireEvent.press(screen.getByRole('button', { name: copy.sv.changeLanguage }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
    expect(globalThis.WebSocket).not.toHaveBeenCalled();
  });

  it('enables only login while registration and guest destinations remain disabled', async () => {
    await openFlow();
    await welcome();
    expect(screen.getByRole('button', { name: introCopy.en.login })).toBeEnabled();
    for (const name of [introCopy.en.register, introCopy.en.guest]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.queryByText('Create My Story')).toBeNull();
  });
});

describe('introduction completion and replay', () => {
  it.each<Language>(['en', 'sv'])('shows all three scenes in order and enters Welcome in %s', async (language) => {
    const flow = await openFlow();
    fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' }));
    fireEvent.press(screen.getByRole('button', { name: copy[language].continue }));
    for (let scene = 0; scene < 3; scene++) {
      expect(await screen.findByRole('header', { name: introCopy[language].scenes[scene].title })).toBeVisible();
      expect(screen.getByTestId('memory-book-scene-' + (scene + 1), { includeHiddenElements: true })).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: scene === 2 ? introCopy[language].enter : introCopy[language].next }));
    }
    expect(await screen.findByRole('header', { name: copy[language].welcomeTitle })).toBeVisible();
    expect(flow.getPathname()).toBe('/welcome');
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!).completed).toBe(true));
  });

  it('moves back through scenes without marking completion', async () => {
    await openFlow('/introduction?scene=2');
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
    expect(await screen.findByRole('header', { name: introCopy.en.scenes[1].title })).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
    expect(await screen.findByRole('header', { name: introCopy.en.scenes[0].title })).toBeVisible();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('explicitly skips from scene %s and returning users bypass the introduction', async (scene) => {
    const flow = await openFlow('/introduction?scene=' + scene);
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.skip }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!).completed).toBe(true));
    flow.unmount();
    const returning = await openFlow();
    expect(returning.getPathname()).toBe('/welcome');
    expect(screen.queryByText(introCopy.en.scenes[0].title)).toBeNull();
  });

  it('replays without clearing prior completion or language', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'sv', completed: true }));
    const flow = await openFlow();
    expect(flow.getPathname()).toBe('/welcome');
    fireEvent.press(screen.getByRole('button', { name: introCopy.sv.replay }));
    expect(await screen.findByRole('header', { name: introCopy.sv.scenes[0].title })).toBeVisible();
    expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!).completed).toBe(true);
  });

  it('does not accumulate Welcome or introduction screens after repeated replay', async () => {
    await openFlow();
    await welcome();
    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
      await screen.findByRole('header', { name: introCopy.en.scenes[0].title });
      fireEvent.press(screen.getByRole('button', { name: introCopy.en.skip }));
      await screen.findByRole('header', { name: copy.en.welcomeTitle });
    }
    act(() => router.back());
    expect(await screen.findByRole('header', { name: copy.en.languageTitle })).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    expect(await screen.findByRole('header', { name: copy.en.welcomeTitle })).toBeVisible();
  });

  it('does not duplicate language selection when backing out of the first scene', async () => {
    const flow = await openFlow();
    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
      await screen.findByRole('header', { name: introCopy.en.scenes[0].title });
      fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
      await screen.findByRole('header', { name: copy.en.languageTitle });
    }
    expect(router.canGoBack()).toBe(false);
    expect(flow.getPathname()).toBe('/language');
  });

  it.each(['-1', '3', 'garbage'])('handles invalid scene parameter %s safely', async (scene) => {
    await openFlow('/introduction?scene=' + scene);
    expect(screen.getByRole('header', { name: introCopy.en.scenes[0].title })).toBeVisible();
  });

  it('preserves completion when changing the language of a returning user', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    await openFlow();
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
    expect(await screen.findByRole('header', { name: copy.sv.welcomeTitle })).toBeVisible();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language: 'sv', completed: true }));
  });
});
