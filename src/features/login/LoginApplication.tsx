import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Entrance from "../../entry/Entrance";
import { type Language } from "../onboarding/copy";
import MyStoryProjects from "../../development/story-projects/MyStoryProjects";
import { createLoginRuntime, loginLocation, type LoginRuntime } from "./login-runtime";
import Registration from "./Registration";
import { isConfirmationRedirect } from "./registration-auth";
import styles from "./login.css?inline";

function Authentication({ language, createRuntime, onBack, initialMode, onRegistrationSignIn }: {
  language: Language; createRuntime: () => LoginRuntime; onBack: () => void; initialMode: "login" | "registration";
  onRegistrationSignIn: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [runtime, setRuntime] = useState<LoginRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const failureHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (failed) failureHeading.current?.focus(); }, [failed]);
  useEffect(() => {
    let active: LoginRuntime | undefined;
    try { active = createRuntime(); setRuntime(active); }
    catch { setFailed(true); }
    return () => active?.auth.invalidateSession?.();
  }, [createRuntime]);

  if (failed) return <main>
    <h1 ref={failureHeading} tabIndex={-1}>{language === "sv" ? "Inloggningen behöver utvecklingsinställningar" : "Login needs development settings"}</h1>
    <p role="alert">{language === "sv" ? "Kontrollera de separata utvecklingsinställningarna i guiden. Inga anslutningar har aktiverats." : "Check the separate development settings in the guide. No service connections were enabled."}</p>
    <button type="button" onClick={onBack}>{language === "sv" ? "Tillbaka till Memy" : "Back to Memy"}</button>
  </main>;
  if (!runtime) return <main><p role="status">{language === "sv" ? "Öppnar säker inloggning…" : "Opening safe sign-in…"}</p></main>;
  if (mode === "registration") return <Registration auth={runtime.auth} language={language}
    onSignIn={() => { onRegistrationSignIn(); setMode("login"); }} onBack={onBack} />;
  return <MyStoryProjects auth={runtime.auth} loadProjects={runtime.loadProjects}
    language={language} onBack={onBack} recoveryReturnPath="/" />;
}

export default function LoginApplication({ createRuntime = createLoginRuntime }: { createRuntime?: () => LoginRuntime }) {
  const [view, setView] = useState<"entrance" | "auth" | "registration" | "unsupported">(() => {
    const target = loginLocation(window.location);
    return target === "auth" && isConfirmationRedirect(window.location) ? "registration" : target;
  });
  const [entranceMounted, setEntranceMounted] = useState(() => loginLocation(window.location) === "entrance");
  const [language, setLanguage] = useState<Language>("en");
  const [callbackGeneration, setCallbackGeneration] = useState(0);
  const callbackPending = useRef(loginLocation(window.location) === "auth");
  const entranceRegion = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (view === "entrance") entranceRegion.current?.querySelector<HTMLHeadingElement>("h1")?.focus({ preventScroll: true });
  }, [view]);

  useEffect(() => {
    const onLocation = () => {
      const target = loginLocation(window.location);
      if (target === "unsupported") { setView(target); setEntranceMounted(false); return; }
      if (target !== "auth") { callbackPending.current = false; return; }
      if (callbackPending.current) return;
      callbackPending.current = true;
      // A newly arrived callback needs a fresh SDK initialization. Do not let an
      // existing ordinary session, old list or intro intercept its credentials.
      setEntranceMounted(false);
      setCallbackGeneration(value => value + 1);
      setView(isConfirmationRedirect(window.location) ? "registration" : "auth");
    };
    window.addEventListener("hashchange", onLocation);
    window.addEventListener("popstate", onLocation);
    return () => {
      window.removeEventListener("hashchange", onLocation);
      window.removeEventListener("popstate", onLocation);
    };
  }, []);

  if (view === "unsupported") return <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
    <h1>Memy</h1><p>This page is outside the development login preview. Legacy authentication is not opened here.</p>
  </main>;

  const leaveCallback = () => {
    // Explicitly leaving a callback must remove its route/credentials and allow
    // a subsequent callback to initialize a fresh SDK in this same window.
    if (loginLocation(window.location) === "auth") window.history.replaceState(null, "", "/");
    callbackPending.current = false;
  };
  const back = () => {
    leaveCallback();
    setEntranceMounted(true); setView("entrance");
  };
  return <>
    <style>{styles}</style>
    {entranceMounted && <div ref={entranceRegion} hidden={view !== "entrance"}>
      <Entrance language={language} onLanguageChange={setLanguage} onLogin={() => setView("auth")}
        onRegister={() => setView("registration")} />
    </div>}
    {(view === "auth" || view === "registration") && <div className="memy-login" lang={language}>
      <header className="login-toolbar">
        <span className="login-brand">Memy</span>
        <label>{language === "sv" ? "Språk" : "Language"}
          <select value={language} onChange={event => setLanguage(event.target.value as Language)}>
            <option value="en" lang="en">English</option><option value="sv" lang="sv">Svenska</option>
          </select>
        </label>
      </header>
      <Authentication key={`${callbackGeneration}-${view}`} language={language} createRuntime={createRuntime} onBack={back}
        initialMode={view === "registration" ? "registration" : "login"} onRegistrationSignIn={leaveCallback} />
    </div>}
  </>;
}
