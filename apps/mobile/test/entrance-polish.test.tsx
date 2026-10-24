import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MemoryBookArtwork } from '../src/components/BrandArtwork';
import { entranceCopy } from '../src/entrance-copy';
import { accessibilityLanguages, copy, type Language } from '../src/i18n';
import { introCopy } from '../src/intro-copy';
import { WelcomeScreen } from '../src/screens/WelcomeScreen';
import { colors } from '../src/theme';

const languages: Language[] = ['en', 'sv'];
afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it.each(languages)('Welcome has one Memy heading and intentionally opens working actions in %s', language => {
  const login = jest.fn(), register = jest.fn(), replay = jest.fn(), change = jest.fn();
  const entrance = entranceCopy[language], intro = introCopy[language];
  render(<WelcomeScreen language={language} onLogin={login} onRegister={register}
    onReplayIntroduction={replay} onChangeLanguage={change} />);
  expect(screen.getAllByRole('header')).toHaveLength(1);
  expect(screen.getByRole('header', { name: copy[language].welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByText('Memy')).toBeNull();
  expect(screen.getByText(copy[language].welcomeDescription)).toBeOnTheScreen();
  expect(screen.getByText(entrance.availability)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: intro.register })).toBeNull();
  expect(screen.queryByRole('button', { name: intro.guest })).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(4);
  expect(login).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: intro.login }));
  fireEvent.press(screen.getByRole('button', { name: entrance.previewRegistration }));
  fireEvent.press(screen.getByRole('button', { name: intro.replay }));
  fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
  expect(login).toHaveBeenCalledTimes(1); expect(register).toHaveBeenCalledTimes(1);
  expect(replay).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1);
});

it.each(languages)('Welcome keeps login primary and the original artwork within a compact wrapper in %s', language => {
  render(<WelcomeScreen language={language} onLogin={jest.fn()} onRegister={jest.fn()} onChangeLanguage={jest.fn()} />);
  const login = screen.getByRole('button', { name: introCopy[language].login });
  const preview = screen.getByRole('button', { name: entranceCopy[language].previewRegistration });
  expect(login).toHaveStyle({ backgroundColor: colors.forest });
  expect(preview).not.toHaveStyle({ backgroundColor: colors.forest });
  let artwork = screen.UNSAFE_getByType(MemoryBookArtwork).parent;
  while (artwork && StyleSheet.flatten(artwork.props.style)?.maxWidth !== 184) artwork = artwork.parent;
  expect(artwork).not.toBeNull();
  expect(StyleSheet.flatten(artwork?.props.style)).toMatchObject({ width: '100%', maxWidth: 184, alignSelf: 'center' });
  expect(screen.getByText(copy[language].footer)).toBeOnTheScreen();
});

it.each(languages)('Welcome has no fake account or guest action when callbacks are unavailable in %s', language => {
  const change = jest.fn();
  render(<WelcomeScreen language={language} onChangeLanguage={change} />);
  expect(screen.getByText(introCopy[language].unavailable)).toBeOnTheScreen();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  for (const label of [introCopy[language].login, introCopy[language].register,
    introCopy[language].guest, entranceCopy[language].previewRegistration]) {
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  }
  fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
  expect(change).toHaveBeenCalledTimes(1);
});

it.each(languages)('Welcome cleanup blocks account entry while retaining recovery, language and replay in %s', language => {
  const login = jest.fn(), register = jest.fn(), retry = jest.fn(), replay = jest.fn(), change = jest.fn();
  const message = language === 'sv' ? 'Kontot behöver rensas innan du kan fortsätta.' : 'Account cleanup must finish before continuing.';
  const retryLabel = language === 'sv' ? 'Försök igen' : 'Try again';
  render(<WelcomeScreen language={language} onLogin={login} onRegister={register}
    onChangeLanguage={change} onReplayIntroduction={replay} cleanup={{ message, retryLabel, onRetry: retry }} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(message);
  expect(alert.props.accessibilityLiveRegion).toBe('assertive');
  expect(screen.queryByRole('button', { name: introCopy[language].login })).toBeNull();
  expect(screen.queryByRole('button', { name: entranceCopy[language].previewRegistration })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: retryLabel }));
  fireEvent.press(screen.getByRole('button', { name: introCopy[language].replay }));
  fireEvent.press(screen.getByRole('button', { name: copy[language].changeLanguage }));
  expect(retry).toHaveBeenCalledTimes(1); expect(replay).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1);
  expect(login).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
});

it.each(languages)('Welcome preserves an explicit local primary fallback without inventing Login in %s', language => {
  const open = jest.fn(), label = language === 'sv' ? 'Öppna exempelberättelser' : 'Open sample stories';
  render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} primaryAction={{ label, onPress: open }} />);
  expect(screen.queryByRole('button', { name: introCopy[language].login })).toBeNull();
  expect(screen.getByText(introCopy[language].unavailable)).toBeOnTheScreen();
  expect(open).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: label }));
  expect(open).toHaveBeenCalledTimes(1);
});

it.each(languages)('Welcome retains storage failure feedback without changing preferences in %s', language => {
  const view = render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} />);
  expect(screen.queryByText(introCopy[language].storageNote)).toBeNull();
  view.rerender(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} storageUnavailable />);
  expect(screen.getByText(introCopy[language].storageNote).props.accessibilityLiveRegion).toBe('polite');
});

it.each(languages)('Welcome preserves flexible readable text, safe areas and large focused controls in %s', language => {
  render(<WelcomeScreen language={language} onLogin={jest.fn()} onRegister={jest.fn()}
    onReplayIntroduction={jest.fn()} onChangeLanguage={jest.fn()} />);
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true);
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.adjustsFontSizeToFit).not.toBe(true);
    expect(StyleSheet.flatten(node.props.style)?.height).toBeUndefined();
  }
  for (const target of screen.getAllByRole('button')) {
    const style = StyleSheet.flatten(target.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(56);
    expect(style.height).toBeUndefined(); expect(style.maxHeight).toBeUndefined();
    expect(target.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    fireEvent(target, 'focus'); expect(target).toHaveStyle({ borderColor: colors.ink });
    fireEvent(target, 'blur');
  }
  expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).not.toBe(false);
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
});
