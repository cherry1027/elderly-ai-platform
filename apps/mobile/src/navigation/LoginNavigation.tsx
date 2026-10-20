import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';

type LoginNavigation = {
  loginRequested: boolean;
  requestLogin: () => void;
  cancelLogin: () => void;
  welcomeAvailable: boolean;
  rememberAuthenticatedVisit: () => void;
};
const LoginNavigationContext = createContext<LoginNavigation | null>(null);

// UI intent only. Never persist it or accept it from a URL; it grants no session.
export function LoginNavigationProvider({ children }: PropsWithChildren) {
  const [loginRequested, setLoginRequested] = useState(false);
  const [welcomeAvailable, setWelcomeAvailable] = useState(false);
  const requestLogin = useCallback(() => setLoginRequested(true), []);
  const cancelLogin = useCallback(() => setLoginRequested(false), []);
  // A verified returning account can lack local onboarding preferences. Keep
  // its sign-out destination without fabricating a completed preference record.
  const rememberAuthenticatedVisit = useCallback(() => setWelcomeAvailable(true), []);
  return <LoginNavigationContext.Provider value={{ loginRequested, requestLogin, cancelLogin,
    welcomeAvailable, rememberAuthenticatedVisit }}>
    {children}
  </LoginNavigationContext.Provider>;
}

export function useLoginNavigation() {
  const value = useContext(LoginNavigationContext);
  if (!value) throw new Error('LoginNavigationProvider is required.');
  return value;
}
