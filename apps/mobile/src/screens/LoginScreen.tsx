import { useEffect, useRef, useState } from 'react';
import {
  AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { AuthErrorKind } from '../auth/errors';
import { authCopy } from '../auth-copy';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';

interface LoginScreenProps {
  language: Language;
  onSignIn: (email: string, password: string) => Promise<void>;
  onBack: () => void;
  busy: boolean;
  error: AuthErrorKind | null;
  blocked?: boolean;
  onRetryCleanup?: () => void;
}

function Action({ label, language, onPress, disabled = false, busy = false, secondary = false }: {
  label: string; language: Language; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable
    accessibilityRole="button" accessibilityLabel={label}
    accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, secondary && styles.secondary,
      disabled && styles.disabled, pressed && !disabled && styles.pressed, focused && styles.focused]}
  ><Text allowFontScaling style={[styles.actionLabel, secondary && styles.secondaryLabel]}>{label}</Text></Pressable>;
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
  const [visibilityFocused, setVisibilityFocused] = useState(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const generation = useRef(0);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
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

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen>
      <MemyBrand />
      <View style={screenStyles.section}>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.title}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
          style={screenStyles.description}>{text.introduction}</Text>
      </View>
      <View style={styles.form}>
        {message && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.error}>{message}</Text>}
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label} accessibilityLanguage={accessibilityLanguages[language]}>{text.email}</Text>
          <TextInput ref={emailInput} accessibilityLabel={text.email} accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={[styles.input, focusedInput === 'email' && styles.focused]}
            value={email} onChangeText={(value) => { setEmail(value); setValidation(null); }}
            editable={!disabled} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            autoComplete="username" textContentType="username" returnKeyType="next"
            onFocus={() => setFocusedInput('email')} onBlur={() => setFocusedInput(null)}
            onSubmitEditing={() => passwordInput.current?.focus()} />
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label} accessibilityLanguage={accessibilityLanguages[language]}>{text.password}</Text>
          <TextInput ref={passwordInput} accessibilityLabel={text.password} accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={[styles.input, focusedInput === 'password' && styles.focused]}
            value={password} onChangeText={(value) => { setPassword(value); setValidation(null); }}
            editable={!disabled} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" textContentType="password" returnKeyType="go"
            onFocus={() => setFocusedInput('password')} onBlur={() => setFocusedInput(null)}
            onSubmitEditing={() => { void submit(); }} />
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? text.hidePassword : text.showPassword}
            accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ disabled, selected: visible }}
            disabled={disabled} onPress={() => setVisible((value) => !value)}
            onFocus={() => setVisibilityFocused(true)} onBlur={() => setVisibilityFocused(false)}
            style={({ pressed }) => [styles.action, styles.secondary, pressed && styles.pressed, visibilityFocused && styles.focused]}>
            <Text allowFontScaling style={[styles.actionLabel, styles.secondaryLabel]}>{visible ? text.hidePassword : text.showPassword}</Text>
          </Pressable>
        </View>
        <Action label={busy || working ? text.signingIn : text.signIn} language={language}
          disabled={disabled} busy={busy || working} onPress={() => { void submit(); }} />
        {blocked && onRetryCleanup && <Action label={text.retryCleanup} language={language}
          disabled={busy || working} busy={busy} secondary onPress={onRetryCleanup} />}
        <Action label={text.back} language={language} secondary onPress={back} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  heading: { fontFamily: headingFont },
  form: { width: '100%', gap: 24 },
  field: { width: '100%', gap: 10 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  input: { minHeight: layout.minimumTouchTarget, width: '100%', padding: 16, borderWidth: 2,
    borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper,
    color: colors.ink, fontSize: 22, lineHeight: 32 },
  error: { color: colors.ink, fontSize: 21, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  action: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.paper },
  actionLabel: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondaryLabel: { color: colors.forest },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.8 },
  focused: { borderColor: colors.ink },
});
