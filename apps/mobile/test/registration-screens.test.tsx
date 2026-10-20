import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AccessibilityInfo, AppState, Keyboard, KeyboardAvoidingView, StyleSheet, Text, TextInput, type AppStateStatus } from 'react-native';
import type { Language } from '../src/i18n';
import { registrationCopy as copy } from '../src/registration-copy';
import { ConfirmationScreen, type ConfirmationStatus } from '../src/screens/ConfirmationScreen';
import { RegistrationScreen } from '../src/screens/RegistrationScreen';
import { colors } from '../src/theme';

function setup(props: Partial<React.ComponentProps<typeof RegistrationScreen>> = {}) {
  const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
  const view = render(<RegistrationScreen language="en" enabled={false} {...callbacks} {...props} />);
  return { ...callbacks, view };
}
function fill({ email = 'person@example.invalid', password = 'synthetic-password', confirmation = password,
  language = 'en' }: { email?: string; password?: string; confirmation?: string; language?: Language } = {}) {
  const text = copy[language];
  fireEvent.changeText(screen.getByLabelText(text.email), email);
  fireEvent.changeText(screen.getByLabelText(text.password), password);
  fireEvent.changeText(screen.getByLabelText(text.confirmation), confirmation);
}
function submit(enabled = false, language: Language = 'en') {
  fireEvent.press(screen.getByRole('button', { name: enabled ? copy[language].create : copy[language].checkDetails }));
}

describe('native registration validation with the live gate closed', () => {
  it.each<Language>(['en', 'sv'])('clearly labels the closed gate and local check action in %s', (language) => {
    const { onSubmit } = setup({ language });
    const text = copy[language];
    expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
    expect(screen.getByText(text.gate)).toBeOnTheScreen();
    expect(screen.getByText(text.rules)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: text.checkDetails })).toBeEnabled();
    expect(screen.queryByRole('button', { name: text.create })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['all missing', '', '', ''], ['email missing', '', 'abcdef', 'abcdef'],
    ['password missing', 'person@example.invalid', '', 'abcdef'],
    ['confirmation missing', 'person@example.invalid', 'abcdef', ''],
  ])('validates required fields locally: %s', (_case, email, password, confirmation) => {
    const { onSubmit } = setup(); fill({ email, password, confirmation }); submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.required);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'a@', '@example.invalid', 'a b@example.invalid'])('rejects malformed email locally: %s', (email) => {
    const { onSubmit } = setup(); fill({ email }); submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.emailInvalid);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('checks the approved six-character minimum locally', () => {
    const { onSubmit } = setup(); fill({ password: 'abcde' }); submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.minimum);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords locally', () => {
    const { onSubmit } = setup(); fill({ confirmation: 'different-password' }); submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.mismatch);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('checks valid %s details without any signup or invented check-email success', (language) => {
    const { onSubmit } = setup({ language }); fill({ language, password: 'abcdef' }); submit(false, language);
    expect(screen.getByText(copy[language].checked)).toBeOnTheScreen();
    expect(screen.queryByText(copy[language].sent)).toBeNull();
    expect(screen.getByLabelText(copy[language].password).props.value).toBe('abcdef');
    expect(screen.getByLabelText(copy[language].confirmation).props.value).toBe('abcdef');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('dismisses the keyboard without checking details or submitting through the closed gate', () => {
    const { onSubmit } = setup(); fill();
    fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
    expect(screen.queryByText(copy.en.checked)).toBeNull();
    expect(screen.queryByText(copy.en.sent)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses independent, labeled password visibility controls with selected states', () => {
    setup(); fill();
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: copy.en.showPassword }));
    expect(screen.getByRole('button', { name: copy.en.hidePassword }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: copy.en.showConfirmation }));
    expect(screen.getByRole('button', { name: copy.en.hideConfirmation }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: copy.en.hidePassword }));
    fireEvent.press(screen.getByRole('button', { name: copy.en.hideConfirmation }));
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
  });

  it('clears and conceals both password fields on background and removes the listener on unmount', () => {
    const original = AppState.addEventListener;
    const remove = jest.fn();
    let changed: ((state: AppStateStatus) => void) | undefined;
    AppState.addEventListener = (_event, listener) => { changed = listener; return { remove }; };
    try {
      const { view } = setup(); fill();
      fireEvent.press(screen.getByRole('button', { name: copy.en.showPassword }));
      fireEvent.press(screen.getByRole('button', { name: copy.en.showConfirmation }));
      act(() => changed?.('background'));
      for (const label of [copy.en.password, copy.en.confirmation]) {
        expect(screen.getByLabelText(label).props.value).toBe('');
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
      }
      view.unmount(); expect(remove).toHaveBeenCalledTimes(1);
    } finally { AppState.addEventListener = original; }
  });

  it('does not steal input focus on a language rerender', () => {
    const props = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn(), enabled: false };
    const view = render(<RegistrationScreen {...props} language="en" />);
    fireEvent.changeText(screen.getByLabelText(copy.en.email), 'person@example.invalid');
    fireEvent(screen.getByLabelText(copy.en.email), 'focus');
    view.rerender(<RegistrationScreen {...props} language="sv" />);
    expect(screen.getByLabelText(copy.sv.email)).toHaveStyle({ borderColor: colors.ink });
    expect(screen.getByLabelText(copy.sv.email).props.value).toBe('person@example.invalid');
  });

  it('keeps controls large, labels readable, text scalable and native keyboard avoidance present', () => {
    setup();
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeDefined();
    for (const input of screen.UNSAFE_getAllByType(TextInput)) {
      expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minHeight: 56, fontSize: 22 });
      expect(input.props.allowFontScaling).toBe(true);
      expect(input.props.autoCapitalize).toBe('none'); expect(input.props.autoCorrect).toBe(false);
    }
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of screen.UNSAFE_getAllByType(Text)) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.maxHeight).toBeUndefined();
    }
    expect(screen.getByLabelText(copy.en.password).props.autoComplete).toBe('new-password');
    expect(screen.getByLabelText(copy.en.confirmation).props.autoComplete).toBe('new-password');
  });
});

