import { getComponent } from './component-probe';
import { nativeNodes } from './native-tree';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AccessibilityInfo, AppState, Keyboard, KeyboardAvoidingView, StyleSheet, type AppStateStatus } from 'react-native';
import type { Language } from '../src/i18n';
import { registrationCopy as copy } from '../src/registration-copy';
import { ConfirmationScreen, type ConfirmationStatus } from '../src/screens/ConfirmationScreen';
import { RegistrationScreen } from '../src/screens/RegistrationScreen';
import { colors } from '../src/theme';

async function setup(props: Partial<React.ComponentProps<typeof RegistrationScreen>> = {}) {
  const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
  const view = await render(<RegistrationScreen language="en" enabled={false} {...callbacks} {...props} />);
  return { ...callbacks, view };
}
async function fill({ email = 'person@example.invalid', password = 'synthetic-password', confirmation = password,
  language = 'en' }: { email?: string; password?: string; confirmation?: string; language?: Language } = {}) {
  const text = copy[language];
  await fireEvent.changeText(screen.getByLabelText(text.email), email);
  await fireEvent.changeText(screen.getByLabelText(text.password), password);
  await fireEvent.changeText(screen.getByLabelText(text.confirmation), confirmation);
}
async function submit(enabled = false, language: Language = 'en') {
  await fireEvent.press(screen.getByRole('button', { name: enabled ? copy[language].create : copy[language].checkDetails }));
}

