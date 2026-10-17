import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DevelopmentAuth } from "./development";
import { PasswordRecoveryError, type RecoveryState } from "./recovery";

export default function PasswordRecovery({ auth, state }: { auth: DevelopmentAuth; state: RecoveryState }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (state === "ready") passwordInput.current?.focus(); }, [state]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!password) { setError("Enter a new password."); return; }
    if (password !== confirmation) { setError("The passwords do not match. Enter the same new password in both fields."); return; }
    setBusy(true);
    try { await auth.updatePassword(password); }
    catch (error) {
      setError(error instanceof PasswordRecoveryError ? error.message : "Could not update your password. Please try again or ask Charan for a fresh recovery email.");
    } finally {
      setPassword(""); setConfirmation(""); setBusy(false);
    }
  }

  if (state === "checking") return <p role="status">Checking your recovery link…</p>;
  if (state === "finishing") return <p role="status">Password updated. Closing the temporary recovery session…</p>;
  if (state === "cleanup-failed") return <div className="space-y-4">
    <p role="status">Your password was updated. Reload this preview to clear the temporary session before signing in.</p>
    <Button onClick={() => window.location.replace("/story-projects.html")}>Reload to sign in</Button>
  </div>;
  if (state !== "ready") return null;

  return <Card><CardContent className="space-y-4 pt-6">
    <h2 id="recovery-title" className="text-xl font-semibold">Choose a new password</h2>
    <p id="password-rules" className="text-sm text-muted-foreground">
      Use a new, strong password that meets the development project's password rules. Supabase checks those rules before saving.
      You will sign in again after the update. Your story projects stay closed during recovery.
    </p>
    {error && <p ref={errorMessage} id="recovery-error" role="alert" tabIndex={-1}
      className="rounded-lg border border-destructive p-4">{error}</p>}
    <form aria-labelledby="recovery-title" onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <div className="space-y-2">
        <Label htmlFor="new-password">New Password</Label>
        <Input ref={passwordInput} id="new-password" type="password" autoComplete="new-password" required
          aria-describedby={`password-rules${error ? " recovery-error" : ""}`} aria-invalid={Boolean(error)}
          value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required
          aria-describedby={error ? "recovery-error" : undefined} aria-invalid={Boolean(error)}
          value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
      </div>
      <Button type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"}</Button>
    </form>
  </CardContent></Card>;
}
