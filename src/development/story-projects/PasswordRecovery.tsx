import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Language } from "@/features/onboarding/copy";
import type { DevelopmentAuth } from "./development";
import { PasswordRecoveryError, type RecoveryState } from "./recovery";

const copy = {
  en: {
    checking: "Checking your recovery link…", finishing: "Password updated. Closing the temporary recovery session…",
    cleanup: "Your password was updated. Reload this preview to clear the temporary session before signing in.", reload: "Reload to sign in",
    title: "Choose a new password", rules: "Use a new, strong password that meets the development project's password rules. Supabase checks those rules before saving. You will sign in again after the update. Your story projects stay closed during recovery.",
    password: "New Password", confirmation: "Confirm Password", updating: "Updating password…", update: "Update password",
    empty: "Enter a new password.", mismatch: "The passwords do not match. Enter the same new password in both fields.",
    invalid: "This recovery link is invalid, expired, already used, or could not be verified. Ask Charan for a fresh development recovery email and open its newest link.",
    weak: "That password does not meet the development project's password rules. Try a longer, stronger password with a mix of character types.",
    same: "Choose a new password different from your previous password.",
    failed: "Could not update your password. Check your connection and try again, or ask Charan for a fresh recovery email.",
  },
  sv: {
    checking: "Kontrollerar din återställningslänk…", finishing: "Lösenordet har uppdaterats. Stänger den tillfälliga återställningssessionen…",
    cleanup: "Ditt lösenord har uppdaterats. Ladda om förhandsvisningen för att rensa den tillfälliga sessionen innan du loggar in.", reload: "Ladda om för att logga in",
    title: "Välj ett nytt lösenord", rules: "Använd ett nytt, starkt lösenord som uppfyller utvecklingsprojektets lösenordsregler. Supabase kontrollerar reglerna innan lösenordet sparas. Du loggar in igen efter uppdateringen. Dina berättelseprojekt hålls stängda under återställningen.",
    password: "Nytt lösenord", confirmation: "Bekräfta lösenord", updating: "Uppdaterar lösenord…", update: "Uppdatera lösenord",
    empty: "Ange ett nytt lösenord.", mismatch: "Lösenorden matchar inte. Ange samma nya lösenord i båda fälten.",
    invalid: "Återställningslänken är ogiltig, utgången, redan använd eller kunde inte verifieras. Be Charan om ett nytt återställningsmejl för utvecklingskontot och öppna den senaste länken.",
    weak: "Lösenordet uppfyller inte utvecklingsprojektets lösenordsregler. Försök med ett längre, starkare lösenord med olika teckentyper.",
    same: "Välj ett nytt lösenord som skiljer sig från ditt tidigare lösenord.",
    failed: "Lösenordet kunde inte uppdateras. Kontrollera anslutningen och försök igen, eller be Charan om ett nytt återställningsmejl.",
  },
};

export default function PasswordRecovery({ auth, state, language = "en", recoveryReturnPath = "/story-projects.html" }: {
  auth: DevelopmentAuth; state: RecoveryState; language?: Language; recoveryReturnPath?: "/" | "/story-projects.html";
}) {
  const text = copy[language];
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"empty" | "mismatch" | "invalid" | "weak" | "same" | "failed" | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (state !== "ready") { setPassword(""); setConfirmation(""); }
  }, [state]);
  useEffect(() => { if (state === "ready") passwordInput.current?.focus(); }, [state]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!password) { setError("empty"); return; }
    if (password !== confirmation) { setError("mismatch"); return; }
    setBusy(true);
    try { await auth.updatePassword(password); }
    catch (error) { if (mounted.current) setError(error instanceof PasswordRecoveryError ? error.kind : "failed"); }
    finally { if (mounted.current) { setPassword(""); setConfirmation(""); setBusy(false); } }
  }

  if (state === "checking") return <p role="status">{text.checking}</p>;
  if (state === "finishing") return <p role="status">{text.finishing}</p>;
  if (state === "cleanup-failed") return <div className="space-y-4">
    <p role="status">{text.cleanup}</p>
    <Button onClick={() => window.location.replace(recoveryReturnPath === "/" ? "/" : "/story-projects.html")}>{text.reload}</Button>
  </div>;
  if (state !== "ready") return null;

  return <Card><CardContent className="space-y-4 pt-6">
    <h2 id="recovery-title" className="text-xl font-semibold">{text.title}</h2>
    <p id="password-rules" className="text-sm text-muted-foreground">{text.rules}</p>
    {error && <p ref={errorMessage} id="recovery-error" role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4">{text[error]}</p>}
    <form aria-labelledby="recovery-title" onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <div className="space-y-2">
        <Label htmlFor="new-password">{text.password}</Label>
        <Input ref={passwordInput} id="new-password" type="password" autoComplete="new-password" required
          aria-describedby={`password-rules${error ? " recovery-error" : ""}`} aria-invalid={Boolean(error)}
          value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">{text.confirmation}</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required
          aria-describedby={error ? "recovery-error" : undefined} aria-invalid={Boolean(error)}
          value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
      </div>
      <Button type="submit" disabled={busy}>{busy ? text.updating : text.update}</Button>
    </form>
  </CardContent></Card>;
}
