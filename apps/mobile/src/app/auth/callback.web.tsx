import { useEffect, useRef, useState } from 'react';
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
    weak: 'Choose a password between 12 and 128 characters.', rate: 'Too many requests. Please wait before trying again.' },
  sv: { title: 'Välj ditt lösenord', description: 'Välj ett privat lösenord för ditt pilotkonto i Mina Minnen.', password: 'Nytt lösenord', repeat: 'Upprepa lösenord',
    help: 'Använd minst 12 tecken. Ditt lösenord delas aldrig med teamet för Mina Minnen.', save: 'Spara lösenord', checking: 'Kontrollerar länken i ditt mejl…',
    saved: 'Ditt lösenord har sparats. Du kan nu logga in i Mina Minnen.', login: 'Gå till inloggning', mismatch: 'Lösenorden stämmer inte överens.',
    cleanup: 'Ditt lösenord har sparats. Det gick inte att bekräfta att mejlsessionen avslutats. Logga in som vanligt; spara inte lösenordet igen.',
    uncertain: 'Lösenordet kan ha sparats. Försök logga in med ditt nya lösenord. Be annars om en ny länk. Upprepa inte sparandet.',
    invalid: 'Länken är inte tillgänglig eller har gått ut. Be pilotansvarig om ett nytt mejl för att välja lösenord.',
    failed: 'Det gick inte att slutföra. Kontrollera anslutningen och försök igen. Inga automatiska försök gjordes.',
    weak: 'Välj ett lösenord med 12 till 128 tecken.', rate: 'För många förfrågningar. Vänta innan du försöker igen.' },
};
export default function WebPasswordSetupRoute() {
  const { language, ready, completed } = useLanguage(), router = useRouter(), navigation = useLoginNavigation(), auth = useAuth(), text = copy[language];
  const service = useRef<WebPasswordSetup | null>(null), mounted = useRef(false), submitting = useRef(false);
  const [state, setState] = useState<'checking' | 'ready' | 'busy' | 'saved' | 'uncertain' | 'invalid'>('checking');
  const [leaving, setLeaving] = useState(false);
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [notice, setNotice] = useState<keyof typeof text | null>(null);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    try {
      service.current ??= createWebPasswordSetup(window.location, window.history);
      void service.current.verify().then(() => { if (alive) setState('ready'); }, () => { if (alive) setState('invalid'); });
    } catch { queueMicrotask(() => { if (alive) setState('invalid'); }); }
    const clear = () => { setPassword(''); setRepeat(''); };
    const background = () => { if (document.visibilityState === 'hidden') { clear(); setState('invalid'); } };
    document.addEventListener('visibilitychange', background); window.addEventListener('pagehide', clear);
    return () => {
      alive = false; mounted.current = false;
      document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', clear);
      // React's development effect replay must not consume the email link twice.
      queueMicrotask(() => { if (!mounted.current) service.current?.dispose(); });
    };
  }, []);
  const save = async () => {
    if (state !== 'ready' || submitting.current) return;
    if (password !== repeat) { setNotice('mismatch'); return; }
    submitting.current = true; setState('busy'); setNotice(null);
    try {
      if (!service.current) throw new PasswordSetupError('invalid-link');
      const result = await service.current.save(password);
      if (mounted.current) { setState('saved'); if (result.cleanup === 'unknown') setNotice('cleanup'); }
    }
    catch (error) {
      if (!mounted.current) return;
      const kind = error instanceof PasswordSetupError ? error.kind : 'failed';
      if (kind === 'check-sign-in') setState('uncertain');
      else if (kind === 'invalid-link' || kind === 'expired') setState('invalid');
      else { setState('ready'); setNotice(kind === 'weak-password' ? 'weak' : kind === 'rate-limit' ? 'rate' : 'failed'); }
    } finally { submitting.current = false; if (mounted.current) { setPassword(''); setRepeat(''); } }
  };
  const login = async () => {
    if (leaving) return;
    setLeaving(true); service.current?.dispose(); setPassword(''); setRepeat('');
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