describe('iPhone keyboard Done and in-memory password retention', () => {
  it.each([
    { language: 'en' as const, enabled: false }, { language: 'sv' as const, enabled: false },
    { language: 'en' as const, enabled: true }, { language: 'sv' as const, enabled: true },
  ])('Done only dismisses the keyboard in $language (mock submission enabled=$enabled)', ({ language, enabled }) => {
    const text = copy[language];
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = setup({ language, enabled });
      fill({ language, password: 'synthetic Done value' });
      fireEvent(screen.getByLabelText(text.confirmation), 'focus');
      fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing', { nativeEvent: { text: 'synthetic Done value' } });
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByLabelText(text.password).props.value).toBe('synthetic Done value');
      expect(screen.getByLabelText(text.confirmation).props.value).toBe('synthetic Done value');
      expect(screen.queryByText(text.checked)).toBeNull();
      expect(screen.queryByText(text.sent)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { dismiss.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('retains exact matching passwords through Next, Done, blur, refocus and repeated local checks in %s', language => {
    const text = copy[language];
    const { onSubmit } = setup({ language });
    const secret = '  synthetic password  ';
    fill({ language, password: secret });
    fireEvent(screen.getByLabelText(text.password), 'submitEditing');
    fireEvent(screen.getByLabelText(text.password), 'blur');
    fireEvent(screen.getByLabelText(text.confirmation), 'focus');
    fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    fireEvent(screen.getByLabelText(text.confirmation), 'blur');
    fireEvent(screen.getByLabelText(text.password), 'focus');
    submit(false, language);
    expect(screen.getByText(text.checked)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    for (let count = 0; count < 2; count++) {
      fireEvent.press(screen.getByRole('button', { name: text.showPassword }));
      fireEvent.press(screen.getByRole('button', { name: text.showConfirmation }));
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(false);
        expect(screen.getByLabelText(label).props.value).toBe(secret);
      }
      fireEvent.press(screen.getByRole('button', { name: text.hidePassword }));
      fireEvent.press(screen.getByRole('button', { name: text.hideConfirmation }));
      submit(false, language);
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
        expect(screen.getByLabelText(label).props.value).toBe(secret);
      }
    }
    expect(screen.queryByText(secret)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('validates mismatches only after Check details and accepts a corrected confirmation in %s', language => {
    const text = copy[language];
    const { onSubmit } = setup({ language });
    fill({ language, password: 'synthetic original', confirmation: 'synthetic different' });
    fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    expect(screen.queryByRole('alert')).toBeNull();
    submit(false, language);
    expect(screen.getByRole('alert')).toHaveTextContent(text.mismatch);
    expect(screen.getByLabelText(text.password).props.value).toBe('synthetic original');
    expect(screen.getByLabelText(text.confirmation).props.value).toBe('synthetic different');
    fireEvent.changeText(screen.getByLabelText(text.confirmation), 'synthetic original');
    fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    submit(false, language);
    expect(screen.getByText(text.checked)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps synthetic password values out of results, logs and persistent storage during Done and local checks', () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    const secureWrite = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    try {
      const { onSubmit } = setup();
      fill({ password: 'synthetic-private-sentinel' });
      fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
      submit();
      expect(screen.getByText(copy.en.checked)).toBeOnTheScreen();
      expect(screen.queryByText('synthetic-private-sentinel')).toBeNull();
      expect(JSON.stringify(logs.map(log => log.mock.calls))).not.toContain('synthetic-private-sentinel');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(secureWrite).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); secureWrite.mockRestore(); }
  });
});

describe('registration screen with synthetic submission callbacks only', () => {
  it('trims email, preserves exact password whitespace and shows only a generic check-email result', async () => {
    const { onSubmit } = setup({ enabled: true });
    fill({ email: '  person@example.invalid  ', password: '  synthetic password  ' }); submit(true);
    await screen.findByText(copy.en.sent);
    expect(onSubmit).toHaveBeenCalledWith('person@example.invalid', '  synthetic password  ');
    expect(screen.queryByLabelText(copy.en.password)).toBeNull();
    expect(screen.queryByText('person@example.invalid')).toBeNull();
    expect(screen.queryByText('synthetic password')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('locks duplicate submissions synchronously and clears password fields while the request is pending', async () => {
    let finish!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    setup({ enabled: true, onSubmit }); fill();
    const button = screen.getByRole('button', { name: copy.en.create });
    fireEvent.press(button); fireEvent.press(button);
    fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: copy.en.creating })).toBeDisabled();
    expect(screen.getByLabelText(copy.en.password).props.value).toBe('');
    expect(screen.getByLabelText(copy.en.confirmation).props.value).toBe('');
    await act(async () => finish());
    expect(screen.getByText(copy.en.sent)).toBeOnTheScreen();
  });

  it.each(Object.keys(copy.en.errors) as (keyof typeof copy.en.errors)[])('maps %s failures to static Swedish copy without upstream details', async (kind) => {
    const onSubmit = jest.fn(async () => { throw { kind, message: 'private-response-sentinel' }; });
    setup({ enabled: true, language: 'sv', onSubmit }); fill({ language: 'sv' }); submit(true, 'sv');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.sv.errors[kind]));
    expect(screen.queryByText('private-response-sentinel')).toBeNull();
    expect(screen.queryByText(copy.sv.sent)).toBeNull();
    expect(screen.getByLabelText(copy.sv.password).props.value).toBe('');
    expect(screen.getByLabelText(copy.sv.confirmation).props.value).toBe('');
  });

  it.each([
    new Error('private-error-sentinel'), { kind: 'unexpected-private-kind', message: 'private-error-sentinel' },
    { get kind() { throw new Error('private-error-sentinel'); } },
  ])('never renders unexpected values or credential details: %#', async (error) => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      setup({ enabled: true, onSubmit: jest.fn(async () => { throw error; }) }); fill(); submit(true);
      await screen.findByText(copy.en.errors.unknown);
      expect(screen.queryByText('private-error-sentinel')).toBeNull();
      expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain('private-error-sentinel');
    } finally { logs.forEach((log) => log.mockRestore()); }
  });

  it('blocks new requests while the parent reports an existing pending signup', () => {
    const { onSubmit } = setup({ enabled: true, pending: true });
    expect(screen.getByText(copy.en.pending)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name: copy.en.create }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('restores the parent-owned check-email state without reconstructing a form or submitting again', () => {
    const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
    const view = render(<RegistrationScreen {...callbacks} language="en" enabled={false} sent />);
    expect(screen.getByText(copy.en.sent)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.en.email)).toBeNull();
    expect(screen.queryByLabelText(copy.en.password)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.en.checkDetails })).toBeNull();
    view.rerender(<RegistrationScreen {...callbacks} language="sv" enabled={false} sent />);
    expect(screen.getByText(copy.sv.sent)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.sv.password)).toBeNull();
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(callbacks.onLogin).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: copy.sv.login }));
    expect(callbacks.onLogin).toHaveBeenCalledTimes(1);
  });

  it('prioritizes external cleanup failure over validation and keeps Back available for a safe retry', () => {
    const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
    const view = render(<RegistrationScreen {...callbacks} language="en" enabled={false} />);
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.required);
    view.rerender(<RegistrationScreen {...callbacks} language="en" enabled={false} externalFailure="cleanup" />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.errors.cleanup);
    expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
    expect(screen.getByRole('button', { name: copy.en.checkDetails })).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name: copy.en.back }));
    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
    expect(callbacks.onLogin).not.toHaveBeenCalled();
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
  });

  it('does not automatically retry after a timeout or turn it into a success', async () => {
    const onSubmit = jest.fn(async () => { throw { kind: 'timeout' }; });
    setup({ enabled: true, onSubmit }); fill(); submit(true);
    await screen.findByText(copy.en.errors.timeout);
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    expect(screen.queryByText(copy.en.sent)).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not offer Login or another request after unsafe cleanup', async () => {
    const onSubmit = jest.fn(async () => { throw { kind: 'cleanup' }; });
    setup({ enabled: true, onSubmit }); fill(); submit(true);
    await screen.findByText(copy.en.errors.cleanup);
    expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.en.back })).toBeEnabled();
  });

  it('ignores late success after Back and leaves no typed credentials in the form', async () => {
    let finish!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { onBack } = setup({ enabled: true, onSubmit }); fill(); submit(true);
    fireEvent.press(screen.getByRole('button', { name: copy.en.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(copy.en.password).props.value).toBe('');
    await act(async () => finish());
    expect(screen.queryByText(copy.en.sent)).toBeNull();
  });

  it('ignores late rejection after unmount', async () => {
    let reject!: (error: unknown) => void;
    const onSubmit = jest.fn(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
    const { view } = setup({ enabled: true, onSubmit }); fill(); submit(true); view.unmount();
    await act(async () => reject(new Error('synthetic late failure')));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('returns to normal Login only through an explicit action after the generic check-email result', async () => {
    const { onLogin } = setup({ enabled: true }); fill(); submit(true);
    await screen.findByText(copy.en.sent);
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: copy.en.login }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});

describe('native confirmation screen consumes trusted service state only', () => {
  const states: ConfirmationStatus[] = ['checking', 'confirmed', 'invalid', 'blocked', 'unavailable'];
  const messages = {
    checking: 'confirmationChecking', confirmed: 'confirmationConfirmed', invalid: 'confirmationInvalid',
    blocked: 'confirmationBlocked', unavailable: 'confirmationUnavailable',
  } as const;

  it.each(states)('shows %s without fields, automatic login or service requests', (status) => {
    const onLogin = jest.fn(); const onWelcome = jest.fn();
    render(<ConfirmationScreen language="en" status={status} onWelcome={onWelcome} onLogin={onLogin} />);
    expect(screen.getByRole('header', { name: copy.en.confirmationTitle })).toBeOnTheScreen();
    expect(screen.getByText(copy.en[messages[status]])).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.en.password)).toBeNull();
    expect(onLogin).not.toHaveBeenCalled(); expect(onWelcome).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    if (status === 'checking' || status === 'blocked') expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
  });

  it('shows success only after the caller changes checking to confirmed, then offers normal Login', () => {
    const props = { language: 'sv' as const, onWelcome: jest.fn(), onLogin: jest.fn() };
    const view = render(<ConfirmationScreen {...props} status="checking" />);
    expect(screen.queryByText(copy.sv.confirmationConfirmed)).toBeNull();
    view.rerender(<ConfirmationScreen {...props} status="confirmed" />);
    expect(screen.getByText(copy.sv.confirmationConfirmed)).toBeOnTheScreen();
    expect(props.onLogin).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: copy.sv.login }));
    expect(props.onLogin).toHaveBeenCalledTimes(1);
  });

  it('announces changed confirmation state natively without repeating on a language-only render', () => {
    const original = AccessibilityInfo.announceForAccessibility;
    const announce = jest.fn();
    AccessibilityInfo.announceForAccessibility = announce;
    try {
      const props = { onWelcome: jest.fn() };
      const view = render(<ConfirmationScreen {...props} language="en" status="checking" />);
      expect(announce).not.toHaveBeenCalled();
      view.rerender(<ConfirmationScreen {...props} language="en" status="confirmed" />);
      expect(announce).toHaveBeenCalledWith(copy.en.confirmationConfirmed);
      view.rerender(<ConfirmationScreen {...props} language="sv" status="confirmed" />);
      expect(announce).toHaveBeenCalledTimes(1);
    } finally { AccessibilityInfo.announceForAccessibility = original; }
  });

  it('provides Swedish invalid-link guidance, an explicit Welcome action and large scalable controls', () => {
    const onWelcome = jest.fn();
    render(<ConfirmationScreen language="sv" status="invalid" onWelcome={onWelcome} />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.sv.confirmationInvalid);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of screen.UNSAFE_getAllByType(Text)) expect(text.props.allowFontScaling).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: copy.sv.back }));
    expect(onWelcome).toHaveBeenCalledTimes(1);
  });
});
