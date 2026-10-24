import { getComponent } from './component-probe';
import { nativeNodes } from './native-tree';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, KeyboardAvoidingView, StyleSheet, type AppStateStatus } from 'react-native';
import type { AuthErrorKind } from '../src/auth/errors';
import { authCopy } from '../src/auth-copy';
import type { Language } from '../src/i18n';
import { AuthenticatedScreen } from '../src/screens/AuthenticatedScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { colors } from '../src/theme';

const setup = async (props: Partial<React.ComponentProps<typeof LoginScreen>> = {}) => {
  const onSignIn = jest.fn(async () => {});
  const onBack = jest.fn();
  await render(<LoginScreen language="en" onSignIn={onSignIn} onBack={onBack} busy={false} error={null} {...props} />);
  return { onSignIn, onBack };
};

async function fill(email = 'example@invalid.test', password = 'not-a-real-password') {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

describe('native login form', () => {
  it.each<Language>(['en', 'sv'])('renders the native %s labels and safe instructions', async (language) => {
    await setup({ language });
    const copy = authCopy[language];
    expect(screen.getByRole('header', { name: copy.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(copy.email)).toBeOnTheScreen();
    expect(screen.getByLabelText(copy.password).props.secureTextEntry).toBe(true);
    expect(screen.getByText(copy.introduction)).toBeOnTheScreen();
    expect(screen.queryByText(/forgot password|register|create account|guest/i)).toBeNull();
  });

  it.each(['', 'example@invalid.test'])('requires both fields before requesting sign-in: %s', async (email) => {
    const { onSignIn } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Email'), email);
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    expect(screen.getByRole('alert')).toHaveTextContent(authCopy.en.required);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'a@', '@invalid.test', 'a b@invalid.test'])('rejects malformed email without a request: %s', async (email) => {
    const { onSignIn } = await setup();
    await fill(email);
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    expect(screen.getByRole('alert')).toHaveTextContent(authCopy.en.invalidEmail);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('trims email while preserving the exact password and clears it after success', async () => {
    const { onSignIn } = await setup();
    await fill('  example@invalid.test  ', '  exact password  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith('example@invalid.test', '  exact password  '));
    await waitFor(() => expect(screen.getByLabelText('Password').props.value).toBe(''));
    expect(screen.getByLabelText('Email').props.value).toBe('  example@invalid.test  ');
  });

  it('accepts existing short passwords without applying registration rules', async () => {
    const { onSignIn } = await setup();
    await fill('example@invalid.test', 'x');
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith('example@invalid.test', 'x'));
  });

  it('blocks duplicate submissions before the parent can update busy state', async () => {
    let finish!: () => void;
    const onSignIn = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    await setup({ onSignIn }); await fill();
    const button = screen.getByRole('button', { name: 'Log In' });
    await fireEvent.press(button); await fireEvent.press(button);
    await fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled();
    await act(async () => finish());
  });

  it('replaces raw rejected values with safe copy and clears the password', async () => {
    const onSignIn = jest.fn(async () => { throw new Error('private-response-secret'); });
    await setup({ onSignIn }); await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(authCopy.en.errors.unknown));
    expect(screen.queryByText('private-response-secret')).toBeNull();
    expect(screen.getByLabelText('Password').props.value).toBe('');
  });

  it.each<AuthErrorKind>(['configuration', 'credentials', 'rate-limit', 'network', 'timeout', 'session', 'storage', 'cleanup', 'confirmation', 'unknown'])(
    'shows only localized safe error copy for %s', async (kind) => {
      await setup({ language: 'sv', error: kind });
      expect(screen.getByRole('alert')).toHaveTextContent(authCopy.sv.errors[kind]);
      expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    },
  );

  it('offers distinct accessible show/hide password states', async () => {
    await setup(); await fill();
    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show.props.accessibilityState.selected).toBe(false);
    await fireEvent.press(show);
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.props.accessibilityState.selected).toBe(true);
    await fireEvent.press(hide);
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('clears and conceals the password as the application leaves the foreground', async () => {
    let changed: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    const originalListener = AppState.addEventListener;
    AppState.addEventListener = (event, handler) => {
      if (event !== 'change') return originalListener(event, handler);
      changed = handler as (state: AppStateStatus) => void; return { remove };
    };
    try {
      const view = await render(<LoginScreen language="en" onSignIn={jest.fn()} onBack={jest.fn()} busy={false} error={null} />);
      await fill(); await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
      await act(() => changed?.('background'));
      expect(screen.getByLabelText('Password').props.value).toBe('');
      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
      await view.unmount(); expect(remove).toHaveBeenCalledTimes(1);
    } finally { AppState.addEventListener = originalListener; }
  });

  it('keeps blocked sessions closed and offers cleanup only when explicitly supplied', async () => {
    const onRetryCleanup = jest.fn();
    const { onSignIn } = await setup({ blocked: true, error: 'cleanup', onRetryCleanup });
    await fill(); await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    expect(onSignIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry secure sign-out' }));
    expect(onRetryCleanup).toHaveBeenCalledTimes(1);
  });

  it('supports Back while a request is pending and ignores its late rejection', async () => {
    let reject!: (reason: Error) => void;
    const onSignIn = jest.fn(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
    const onBack = jest.fn();
    await setup({ onSignIn, onBack }); await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Welcome' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Password').props.value).toBe('');
    await act(async () => reject(new Error('private-late-response')));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('settles a late rejected request safely after the native form unmounts', async () => {
    let reject!: (reason: Error) => void;
    const onSignIn = jest.fn(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
    const view = await render(<LoginScreen language="en" onSignIn={onSignIn} onBack={jest.fn()} busy={false} error={null} />);
    await fill(); await fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
    await view.unmount();
    await act(async () => reject(new Error('synthetic late rejection')));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps all controls large and text scalable, with a native keyboard-avoiding wrapper', async () => {
    await setup();
    expect(getComponent(KeyboardAvoidingView)).toBeDefined();
    for (const input of nativeNodes('input')) {
      expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minHeight: 56, fontSize: 22 });
      expect(input.props.allowFontScaling).toBe(true);
    }
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of nativeNodes('text')) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.maxHeight).toBeUndefined();
    }
    const email = screen.getByLabelText('Email');
    expect(email.props.autoCapitalize).toBe('none'); expect(email.props.autoCorrect).toBe(false);
    await fireEvent(email, 'focus'); expect(email).toHaveStyle({ borderColor: colors.ink });
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await fireEvent(toggle, 'focus'); expect(toggle).toHaveStyle({ borderColor: colors.ink });
  });
});

describe('minimal native authenticated destination', () => {
  it.each<Language>(['en', 'sv'])('shows only the current %s account and working sign-out', async (language) => {
    const onSignOut = jest.fn();
    await render(<AuthenticatedScreen language={language} user={{ id: 'synthetic-user', email: 'example@invalid.test' }} onSignOut={onSignOut} />);
    const text = authCopy[language];
    expect(screen.getByRole('header', { name: text.signedInTitle })).toBeOnTheScreen();
    expect(screen.getByText('example@invalid.test')).toBeOnTheScreen();
    expect(screen.queryByText('synthetic-user')).toBeNull();
    expect(screen.getByText(text.authenticatedNote)).toBeOnTheScreen();
    const signOut = screen.getByRole('button', { name: text.signOut });
    expect(signOut).toHaveStyle({ minHeight: 56 }); await fireEvent.press(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not keep the old account when the authenticated user changes', async () => {
    const view = await render(<AuthenticatedScreen language="en" user={{ id: 'a', email: 'first@invalid.test' }} onSignOut={jest.fn()} />);
    await view.rerender(<AuthenticatedScreen language="en" user={{ id: 'b', email: 'second@invalid.test' }} onSignOut={jest.fn()} />);
    expect(screen.queryByText('first@invalid.test')).toBeNull();
    expect(screen.getByText('second@invalid.test')).toBeOnTheScreen();
  });

  it('disables sign-out while the parent is cleaning up the session', async () => {
    const onSignOut = jest.fn();
    await render(<AuthenticatedScreen language="en" user={{ id: 'a' }} onSignOut={onSignOut} busy />);
    const button = screen.getByRole('button', { name: 'Signing out…' });
    expect(button).toBeDisabled(); await fireEvent.press(button);
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
