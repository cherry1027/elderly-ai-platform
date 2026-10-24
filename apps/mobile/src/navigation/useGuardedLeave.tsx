import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { AppState, Keyboard, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountAction } from '../components/AccountPresentation';
import { RootScreenHeading } from './AuthenticatedShell';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors } from '../theme';

export interface LeaveHandle { requestLeave: (destination: () => void) => void }
interface Options {
  language: Language;
  dirty: boolean;
  uncertain: boolean;
  handleRef?: Ref<LeaveHandle>;
  onDiscard?: () => void;
  onCheckSavedResult?: () => void;
  checkDisabled?: boolean;
}
export const leaveCopy = {
  en: { title: 'Keep your changes?', dirty: 'You have changes that have not been saved. Keep editing, or leave without saving these changes.',
    uncertain: 'Your save may already have reached Memy. Leaving does not undo it. Check the saved result before trying to save again.',
    keep: 'Keep Editing', discard: 'Leave Without Saving', leave: 'Leave Anyway', check: 'Check Saved Result' },
  sv: { title: 'Vill du behålla dina ändringar?', dirty: 'Du har ändringar som inte har sparats. Fortsätt redigera eller lämna utan att spara ändringarna.',
    uncertain: 'Din sparning kan redan ha nått Memy. Den ångras inte om du lämnar. Kontrollera det sparade resultatet innan du försöker spara igen.',
    keep: 'Fortsätt redigera', discard: 'Lämna utan att spara', leave: 'Lämna ändå', check: 'Kontrollera sparat resultat' },
} as const;

/** A RAM-only leave intent. It never retries writes or outlives the private view. */
export function useGuardedLeave(options: Options) {
  const context = useRef(options), active = useRef(false);
  const intent = useRef<{ id: number; destination: () => void } | null>(null), sequence = useRef(0);
  const [open, setOpen] = useState<number | null>(null);
  useLayoutEffect(() => { context.current = options; });
  useEffect(() => {
    // A confirmed save may finish while the person is reading the warning.
    // Retire that intent; never navigate automatically on request completion.
    if (!options.dirty && !options.uncertain && intent.current) { intent.current = null; setOpen(null); }
  }, [options.dirty, options.uncertain]);
  useEffect(() => {
    let mounted = true;
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const listener = AppState.addEventListener('change', state => {
      if (!mounted) return;
      active.current = state === 'active';
      if (!active.current) { intent.current = null; setOpen(null); }
    });
    return () => { mounted = false; active.current = false; intent.current = null; listener.remove(); };
  }, []);
  const requestLeave = useCallback((destination: () => void) => {
    if (!active.current || intent.current) return;
    Keyboard.dismiss();
    if (!context.current.dirty && !context.current.uncertain) { destination(); return; }
    const id = ++sequence.current;
    intent.current = { id, destination };
    setOpen(id);
  }, []);
  useImperativeHandle(options.handleRef, () => ({ requestLeave }), [requestLeave]);
  const keep = () => { if (intent.current?.id !== open) return; intent.current = null; setOpen(null); };
  const proceed = () => {
    const selected = intent.current;
    if (!selected || selected.id !== open) return;
    intent.current = null;
    setOpen(null);
    if (!active.current) return;
    context.current.onDiscard?.();
    selected.destination();
  };
  const check = () => {
    if (!active.current || !intent.current || intent.current.id !== open || context.current.checkDisabled || !context.current.onCheckSavedResult) return;
    intent.current = null; setOpen(null);
    context.current.onCheckSavedResult();
  };
  const text = leaveCopy[options.language];
  const dialog = open !== null ? <Modal visible transparent={false} animationType="none" onRequestClose={keep}>
    <SafeAreaView style={styles.safe}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View accessibilityViewIsModal style={styles.card}>
          <RootScreenHeading language={options.language} title={text.title} />
          <Text accessibilityLanguage={accessibilityLanguages[options.language]} allowFontScaling style={styles.body}>
            {options.uncertain ? text.uncertain : text.dirty}
          </Text>
          <AccountAction language={options.language} label={text.keep} onPress={keep} />
          {options.uncertain && options.onCheckSavedResult && <AccountAction language={options.language}
            label={text.check} onPress={check} disabled={options.checkDisabled} secondary />}
          <AccountAction language={options.language} label={options.uncertain ? text.leave : text.discard}
            onPress={proceed} quiet />
        </View>
      </ScrollView>
    </SafeAreaView>
  </Modal> : null;
  return { requestLeave, dialog };
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream }, scroll: { flexGrow: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  card: { width: '100%', maxWidth: 640, gap: 20 }, body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
});
