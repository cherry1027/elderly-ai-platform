import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { AccountAction, AccountNotice } from '../src/components/AccountPresentation';
import { colors } from '../src/theme';
import { ConfirmationScreen } from '../src/screens/ConfirmationScreen';
import { registrationCopy } from '../src/registration-copy';

afterEach(() => { jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(['primary', 'secondary', 'quiet'] as const)('%s account action keeps a contrasting pressed label and a large focusable target', variant => {
  const press = jest.fn();
  render(<AccountAction label="Log In" language="en" onPress={press}
    secondary={variant === 'secondary'} quiet={variant === 'quiet'} />);
  const button = screen.getByRole('button', { name: 'Log In' });
  // The SDK's memoized Pressable is not exposed under its exported wrapper type.
  const native = screen.UNSAFE_getAllByProps({ accessibilityRole: 'button' })
    .find(node => typeof node.props.style === 'function');
  expect(native).toBeDefined();
  const pressed = StyleSheet.flatten(native!.props.style({ pressed: true }));
  expect(pressed.backgroundColor).toBe(variant === 'primary' ? colors.forestPressed : colors.selected);
  expect(screen.getByText('Log In')).toHaveStyle({ color: variant === 'primary' ? colors.paper : colors.forest });
  expect(button).toHaveStyle({ minHeight: 56 });
  fireEvent(button, 'focus'); expect(button).toHaveStyle({ borderColor: colors.ink });
  fireEvent.press(button); expect(press).toHaveBeenCalledTimes(1);
});

it('a disabled busy action stays disabled even if its captured callback is invoked directly', () => {
  const press = jest.fn();
  render(<AccountAction label="Logging in…" language="en" onPress={press} disabled busy />);
  const button = screen.getByRole('button');
  expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  const native = screen.UNSAFE_getAllByProps({ accessibilityRole: 'button' })
    .find(node => typeof node.props.onPress === 'function');
  expect(native).toBeDefined();
  act(() => native!.props.onPress());
  expect(press).not.toHaveBeenCalled();
});

it('Android feedback uses its live region without a duplicate native announcement', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  render(<AccountNotice language="sv" message="Kontrollera dina uppgifter." />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
  expect(screen.getByRole('alert').props.accessibilityLanguage).toBe('sv-SE');
  expect(announce).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); platform.restore();
});

it('Android confirmation changes use the live region without duplicating VoiceOver-specific announcements', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const props = { language: 'en' as const, onWelcome: jest.fn() };
  const view = render(<ConfirmationScreen {...props} status="checking" />);
  view.rerender(<ConfirmationScreen {...props} status="invalid" />);
  expect(screen.getByRole('alert')).toHaveTextContent(registrationCopy.en.confirmationInvalid);
  expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
  expect(announce).not.toHaveBeenCalled();
});
