import './native-tree';
import { getComponents } from './component-probe';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Pressable, StyleSheet } from 'react-native';
import { AccountAction, AccountNotice } from '../src/components/AccountPresentation';
import { colors } from '../src/theme';
import { ConfirmationScreen } from '../src/screens/ConfirmationScreen';
import { registrationCopy } from '../src/registration-copy';

afterEach(() => { jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(['primary', 'secondary', 'quiet'] as const)('%s account action keeps a contrasting pressed label and a large focusable target', async variant => {
  const press = jest.fn();
  await render(<AccountAction label="Log In" language="en" onPress={press}
    secondary={variant === 'secondary'} quiet={variant === 'quiet'} />);
  const button = screen.getByRole('button', { name: 'Log In' });
  const native = getComponents(Pressable).find(node => node.props.accessibilityRole === 'button');
  expect(native).toBeDefined();
  const style = native!.props.style;
  if (typeof style !== 'function') throw new Error('Expected the actual Pressable style callback.');
  const pressed = StyleSheet.flatten(style({ pressed: true }));
  if (!pressed) throw new Error('Expected actual pressed native styles.');
  expect(pressed.backgroundColor).toBe(variant === 'primary' ? colors.forestPressed : colors.selected);
  expect(screen.getByText('Log In')).toHaveStyle({ color: variant === 'primary' ? colors.paper : colors.forest });
  expect(button).toHaveStyle({ minHeight: 56 });
  await fireEvent(button, 'focus'); expect(screen.getByRole('button')).toHaveStyle({ borderColor: colors.ink });
  await fireEvent.press(button); expect(press).toHaveBeenCalledTimes(1);
});

it('a disabled busy action stays disabled even if its captured callback is invoked directly', async () => {
  const press = jest.fn();
  await render(<AccountAction label="Logging in…" language="en" onPress={press} disabled busy />);
  const button = screen.getByRole('button');
  expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  const native = getComponents(Pressable).find(node => node.props.accessibilityRole === 'button');
  expect(native).toBeDefined();
  await act(() => native!.props.onPress?.({ nativeEvent: { identifier: 0, target: 0, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0, touches: [], changedTouches: [] }, currentTarget: 0, target: 0,
    bubbles: false, cancelable: true, defaultPrevented: false, eventPhase: 0, isTrusted: false, preventDefault: () => {}, stopPropagation: () => {}, persist: () => {},
    isDefaultPrevented: () => false, isPropagationStopped: () => false, timeStamp: 0, type: 'press', dispatchConfig: { registrationName: 'onPress' },
    touchHistory: { indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0, numberActiveTouches: 0, touchBank: [] } }));
  expect(press).not.toHaveBeenCalled();
});

it('Android feedback uses its live region without a duplicate native announcement', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  await render(<AccountNotice language="sv" message="Kontrollera dina uppgifter." />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
  expect(screen.getByRole('alert').props.accessibilityLanguage).toBe('sv-SE');
  expect(announce).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled(); platform.restore();
});

it('Android confirmation changes use the live region without duplicating VoiceOver-specific announcements', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const props = { language: 'en' as const, onWelcome: jest.fn() };
  const view = await render(<ConfirmationScreen {...props} status="checking" />);
  await view.rerender(<ConfirmationScreen {...props} status="invalid" />);
  expect(screen.getByRole('alert')).toHaveTextContent(registrationCopy.en.confirmationInvalid);
  expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
  expect(announce).not.toHaveBeenCalled();
});
