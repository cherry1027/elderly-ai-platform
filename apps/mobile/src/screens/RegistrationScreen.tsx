import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  AccountAction, AccountHeading, AccountNotice, AccountScreen, PasswordVisibility, accountStyles,
} from '../components/AccountPresentation';
import { accessibilityLanguages, type Language } from '../i18n';
import { registrationCopy } from '../registration-copy';

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
  const scrollView = useRef<ScrollView>(null);
  const formTop = useRef(0);
  const feedbackVisible = useRef(false);
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
  const hasFeedback = !!message || checked;
  useLayoutEffect(() => {
    feedbackVisible.current = hasFeedback;
    return () => { feedbackVisible.current = false; };
  }, [hasFeedback]);
  const revealFeedback = useCallback(() => {
    if (feedbackVisible.current) scrollView.current?.scrollTo({ y: Math.max(0, formTop.current - 16), animated: false });
  }, []);
  useEffect(() => { revealFeedback(); }, [hasFeedback, message, revealFeedback]);
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', revealFeedback);
    const shown = Keyboard.addListener('keyboardDidShow', revealFeedback);
    return () => { feedbackVisible.current = false; hidden.remove(); shown.remove(); };
  }, [revealFeedback]);
  const setValue = (setter: (value: string) => void) => (value: string) => {
    setter(value); setValidation(null); setChecked(false);
  };

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <AccountScreen scrollViewRef={scrollView} onContentLayout={revealFeedback}>
      <AccountHeading language={language} title={text.title} description={text.introduction} />
      <View testID="registration-form" style={accountStyles.form} onLayout={(event) => {
        formTop.current = event.nativeEvent.layout.y; revealFeedback();
      }}>
        {message && <AccountNotice language={language} message={message} />}
        {sent || submitted ? <Text accessibilityRole="text" accessibilityLiveRegion="polite"
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.notice}>{text.sent}</Text> : <>
          {!enabled && <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.help}>{text.gate}</Text>}
          {checked && <AccountNotice language={language} message={text.checked} urgent={false} />}
          {pending && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={accountStyles.notice}>{text.pending}</Text>}
          <View style={accountStyles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={accountStyles.label}>{text.email}</Text>
            <TextInput ref={emailInput} accessibilityLabel={text.email} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[accountStyles.input, focused === 'email' && accountStyles.focused]}
              value={email} onChangeText={setValue(setEmail)} editable={!disabled} autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next"
              onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} onSubmitEditing={() => passwordInput.current?.focus()} />
          </View>
          <View style={accountStyles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={accountStyles.label}>{text.password}</Text>
            <TextInput ref={passwordInput} accessibilityLabel={text.password} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[accountStyles.input, focused === 'password' && accountStyles.focused]}
              value={password} onChangeText={setValue(setPassword)} editable={!disabled} secureTextEntry={!passwordVisible}
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="next"
              onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} onSubmitEditing={() => confirmationInput.current?.focus()} />
            <PasswordVisibility language={language} label={passwordVisible ? text.hidePassword : text.showPassword}
              selected={passwordVisible} disabled={disabled} onPress={() => setPasswordVisible((value) => !value)} />
          </View>
          <View style={accountStyles.field}>
            <Text allowFontScaling accessibilityLanguage={accessibilityLanguages[language]} style={accountStyles.label}>{text.confirmation}</Text>
            <TextInput ref={confirmationInput} accessibilityLabel={text.confirmation} accessibilityLanguage={accessibilityLanguages[language]}
              allowFontScaling style={[accountStyles.input, focused === 'confirmation' && accountStyles.focused]}
              value={confirmation} onChangeText={setValue(setConfirmation)} editable={!disabled} secureTextEntry={!confirmationVisible}
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="done"
              onFocus={() => setFocused('confirmation')} onBlur={() => setFocused(null)} onSubmitEditing={() => Keyboard.dismiss()} />
            <PasswordVisibility language={language} label={confirmationVisible ? text.hideConfirmation : text.showConfirmation}
              selected={confirmationVisible} disabled={disabled} onPress={() => setConfirmationVisible((value) => !value)} />
          </View>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.help}>{text.rules}</Text>
          <AccountAction language={language} label={working ? text.creating : enabled ? text.create : text.checkDetails}
            disabled={disabled} busy={working} onPress={() => { void submit(); }} />
        </>}
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={accountStyles.help}>{text.emailLimit}</Text>
        {effectiveFailure !== 'cleanup' && <AccountAction language={language} label={text.login} secondary
          disabled={working} onPress={() => leave(onLogin)} />}
        <AccountAction language={language} label={text.back} quiet onPress={() => leave(onBack)} />
      </View>
    </AccountScreen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ keyboard: { flex: 1 } });
