import { getComponent } from './component-probe';
import { nativeNodes, nativeNode, nativeRef, contentLayout } from './native-tree';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, AppState, Keyboard, StyleSheet, type AppStateStatus } from 'react-native';
import { AccountScreen } from '../src/components/AccountPresentation';
import { MemoryBookArtwork } from '../src/components/BrandArtwork';
import { accessibilityLanguages, type Language } from '../src/i18n';
import { registrationCopy } from '../src/registration-copy';
import { ConfirmationScreen, type ConfirmationStatus } from '../src/screens/ConfirmationScreen';
import { RegistrationScreen } from '../src/screens/RegistrationScreen';
import { colors } from '../src/theme';

jest.mock('../src/components/AccountPresentation', () => {
  const actual = jest.requireActual<typeof import('../src/components/AccountPresentation')>('../src/components/AccountPresentation');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, AccountScreen: observeComponent(actual.AccountScreen) };
});

jest.mock('../src/components/BrandArtwork', () => {
  const actual = jest.requireActual<typeof import('../src/components/BrandArtwork')>('../src/components/BrandArtwork');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, MemoryBookArtwork: observeComponent(actual.MemoryBookArtwork) };
});

async function registration(language: Language) {
  const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
  const view = await render(<RegistrationScreen language={language} enabled={false} {...callbacks} />);
  return { ...callbacks, view };
}

async function fill(language: Language, confirmation = 'synthetic account password') {
  const text = registrationCopy[language];
  await fireEvent.changeText(screen.getByLabelText(text.email), 'fictional@example.invalid');
  await fireEvent.changeText(screen.getByLabelText(text.password), 'synthetic account password');
  await fireEvent.changeText(screen.getByLabelText(text.confirmation), confirmation);
}

