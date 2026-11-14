import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLanguage } from '../../language';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginNavigation } from '../../navigation/LoginNavigation';
import { AccountAction, AccountHeading, AccountNotice, AccountScreen, accountStyles } from '../../components/AccountPresentation';
import { PreferenceLoading } from '../../components/PreferenceLoading';
import { createWebPasswordSetup, PasswordSetupError, type WebPasswordSetup } from '../../auth/web-password-setup';

const copy = {
  en: { title: 'Choose your password', description: 'Set a private password for your Memy pilot account.', password: 'New password', repeat: 'Repeat password',
    help: 'Use at least 12 characters. Your password is never shared with the Memy team.', save: 'Save password', checking: 'Checking your email link…',
    saved: 'Your password is saved. You can now sign in to Memy.', login: 'Go to sign in', mismatch: 'The passwords do not match.',
    cleanup: 'Your password is saved. We could not confirm closure of this email session. Sign in normally; do not save the password again.',
    uncertain: 'The request may have saved your password. Try signing in with your new password. If that fails, ask for a fresh password setup link. Do not repeat this save.',
    invalid: 'This link is unavailable or has expired. Ask the pilot organiser for a fresh password setup email.',
    failed: 'We could not complete password setup. Check your connection, then try again. No automatic retry was made.',
    weak: 'Choose a password between 12 and 128 characters.', rate: 'Too many requests. Please wait before trying again.',
    email: 'Email address', code: 'Email code', continue: 'Continue', checkingCode: 'Checking your code…',
    codeHelp: 'Enter the email address for your pilot account and the six-digit code from your password setup email.',
    invalidCode: 'That code is incorrect or has expired. Check the email address and enter the code again, or ask for a fresh email.',
    codeNetwork: 'We could not check the code. Check your connection before trying again.' },
  sv: { title: 'Välj ditt lösenord', description: 'Välj ett privat lösenord för ditt pilotkonto i Mina Minnen.', password: 'Nytt lösenord', repeat: 'Upprepa lösenord',
    help: 'Använd minst 12 tecken. Ditt lösenord delas aldrig med teamet för Mina Minnen.', save: 'Spara lösenord', checking: 'Kontrollerar länken i ditt mejl…',
    saved: 'Ditt lösenord har sparats. Du kan nu logga in i Mina Minnen.', login: 'Gå till inloggning', mismatch: 'Lösenorden stämmer inte överens.',
    cleanup: 'Ditt lösenord har sparats. Det gick inte att bekräfta att mejlsessionen avslutats. Logga in som vanligt; spara inte lösenordet igen.',
    uncertain: 'Lösenordet kan ha sparats. Försök logga in med ditt nya lösenord. Be annars om en ny länk. Upprepa inte sparandet.',
    invalid: 'Länken är inte tillgänglig eller har gått ut. Be pilotansvarig om ett nytt mejl för att välja lösenord.',
    failed: 'Det gick inte att slutföra. Kontrollera anslutningen och försök igen. Inga automatiska försök gjordes.',
    weak: 'Välj ett lösenord med 12 till 128 tecken.', rate: 'För många förfrågningar. Vänta innan du försöker igen.',
    email: 'E-postadress', code: 'Kod från mejlet', continue: 'Fortsätt', checkingCode: 'Kontrollerar koden…',
    codeHelp: 'Ange e-postadressen för ditt pilotkonto och den sexsiffriga koden i mejlet för lösenordsval.',
    invalidCode: 'Koden är felaktig eller har gått ut. Kontrollera e-postadressen och ange koden igen, eller be om ett nytt mejl.',
    codeNetwork: 'Det gick inte att kontrollera koden. Kontrollera anslutningen innan du försöker igen.' },
};
type SetupState = 'checking' | 'code' | 'code-busy' | 'ready' | 'busy' | 'saved' | 'uncertain' | 'invalid';
const sixDigitCode = /^[0-9]{6}$/;

