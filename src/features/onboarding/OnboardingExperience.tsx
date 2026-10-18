import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { MemoryBookScene } from "./MemoryBookScene";
import { copy, type Language, type Scene } from "./copy";
import { completeIntroduction, hasCompletedIntroduction, isAuthenticationCallback } from "./onboarding-state";

type View = "introduction" | "welcome" | "callback";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return true;
  }
}

export interface OnboardingOptions {
  variant?: "preview" | "application";
  language?: Language;
  onLanguageChange?: (language: Language) => void;
  onLogin?: () => void;
  onRegister?: () => void;
}

export function OnboardingExperience({ variant = "preview", language: chosenLanguage, onLanguageChange, onLogin, onRegister }: OnboardingOptions) {
  const [view, setView] = useState<View>(() => isAuthenticationCallback(window.location)
    ? "callback" : hasCompletedIntroduction() ? "welcome" : "introduction");
  const [scene, setScene] = useState<Scene>(0);
  const [selectedLanguage, setLanguage] = useState<Language>("en");
  const language = chosenLanguage ?? selectedLanguage;
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [motionOff, setMotionOff] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigating = useRef(false);
  const text = copy[language];
  const current = text.scenes[scene];
  const motion = !reducedMotion && !motionOff;

  useLayoutEffect(() => {
    navigating.current = false;
    if (view !== "callback") heading.current?.focus({ preventScroll: true });
  }, [scene, view]);

  useEffect(() => {
    // A callback arriving through history/hash changes also takes precedence.
    // Once exempted, this mounted preview never resumes decorative onboarding.
    const exemptCallback = () => {
      if (isAuthenticationCallback(window.location)) setView("callback");
    };
    window.addEventListener("popstate", exemptCallback);
    window.addEventListener("hashchange", exemptCallback);
    return () => {
      window.removeEventListener("popstate", exemptCallback);
      window.removeEventListener("hashchange", exemptCallback);
    };
  }, []);

  useEffect(() => {
    try {
      const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      if (!media) return;
      const update = () => setReducedMotion(media.matches);
      update();
      if (media.addEventListener) {
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
      }
      media.addListener(update);
      return () => media.removeListener(update);
    } catch {
      setReducedMotion(true);
    }
  }, []);

  function navigate(event: MouseEvent<HTMLButtonElement>, action: () => void) {
    // Ignore the second/third click of a pointer multi-click. A newly mounted
    // Enter button cannot inherit the Next button's activation or keyboard focus.
    if (event.detail > 1 || navigating.current) return;
    if (isAuthenticationCallback(window.location)) {
      setView("callback");
      return;
    }
    navigating.current = true;
    action();
  }

  function finish() {
    setStorageUnavailable(!completeIntroduction());
    setView("welcome");
  }

  if (view === "callback") {
    return <div className="memy-onboarding" lang={language} data-motion="off">
      <main className="onboarding-shell onboarding-main">
        <section className="onboarding-welcome">
          <p className="onboarding-brand">Memy</p>
          <h1 className="onboarding-heading">{text.callbackTitle}</h1>
          <p className="onboarding-description">{text.callbackNote}</p>
        </section>
      </main>
    </div>;
  }

  return <div className="memy-onboarding" lang={language} data-motion={motion ? "on" : "off"}>
    <div className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand">
          <svg width="30" height="32" viewBox="0 0 30 32" aria-hidden="true" focusable="false">
            <path d="M15 27V8M15 15C4 15 3 7 4 3c7 0 11 4 11 12Zm0 7c10 0 12-7 11-12-7 0-11 5-11 12Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <span>Memy</span>
        </div>
        <div className="onboarding-tools">
          <label className="onboarding-language">{text.language}
            <select value={language} onChange={event => {
              const nextLanguage = event.target.value as Language;
              setLanguage(nextLanguage);
              onLanguageChange?.(nextLanguage);
            }}>
              <option value="en" lang="en">English</option>
              <option value="sv" lang="sv">Svenska</option>
            </select>
          </label>
          <button className="onboarding-motion" type="button" role="switch" aria-checked={motion}
            aria-describedby={reducedMotion ? "onboarding-reduced-motion" : undefined}
            disabled={reducedMotion} onClick={() => setMotionOff(value => !value)}>
            {text.animations}<span aria-hidden="true">: {motion ? text.motionOn : text.motionOff}</span>
          </button>
        </div>
      </header>
      {reducedMotion && <p id="onboarding-reduced-motion" className="onboarding-preview-note">{text.reducedMotion}</p>}
      <main className="onboarding-main">
        {variant === "preview" && <span className="onboarding-preview-badge">{text.preview}</span>}
        {view === "introduction" ? <>
          <section className="onboarding-card" aria-labelledby="onboarding-heading">
            <div className="onboarding-copy">
              <p className="onboarding-eyebrow">{current.eyebrow}</p>
              <h1 id="onboarding-heading" className="onboarding-heading" tabIndex={-1} ref={heading}>{current.title}</h1>
              <p className="onboarding-description">{current.description}</p>
              <p className="onboarding-caption">{current.caption}</p>
            </div>
            <div className="onboarding-art">
              <MemoryBookScene scene={scene} language={language} motion={motion} />
              <p className="onboarding-preview-note">{text.illustration}</p>
            </div>
          </section>
          <footer className="onboarding-navigation">
            <div className="onboarding-progress">
              <ol className="onboarding-steps" aria-label={text.progress}>
                {text.scenes.map((step, index) => <li key={index} data-active={index === scene} aria-current={index === scene ? "step" : undefined}>
                  <span className="onboarding-sr-only">{index + 1}. {step.title}</span>
                </li>)}
              </ol>
              <p aria-hidden="true">{scene + 1} {text.of} 3</p>
              <p role="status" aria-live="polite" aria-atomic="true" className="onboarding-sr-only">
                {scene + 1} {text.of} 3 · {current.title}
              </p>
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-button quiet" type="button" onClick={event => navigate(event, finish)}>{text.skip}</button>
              <button className="onboarding-button secondary" type="button" disabled={scene === 0}
                onClick={event => navigate(event, () => setScene(value => Math.max(0, value - 1) as Scene))}>{text.back}</button>
              {scene < 2
                ? <button key={`next-${scene}`} className="onboarding-button primary" type="button"
                  onClick={event => navigate(event, () => setScene(value => Math.min(2, value + 1) as Scene))}>{text.next}<span aria-hidden="true"> →</span></button>
                : <button key="enter" className="onboarding-button primary" type="button"
                  onClick={event => navigate(event, finish)}>{text.enter}<span aria-hidden="true"> →</span></button>}
            </div>
          </footer>
        </> : <section className="onboarding-card onboarding-welcome" aria-labelledby="onboarding-heading">
          <div className="onboarding-copy">
            <p className="onboarding-eyebrow">{text.welcomeEyebrow}</p>
            <h1 id="onboarding-heading" className="onboarding-heading" tabIndex={-1} ref={heading}>{text.welcomeTitle}</h1>
            <p className="onboarding-description">{text.welcomeDescription}</p>
            <p id="onboarding-welcome-note" className="onboarding-preview-note">{onRegister ? text.registrationNote : onLogin ? text.loginNote : variant === "application" ? text.applicationNote : text.previewNote}</p>
            <div className="onboarding-welcome-actions" aria-describedby="onboarding-welcome-note">
              <button className="onboarding-button primary" type="button" disabled={!onLogin}
                onClick={event => navigate(event, () => {
                  // The entrance can stay mounted while login is displayed.
                  // Its scene/view do not change, so release this click guard.
                  navigating.current = false;
                  onLogin?.();
                })}>{text.login}</button>
              <button className="onboarding-button secondary" type="button" disabled={!onRegister}
                onClick={event => navigate(event, () => {
                  navigating.current = false;
                  onRegister?.();
                })}>{text.register}</button>
              <button className="onboarding-button secondary" type="button" disabled>{text.guest}</button>
            </div>
            <button className="onboarding-button quiet" type="button"
              onClick={event => navigate(event, () => { setScene(0); setView("introduction"); })}>{text.replay}</button>
            {storageUnavailable && <p role="status" className="onboarding-storage-note">{text.storageNote}</p>}
          </div>
          <div className="onboarding-art"><MemoryBookScene scene={2} language={language} motion={false} /></div>
        </section>}
      </main>
      <p className="onboarding-caption">{text.footer}</p>
    </div>
  </div>;
}
