import { openSettings } from './root-shell-helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { act, renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AccessibilityInfo, BackHandler } from 'react-native';
import RootLayout from '../src/app/_layout';
import EntryRoute from '../src/app/index';
import LanguageRoute from '../src/app/language';
import IntroductionRoute from '../src/app/introduction';
import WelcomeRoute from '../src/app/welcome';
import LoginRoute from '../src/app/login';
import AuthenticatedRoute from '../src/app/authenticated';
import RegisterRoute from '../src/app/register';
import ConfirmRoute from '../src/app/auth/confirm';
import { copy, type Language } from '../src/i18n';
import { introCopy } from '../src/intro-copy';
import { entranceCopy } from '../src/entrance-copy';
import { PREFERENCES_KEY } from '../src/onboarding/preferences';
import { LargeButton } from '../src/components/LargeButton';
import { useLanguage } from '../src/language';
import { useLoginNavigation } from '../src/navigation/LoginNavigation';
import * as AuthModule from '../src/auth/AuthProvider';

const routes = { _layout: RootLayout, index: EntryRoute, language: LanguageRoute, introduction: IntroductionRoute,
  welcome: WelcomeRoute, login: LoginRoute, authenticated: AuthenticatedRoute,
  register: RegisterRoute, 'auth/confirm': ConfirmRoute };

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
function RememberedVisitEntry() {
  const { language, ready } = useLanguage();
  const { rememberAuthenticatedVisit } = useLoginNavigation();
  if (!ready) return null;
  return <LargeButton label="Simulate previously verified visit" language={language} onPress={() => {
    // UI-only fixture for a signed-out visitor whose account visit was verified
    // earlier in this launch. It does not grant a session or mark onboarding done.
    rememberAuthenticatedVisit(); router.replace('/welcome');
  }} />;
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

  it('returns from changing language without leaving stale language history behind Welcome', async () => {
    const flow = await openFlow();
    await welcome();
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    await waitFor(() => expect(router.canGoBack()).toBe(false));
    expect(flow.getPathname()).toBe('/welcome');
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

  it.each((['en', 'sv'] as const).flatMap(language => [false, true].map(hardware => ({ language, hardware }))))(
    'returns from language selection with current preferences using Back in $language (hardware=$hardware)', async ({ language, hardware }) => {
      const original = BackHandler.addEventListener;
      const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
      BackHandler.addEventListener = (name, handler) => { handlers.push(handler); return original(name, handler); };
      let flow: ReturnType<typeof renderRouter> | undefined;
      try {
        await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
        flow = await openFlow();
        fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
        await screen.findByRole('header', { name: copy[language].languageTitle });
        const selected = language === 'sv' ? 'en' : 'sv';
        fireEvent.press(screen.getByRole('radio', { name: selected === 'sv' ? 'Svenska' : 'English' }));
        if (hardware) act(() => {
          const handler = handlers.at(-1)!;
          expect(handler({} as Parameters<typeof handler>[0])).toBe(true);
        });
        else fireEvent.press(screen.getByRole('button', { name: introCopy[selected].back }));
        await screen.findByRole('header', { name: copy[selected].welcomeTitle });
        expect(flow.getPathname()).toBe('/welcome');
        expect(screen.queryByRole('header', { name: introCopy[selected].scenes[0].title })).toBeNull();
        await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!))
          .toEqual({ version: 1, language: selected, completed: true }));
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally { flow?.unmount(); BackHandler.addEventListener = original; }
    });

  it('returns to Welcome after a language change without inventing completion for a remembered account visit', async () => {
    const flow = renderRouter({ ...routes, index: RememberedVisitEntry }, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: 'Simulate previously verified visit' }));
    await screen.findByRole('header', { name: copy.en.welcomeTitle });
    expect(await AsyncStorage.getItem(PREFERENCES_KEY)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    await screen.findByRole('header', { name: copy.en.languageTitle });
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
    await screen.findByRole('header', { name: copy.sv.welcomeTitle });
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByRole('header', { name: introCopy.sv.scenes[0].title })).toBeNull();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!))
      .toEqual({ version: 1, language: 'sv', completed: false }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('changes language through the public selection route without altering a verified session or completion', async () => {
    const snapshot = { status: 'signed-in' as const, user: { id: 'synthetic-verified-user', email: 'returning@example.test' },
      error: null, appActive: true, signIn: jest.fn(async () => {}), signOut: jest.fn(async () => {}), getAccessToken: jest.fn(async () => null) };
    const auth = jest.spyOn(AuthModule, 'useAuth').mockReturnValue(snapshot);
    let flow: ReturnType<typeof renderRouter> | undefined;
    try {
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
      flow = await openFlow('/language');
      fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
      fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
      await openSettings('sv'); await screen.findByText(snapshot.user.email);
      expect(flow.getPathname()).toBe('/authenticated');
      expect(snapshot.signOut).not.toHaveBeenCalled(); expect(snapshot.signIn).not.toHaveBeenCalled();
      expect(snapshot.getAccessToken).not.toHaveBeenCalled();
      await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!))
        .toEqual({ version: 1, language: 'sv', completed: true }));
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { flow?.unmount(); auth.mockRestore(); }
  });

  it('enables intentional login and local registration preview while guest stays unavailable', async () => {
    await openFlow();
    await welcome();
    expect(screen.getByRole('button', { name: introCopy.en.login })).toBeEnabled();
    expect(screen.getByRole('button', { name: entranceCopy.en.previewRegistration })).toBeEnabled();
    expect(screen.queryByRole('button', { name: introCopy.en.guest })).toBeNull();
    expect(screen.getByText(entranceCopy.en.availability)).toBeOnTheScreen();
    expect(screen.queryByText('Create My Story')).toBeNull();
  });
});

