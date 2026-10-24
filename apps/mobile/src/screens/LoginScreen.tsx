import { useEffect, useRef, useState } from 'react';
import {
  AppState, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View, type ScrollView,
} from 'react-native';
import type { AuthErrorKind } from '../auth/errors';
import { authCopy } from '../auth-copy';
import { AccountAction, AccountHeading, AccountNotice, AccountScreen, PasswordVisibility, accountStyles } from '../components/AccountPresentation';
import { accessibilityLanguages, type Language } from '../i18n';

interface LoginScreenProps {
  language: Language;
  onSignIn: (email: string, password: string) => Promise<void>;
  onBack: () => void;
  busy: boolean;
  error: AuthErrorKind | null;
  blocked?: boolean;
  onRetryCleanup?: () => void;
}

export function LoginScreen({ language, onSignIn, onBack, busy, error, blocked = false, onRetryCleanup }: LoginScreenProps) {
  const text = authCopy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [validation, setValidation] = useState<'required' | 'invalidEmail' | null>(null);
  const [failed, setFailed] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const generation = useRef(0);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const scrollView = useRef<ScrollView>(null);
  const formTop = useRef(0);
  const disabled = busy || working || blocked;

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { setPassword(''); setVisible(false); }
    });
    return () => { mounted.current = false; generation.current += 1; subscription.remove(); };
  }, []);

  async function submit() {
    if (disabled || submitting.current) return;
    const cleanedEmail = email.trim();
    if (!cleanedEmail || !password) {
      setValidation('required');
      (!cleanedEmail ? emailInput : passwordInput).current?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      setValidation('invalidEmail'); emailInput.current?.focus(); return;
    }
    submitting.current = true;
    const attempt = ++generation.current;
    setWorking(true); setFailed(false); setValidation(null); Keyboard.dismiss();
    try { await onSignIn(cleanedEmail, password); }
    catch { if (mounted.current && generation.current === attempt) setFailed(true); }
    finally {
      if (mounted.current && generation.current === attempt) {
        submitting.current = false; setWorking(false); setPassword(''); setVisible(false);
      }
    }
  }

  function back() {
    generation.current += 1;
    submitting.current = false;
    setPassword(''); setVisible(false); setWorking(false); Keyboard.dismiss(); onBack();
  }

  const message = validation ? text[validation] : error ? text.errors[error] : failed ? text.errors.unknown : null;

  useEffect(() => {
    if (!message) return;
    let active = true;
    const reveal = () => { if (active) scrollView.current?.scrollTo({ y: Math.max(0, formTop.current - 16), animated: false }); };
    reveal();
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    const hidden = Keyboard.addListener('keyboardDidHide', reveal);
    return () => { active = false; shown.remove(); hidden.remove(); };
  }, [message]);

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <AccountScreen scrollViewRef={scrollView} onContentLayout={() => {
      if (message) scrollView.current?.scrollTo({ y: Math.max(0, formTop.current - 16), animated: false });
    }}>
      <AccountHeading language={language} title={text.title} description={text.introduction} />
      <View style={accountStyles.form} onLayout={(event) => {
        formTop.current = event.nativeEvent.layout.y;
        if (message) scrollView.current?.scrollTo({ y: Math.max(0, formTop.current - 16), animated: false });
      }}>
        {message && <AccountNotice language={language} message={message} />}
        <View style={accountStyles.field}>
          <Text allowFontScaling style={accountStyles.label} accessibilityLanguage={accessibilityLanguages[language]}>{text.email}</Text>
          <TextInput ref={emailInput} accessibilityLabel={text.email} accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={[accountStyles.input, focusedInput === 'email' && accountStyles.focused]}
            value={email} onChangeText={(value) => { setEmail(value); setValidation(null); }}
            editable={!disabled} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit"
            onFocus={() => setFocusedInput('email')} onBlur={() => setFocusedInput(null)}
            onSubmitEditing={() => passwordInput.current?.focus()} />
        </View>
        <View style={accountStyles.field}>
          <Text allowFontScaling style={accountStyles.label} accessibilityLanguage={accessibilityLanguages[language]}>{text.password}</Text>
          <TextInput ref={passwordInput} accessibilityLabel={text.password} accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={[accountStyles.input, focusedInput === 'password' && accountStyles.focused]}
            value={password} onChangeText={(value) => { setPassword(value); setValidation(null); }}
            editable={!disabled} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" textContentType="password" returnKeyType="done" submitBehavior="blurAndSubmit"
            onFocus={() => setFocusedInput('password')} onBlur={() => setFocusedInput(null)}
            onSubmitEditing={() => Keyboard.dismiss()} />
          <PasswordVisibility label={visible ? text.hidePassword : text.showPassword} language={language}
            disabled={disabled} selected={visible} onPress={() => setVisible((value) => !value)} />
        </View>
        <AccountAction label={busy || working ? text.signingIn : text.signIn} language={language}
          disabled={disabled} busy={busy || working} onPress={() => { void submit(); }} />
        {blocked && onRetryCleanup && <AccountAction label={text.retryCleanup} language={language}
          disabled={busy || working} busy={busy} secondary onPress={onRetryCleanup} />}
        <AccountAction label={text.back} language={language} quiet onPress={back} />
      </View>
    </AccountScreen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
});
