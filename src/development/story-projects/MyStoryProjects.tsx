import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StoryProjectsError, type StoryProject } from "@/lib/api/story-projects";
import type { Language } from "@/features/onboarding/copy";
import type { DevelopmentAuth } from "./development";
import PasswordRecovery from "./PasswordRecovery";
import { INVALID_RECOVERY_MESSAGE, type RecoveryState } from "./recovery";

interface Props {
  auth: DevelopmentAuth;
  loadProjects: (signal: AbortSignal) => Promise<StoryProject[]>;
  language?: Language;
  onBack?: () => void;
  recoveryReturnPath?: "/" | "/story-projects.html";
}

const copy = {
  en: {
    preview: "Memy · Development preview", title: "My Story Projects", recoveryIntro: "Reset your development password. Your story projects stay closed during recovery.",
    intro: "View your projects. This page is read-only.", invalid: INVALID_RECOVERY_MESSAGE,
    complete: "Your password was updated successfully. Sign in with your new password.", signInTitle: "Sign in to development",
    signInNote: "Use your Memy development account. Sign-in lasts until you close or reload this page.",
    email: "Email", password: "Password", signingIn: "Signing in…", signIn: "Sign in", back: "Back to Welcome",
    signInFailed: "Could not sign in. Check your development account details and try again. If the request timed out, reload this preview before trying again.",
    signOutFailed: "Could not confirm sign-out. Your projects have been cleared. Reload this preview to clear the in-memory session before signing in again.",
    reload: "Reload to sign in", refresh: "Refresh projects", signingOut: "Signing out…", signOut: "Sign out", region: "Your story projects",
    loading: "Loading your story projects…", retry: "Try again", empty: "You have no story projects yet.", list: "Story projects",
    untitled: "Untitled story project", language: "Language", status: "Status", swedish: "Swedish (sv)", english: "English (en)", unspecified: "Not specified",
    count: (count: number) => `Showing ${count} story ${count === 1 ? "project" : "projects"} (up to 50), newest first.`,
    errors: {
      configuration: "Check the development page configuration in the setup guide.", authentication: "Your development session has expired. Please sign in again.",
      network: "The development backend could not be reached. Check that it is running and try again.",
      backend: "The development backend could not load your projects. Please try again.", unexpected: "The development backend returned an unexpected response. Please try again.",
    },
  },
  sv: {
    preview: "Memy · Utvecklingsförhandsvisning", title: "Mina berättelseprojekt", recoveryIntro: "Återställ ditt utvecklingslösenord. Dina berättelseprojekt hålls stängda under återställningen.",
    intro: "Se dina projekt. Sidan är skrivskyddad.", invalid: "Återställningslänken är ogiltig, utgången, redan använd eller kunde inte verifieras. Be Charan om ett nytt återställningsmejl för utvecklingskontot och öppna den senaste länken.",
    complete: "Ditt lösenord har uppdaterats. Logga in med ditt nya lösenord.", signInTitle: "Logga in i utvecklingsmiljön",
    signInNote: "Använd ditt Memy-utvecklingskonto. Inloggningen gäller tills du stänger eller laddar om sidan.",
    email: "E-post", password: "Lösenord", signingIn: "Loggar in…", signIn: "Logga in", back: "Tillbaka till Välkommen",
    signInFailed: "Det gick inte att logga in. Kontrollera uppgifterna för ditt utvecklingskonto och försök igen. Om begäran tog för lång tid behöver du ladda om förhandsvisningen först.",
    signOutFailed: "Utloggningen kunde inte bekräftas. Dina projekt har rensats. Ladda om förhandsvisningen för att rensa sessionen i minnet innan du loggar in igen.",
    reload: "Ladda om för att logga in", refresh: "Uppdatera projekt", signingOut: "Loggar ut…", signOut: "Logga ut", region: "Dina berättelseprojekt",
    loading: "Laddar dina berättelseprojekt…", retry: "Försök igen", empty: "Du har inga berättelseprojekt ännu.", list: "Berättelseprojekt",
    untitled: "Namnlöst berättelseprojekt", language: "Språk", status: "Status", swedish: "Svenska (sv)", english: "Engelska (en)", unspecified: "Inte angiven",
    count: (count: number) => `Visar ${count} berättelseprojekt (högst 50), nyaste först.`,
    errors: {
      configuration: "Kontrollera konfigurationen för utvecklingssidan i installationsguiden.", authentication: "Din utvecklingssession har gått ut. Logga in igen.",
      network: "Utvecklingsservern kunde inte nås. Kontrollera att den körs och försök igen.",
      backend: "Utvecklingsservern kunde inte ladda dina projekt. Försök igen.", unexpected: "Utvecklingsservern gav ett oväntat svar. Försök igen.",
    },
  },
};

