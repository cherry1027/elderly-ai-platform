import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Language } from "../onboarding/copy";
import { RegistrationError, type ConfirmationState, type RegistrationAuth } from "./registration-auth";

const copy = {
  en: {
    title: "Create your Memy account", email: "Email", password: "Password", confirmation: "Confirm Password",
    rules: "Use a strong password that meets the development project's password rules. Supabase checks those rules. Confirm your email, then sign in to open your story projects.",
    create: "Create account", busy: "Creating account…", back: "Back to Welcome", signIn: "Go to sign in",
    checking: "Checking your confirmation link…", complete: "Your email confirmation was verified. Sign in with your email and password to continue.",
    sent: "If registration can proceed, check your email for a confirmation link. After confirming, return here to sign in. Email delivery may take a few minutes.",
    invalid: "This confirmation link is invalid, expired, already used, or could not be verified. Try signing in if you already confirmed your email, or ask Charan for help with the development account.",
    cleanupFailed: "The temporary confirmation session could not be closed safely. Reload before signing in.",
    reload: "Reload to sign in", required: "Enter your email and password, then confirm the password.",
    emailInvalid: "Enter a valid email address.", mismatch: "The passwords do not match. Enter the same password in both fields.",
    weak: "The password does not meet the development project's password rules. Try a longer, stronger password.",
    rateLimit: "Too many requests. Wait before trying again, or ask Charan about development email limits.",
    failed: "Registration could not be completed. Check your connection and try again. If you already have an account, sign in.",
    configuration: "Registration needs the approved development authentication settings. Ask Charan to check them.",
    cleanup: "Registration could not finish safely. Reload before signing in or trying again.",
    timeout: "Registration took too long. It may have reached Supabase. Check your email before trying again.",
  },
  sv: {
    title: "Skapa ditt Memy-konto", email: "E-post", password: "Lösenord", confirmation: "Bekräfta lösenord",
    rules: "Använd ett starkt lösenord som uppfyller utvecklingsprojektets lösenordsregler. Supabase kontrollerar reglerna. Bekräfta din e-post och logga sedan in för att öppna dina berättelseprojekt.",
    create: "Skapa konto", busy: "Skapar konto…", back: "Tillbaka till Välkommen", signIn: "Gå till inloggning",
    checking: "Kontrollerar din bekräftelselänk…", complete: "Din e-postbekräftelse har verifierats. Logga in med din e-post och ditt lösenord för att fortsätta.",
    sent: "Om registreringen kan fortsätta får du ett mejl med en bekräftelselänk. Bekräfta din e-post och kom sedan tillbaka för att logga in. Det kan ta några minuter innan mejlet kommer.",
    invalid: "Bekräftelselänken är ogiltig, utgången, redan använd eller kunde inte verifieras. Försök logga in om du redan har bekräftat din e-post, eller be Charan om hjälp med utvecklingskontot.",
    cleanupFailed: "Den tillfälliga bekräftelsesessionen kunde inte stängas säkert. Ladda om innan du loggar in.",
    reload: "Ladda om för att logga in", required: "Ange din e-post och ditt lösenord och bekräfta sedan lösenordet.",
    emailInvalid: "Ange en giltig e-postadress.", mismatch: "Lösenorden matchar inte. Ange samma lösenord i båda fälten.",
    weak: "Lösenordet uppfyller inte utvecklingsprojektets lösenordsregler. Försök med ett längre, starkare lösenord.",
    rateLimit: "För många förfrågningar. Vänta innan du försöker igen, eller fråga Charan om utvecklingsprojektets mejlgränser.",
    failed: "Registreringen kunde inte slutföras. Kontrollera anslutningen och försök igen. Logga in om du redan har ett konto.",
    configuration: "Registreringen behöver de godkända utvecklingsinställningarna för autentisering. Be Charan kontrollera dem.",
    cleanup: "Registreringen kunde inte slutföras säkert. Ladda om innan du loggar in eller försöker igen.",
    timeout: "Registreringen tog för lång tid. Förfrågan kan ha nått Supabase. Kontrollera din e-post innan du försöker igen.",
  },
};

type FormError = "required" | "emailInvalid" | "mismatch" | "weak" | "rateLimit" | "failed" | "configuration" | "cleanup" | "timeout";