describe('B2 native registration presentation keeps the closed service boundary', () => {
  it.each<Language>(['en', 'sv'])('keeps the %s form readable and honest without activating signup', async (language) => {
    const text = registrationCopy[language];
    const callbacks = await registration(language);
    expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
    expect(screen.getByText(text.gate)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: text.create })).toBeNull();
    expect(nativeNode('scroll')).toBeDefined();
    for (const input of nativeNodes('input')) {
      expect(input.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
      expect(input.props.allowFontScaling).toBe(true);
      expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minHeight: 56, fontSize: 22 });
      expect(StyleSheet.flatten(input.props.style)?.height).toBeUndefined();
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minHeight: 56 });
      expect(button.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    }
    for (const node of nativeNodes('text')) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined();
    }
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('Done and visibility controls retain %s values until explicit local validation', async (language) => {
    const text = registrationCopy[language];
    const callbacks = await registration(language);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      await fill(language);
      await fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(text.checked)).toBeNull();
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.value).toBe('synthetic account password');
      }
      await fireEvent.press(screen.getByRole('button', { name: text.showPassword }));
      expect(screen.getByRole('button', { name: text.hidePassword }).props.accessibilityState.selected).toBe(true);
      expect(screen.getByLabelText(text.password).props.secureTextEntry).toBe(false);
      expect(screen.getByLabelText(text.confirmation).props.secureTextEntry).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: text.checkDetails }));
      expect(screen.getByText(text.checked)).toBeOnTheScreen();
      expect(screen.queryByText(text.sent)).toBeNull();
      expect(screen.queryByText('synthetic account password')).toBeNull();
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    } finally { dismiss.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('announces %s validation without exposing entered passwords or dispatching', async (language) => {
    const text = registrationCopy[language];
    const callbacks = await registration(language);
    await fill(language, 'synthetic mismatching password');
    await fireEvent.press(screen.getByRole('button', { name: text.checkDetails }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(text.mismatch);
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
    expect(alert.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    expect(screen.queryByText('synthetic account password')).toBeNull();
    expect(screen.queryByText('synthetic mismatching password')).toBeNull();
    await fireEvent(screen.getByLabelText(text.confirmation), 'focus');
    expect(screen.getByLabelText(text.confirmation)).toHaveStyle({ borderColor: colors.ink });
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('preserves %s background password concealment after presentation changes', async (language) => {
    const original = AppState.addEventListener;
    const remove = jest.fn();
    let changed: ((state: AppStateStatus) => void) | undefined;
    AppState.addEventListener = (event, listener) => {
      if (event !== 'change') return original(event, listener);
      changed = listener as (state: AppStateStatus) => void; return { remove };
    };
    try {
      const callbacks = await registration(language);
      const text = registrationCopy[language];
      await fill(language);
      await fireEvent.press(screen.getByRole('button', { name: text.showPassword }));
      await fireEvent.press(screen.getByRole('button', { name: text.showConfirmation }));
      await act(() => changed?.('inactive'));
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.value).toBe('');
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
      }
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { AppState.addEventListener = original; }
  });

  it.each<Language>(['en', 'sv'])('announces only mapped %s validation and local-check copy to VoiceOver', async (language) => {
    const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    try {
      const text = registrationCopy[language];
      const callbacks = await registration(language);
      await fill(language, 'synthetic mismatching password');
      await fireEvent.press(screen.getByRole('button', { name: text.checkDetails }));
      await waitFor(() => expect(announce).toHaveBeenCalledWith(text.mismatch));
      await fireEvent.changeText(screen.getByLabelText(text.confirmation), 'synthetic account password');
      await fireEvent.press(screen.getByRole('button', { name: text.checkDetails }));
      await waitFor(() => expect(announce).toHaveBeenCalledWith(text.checked));
      expect(announce.mock.calls.map(([message]) => message)).toEqual([text.mismatch, text.checked]);
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { reader.mockRestore(); announce.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('reveals %s feedback after layout and keyboard movement without replaying validation', async (language) => {
    const original = Keyboard.addListener;
    const subscriptions: { name: string; listener: () => void; remove: jest.Mock }[] = [];
    Keyboard.addListener = ((name, listener) => {
      if (name !== 'keyboardDidHide' && name !== 'keyboardDidShow') return original.call(Keyboard, name, listener);
      const subscription = { name, listener: listener as () => void, remove: jest.fn() };
      subscriptions.push(subscription);
      return { remove: subscription.remove };
    }) as typeof Keyboard.addListener;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const callbacks = await registration(language); view = callbacks.view;
      const text = registrationCopy[language];
      const container = getComponent(AccountScreen);
      const scrollTo = jest.fn(); jest.spyOn(nativeRef(container.props.scrollViewRef), 'scrollTo').mockImplementation(scrollTo);
      await contentLayout(getComponent(AccountScreen).props.onContentLayout);
      const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 342, height: 600 } } });
      await fireEvent(screen.getByTestId('registration-form'), 'layout', layout(420));
      expect(scrollTo).not.toHaveBeenCalled();
      await fill(language, 'synthetic mismatching password');
      await fireEvent.press(screen.getByRole('button', { name: text.checkDetails }));
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 404, animated: false });
      scrollTo.mockClear();
      await contentLayout(getComponent(AccountScreen).props.onContentLayout);
      await act(() => subscriptions.forEach(subscription => subscription.listener()));
      expect(scrollTo).toHaveBeenCalledWith({ y: 404, animated: false });
      expect(screen.getByRole('alert')).toHaveTextContent(text.mismatch);
      await fireEvent.changeText(screen.getByLabelText(text.confirmation), 'synthetic account password');
      scrollTo.mockClear();
      await act(() => subscriptions.forEach(subscription => subscription.listener()));
      expect(scrollTo).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
      await view.unmount(); view = undefined;
      scrollTo.mockClear();
      await act(() => subscriptions.forEach(subscription => subscription.listener()));
      expect(scrollTo).not.toHaveBeenCalled();
      for (const subscription of subscriptions) expect(subscription.remove).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { await view?.unmount(); Keyboard.addListener = original; }
  });
});

describe('B2 confirmation presents trusted statuses without activating callback services', () => {
  const statuses: ConfirmationStatus[] = ['checking', 'confirmed', 'invalid', 'blocked', 'unavailable'];
  const messages = {
    checking: 'confirmationChecking', confirmed: 'confirmationConfirmed', invalid: 'confirmationInvalid',
    blocked: 'confirmationBlocked', unavailable: 'confirmationUnavailable',
  } as const;

  it.each((['en', 'sv'] as const).flatMap(language => statuses.map(status => ({ language, status }))))(
    'keeps $language $status truthful, scalable and explicitly navigated', async ({ language, status }) => {
      const onWelcome = jest.fn(); const onLogin = jest.fn();
      await render(<ConfirmationScreen language={language} status={status} onWelcome={onWelcome} onLogin={onLogin} />);
      const text = registrationCopy[language];
      expect(screen.getByText(text[messages[status]])).toBeOnTheScreen();
      expect(screen.queryByLabelText(text.password)).toBeNull();
      expect(getComponent(MemoryBookArtwork)).toBeDefined();
      const artwork = nativeNodes('view').find(node => StyleSheet.flatten(node.props.style)?.aspectRatio === 760 / 650)!;
      expect(artwork.parent?.props.style).toMatchObject({ maxWidth: 160 });
      if (status === 'checking' || status === 'blocked') {
        expect(screen.queryByRole('button', { name: text.login })).toBeNull();
      } else {
        expect(screen.getByRole('button', { name: text.login })).toBeEnabled();
      }
      for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
      for (const node of nativeNodes('text')) {
        expect(node.props.allowFontScaling).toBe(true);
        expect(node.props.numberOfLines).toBeUndefined();
      }
      expect(onLogin).not.toHaveBeenCalled();
      expect(onWelcome).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: text.back }));
      expect(onWelcome).toHaveBeenCalledTimes(1);
    },
  );
});
