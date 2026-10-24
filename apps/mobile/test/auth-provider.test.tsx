import { useEffect, useLayoutEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Pressable, Text, type AppStateStatus } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from '../src/auth/client';
import { readMobileAuthConfig } from '../src/auth/config';
import { AuthError } from '../src/auth/errors';

jest.mock('../src/auth/client', () => ({ createMobileAuth: jest.fn() }));
jest.mock('../src/auth/config', () => ({ readMobileAuthConfig: jest.fn() }));
const userA = { id: 'synthetic-a', email: 'a@example.test' };

function Probe() {
  const auth = useAuth();
  return <>
    <Text>{auth.status}</Text><Text>{auth.user?.email ?? 'no account'}</Text>
    <Text>{auth.appActive ? 'foreground' : 'private background'}</Text><Text>{auth.error ?? 'no error'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Log in" onPress={() => { void auth.signIn('a@example.test', 'synthetic-password').catch(() => {}); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={() => { void auth.signOut().catch(() => {}); }} />
  </>;
}
function fakeAuth() {
  let snapshot: AuthSnapshot = { status: 'checking', user: null, error: null };
  let listener = () => {};
  const publish = (next: AuthSnapshot) => { snapshot = next; listener(); };
  const unsubscribe = jest.fn();
  const auth: MobileAuth = {
    getSnapshot: () => snapshot,
    getAccessToken: jest.fn(async () => null as string | null),
    subscribe: jest.fn((next) => { listener = next; return unsubscribe; }),
    restore: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    signIn: jest.fn(async () => publish({ status: 'signed-in', user: userA, error: null })),
    signOut: jest.fn(async () => publish({ status: 'signed-out', user: null, error: null })),
    setForeground: jest.fn((active) => { if (active) publish({ status: 'checking', user: null, error: null }); }),
    dispose: jest.fn(),
  };
  return { auth, publish, unsubscribe };
}
let stateChanged: (state: AppStateStatus) => void;
let remove: jest.Mock;
let current: ReturnType<typeof fakeAuth>;
beforeEach(() => {
  current = fakeAuth(); remove = jest.fn();
  jest.mocked(readMobileAuthConfig).mockReturnValue({ supabaseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co', publishableKey: 'sb_publishable_synthetic_key_for_tests' });
  jest.mocked(createMobileAuth).mockReturnValue(current.auth);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateChanged = listener as unknown as (state: AppStateStatus) => void;
    return { remove };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('native auth provider with mocked services', () => {
  it('waits for verified restoration before exposing any account', async () => {
    jest.mocked(current.auth.restore).mockImplementation(() => new Promise(() => {}));
    await render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('checking')).toBeOnTheScreen();
    expect(screen.getByText('no account')).toBeOnTheScreen();
    await act(async () => { await Promise.resolve(); });
    expect(current.auth.restore).toHaveBeenCalledTimes(1);
    await act(() => current.publish({ status: 'signed-in', user: userA, error: null }));
    expect(screen.getByText(userA.email)).toBeOnTheScreen();
  });
  it('does not create an SDK client for missing or unapproved development configuration', async () => {
    jest.mocked(readMobileAuthConfig).mockImplementation(() => { throw new AuthError('configuration'); });
    await render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('configuration');
    expect(createMobileAuth).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('forwards login and reflects sign-out without retaining the old account', async () => {
    await render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('signed-out');
    await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByText(userA.email);
    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('no account');
    expect(screen.queryByText(userA.email)).toBeNull();
  });
  it('hides account details in background and keeps them hidden during foreground revalidation', async () => {
    await render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('signed-out');
    await act(() => current.publish({ status: 'signed-in', user: userA, error: null }));
    await act(() => stateChanged('background'));
    expect(screen.queryByText(userA.email)).toBeNull();
    expect(screen.getByText('private background')).toBeOnTheScreen();
    expect(current.auth.setForeground).toHaveBeenLastCalledWith(false);
    await act(() => stateChanged('active'));
    expect(screen.getByText('checking')).toBeOnTheScreen();
    expect(screen.queryByText(userA.email)).toBeNull();
    expect(current.auth.setForeground).toHaveBeenLastCalledWith(true);
  });
  it('cleans up subscriptions, native events and refresh service on unmount', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('signed-out'); await view.unmount();
    expect(current.unsubscribe).toHaveBeenCalledTimes(1);
    expect(current.auth.dispose).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('provides a stable token callback without retaining tokens in provider state', async () => {
    let read!: MobileAuth['getAccessToken'];
    let beforeInitialization!: Promise<string | null>;
    function TokenProbe() {
      const auth = useAuth();
      const readToken = auth.getAccessToken;
      // Async rendering flushes passive initialization before returning. Capture
      // this pre-initialization call at the actual earlier layout boundary.
      useLayoutEffect(() => { beforeInitialization = readToken(userA.id); }, [readToken]);
      useEffect(() => { read = readToken; }, [readToken]);
      return <Text>{auth.status}</Text>;
    }
    const view = await render(<AuthProvider><TokenProbe /></AuthProvider>);
    const first = read;
    expect(current.auth.getAccessToken).not.toHaveBeenCalled();
    await act(async () => { await expect(beforeInitialization).resolves.toBeNull(); });
    await screen.findByText('signed-out');
    await act(() => current.publish({ status: 'signed-in', user: userA, error: null }));
    jest.mocked(current.auth.getAccessToken).mockResolvedValueOnce('synthetic-access-token');
    await expect(read(userA.id)).resolves.toBe('synthetic-access-token');
    expect(current.auth.getAccessToken).toHaveBeenCalledWith(userA.id);
    expect(read).toBe(first);
    expect(screen.queryByText('synthetic-access-token')).toBeNull();
    await view.unmount();
    await expect(read(userA.id)).resolves.toBeNull();
    expect(current.auth.getAccessToken).toHaveBeenCalledTimes(1);
  });
  it('returns no token when development configuration fails', async () => {
    let read!: MobileAuth['getAccessToken'];
    function TokenProbe() {
      const auth = useAuth();
      useEffect(() => { read = auth.getAccessToken; }, [auth.getAccessToken]);
      return null;
    }
    jest.mocked(readMobileAuthConfig).mockImplementation(() => { throw new AuthError('configuration'); });
    await render(<AuthProvider><TokenProbe /><Probe /></AuthProvider>);
    await screen.findByText('configuration');
    await expect(read(userA.id)).resolves.toBeNull();
    expect(createMobileAuth).not.toHaveBeenCalled();
    expect(current.auth.getAccessToken).not.toHaveBeenCalled();
  });
});