type ListState =
  | { phase: "idle" | "loading" | "ready"; projects: StoryProject[] }
  | { phase: "error"; projects: StoryProject[]; kind: keyof typeof copy.en.errors };

export default function MyStoryProjects({ auth, loadProjects, language = "en", onBack, recoveryReturnPath = "/story-projects.html" }: Props) {
  const text = copy[language];
  const [signedIn, setSignedIn] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryState>(() => auth.getRecoveryState());
  const recovering = ["checking", "ready", "finishing", "cleanup-failed"].includes(recovery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [authError, setAuthError] = useState<"signInFailed" | "signOutFailed" | "authentication" | null>(null);
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<ListState>({ phase: "idle", projects: [] });
  const emailInput = useRef<HTMLInputElement>(null);
  const activeRead = useRef<AbortController>();
  const intentionalSignOut = useRef(false);
  const actionEpoch = useRef(0);
  const readEpoch = useRef(0);
  const mounted = useRef(true);

  const clearProjects = useCallback(() => {
    readEpoch.current += 1;
    activeRead.current?.abort();
    setSignedIn(false);
    setList({ phase: "idle", projects: [] });
    setPassword("");
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionEpoch.current += 1; activeRead.current?.abort(); };
  }, []);
  useEffect(() => auth.onSignedOut(() => {
    actionEpoch.current += 1;
    clearProjects(); setEmail("");
    // Our own invalidation and SDK logout may both emit this synchronously.
    // Neither may unlock sign-in while the intentional logout is pending.
    if (!intentionalSignOut.current) { setAuthBusy(false); setAuthError("authentication"); }
  }), [auth, clearProjects]);
  useEffect(() => auth.onRecoveryChange(state => {
    setRecovery(state);
    if (state !== "none") {
      actionEpoch.current += 1;
      clearProjects(); setAuthBusy(false); setAuthError(null);
    }
  }), [auth, clearProjects]);
  useEffect(() => {
    // Wait until inputs are enabled after SDK completion; do not move focus on a language change.
    if (!signedIn && !recovering && !authBusy) emailInput.current?.focus();
  }, [signedIn, authError, recovery, recovering, authBusy]);

  useEffect(() => {
    if (!signedIn || recovery !== "none" || auth.getRecoveryState() !== "none") return;
    const controller = new AbortController();
    activeRead.current = controller;
    const epoch = ++readEpoch.current;
    const current = () => mounted.current && !controller.signal.aborted && epoch === readEpoch.current && auth.getRecoveryState() === "none";
    setList({ phase: "loading", projects: [] });
    loadProjects(controller.signal).then(projects => {
      if (current()) setList({ phase: "ready", projects });
    }).catch(error => {
      if (!current()) return;
      if (error instanceof StoryProjectsError && error.kind === "authentication") {
        auth.invalidateSession?.();
        clearProjects(); setAuthError("authentication");
      } else {
        setList({ phase: "error", projects: [], kind: error instanceof StoryProjectsError ? error.kind : "unexpected" });
      }
    });
    return () => controller.abort();
  }, [signedIn, reload, loadProjects, recovery, auth, clearProjects]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (authBusy) return;
    const epoch = ++actionEpoch.current;
    setAuthBusy(true); setLoggingOut(false); setAuthError(null);
    try {
      await auth.signIn(email.trim(), password);
      if (mounted.current && epoch === actionEpoch.current && auth.getRecoveryState() === "none") setSignedIn(true);
    } catch {
      if (mounted.current && epoch === actionEpoch.current && ["none", "invalid", "complete"].includes(auth.getRecoveryState())) setAuthError("signInFailed");
    } finally {
      if (mounted.current && epoch === actionEpoch.current) { setPassword(""); setAuthBusy(false); }
    }
  }

  async function signOut() {
    if (authBusy) return;
    intentionalSignOut.current = true;
    actionEpoch.current += 1;
    // Clear private UI and cancel reads BEFORE waiting for any SDK/network work.
    setAuthBusy(true); setLoggingOut(true); setAuthError(null);
    clearProjects(); setEmail(""); auth.invalidateSession?.();
    try { await auth.signOut(); }
    catch { if (mounted.current) setAuthError("signOutFailed"); }
    finally {
      intentionalSignOut.current = false;
      if (mounted.current) { setAuthBusy(false); setLoggingOut(false); }
    }
  }

  function back() {
    actionEpoch.current += 1;
    clearProjects(); setEmail(""); auth.invalidateSession?.();
    onBack?.();
  }
  const reloadPath = recoveryReturnPath === "/" ? "/" : "/story-projects.html";

  return (
    <main className="memy-story-projects mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-10 sm:px-6" lang={language}>
      <header className="space-y-2">
        <p className="text-sm font-semibold text-secondary">{text.preview}</p>
        <h1 className="font-serif text-3xl font-bold">{text.title}</h1>
        <p className="text-muted-foreground">{recovering ? text.recoveryIntro : text.intro}</p>
      </header>
      {authError && <div className="space-y-3">
        <p role="alert" className="rounded-lg border border-destructive p-4">{authError === "authentication" ? text.errors.authentication : text[authError]}</p>
        <Button variant="outline" onClick={() => window.location.replace(reloadPath)}>{text.reload}</Button>
      </div>}
      {recovery === "invalid" && <p role="alert" className="rounded-lg border border-destructive p-4">{text.invalid}</p>}
      {recovery === "complete" && <p role="status">{text.complete}</p>}

      {recovering ? <PasswordRecovery auth={auth} state={recovery} language={language} recoveryReturnPath={recoveryReturnPath} /> : !signedIn ? (
        <Card><CardContent className="space-y-4 pt-6">
          <h2 id="sign-in-title" className="text-xl font-semibold">{text.signInTitle}</h2>
          <p className="text-sm text-muted-foreground">{text.signInNote}</p>
          <form aria-labelledby="sign-in-title" onSubmit={signIn} className="space-y-4" aria-busy={authBusy}>
            <div className="space-y-2">
              <Label htmlFor="development-email">{text.email}</Label>
              <Input ref={emailInput} id="development-email" type="email" autoComplete="username" required
                value={email} onChange={event => setEmail(event.target.value)} disabled={authBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="development-password">{text.password}</Label>
              <Input id="development-password" type="password" autoComplete="current-password" required
                value={password} onChange={event => setPassword(event.target.value)} disabled={authBusy} />
            </div>
            <Button type="submit" disabled={authBusy}>{authBusy ? (loggingOut ? text.signingOut : text.signingIn) : text.signIn}</Button>
          </form>
          {onBack && <Button variant="outline" onClick={back} disabled={authBusy}>{text.back}</Button>}
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setReload(value => value + 1)} disabled={list.phase === "loading" || authBusy}>{text.refresh}</Button>
            <Button variant="outline" onClick={signOut} disabled={authBusy}>{authBusy ? text.signingOut : text.signOut}</Button>
          </div>
          <section aria-label={text.region} aria-busy={list.phase === "loading"}>
            {list.phase === "loading" && <p role="status">{text.loading}</p>}
            {list.phase === "error" && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4">
              <p>{text.errors[list.kind]}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{text.retry}</Button>
            </div>}
            {list.phase === "ready" && (list.projects.length === 0 ? <p role="status">{text.empty}</p> : <>
              <p role="status" className="mb-4 text-sm text-muted-foreground">{text.count(list.projects.length)}</p>
              <ul className="space-y-4" aria-label={text.list}>
                {list.projects.map(project => <li key={project.id}>
                  <Card><CardContent className="space-y-3 pt-6">
                    <h2 className="break-words text-xl font-semibold">{project.title || text.untitled}</h2>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <dt className="text-muted-foreground">{text.language}</dt><dd>{project.language === "sv" ? text.swedish : text.english}</dd>
                      <dt className="text-muted-foreground">{text.status}</dt><dd className="break-words">{project.status || text.unspecified}</dd>
                    </dl>
                  </CardContent></Card>
                </li>)}
              </ul></>)}
          </section>
        </>
      )}
    </main>
  );
}
