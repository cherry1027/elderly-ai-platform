import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { createMobileAuth, type AuthSnapshot, type MobileAuth } from './client';
import { readMobileAuthConfig } from './config';
import { AuthError } from './errors';

type AuthContextValue = AuthSnapshot & {
  appActive: boolean;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const initial: AuthSnapshot = { status: 'checking', user: null, error: null };

export function AuthProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState(initial);
  const [appActive, setAppActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const service = useRef<MobileAuth | null>(null);
  useEffect(() => {
    let alive = true;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let auth: MobileAuth | null = null;
    let unsubscribe: (() => void) | undefined;
    const changes = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      setAppActive(foreground);
      auth?.setForeground(foreground);
    });
    // Initialization is outside render and SDK callbacks. A discarded StrictMode
    // effect cannot leave a client or refresh ticker running.
    void Promise.resolve().then(async () => {
      if (!alive) return;
      try {
        auth = createMobileAuth(readMobileAuthConfig());
        service.current = auth;
        const current = auth;
        const sync = () => { if (alive) setSnapshot(current.getSnapshot()); };
        unsubscribe = current.subscribe(sync);
        current.setForeground(foreground);
        sync();
        await current.restore();
      } catch (error) {
        if (alive && !auth) setSnapshot({ status: 'signed-out', user: null,
          error: error instanceof AuthError ? error.kind : 'configuration' });
      }
    });
    return () => {
      alive = false;
      changes.remove();
      unsubscribe?.();
      auth?.dispose();
      if (service.current === auth) service.current = null;
    };
  }, []);
  const signIn = useCallback((email: string, password: string) => {
    if (!service.current) return Promise.reject(new AuthError('configuration'));
    return service.current.signIn(email, password);
  }, []);
  const signOut = useCallback(() => service.current?.signOut() ?? Promise.resolve(), []);
  const getAccessToken = useCallback((expectedUserId: string) =>
    service.current?.getAccessToken(expectedUserId) ?? Promise.resolve(null), []);
  return <AuthContext.Provider value={{ ...snapshot, user: appActive ? snapshot.user : null,
    appActive, getAccessToken, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required.');
  return value;
}
