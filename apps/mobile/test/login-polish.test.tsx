import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Keyboard, KeyboardAvoidingView, StyleSheet, Text, TextInput, View, type AppStateStatus, type KeyboardEvent } from 'react-native';
import { authCopy } from '../src/auth-copy';
import { accountStyles } from '../src/components/AccountPresentation';
import { Screen } from '../src/components/Screen';
import type { Language } from '../src/i18n';
import { LoginScreen } from '../src/screens/LoginScreen';
import { colors } from '../src/theme';

const languages: Language[] = ['en', 'sv'];
const syntheticEmail = 'reader@invalid.test';
const syntheticPassword = 'fictional test input';

function setup(language: Language, props: Partial<React.ComponentProps<typeof LoginScreen>> = {}) {
  const onSignIn = jest.fn(async () => {});
  const onBack = jest.fn();
  const view = render(<LoginScreen language={language} busy={false} error={null}
    onSignIn={onSignIn} onBack={onBack} {...props} />);
  return { ...view, onSignIn, onBack, copy: authCopy[language] };
}

function fill(language: Language, email = syntheticEmail, password = syntheticPassword) {
  fireEvent.changeText(screen.getByLabelText(authCopy[language].email), email);
  fireEvent.changeText(screen.getByLabelText(authCopy[language].password), password);
}

afterEach(() => jest.restoreAllMocks());

