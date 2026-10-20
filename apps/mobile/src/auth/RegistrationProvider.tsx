import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { createRegistration } from './registration';

type Service = ReturnType<typeof createRegistration>;
type Snapshot = ReturnType<Service['getSnapshot']>;
type RegistrationContextValue = Snapshot & {
  enabled: false;
  signUp: (email: string, password: string) => Promise<void>;
  confirm: (code: string, state: string) => Promise<void>;
  cancel: () => Promise<void>;
};
const RegistrationContext = createContext<RegistrationContextValue | null>(null);

export function RegistrationProvider({ children }: PropsWithChildren) {
  const service = useRef<Service | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ status: 'idle', error: null });
  useEffect(() => {
    // No settings, SDK client, transport or native storage are opened by this
    // closed gate. Activation requires separate review, never a URL/env switch.
    const current = createRegistration();
    service.current = current;
    let alive = true;
    const sync = () => { if (alive) setSnapshot(current.getSnapshot()); };
    const unsubscribe = current.subscribe(sync);
    void Promise.resolve().then(sync);
    return () => {
      alive = false;
      unsubscribe();
      current.dispose();
      if (service.current === current) service.current = null;
    };
  }, []);
  const signUp = useCallback(async (email: string, password: string) => {
    if (!service.current) throw new Error('Registration is unavailable.');
    await service.current.signUp(email, password);
  }, []);
  const confirm = useCallback(async (code: string, state: string) => {
    if (!service.current) throw new Error('Confirmation is unavailable.');
    await service.current.confirm({ code, state });
  }, []);
  const cancel = useCallback(async () => { await service.current?.cancel(); }, []);
  return <RegistrationContext.Provider value={{ ...snapshot, enabled: false, signUp, confirm, cancel }}>
    {children}
  </RegistrationContext.Provider>;
}

export function useRegistration() {
  const value = useContext(RegistrationContext);
  if (!value) throw new Error('RegistrationProvider is required.');
  return value;
}
