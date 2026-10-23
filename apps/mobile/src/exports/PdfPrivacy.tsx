
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useLanguage } from '../language';
import { colors, layout } from '../theme';
import { exportCopy } from './export-copy';
import { createPrivatePdfStore, NativePdfError, purgeOwnedPdfCache, type PrivatePdfStore } from './native-pdf';

export interface PdfReturnHint { projectId: string; draftId: string }
export interface PdfPrivacyValue {
  ready: boolean;
  failed: boolean;
  createStore(expectedOwner: string): PrivatePdfStore;
  release(store: PrivatePdfStore): void;
  reportFailure(): void;
  retry(): void;
  rememberReturn(ownerId: string, projectId: string, draftId: string): void;
  consumeReturn(ownerId: string): PdfReturnHint | null;
  clearReturn(ownerId: string): void;
}
const unavailable: PdfPrivacyValue = {
  ready: false, failed: true,
  createStore: () => { throw new NativePdfError('revoked'); },
  release: () => {}, reportFailure: () => {}, retry: () => {},
  rememberReturn: () => { throw new NativePdfError('revoked'); }, consumeReturn: () => null, clearReturn: () => {},
};
const Context = createContext<PdfPrivacyValue>(unavailable);
type Registration = { store: PrivatePdfStore; owner: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache cleanup gates only PDF capabilities, never ordinary application navigation. */
export function PdfPrivacyProvider({ children }: PropsWithChildren) {
  const auth = useAuth(), { language } = useLanguage(), copy = exportCopy[language];
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [working, setWorking] = useState(true);
  const mountedRef = useRef(false), readyRef = useRef(false), failedRef = useRef(false);
  const cleaningRef = useRef(false), epochRef = useRef(0), failureVersionRef = useRef(0);
  const storesRef = useRef(new Set<Registration>());
  const returnRef = useRef<(PdfReturnHint & { owner: string }) | null>(null);
  const verifiedOwnerRef = useRef<string | null>(null);
  const authRef = useRef({ active: false, owner: null as string | null });
  const markFailure = useCallback(() => {
    failureVersionRef.current++;
    failedRef.current = true; readyRef.current = false;
    if (mountedRef.current) { setFailed(true); setReady(false); }
  }, []);
  const revoke = useCallback((registration: Registration): Promise<void> => {
    storesRef.current.delete(registration);
    // Native revoke closes its gate synchronously, even while a share lease awaits.
    try {
      return Promise.resolve(registration.store.revoke()).catch(() => { markFailure(); });
    } catch { markFailure(); return Promise.resolve(); }
  }, [markFailure]);
  const release = useCallback((store: PrivatePdfStore) => {
    const registration = [...storesRef.current].find(entry => entry.store === store);
    if (registration) void revoke(registration);
  }, [revoke]);
  const reportFailure = useCallback(() => {
    markFailure();
    for (const registration of [...storesRef.current]) void revoke(registration);
  }, [markFailure, revoke]);
  const retry = useCallback(() => {
    if (!mountedRef.current || cleaningRef.current) return;
    cleaningRef.current = true; readyRef.current = false;
    setReady(false); setWorking(true);
    const epoch = ++epochRef.current;
    void (async () => {
      try {
        await Promise.all([...storesRef.current].map(revoke));
        const failuresBeforePurge = failureVersionRef.current;
        await purgeOwnedPdfCache();
        if (!mountedRef.current || epochRef.current !== epoch) return;
        // A separately reported cleanup failure during this purge still needs review.
        if (failureVersionRef.current !== failuresBeforePurge) return;
        failedRef.current = false; readyRef.current = true;
        setFailed(false); setReady(true);
      } catch { markFailure(); }
      finally {
        if (epochRef.current === epoch) {
          cleaningRef.current = false;
          if (mountedRef.current) setWorking(false);
        }
      }
    })();
  }, [markFailure, revoke]);
  const createStore = useCallback((expectedOwner: string) => {
    const current = authRef.current;
    if (!mountedRef.current || !readyRef.current || failedRef.current || !current.active ||
      !expectedOwner || current.owner !== expectedOwner) throw new NativePdfError('revoked');
    let store: PrivatePdfStore;
    try { store = createPrivatePdfStore(); }
    catch { markFailure(); throw new NativePdfError('storage'); }
    storesRef.current.add({ store, owner: expectedOwner });
    return store;
  }, [markFailure]);

  const rememberReturn = useCallback((ownerId: string, projectId: string, draftId: string) => {
    if (!UUID.test(ownerId) || !UUID.test(projectId) || !UUID.test(draftId)) throw new NativePdfError('invalid');
    if (!mountedRef.current || !authRef.current.active || authRef.current.owner !== ownerId ||
      !readyRef.current || failedRef.current) throw new NativePdfError('revoked');
    // IDs only; never retain a document, story wording, title or authentication.
    returnRef.current = { owner: ownerId, projectId: projectId.toLowerCase(), draftId: draftId.toLowerCase() };
  }, []);
  const consumeReturn = useCallback((ownerId: string): PdfReturnHint | null => {
    const hint = returnRef.current;
    if (!mountedRef.current || !UUID.test(ownerId) || !authRef.current.active || authRef.current.owner !== ownerId ||
      !hint || hint.owner !== ownerId) return null;
    returnRef.current = null;
    return { projectId: hint.projectId, draftId: hint.draftId };
  }, []);
  const clearReturn = useCallback((ownerId: string) => {
    if (returnRef.current?.owner === ownerId) returnRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const owner = auth.status === 'signed-in' && auth.appActive && auth.user ? auth.user.id : null;
    authRef.current = { active: owner !== null, owner };
    if (owner) {
      if (verifiedOwnerRef.current !== owner) returnRef.current = null;
      verifiedOwnerRef.current = owner;
    } else if (auth.status === 'signed-out' || auth.status === 'blocked') {
      verifiedOwnerRef.current = null; returnRef.current = null;
    }
    // Checking/background may temporarily hide auth.user. Retain only the same
    // last verified owner's ID hint until that owner is verified again.
    for (const registration of [...storesRef.current]) {
      if (!owner || registration.owner !== owner) void revoke(registration);
    }
  }, [auth.status, auth.appActive, auth.user, revoke]);
  const shutdown = useCallback(() => {
    mountedRef.current = false; readyRef.current = false; authRef.current = { active: false, owner: null };
    epochRef.current++; cleaningRef.current = false;
    returnRef.current = null; verifiedOwnerRef.current = null;
    for (const registration of [...storesRef.current]) void revoke(registration);
  }, [revoke]);
  useEffect(() => {
    mountedRef.current = true;
    retry();
    return shutdown;
  }, [retry, shutdown]);

  const value = useMemo(() => ({ ready, failed, createStore, release, reportFailure, retry, rememberReturn, consumeReturn, clearReturn }),
    [ready, failed, createStore, release, reportFailure, retry, rememberReturn, consumeReturn, clearReturn]);
  return <Context.Provider value={value}>
    <View style={styles.root}>
      {failed && <View style={styles.warning}>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>{copy['cleanup-failed']}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: working, busy: working }}
          disabled={working} onPress={retry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <Text style={styles.label}>{working ? copy.cleanupWorking : copy.cleanupRetry}</Text>
        </Pressable>
      </View>}
      {children}
    </View>
  </Context.Provider>;
}
export function usePdfPrivacy(): PdfPrivacyValue { return useContext(Context); }

const styles = StyleSheet.create({
  root: { flex: 1 },
  warning: { padding: 16, gap: 12, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.border },
  message: { fontSize: 18, lineHeight: 27, color: colors.ink },
  retry: { minHeight: layout.minimumTouchTarget, padding: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius },
  pressed: { backgroundColor: colors.selected },
  label: { fontSize: 19, lineHeight: 28, fontWeight: '600', color: colors.forest, textAlign: 'center' },
});
