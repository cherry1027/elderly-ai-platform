import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import WebPasswordSetupRoute from '../src/app/auth/callback.web';
import { createWebPasswordSetup, PasswordSetupError } from '../src/auth/web-password-setup';
import { useAuth } from '../src/auth/AuthProvider';
const mockReplace = jest.fn(), mockRequestLogin = jest.fn();
let mockLanguage: 'en' | 'sv', mockCompleted: boolean;
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../src/language', () => ({ useLanguage: () => ({ language: mockLanguage, ready: true, completed: mockCompleted }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/navigation/LoginNavigation', () => ({ useLoginNavigation: () => ({ requestLogin: mockRequestLogin }) }));
jest.mock('../src/auth/web-password-setup', () => ({ ...jest.requireActual('../src/auth/web-password-setup'), createWebPasswordSetup: jest.fn() }));
jest.mock('../src/components/AccountPresentation', () => {
  const { View, Text, Pressable } = jest.requireActual('react-native');
  return {
    accountStyles: {}, AccountScreen: ({ children }: {children: React.ReactNode}) => <View>{children}</View>,
    AccountHeading: ({ title }: {title: string}) => <Text>{title}</Text>,
    AccountNotice: ({ message }: {message: string}) => <Text>{message}</Text>,
    AccountAction: ({ label, onPress, disabled }: {label: string; onPress: () => void; disabled: boolean}) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>,
  };
});
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const callbacks = new Map<string, () => void>();
const service = { verify: jest.fn(async () => {}), save: jest.fn(async () => ({ cleanup: 'complete' as 'complete' | 'unknown' })), dispose: jest.fn() };
const signOut = jest.fn(async () => {});
beforeAll(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: {}, history: {}, addEventListener: jest.fn(), removeEventListener: jest.fn() } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener: (name: string, callback: () => void) => callbacks.set(name, callback), removeEventListener: (name: string) => callbacks.delete(name) } });
});
beforeEach(() => {
  mockLanguage = 'en'; mockCompleted = true;
  jest.mocked(createWebPasswordSetup).mockReturnValue(service); service.verify.mockResolvedValue(); service.save.mockResolvedValue({ cleanup: 'complete' });
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-in', signOut } as unknown as ReturnType<typeof useAuth>); signOut.mockResolvedValue();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterAll(() => {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
});
async function ready() {
  const view = await render(<WebPasswordSetupRoute />); await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('New password'), 'Synthetic password 123');
  await fireEvent.changeText(screen.getByLabelText('Repeat password'), 'Synthetic password 123'); return view;
}
it('requires explicit save and safely signs out an existing browser account before normal sign-in', async () => {
  await ready(); expect(service.save).not.toHaveBeenCalled(); await fireEvent.press(screen.getByLabelText('Save password'));
  await waitFor(() => expect(screen.getByText('Your password is saved. You can now sign in to Memy.')).toBeTruthy());
  expect(signOut).not.toHaveBeenCalled();
  let release!: () => void; signOut.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await fireEvent.press(screen.getByLabelText('Go to sign in')); expect(mockRequestLogin).not.toHaveBeenCalled();
  await act(async () => { release(); }); expect(signOut).toHaveBeenCalledTimes(1); expect(mockRequestLogin).toHaveBeenCalledTimes(1); expect(mockReplace).toHaveBeenCalledWith('/login');
});
it('sends a first-time browser visitor through language onboarding after saving the password', async () => {
  mockLanguage = 'sv'; mockCompleted = false;
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-out', signOut } as unknown as ReturnType<typeof useAuth>);
  await render(<WebPasswordSetupRoute />);
  await fireEvent.changeText(await screen.findByLabelText('Nytt lösenord'), 'Synthetic password 123');
  await fireEvent.changeText(screen.getByLabelText('Upprepa lösenord'), 'Synthetic password 123');
  await fireEvent.press(screen.getByLabelText('Spara lösenord'));
  await screen.findByText('Ditt lösenord har sparats. Du kan nu logga in i Mina Minnen.');
  await fireEvent.press(screen.getByLabelText('Gå till inloggning'));
  expect(mockReplace).toHaveBeenCalledWith('/');
  expect(mockRequestLogin).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});
it('preserves confirmed save when session cleanup fails and offers no repeated write', async () => {
  service.save.mockResolvedValueOnce({ cleanup: 'unknown' }); await ready(); await fireEvent.press(screen.getByLabelText('Save password'));
  await waitFor(() => expect(screen.getByText(/Your password is saved. We could not confirm/)).toBeTruthy());
  expect(screen.queryByLabelText('New password')).toBeNull(); expect(service.save).toHaveBeenCalledTimes(1);
});
it('shows check-sign-in after an uncertain write without another password form or automatic retry', async () => {
  service.save.mockRejectedValueOnce(new PasswordSetupError('check-sign-in')); await ready(); await fireEvent.press(screen.getByLabelText('Save password'));
  await waitFor(() => expect(screen.getByText(/The request may have saved your password/)).toBeTruthy());
  expect(screen.queryByLabelText('Save password')).toBeNull(); expect(service.save).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
});
it('removes password fields and prevents a save after backgrounding', async () => {
  await ready(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await act(async () => { callbacks.get('visibilitychange')?.(); }); expect(screen.queryByLabelText('New password')).toBeNull(); expect(service.save).not.toHaveBeenCalled();
});