export default function WebPasswordSetupRoute() {
  const { language, ready, completed } = useLanguage(), router = useRouter(), navigation = useLoginNavigation(), auth = useAuth(), text = copy[language];
  const service = useRef<WebPasswordSetup | null>(null), mounted = useRef(false), phase = useRef<SetupState>('checking');
  const [state, setState] = useState<SetupState>('checking');
  const [leaving, setLeaving] = useState(false);
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [notice, setNotice] = useState<keyof typeof text | null>(null);
  const [email, setEmail] = useState(''), [code, setCode] = useState('');
  const show = useCallback((next: SetupState) => { phase.current = next; setState(next); }, []);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const finishChecking = (next: SetupState) => { if (alive && phase.current === 'checking') show(next); };
    try {
      service.current ??= createWebPasswordSetup(window.location, window.history);
      if (service.current.submitCode) finishChecking('code');
      else void service.current.verify().then(() => finishChecking('ready'), () => finishChecking('invalid'));
    } catch { queueMicrotask(() => finishChecking('invalid')); }
    const clear = () => {
      setPassword(''); setRepeat(''); setEmail(''); setCode('');
      if (phase.current === 'checking' || phase.current === 'code-busy' || phase.current === 'ready' || phase.current === 'busy') {
        service.current?.dispose();
        show(phase.current === 'busy' ? 'uncertain' : 'invalid');
      }
    };
    const background = () => { if (document.visibilityState === 'hidden') clear(); };
    document.addEventListener('visibilitychange', background); window.addEventListener('pagehide', clear);
    return () => {
      alive = false; mounted.current = false;
      document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', clear);
      // React's development effect replay must not consume the email link twice.
      queueMicrotask(() => { if (!mounted.current) service.current?.dispose(); });
    };
  }, [show]);
  const isCurrent = (expected: SetupState) => mounted.current && phase.current === expected;
  const verifyCode = async () => {
    const current = service.current;
    if (phase.current !== 'code' || !current?.submitCode || !email.trim() || !sixDigitCode.test(code)) return;
    show('code-busy'); setNotice(null); setCode('');
    try {
      await current.submitCode(email.trim(), code);
      if (isCurrent('code-busy')) { setEmail(''); show('ready'); }
    } catch (error) {
      if (!isCurrent('code-busy')) return;
      const kind = error instanceof PasswordSetupError ? error.kind : 'failed';
      if (kind === 'expired') show('invalid');
      else {
        show('code');
        setNotice(kind === 'invalid-link' ? 'invalidCode' : kind === 'rate-limit' ? 'rate' : kind === 'network' ? 'codeNetwork' : 'failed');
      }
    }
  };
  const save = async () => {
    if (phase.current !== 'ready') return;
    if (password !== repeat) { setNotice('mismatch'); return; }
    show('busy'); setNotice(null);
    try {
      if (!service.current) throw new PasswordSetupError('invalid-link');
      const result = await service.current.save(password);
      if (isCurrent('busy')) { show('saved'); if (result.cleanup === 'unknown') setNotice('cleanup'); }
    }
    catch (error) {
      if (!isCurrent('busy')) return;
      const kind = error instanceof PasswordSetupError ? error.kind : 'failed';
      if (kind === 'check-sign-in') show('uncertain');
      else if (kind === 'invalid-link' || kind === 'expired') show('invalid');
      else { show('ready'); setNotice(kind === 'weak-password' ? 'weak' : kind === 'rate-limit' ? 'rate' : 'failed'); }
    } finally { if (mounted.current) { setPassword(''); setRepeat(''); } }
  };
  const login = async () => {
    if (leaving) return;
    setLeaving(true); service.current?.dispose(); setPassword(''); setRepeat(''); setEmail(''); setCode('');
    try {
      // An already signed-in browser account must not silently replace the email recipient.
      if (auth.status !== 'signed-out') await auth.signOut();
      if (!mounted.current) return;
      if (completed) {
        navigation.requestLogin();
        router.replace('/login');
      } else {
        router.replace('/');
      }
    } catch { if (mounted.current) { setNotice('failed'); setLeaving(false); } }
  };
  if (!ready) return <PreferenceLoading language={language} />;
  return <AccountScreen>
    <AccountHeading language={language} title={text.title} description={text.description} />
    {state === 'checking' && <AccountNotice language={language} message={text.checking} urgent={false} />}
    {(state === 'code' || state === 'code-busy') && <View style={accountStyles.form}>
      <Text style={accountStyles.help}>{text.codeHelp}</Text>
      {notice && <AccountNotice language={language} message={text[notice]} />}
      {state === 'code-busy' && <AccountNotice language={language} message={text.checkingCode} urgent={false} />}
      <View style={accountStyles.field}><Text style={accountStyles.label}>{text.email}</Text>
        <TextInput accessibilityLabel={text.email} style={accountStyles.input} autoComplete="email" inputMode="email"
          autoCapitalize="none" autoCorrect={false} maxLength={254} value={email} onChangeText={setEmail} editable={state === 'code'} /></View>
      <View style={accountStyles.field}><Text style={accountStyles.label}>{text.code}</Text>
        <TextInput accessibilityLabel={text.code} style={accountStyles.input} autoComplete="one-time-code" inputMode="numeric"
          autoCorrect={false} maxLength={6} value={code} onChangeText={value => { if (/^[0-9]{0,6}$/.test(value)) setCode(value); }}
          editable={state === 'code'} onSubmitEditing={() => { void verifyCode(); }} /></View>
      <AccountAction language={language} label={text.continue} busy={state === 'code-busy'}
        disabled={state === 'code-busy' || !email.trim() || !sixDigitCode.test(code)} onPress={() => { void verifyCode(); }} />
    </View>}
    {state === 'invalid' && <AccountNotice language={language} message={text.invalid} />}
    {state === 'saved' && <AccountNotice language={language} message={notice === 'cleanup' ? text.cleanup : text.saved} urgent={false} />}
    {state === 'uncertain' && <AccountNotice language={language} message={text.uncertain} />}
    {(state === 'ready' || state === 'busy') && <View style={accountStyles.form}>
      {notice && <AccountNotice language={language} message={text[notice]} />}
      <View style={accountStyles.field}><Text style={accountStyles.label}>{text.password}</Text>
        <TextInput accessibilityLabel={text.password} style={accountStyles.input} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          autoCapitalize="none" autoCorrect={false} maxLength={128} value={password} onChangeText={setPassword} editable={state === 'ready'} /></View>
      <View style={accountStyles.field}><Text style={accountStyles.label}>{text.repeat}</Text>
        <TextInput accessibilityLabel={text.repeat} style={accountStyles.input} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          autoCapitalize="none" autoCorrect={false} maxLength={128} value={repeat} onChangeText={setRepeat} editable={state === 'ready'} onSubmitEditing={() => { void save(); }} /></View>
      <Text style={accountStyles.help}>{text.help}</Text>
      <AccountAction language={language} label={text.save} disabled={state === 'busy'} busy={state === 'busy'} onPress={() => { void save(); }} />
    </View>}
    {(state === 'saved' || state === 'invalid' || state === 'uncertain') && <AccountAction language={language} label={text.login} disabled={leaving} busy={leaving} onPress={() => { void login(); }} />}
  </AccountScreen>;
}
