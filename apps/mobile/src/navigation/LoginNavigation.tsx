import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';

type LoginNavigation = {
  loginRequested: boolean;
  requestLogin: () => void;
  cancelLogin: () => void;
  registrationRequested: boolean;
  requestRegistration: () => void;
  cancelRegistration: () => void;
  welcomeAvailable: boolean;
  rememberWelcomeVisit: () => void;
  rememberAuthenticatedVisit: () => void;
};
const LoginNavigationContext = createContext<LoginNavigation | null>(null);

// UI intent only. Never persist it or accept it from a URL; it grants no session.
export function LoginNavigationProvider({ children }: PropsWithChildren) {
  const [loginRequested, setLoginRequested] = useState(false);
  const [registrationRequested, setRegistrationRequested] = useState(false);
  const [welcomeAvailable, setWelcomeAvailable] = useState(false);
  const requestLogin = useCallback(() => { setRegistrationRequested(false); setLoginRequested(true); }, []);
  const cancelLogin = useCallback(() => setLoginRequested(false), []);
  const requestRegistration = useCallback(() => { setLoginRequested(false); setRegistrationRequested(true); }, []);
  const cancelRegistration = useCallback(() => setRegistrationRequested(false), []);
  // A returning account or session-recovery flow can lack local preferences.
  // Keep its Welcome destination without fabricating onboarding completion.
  // This UI-only marker grants no authentication or data access.
  const rememberWelcomeVisit = useCallback(() => setWelcomeAvailable(true), []);
  const rememberAuthenticatedVisit = rememberWelcomeVisit;
  return <LoginNavigationContext.Provider value={{ loginRequested, requestLogin, cancelLogin,
    registrationRequested, requestRegistration, cancelRegistration,
    welcomeAvailable, rememberWelcomeVisit, rememberAuthenticatedVisit }}>
    {children}
  </LoginNavigationContext.Provider>;
}

export function useLoginNavigation() {
  const value = useContext(LoginNavigationContext);
  if (!value) throw new Error('LoginNavigationProvider is required.');
  return value;
}
