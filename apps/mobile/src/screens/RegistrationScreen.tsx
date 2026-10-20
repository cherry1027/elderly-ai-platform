import { useEffect, useRef, useState } from 'react';
import {
  AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { registrationCopy } from '../registration-copy';
import { colors, headingFont, layout } from '../theme';

type RegistrationFailure = keyof typeof registrationCopy.en.errors;
type Validation = 'required' | 'emailInvalid' | 'minimum' | 'mismatch';
interface RegistrationScreenProps {
  language: Language;
  onBack: () => void;
  onLogin: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  enabled: boolean;
  pending?: boolean;
  sent?: boolean;
  externalFailure?: 'cleanup';
}

function safeFailure(error: unknown): RegistrationFailure {
  try {
    if (!error || typeof error !== 'object') return 'unknown';
    const kind: unknown = (error as { kind?: unknown }).kind;
    return typeof kind === 'string' && Object.hasOwn(registrationCopy.en.errors, kind)
      ? kind as RegistrationFailure : 'unknown';
  } catch { return 'unknown'; }
}

function Action({ label, language, onPress, disabled = false, busy = false, secondary = false,
  selected }: { label: string; language: Language; onPress: () => void; disabled?: boolean;
  busy?: boolean; secondary?: boolean; selected?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, busy, ...(selected === undefined ? {} : { selected }) }}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, secondary && styles.secondary, disabled && styles.disabled,
      pressed && !disabled && styles.pressed, focused && styles.focused]}>
    <Text allowFontScaling style={[styles.actionLabel, secondary && styles.secondaryLabel]}>{label}</Text>
  </Pressable>;
}

export function RegistrationScreen({ language, onBack, onLogin, onSubmit, enabled,
  pending = false, sent = false, externalFailure }: RegistrationScreenProps) {
  const text = registrationCopy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | 'confirmation' | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [failure, setFailure] = useState<RegistrationFailure | null>(null);
  const [working, setWorking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [checked, setChecked] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const generation = useRef(0);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);
  const effectiveFailure = externalFailure ?? failure;
  const terminal = effectiveFailure === 'cleanup' || effectiveFailure === 'timeout' || effectiveFailure === 'pending';
  const disabled = pending || working || terminal;

  function clearPasswords() {
    setPassword(''); setConfirmation(''); setPasswordVisible(false); setConfirmationVisible(false);
  }
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setPassword(''); setConfirmation(''); setPasswordVisible(false); setConfirmationVisible(false);
      }
    });
    return () => { mounted.current = false; generation.current += 1; subscription.remove(); };
  }, []);

  async function submit() {
    if (disabled || inFlight.current || finished.current || sent) return;
    setValidation(null); setFailure(null); setChecked(false);
    const cleanedEmail = email.trim();
    if (!cleanedEmail || !password || !confirmation) {
      setValidation('required');
      (!cleanedEmail ? emailInput : !password ? passwordInput : confirmationInput).current?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      setValidation('emailInvalid'); emailInput.current?.focus(); return;
    }
    if (password.length < 6) { setValidation('minimum'); passwordInput.current?.focus(); return; }
    if (password !== confirmation) { setValidation('mismatch'); confirmationInput.current?.focus(); return; }
    Keyboard.dismiss();
    // A local check is not a signup attempt. Keep the controlled values so the
    // user can reveal, correct and check them again without retyping.
    if (!enabled) { setChecked(true); return; }
    inFlight.current = true;
    const attempt = ++generation.current;
    const submittedPassword = password;
    setWorking(true); clearPasswords();
    try {
      await onSubmit(cleanedEmail, submittedPassword);
      if (mounted.current && generation.current === attempt) {
        finished.current = true; setSubmitted(true); setEmail('');
      }
    } catch (error) {
      if (mounted.current && generation.current === attempt) setFailure(safeFailure(error));
    } finally {
      if (mounted.current && generation.current === attempt) {
        inFlight.current = false; setWorking(false); clearPasswords();
      }
    }
  }

  function leave(destination: () => void) {
    generation.current += 1; inFlight.current = false;
    clearPasswords(); setEmail(''); setWorking(false); Keyboard.dismiss(); destination();
  }
  const message = effectiveFailure ? text.errors[effectiveFailure] : validation ? text[validation] : null;
  const setValue = (setter: (value: string) => void) => (value: string) => {
    setter(value); setValidation(null); setChecked(false);
  };

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen>
      <MemyBrand />
      <View style={screenStyles.section}>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.title}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.description}>{text.introduction}</Text>
      </View>
      <View style={styles.form}>
        {message && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{message}</Text>}
        {sent || submitted ? <Text accessibilityRole="text" accessibilityLiveRegion="polite"
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{text.sent}</Text> : <>
          {!enabled && <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{text.gate}</Text>}
          {checked && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={styles.notice}>{text.checked}</Text>}
          {pending && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={styles.notice}>{text.pending}</Text>}
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.description}>{text.rules}</Text>
          <View style={styles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.label}>{text.email}</Text>
            <TextInput ref={emailInput} accessibilityLabel={text.email} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[styles.input, focused === 'email' && styles.focused]}
              value={email} onChangeText={setValue(setEmail)} editable={!disabled} autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next"
              onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} onSubmitEditing={() => passwordInput.current?.focus()} />
          </View>
          <View style={styles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.label}>{text.password}</Text>
            <TextInput ref={passwordInput} accessibilityLabel={text.password} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[styles.input, focused === 'password' && styles.focused]}
              value={password} onChangeText={setValue(setPassword)} editable={!disabled} secureTextEntry={!passwordVisible}
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="next"
              onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} onSubmitEditing={() => confirmationInput.current?.focus()} />
            <Action language={language} label={passwordVisible ? text.hidePassword : text.showPassword} secondary
              selected={passwordVisible} disabled={disabled} onPress={() => setPasswordVisible((value) => !value)} />
          </View>
          <View style={styles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={styles.label}>{text.confirmation}</Text>
            <TextInput ref={confirmationInput} accessibilityLabel={text.confirmation} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[styles.input, focused === 'confirmation' && styles.focused]}
              value={confirmation} onChangeText={setValue(setConfirmation)} editable={!disabled} secureTextEntry={!confirmationVisible}
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="done"
              onFocus={() => setFocused('confirmation')} onBlur={() => setFocused(null)} onSubmitEditing={() => Keyboard.dismiss()} />
            <Action language={language} label={confirmationVisible ? text.hideConfirmation : text.showConfirmation} secondary
              selected={confirmationVisible} disabled={disabled} onPress={() => setConfirmationVisible((value) => !value)} />
          </View>
          <Action language={language} label={working ? text.creating : enabled ? text.create : text.checkDetails}
            disabled={disabled} busy={working} onPress={() => { void submit(); }} />
        </>}
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.footer}>{text.emailLimit}</Text>
        {effectiveFailure !== 'cleanup' && <Action language={language} label={text.login} secondary
          disabled={working} onPress={() => leave(onLogin)} />}
        <Action language={language} label={text.back} secondary onPress={() => leave(onBack)} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 }, heading: { fontFamily: headingFont },
  form: { width: '100%', gap: 24 }, field: { width: '100%', gap: 10 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  input: { minHeight: layout.minimumTouchTarget, width: '100%', padding: 16, borderWidth: 2,
    borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper,
    color: colors.ink, fontSize: 22, lineHeight: 32 },
  notice: { color: colors.ink, fontSize: 21, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  action: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.paper },
  actionLabel: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondaryLabel: { color: colors.forest }, disabled: { opacity: 0.65 }, pressed: { opacity: 0.8 },
  focused: { borderColor: colors.ink },
});