describe('native registration validation with the live gate closed', () => {
  it.each<Language>(['en', 'sv'])('clearly labels the closed gate and local check action in %s', async (language) => {
    const { onSubmit } = await setup({ language });
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
  ])('validates required fields locally: %s', async (_case, email, password, confirmation) => {
    const { onSubmit } = await setup(); await fill({ email, password, confirmation }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.required);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'a@', '@example.invalid', 'a b@example.invalid'])('rejects malformed email locally: %s', async (email) => {
    const { onSubmit } = await setup(); await fill({ email }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.emailInvalid);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('checks the approved six-character minimum locally', async () => {
    const { onSubmit } = await setup(); await fill({ password: 'abcde' }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.minimum);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords locally', async () => {
    const { onSubmit } = await setup(); await fill({ confirmation: 'different-password' }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.mismatch);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('checks valid %s details without any signup or invented check-email success', async (language) => {
    const { onSubmit } = await setup({ language }); await fill({ language, password: 'abcdef' }); await submit(false, language);
    expect(screen.getByText(copy[language].checked)).toBeOnTheScreen();
    expect(screen.queryByText(copy[language].sent)).toBeNull();
    expect(screen.getByLabelText(copy[language].password).props.value).toBe('abcdef');
    expect(screen.getByLabelText(copy[language].confirmation).props.value).toBe('abcdef');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('dismisses the keyboard without checking details or submitting through the closed gate', async () => {
    const { onSubmit } = await setup(); await fill();
    await fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
    expect(screen.queryByText(copy.en.checked)).toBeNull();
    expect(screen.queryByText(copy.en.sent)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses independent, labeled password visibility controls with selected states', async () => {
    await setup(); await fill();
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: copy.en.showPassword }));
    expect(screen.getByRole('button', { name: copy.en.hidePassword }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: copy.en.showConfirmation }));
    expect(screen.getByRole('button', { name: copy.en.hideConfirmation }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: copy.en.hidePassword }));
    await fireEvent.press(screen.getByRole('button', { name: copy.en.hideConfirmation }));
    expect(screen.getByLabelText(copy.en.password).props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText(copy.en.confirmation).props.secureTextEntry).toBe(true);
  });

  it('clears and conceals both password fields on background and removes the listener on unmount', async () => {
    const original = AppState.addEventListener;
    const remove = jest.fn();
    let changed: ((state: AppStateStatus) => void) | undefined;
    AppState.addEventListener = (event, listener) => {
      if (event !== 'change') return original(event, listener);
      changed = listener as (state: AppStateStatus) => void; return { remove };
    };
    try {
      const { view } = await setup(); await fill();
      await fireEvent.press(screen.getByRole('button', { name: copy.en.showPassword }));
      await fireEvent.press(screen.getByRole('button', { name: copy.en.showConfirmation }));
      await act(() => changed?.('background'));
      for (const label of [copy.en.password, copy.en.confirmation]) {
        expect(screen.getByLabelText(label).props.value).toBe('');
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
      }
      await view.unmount(); expect(remove).toHaveBeenCalledTimes(1);
    } finally { AppState.addEventListener = original; }
  });

  it('does not steal input focus on a language rerender', async () => {
    const props = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn(), enabled: false };
    const view = await render(<RegistrationScreen {...props} language="en" />);
    await fireEvent.changeText(screen.getByLabelText(copy.en.email), 'person@example.invalid');
    await fireEvent(screen.getByLabelText(copy.en.email), 'focus');
    await view.rerender(<RegistrationScreen {...props} language="sv" />);
    expect(screen.getByLabelText(copy.sv.email)).toHaveStyle({ borderColor: colors.ink });
    expect(screen.getByLabelText(copy.sv.email).props.value).toBe('person@example.invalid');
  });

  it('keeps controls large, labels readable, text scalable and native keyboard avoidance present', async () => {
    await setup();
    expect(getComponent(KeyboardAvoidingView)).toBeDefined();
    for (const input of nativeNodes('input')) {
      expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minHeight: 56, fontSize: 22 });
      expect(input.props.allowFontScaling).toBe(true);
      expect(input.props.autoCapitalize).toBe('none'); expect(input.props.autoCorrect).toBe(false);
    }
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of nativeNodes('text')) {
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
  ])('Done only dismisses the keyboard in $language (mock submission enabled=$enabled)', async ({ language, enabled }) => {
    const text = copy[language];
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = await setup({ language, enabled });
      await fill({ language, password: 'synthetic Done value' });
      await fireEvent(screen.getByLabelText(text.confirmation), 'focus');
      await fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing', { nativeEvent: { text: 'synthetic Done value' } });
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

  it.each<Language>(['en', 'sv'])('retains exact matching passwords through Next, Done, blur, refocus and repeated local checks in %s', async language => {
    const text = copy[language];
    const { onSubmit } = await setup({ language });
    const secret = '  synthetic password  ';
    await fill({ language, password: secret });
    await fireEvent(screen.getByLabelText(text.password), 'submitEditing');
    await fireEvent(screen.getByLabelText(text.password), 'blur');
    await fireEvent(screen.getByLabelText(text.confirmation), 'focus');
    await fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    await fireEvent(screen.getByLabelText(text.confirmation), 'blur');
    await fireEvent(screen.getByLabelText(text.password), 'focus');
    await submit(false, language);
    expect(screen.getByText(text.checked)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    for (let count = 0; count < 2; count++) {
      await fireEvent.press(screen.getByRole('button', { name: text.showPassword }));
      await fireEvent.press(screen.getByRole('button', { name: text.showConfirmation }));
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(false);
        expect(screen.getByLabelText(label).props.value).toBe(secret);
      }
      await fireEvent.press(screen.getByRole('button', { name: text.hidePassword }));
      await fireEvent.press(screen.getByRole('button', { name: text.hideConfirmation }));
      await submit(false, language);
      for (const label of [text.password, text.confirmation]) {
        expect(screen.getByLabelText(label).props.secureTextEntry).toBe(true);
        expect(screen.getByLabelText(label).props.value).toBe(secret);
      }
    }
    expect(screen.queryByText(secret)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('validates mismatches only after Check details and accepts a corrected confirmation in %s', async language => {
    const text = copy[language];
    const { onSubmit } = await setup({ language });
    await fill({ language, password: 'synthetic original', confirmation: 'synthetic different' });
    await fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    expect(screen.queryByRole('alert')).toBeNull();
    await submit(false, language);
    expect(screen.getByRole('alert')).toHaveTextContent(text.mismatch);
    expect(screen.getByLabelText(text.password).props.value).toBe('synthetic original');
    expect(screen.getByLabelText(text.confirmation).props.value).toBe('synthetic different');
    await fireEvent.changeText(screen.getByLabelText(text.confirmation), 'synthetic original');
    await fireEvent(screen.getByLabelText(text.confirmation), 'submitEditing');
    await submit(false, language);
    expect(screen.getByText(text.checked)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps synthetic password values out of results, logs and persistent storage during Done and local checks', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    const secureWrite = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);
    try {
      const { onSubmit } = await setup();
      await fill({ password: 'synthetic-private-sentinel' });
      await fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
      await submit();
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
    const { onSubmit } = await setup({ enabled: true });
    await fill({ email: '  person@example.invalid  ', password: '  synthetic password  ' }); await submit(true);
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
    await setup({ enabled: true, onSubmit }); await fill();
    const button = screen.getByRole('button', { name: copy.en.create });
    await fireEvent.press(button); await fireEvent.press(button);
    await fireEvent(screen.getByLabelText(copy.en.confirmation), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: copy.en.creating })).toBeDisabled();
    expect(screen.getByLabelText(copy.en.password).props.value).toBe('');
    expect(screen.getByLabelText(copy.en.confirmation).props.value).toBe('');
    await act(async () => finish());
    expect(screen.getByText(copy.en.sent)).toBeOnTheScreen();
  });

  it.each(Object.keys(copy.en.errors) as (keyof typeof copy.en.errors)[])('maps %s failures to static Swedish copy without upstream details', async (kind) => {
    const onSubmit = jest.fn(async () => { throw { kind, message: 'private-response-sentinel' }; });
    await setup({ enabled: true, language: 'sv', onSubmit }); await fill({ language: 'sv' }); await submit(true, 'sv');
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
      await setup({ enabled: true, onSubmit: jest.fn(async () => { throw error; }) }); await fill(); await submit(true);
      await screen.findByText(copy.en.errors.unknown);
      expect(screen.queryByText('private-error-sentinel')).toBeNull();
      expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain('private-error-sentinel');
    } finally { logs.forEach((log) => log.mockRestore()); }
  });

  it('blocks new requests while the parent reports an existing pending signup', async () => {
    const { onSubmit } = await setup({ enabled: true, pending: true });
    expect(screen.getByText(copy.en.pending)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: copy.en.create }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('restores the parent-owned check-email state without reconstructing a form or submitting again', async () => {
    const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
    const view = await render(<RegistrationScreen {...callbacks} language="en" enabled={false} sent />);
    expect(screen.getByText(copy.en.sent)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.en.email)).toBeNull();
    expect(screen.queryByLabelText(copy.en.password)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.en.checkDetails })).toBeNull();
    await view.rerender(<RegistrationScreen {...callbacks} language="sv" enabled={false} sent />);
    expect(screen.getByText(copy.sv.sent)).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.sv.password)).toBeNull();
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(callbacks.onLogin).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: copy.sv.login }));
    expect(callbacks.onLogin).toHaveBeenCalledTimes(1);
  });

  it('prioritizes external cleanup failure over validation and keeps Back available for a safe retry', async () => {
    const callbacks = { onSubmit: jest.fn(async () => {}), onBack: jest.fn(), onLogin: jest.fn() };
    const view = await render(<RegistrationScreen {...callbacks} language="en" enabled={false} />);
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.required);
    await view.rerender(<RegistrationScreen {...callbacks} language="en" enabled={false} externalFailure="cleanup" />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.en.errors.cleanup);
    expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
    expect(screen.getByRole('button', { name: copy.en.checkDetails })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: copy.en.back }));
    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
    expect(callbacks.onLogin).not.toHaveBeenCalled();
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
  });

  it('does not automatically retry after a timeout or turn it into a success', async () => {
    const onSubmit = jest.fn(async () => { throw { kind: 'timeout' }; });
    await setup({ enabled: true, onSubmit }); await fill(); await submit(true);
    await screen.findByText(copy.en.errors.timeout);
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    expect(screen.queryByText(copy.en.sent)).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not offer Login or another request after unsafe cleanup', async () => {
    const onSubmit = jest.fn(async () => { throw { kind: 'cleanup' }; });
    await setup({ enabled: true, onSubmit }); await fill(); await submit(true);
    await screen.findByText(copy.en.errors.cleanup);
    expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
    expect(screen.getByRole('button', { name: copy.en.create })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.en.back })).toBeEnabled();
  });

  it('ignores late success after Back and leaves no typed credentials in the form', async () => {
    let finish!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { onBack } = await setup({ enabled: true, onSubmit }); await fill(); await submit(true);
    await fireEvent.press(screen.getByRole('button', { name: copy.en.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(copy.en.password).props.value).toBe('');
    await act(async () => finish());
    expect(screen.queryByText(copy.en.sent)).toBeNull();
  });

  it('ignores late rejection after unmount', async () => {
    let reject!: (error: unknown) => void;
    const onSubmit = jest.fn(() => new Promise<void>((_resolve, rejected) => { reject = rejected; }));
    const { view } = await setup({ enabled: true, onSubmit }); await fill(); await submit(true); await view.unmount();
    await act(async () => reject(new Error('synthetic late failure')));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('returns to normal Login only through an explicit action after the generic check-email result', async () => {
    const { onLogin } = await setup({ enabled: true }); await fill(); await submit(true);
    await screen.findByText(copy.en.sent);
    expect(onLogin).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: copy.en.login }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});

describe('native confirmation screen consumes trusted service state only', () => {
  const states: ConfirmationStatus[] = ['checking', 'confirmed', 'invalid', 'blocked', 'unavailable'];
  const messages = {
    checking: 'confirmationChecking', confirmed: 'confirmationConfirmed', invalid: 'confirmationInvalid',
    blocked: 'confirmationBlocked', unavailable: 'confirmationUnavailable',
  } as const;

  it.each(states)('shows %s without fields, automatic login or service requests', async (status) => {
    const onLogin = jest.fn(); const onWelcome = jest.fn();
    await render(<ConfirmationScreen language="en" status={status} onWelcome={onWelcome} onLogin={onLogin} />);
    expect(screen.getByRole('header', { name: copy.en.confirmationTitle })).toBeOnTheScreen();
    expect(screen.getByText(copy.en[messages[status]])).toBeOnTheScreen();
    expect(screen.queryByLabelText(copy.en.password)).toBeNull();
    expect(onLogin).not.toHaveBeenCalled(); expect(onWelcome).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    if (status === 'checking' || status === 'blocked') expect(screen.queryByRole('button', { name: copy.en.login })).toBeNull();
  });

  it('shows success only after the caller changes checking to confirmed, then offers normal Login', async () => {
    const props = { language: 'sv' as const, onWelcome: jest.fn(), onLogin: jest.fn() };
    const view = await render(<ConfirmationScreen {...props} status="checking" />);
    expect(screen.queryByText(copy.sv.confirmationConfirmed)).toBeNull();
    await view.rerender(<ConfirmationScreen {...props} status="confirmed" />);
    expect(screen.getByText(copy.sv.confirmationConfirmed)).toBeOnTheScreen();
    expect(props.onLogin).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: copy.sv.login }));
    expect(props.onLogin).toHaveBeenCalledTimes(1);
  });

  it('announces changed confirmation state natively without repeating on a language-only render', async () => {
    const original = AccessibilityInfo.announceForAccessibility;
    const announce = jest.fn();
    AccessibilityInfo.announceForAccessibility = announce;
    try {
      const props = { onWelcome: jest.fn() };
      const view = await render(<ConfirmationScreen {...props} language="en" status="checking" />);
      expect(announce).not.toHaveBeenCalled();
      await view.rerender(<ConfirmationScreen {...props} language="en" status="confirmed" />);
      expect(announce).toHaveBeenCalledWith(copy.en.confirmationConfirmed);
      await view.rerender(<ConfirmationScreen {...props} language="sv" status="confirmed" />);
      expect(announce).toHaveBeenCalledTimes(1);
    } finally { AccessibilityInfo.announceForAccessibility = original; }
  });

  it('provides Swedish invalid-link guidance, an explicit Welcome action and large scalable controls', async () => {
    const onWelcome = jest.fn();
    await render(<ConfirmationScreen language="sv" status="invalid" onWelcome={onWelcome} />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.sv.confirmationInvalid);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of nativeNodes('text')) expect(text.props.allowFontScaling).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: copy.sv.back }));
    expect(onWelcome).toHaveBeenCalledTimes(1);
  });
});
