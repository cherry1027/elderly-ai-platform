import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StoryProjectsError, type StoryProject } from "@/lib/api/story-projects";
import type { DevelopmentAuth } from "./development";
import PasswordRecovery from "./PasswordRecovery";
import { INVALID_RECOVERY_MESSAGE, type RecoveryState } from "./recovery";

interface Props {
  auth: DevelopmentAuth;
  loadProjects: (signal: AbortSignal) => Promise<StoryProject[]>;
}

type ListState =
  | { phase: "idle" | "loading"; projects: StoryProject[] }
  | { phase: "ready"; projects: StoryProject[] }
  | { phase: "error"; projects: StoryProject[]; message: string };

export default function MyStoryProjects({ auth, loadProjects }: Props) {
  const [signedIn, setSignedIn] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryState>(() => auth.getRecoveryState());
  const recovering = ["checking", "ready", "finishing", "cleanup-failed"].includes(recovery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<ListState>({ phase: "idle", projects: [] });
  const emailInput = useRef<HTMLInputElement>(null);
  const wasSignedIn = useRef(false);

  useEffect(() => auth.onSignedOut(() => {
    setSignedIn(false);
    setList({ phase: "idle", projects: [] });
  }), [auth]);

  useEffect(() => auth.onRecoveryChange(state => {
    setRecovery(state);
    if (state !== "none") {
      setSignedIn(false);
      setList({ phase: "idle", projects: [] });
      setPassword("");
      setAuthMessage(null);
    }
  }), [auth]);

  useEffect(() => {
    if (!signedIn && (authMessage || wasSignedIn.current || recovery === "complete" || recovery === "invalid")) emailInput.current?.focus();
    wasSignedIn.current = signedIn;
  }, [signedIn, authMessage, recovery]);

  useEffect(() => {
    if (!signedIn || recovery !== "none" || auth.getRecoveryState() !== "none") return;
    const controller = new AbortController();
    setList({ phase: "loading", projects: [] });
    loadProjects(controller.signal).then(projects => {
      if (!controller.signal.aborted && auth.getRecoveryState() === "none") setList({ phase: "ready", projects });
    }).catch(error => {
      if (controller.signal.aborted || auth.getRecoveryState() !== "none") return;
      if (error instanceof StoryProjectsError && error.kind === "authentication") {
        setSignedIn(false);
        setList({ phase: "idle", projects: [] });
        setAuthMessage(error.message);
      } else {
        setList({ phase: "error", projects: [], message: error instanceof StoryProjectsError
          ? error.message : "Could not load your projects. Please try again." });
      }
    });
    return () => controller.abort();
  }, [signedIn, reload, loadProjects, recovery, auth]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      await auth.signIn(email.trim(), password);
      if (auth.getRecoveryState() === "none") setSignedIn(true);
    } catch {
      if (["none", "invalid", "complete"].includes(auth.getRecoveryState())) {
        setAuthMessage("Could not sign in. Check your development account details and try again.");
      }
    } finally { setPassword(""); setAuthBusy(false); }
  }

  async function signOut() {
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      await auth.signOut();
      setSignedIn(false);
      setList({ phase: "idle", projects: [] });
    } catch { setAuthMessage("Could not sign out. Please try again."); }
    finally { setAuthBusy(false); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-secondary">Memy · Development preview</p>
        <h1 className="font-serif text-3xl font-bold">My Story Projects</h1>
        <p className="text-muted-foreground">{recovering
          ? "Reset your development password. Your story projects stay closed during recovery."
          : "View your projects. This page is read-only."}</p>
      </header>

      {authMessage && <p role="alert" className="rounded-lg border border-destructive p-4">{authMessage}</p>}
      {recovery === "invalid" && <p role="alert" className="rounded-lg border border-destructive p-4">{INVALID_RECOVERY_MESSAGE}</p>}
      {recovery === "complete" && <p role="status">Your password was updated successfully. Sign in with your new password.</p>}

      {recovering ? <PasswordRecovery auth={auth} state={recovery} /> : !signedIn ? (
        <Card><CardContent className="space-y-4 pt-6">
          <h2 id="sign-in-title" className="text-xl font-semibold">Sign in to development</h2>
          <p className="text-sm text-muted-foreground">Use your Memy development account. Sign-in lasts until you close or reload this page.</p>
          <form aria-labelledby="sign-in-title" onSubmit={signIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="development-email">Email</Label>
              <Input ref={emailInput} id="development-email" type="email" autoComplete="username" required
                value={email} onChange={event => setEmail(event.target.value)} disabled={authBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="development-password">Password</Label>
              <Input id="development-password" type="password" autoComplete="current-password" required
                value={password} onChange={event => setPassword(event.target.value)} disabled={authBusy} />
            </div>
            <Button type="submit" disabled={authBusy}>{authBusy ? "Signing in…" : "Sign in"}</Button>
          </form>
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setReload(value => value + 1)}
              disabled={list.phase === "loading" || authBusy}>Refresh projects</Button>
            <Button variant="outline" onClick={signOut} disabled={authBusy}>{authBusy ? "Signing out…" : "Sign out"}</Button>
          </div>
          <section aria-label="Your story projects" aria-busy={list.phase === "loading"}>
            {list.phase === "loading" && <p role="status">Loading your story projects…</p>}
            {list.phase === "error" && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4">
              <p>{list.message}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Try again</Button>
            </div>}
            {list.phase === "ready" && (list.projects.length === 0
              ? <p role="status">You have no story projects yet.</p>
              : <><p role="status" className="mb-4 text-sm text-muted-foreground">
                Showing {list.projects.length} story {list.projects.length === 1 ? "project" : "projects"} (up to 50), newest first.
                </p>
                <ul className="space-y-4" aria-label="Story projects">
                  {list.projects.map(project => <li key={project.id}>
                    <Card><CardContent className="space-y-3 pt-6">
                      <h2 className="break-words text-xl font-semibold">{project.title || "Untitled story project"}</h2>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <dt className="text-muted-foreground">Language</dt>
                        <dd>{project.language === "sv" ? "Swedish (sv)" : "English (en)"}</dd>
                        <dt className="text-muted-foreground">Status</dt><dd className="break-words">{project.status || "Not specified"}</dd>
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