describe.each(languages)('B2 %s intentional native login', (language) => {
  const copy = authCopy[language];

  it('has one calm heading, scalable fields and large accessible controls', () => {
    setup(language);
    expect(screen.getAllByRole('header', { name: copy.title })).toHaveLength(1);
    expect(screen.getByText(copy.introduction)).toBeOnTheScreen();
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeDefined();
    for (const input of screen.UNSAFE_getAllByType(TextInput)) {
      expect(input.props.allowFontScaling).toBe(true);
      expect(input.props.accessibilityLanguage).toBe(language === 'sv' ? 'sv-SE' : 'en-GB');
      expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minHeight: 56, fontSize: 22 });
      expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    }
    for (const control of screen.getAllByRole('button')) expect(control).toHaveStyle({ minHeight: 56 });
    for (const text of screen.UNSAFE_getAllByType(Text)) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
    }
    const email = screen.getByLabelText(copy.email);
    fireEvent(email, 'focus');
    expect(email).toHaveStyle({ borderColor: colors.ink });
    const show = screen.getByRole('button', { name: copy.showPassword });
    fireEvent(show, 'focus');
    expect(show).toHaveStyle({ borderColor: colors.ink });
    expect(screen.getByText(copy.showPassword)).toHaveStyle({ textDecorationLine: 'underline' });
  });

  it('uses Next for email and Done only dismisses the keyboard, retaining both values', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const { onSignIn } = setup(language);
    fill(language);
    expect(screen.getByLabelText(copy.email).props.returnKeyType).toBe('next');
    expect(screen.getByLabelText(copy.email).props.submitBehavior).toBe('submit');
    const password = screen.getByLabelText(copy.password);
    expect(password.props.returnKeyType).toBe('done');
    expect(password.props.submitBehavior).toBe('blurAndSubmit');
    fireEvent(password, 'submitEditing');
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText(copy.email).props.value).toBe(syntheticEmail);
    expect(screen.getByLabelText(copy.password).props.value).toBe(syntheticPassword);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('moves email Next focus to password without logging in', () => {
    const passwordFocus = jest.fn();
    const onSignIn = jest.fn(async () => {});
    render(<LoginScreen language={language} onSignIn={onSignIn} onBack={jest.fn()} busy={false} error={null} />);
    // The installed RN preset supplies class instances, so instrument the
    // password instance held by the real useRef rather than a host-node mock.
    const password = screen.UNSAFE_getAllByType(TextInput).find(input => input.props.accessibilityLabel === copy.password)!.instance as TextInput;
    password.focus = passwordFocus;
    fill(language);
    fireEvent(screen.getByLabelText(copy.email), 'submitEditing');
    expect(passwordFocus).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText(copy.password).props.value).toBe(syntheticPassword);
  });

  it('reveals and conceals the same retained password with selected semantics', () => {
    const { onSignIn } = setup(language);
    fill(language);
    const show = screen.getByRole('button', { name: copy.showPassword });
    expect(show.props.accessibilityState.selected).toBe(false);
    fireEvent.press(show);
    expect(screen.getByLabelText(copy.password).props.value).toBe(syntheticPassword);
    expect(screen.getByLabelText(copy.password).props.secureTextEntry).toBe(false);
    const hide = screen.getByRole('button', { name: copy.hidePassword });
    expect(hide.props.accessibilityState.selected).toBe(true);
    fireEvent(screen.getByLabelText(copy.password), 'submitEditing');
    fireEvent.press(hide);
    expect(screen.getByLabelText(copy.password).props.value).toBe(syntheticPassword);
    expect(screen.getByLabelText(copy.password).props.secureTextEntry).toBe(true);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('updates translated labels without dispatching login or clearing controlled values', () => {
    const onSignIn = jest.fn(async () => {});
    const view = setup(language, { onSignIn });
    fill(language);
    const nextLanguage: Language = language === 'en' ? 'sv' : 'en';
    const nextCopy = authCopy[nextLanguage];
    view.rerender(<LoginScreen language={nextLanguage} onSignIn={onSignIn} onBack={jest.fn()} busy={false} error={null} />);
    expect(screen.getByRole('header', { name: nextCopy.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(nextCopy.email).props.value).toBe(syntheticEmail);
    expect(screen.getByLabelText(nextCopy.password).props.value).toBe(syntheticPassword);
    expect(screen.getByLabelText(nextCopy.password).props.secureTextEntry).toBe(true);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('validates locally and announces translated required/email errors without a request', () => {
    const { onSignIn } = setup(language);
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.required);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    fill(language, 'incorrect-email');
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.invalidEmail);
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.queryByText(syntheticPassword)).toBeNull();
  });

  it('requires explicit Log In, prevents duplicates and preserves exact password until settlement', async () => {
    let finish!: () => void;
    const onSignIn = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    setup(language, { onSignIn });
    fill(language, `  ${syntheticEmail}  `, `  ${syntheticPassword}  `);
    fireEvent(screen.getByLabelText(copy.password), 'submitEditing');
    expect(onSignIn).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    const waiting = screen.getByRole('button', { name: copy.signingIn });
    fireEvent.press(waiting);
    fireEvent(screen.getByLabelText(copy.password), 'submitEditing');
    expect(waiting).toBeDisabled();
    expect(waiting.props.accessibilityState.busy).toBe(true);
    expect(screen.getByLabelText(copy.email).props.editable).toBe(false);
    expect(screen.getByLabelText(copy.password).props.editable).toBe(false);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledWith(syntheticEmail, `  ${syntheticPassword}  `);
    await act(async () => finish());
    expect(screen.getByLabelText(copy.password).props.value).toBe('');
    expect(screen.getByLabelText(copy.password).props.secureTextEntry).toBe(true);
  });

  it('shows safe rejected-login copy and never renders raw private errors', async () => {
    const onSignIn = jest.fn(async () => { throw new Error(`unsafe server detail ${syntheticPassword}`); });
    setup(language, { onSignIn });
    fill(language);
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.unknown));
    expect(screen.queryByText(/unsafe server detail/)).toBeNull();
    expect(screen.queryByText(syntheticPassword)).toBeNull();
    expect(screen.getByLabelText(copy.password).props.value).toBe('');
  });

  it('announces only the mapped safe login error, never credentials or raw failures', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const onSignIn = jest.fn(async () => { throw new Error(`private transport ${syntheticEmail} ${syntheticPassword}`); });
    setup(language, { onSignIn });
    fill(language);
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith(copy.errors.unknown));
    for (const [message] of announce.mock.calls) {
      expect(message).toBe(copy.errors.unknown);
      expect(message).not.toContain(syntheticEmail);
      expect(message).not.toContain(syntheticPassword);
      expect(message).not.toContain('private transport');
    }
  });

  it('reveals validation after content/keyboard layout and cancels stale reveal listeners', () => {
    const original = Keyboard.addListener;
    const subscriptions: { name: 'keyboardDidShow' | 'keyboardDidHide'; listener: (event: KeyboardEvent) => void; remove: jest.Mock }[] = [];
    jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
      if (name !== 'keyboardDidShow' && name !== 'keyboardDidHide') return original.call(Keyboard, name, listener);
      const remove = jest.fn();
      subscriptions.push({ name, listener, remove });
      return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
    });
    const { onSignIn, unmount } = setup(language);
    const scrollTo = jest.fn();
    const container = screen.UNSAFE_getByType(Screen);
    container.props.scrollViewRef.current = { scrollTo };
    const form = screen.UNSAFE_getAllByType(View).find(node => node.props.style === accountStyles.form)!;
    const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 340, height: 600 } } });
    act(() => form.props.onLayout(layout(420)));
    act(() => container.props.onContentLayout());
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    expect(scrollTo).toHaveBeenCalledWith({ y: 404, animated: false });
    scrollTo.mockClear();
    act(() => container.props.onContentLayout());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 404, animated: false });
    const shown = subscriptions.filter(item => item.name === 'keyboardDidShow').at(-1)!;
    const hidden = subscriptions.filter(item => item.name === 'keyboardDidHide').at(-1)!;
    scrollTo.mockClear();
    act(() => { shown.listener({} as KeyboardEvent); hidden.listener({} as KeyboardEvent); });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 404, animated: false });
    act(() => form.props.onLayout(layout(460)));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 444, animated: false });
    act(() => form.props.onLayout(layout(8)));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    fill(language);
    expect(shown.remove).toHaveBeenCalledTimes(1);
    expect(hidden.remove).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    act(() => { shown.listener({} as KeyboardEvent); hidden.listener({} as KeyboardEvent); });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onSignIn).not.toHaveBeenCalled();
    unmount();
    act(() => { shown.listener({} as KeyboardEvent); hidden.listener({} as KeyboardEvent); });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not announce a stale error after leaving the login screen', async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => pending);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const view = setup(language, { error: 'network' });
    view.unmount();
    await act(async () => finish(true));
    expect(announce).not.toHaveBeenCalled();
  });

  it('retains blocked-session cleanup recovery and never bypasses it', () => {
    const onRetryCleanup = jest.fn();
    const { onSignIn } = setup(language, { blocked: true, error: 'cleanup', onRetryCleanup });
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.cleanup);
    expect(screen.getByRole('button', { name: copy.signIn })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.showPassword })).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    fireEvent.press(screen.getByRole('button', { name: copy.retryCleanup }));
    expect(onRetryCleanup).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.back })).not.toBeDisabled();
  });

  it('clears and conceals credentials on background without submitting', () => {
    let changed: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      changed = handler; return { remove };
    });
    const { onSignIn, unmount } = setup(language);
    fill(language);
    fireEvent.press(screen.getByRole('button', { name: copy.showPassword }));
    act(() => changed?.('inactive'));
    act(() => changed?.('background'));
    expect(screen.getByLabelText(copy.password).props.value).toBe('');
    expect(screen.getByLabelText(copy.password).props.secureTextEntry).toBe(true);
    act(() => changed?.('active'));
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.required);
    expect(onSignIn).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps Back available while waiting and ignores a cancelled attempt’s late error', async () => {
    let reject!: (reason: Error) => void;
    const onSignIn = jest.fn(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
    const onBack = jest.fn();
    setup(language, { onSignIn, onBack });
    fill(language);
    fireEvent.press(screen.getByRole('button', { name: copy.signIn }));
    fireEvent.press(screen.getByRole('button', { name: copy.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(copy.password).props.value).toBe('');
    await act(async () => reject(new Error('synthetic cancelled response')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(copy.password).props.value).toBe('');
  });
});