describe('introduction completion and replay', () => {
  it('keeps the sample banner absent throughout normal Welcome and all three Replay scenes', async () => {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language: 'en', completed: true }));
    const flow = await openFlow();
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.queryByText(/SAMPLE STORIES|EXEMPELBERÄTTELSER/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
    for (let scene = 0; scene < 3; scene++) {
      expect(await screen.findByRole('header', { name: introCopy.en.scenes[scene].title })).toBeVisible();
      expect(screen.queryByText(/SAMPLE STORIES|EXEMPELBERÄTTELSER/)).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: scene === 2 ? introCopy.en.enter : introCopy.en.next }));
    }
    expect(await screen.findByRole('header', { name: copy.en.welcomeTitle })).toBeVisible();
    expect(screen.queryByText(/SAMPLE STORIES|EXEMPELBERÄTTELSER/)).toBeNull();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!))
      .toEqual({ version: 1, language: 'en', completed: true }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

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
    await waitFor(() => expect(router.canGoBack()).toBe(false));
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeVisible();
  });

  it.each((['en', 'sv'] as const).flatMap(language => [false, true].map(hardware => ({ language, hardware }))))(
    'returns Replay scene zero to Welcome using Back in $language (hardware=$hardware)', async ({ language, hardware }) => {
      const original = BackHandler.addEventListener;
      const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
      BackHandler.addEventListener = (name, handler) => { handlers.push(handler); return original(name, handler); };
      let flow: ReturnType<typeof renderRouter> | undefined;
      try {
        await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, language, completed: true }));
        flow = await openFlow();
        fireEvent.press(screen.getByRole('button', { name: introCopy[language].replay }));
        await screen.findByRole('header', { name: introCopy[language].scenes[0].title });
        fireEvent.press(screen.getByRole('button', { name: introCopy[language].next }));
        await screen.findByRole('header', { name: introCopy[language].scenes[1].title });
        fireEvent.press(screen.getByRole('button', { name: introCopy[language].back }));
        await screen.findByRole('header', { name: introCopy[language].scenes[0].title });
        if (hardware) act(() => {
          const handler = handlers.at(-1)!;
          expect(handler({} as Parameters<typeof handler>[0])).toBe(true);
        });
        else fireEvent.press(screen.getByRole('button', { name: introCopy[language].back }));
        await screen.findByRole('header', { name: copy[language].welcomeTitle });
        expect(flow.getPathname()).toBe('/welcome');
        expect(JSON.parse((await AsyncStorage.getItem(PREFERENCES_KEY))!)).toEqual({ version: 1, language, completed: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally { flow?.unmount(); BackHandler.addEventListener = original; }
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