export default function Registration({ auth, language, onSignIn, onBack }: {
  auth: RegistrationAuth; language: Language; onSignIn: () => void; onBack: () => void;
}) {
  const text = copy[language];
  const [state, setState] = useState<ConfirmationState>(() => auth.getConfirmationState());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const inFlight = useRef(false);
  const confirmationState = useRef(state);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    confirmationState.current = auth.getConfirmationState();
    setState(confirmationState.current);
    const unsubscribe = auth.onConfirmationChange(next => { confirmationState.current = next; setState(next); });
    return () => { mounted.current = false; unsubscribe(); };
  }, [auth]);
  useEffect(() => {
    if (state !== "none") { setEmail(""); setPassword(""); setConfirmation(""); }
    if (state === "invalid" || state === "cleanup-failed") errorMessage.current?.focus();
  }, [state]);
  useEffect(() => {
    if (submitted || state === "checking" || state === "complete") heading.current?.focus();
  }, [submitted, state]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || confirmationState.current !== "none" || submitted) return;
    setError(null);
    if (!email.trim() || !password || !confirmation) { setError("required"); return; }
    if (emailInput.current?.validity.typeMismatch) { setError("emailInvalid"); return; }
    if (password !== confirmation) { setError("mismatch"); return; }
    inFlight.current = true;
    setBusy(true);
    try {
      await auth.signUp(email.trim(), password);
      if (mounted.current && confirmationState.current === "none") { setSubmitted(true); setEmail(""); }
    } catch (caught) {
      if (mounted.current && confirmationState.current === "none") {
        const kind = caught instanceof RegistrationError ? caught.kind : "failed";
        setError(kind === "rate-limit" ? "rateLimit" : kind === "invalid-email" ? "emailInvalid" : kind);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setPassword(""); setConfirmation(""); setBusy(false); }
    }
  }

  const terminalCleanup = state === "cleanup-failed" || error === "cleanup" || error === "timeout";
  return <main>
    <h1 ref={heading} tabIndex={-1}>{text.title}</h1>
    {state === "checking" ? <p role="status">{text.checking}</p>
      : terminalCleanup ? <>
        <p ref={errorMessage} role="alert" tabIndex={-1}>{error === "timeout" ? `${text.timeout} ${text.cleanup}` : text.cleanupFailed}</p>
        <Button type="button" onClick={() => window.location.replace("/")}>{text.reload}</Button>
      </>
      : state === "complete" || submitted ? <>
        <p role="status">{state === "complete" ? text.complete : text.sent}</p>
        <Button type="button" onClick={onSignIn}>{text.signIn}</Button>
      </>
      : state === "invalid" ? <>
        <p ref={errorMessage} role="alert" tabIndex={-1}>{text.invalid}</p>
        <Button type="button" onClick={onSignIn}>{text.signIn}</Button>
      </>
      : <>
        <p id="registration-rules">{text.rules}</p>
        {error && <p ref={errorMessage} id="registration-error" role="alert" tabIndex={-1}>{text[error]}</p>}
        <form aria-label={text.title} onSubmit={submit} noValidate aria-busy={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="registration-email">{text.email}</Label>
            <Input ref={emailInput} id="registration-email" type="email" autoComplete="email" required disabled={busy}
              value={email} onChange={event => setEmail(event.target.value)}
              aria-invalid={error === "required" || error === "emailInvalid"}
              aria-describedby={error ? "registration-error" : undefined} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-password">{text.password}</Label>
            <Input id="registration-password" type="password" autoComplete="new-password" required disabled={busy}
              value={password} onChange={event => setPassword(event.target.value)}
              aria-invalid={Boolean(error)} aria-describedby={`registration-rules${error ? " registration-error" : ""}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-confirmation">{text.confirmation}</Label>
            <Input id="registration-confirmation" type="password" autoComplete="new-password" required disabled={busy}
              value={confirmation} onChange={event => setConfirmation(event.target.value)}
              aria-invalid={error === "required" || error === "mismatch"}
              aria-describedby={error ? "registration-error" : undefined} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? text.busy : text.create}</Button>
        </form>
        <Button type="button" onClick={onSignIn} disabled={busy}>{text.signIn}</Button>
      </>}
    {!terminalCleanup && <Button type="button" onClick={onBack}>{text.back}</Button>}
  </main>;
}
