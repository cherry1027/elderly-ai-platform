import { fireEvent, screen } from '@testing-library/react-native';
import { act, renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import RootLayout from '../src/app/_layout';
import LanguageRoute from '../src/app/index';
import WelcomeRoute from '../src/app/welcome';
import { copy, type Language } from '../src/i18n';

function openFlow(initialUrl = '/') {
  return renderRouter({
    _layout: RootLayout,
    index: LanguageRoute,
    welcome: WelcomeRoute,
  }, { initialUrl });
}

describe('actual native router flow', () => {
  it('launches directly at language selection', () => {
    const flow = openFlow();
    expect(flow.getPathname()).toBe('/');
    expect(screen.getByRole('header', { name: copy.en.languageTitle })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  it.each<Language>(['en', 'sv'])('continues and returns in %s without losing the selected language', (language) => {
    const flow = openFlow();
    fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' }));
    fireEvent.press(screen.getByRole('button', { name: copy[language].continue }));
    expect(flow.getPathname()).toBe('/welcome');
    expect(screen.getByRole('header', { name: copy[language].welcomeTitle })).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
    expect(flow.getPathname()).toBe('/');
    expect(screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' })).toBeChecked();
  });

  it('lets the user change language after returning', () => {
    openFlow();
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
    expect(screen.getByRole('header', { name: copy.sv.welcomeTitle })).toBeVisible();
  });

  it('supports native router Back', () => {
    const flow = openFlow();
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    act(() => router.back());
    expect(flow.getPathname()).toBe('/');
  });

  it('does not stack duplicate Welcome screens after repeated navigation', () => {
    const flow = openFlow();
    const next = screen.getByRole('button', { name: copy.en.continue });
    act(() => {
      fireEvent.press(next);
      fireEvent.press(next);
    });
    expect(flow.getPathname()).toBe('/welcome');
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    expect(flow.getPathname()).toBe('/');
  });

  it('recovers to language selection if Welcome was opened without history', () => {
    const flow = openFlow('/welcome');
    fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
    expect(flow.getPathname()).toBe('/');
  });

  it('keeps selection in memory only for this mounted application', () => {
    const first = renderRouter({ _layout: RootLayout, index: LanguageRoute, welcome: WelcomeRoute }, { initialUrl: '/' });
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    first.unmount();
    openFlow();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  it('does not contact authentication or backend services during the complete flow', () => {
    openFlow();
    fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
    fireEvent.press(screen.getByRole('button', { name: copy.sv.changeLanguage }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
    expect(globalThis.WebSocket).not.toHaveBeenCalled();
  });

  it('contains no unavailable authentication, guest or story actions', () => {
    openFlow();
    fireEvent.press(screen.getByRole('button', { name: copy.en.continue }));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/log in|create account|continue as guest|create my story/i)).toBeNull();
  });
});
