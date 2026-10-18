import { createClient } from "@supabase/supabase-js";
import { StoryProjectsError, storyProjectsUrl } from "@/lib/api/story-projects";
import { clearRecoveryRedirect, PasswordRecoveryError, privateAuthFetch, readRecoveryRedirect, type RecoveryState } from "./recovery";
import { CONFIRMATION_REDIRECT_URL, isConfirmationRedirect, RegistrationError, type ConfirmationState, type RegistrationAuth } from "../../features/login/registration-auth";

export const DEVELOPMENT_SUPABASE_URL = "https://edbkuunyeyxnyenmmqud.supabase.co";
export const AUTH_TIMEOUT_MS = 10_000;

export interface DevelopmentConfig {
  supabaseUrl: string;
  publishableKey: string;
  apiBaseUrl: string;
}

function validate(config: DevelopmentConfig): DevelopmentConfig {
  if (config.supabaseUrl !== DEVELOPMENT_SUPABASE_URL ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
    throw new StoryProjectsError("configuration");
  }
  const endpoint = new URL(storyProjectsUrl(config.apiBaseUrl));
  // There is no approved hosted development API yet. Never send tokens off-machine.
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname) || endpoint.port !== "8000") {
    throw new StoryProjectsError("configuration");
  }
  return { ...config, apiBaseUrl: endpoint.origin };
}

export function readDevelopmentConfig(env: Record<string, unknown>): DevelopmentConfig {
  if (env.DEV !== true || !["story-projects", "login"].includes(String(env.MODE))) throw new StoryProjectsError("configuration");
  const login = env.MODE === "login";
  const url = login ? env.VITE_LOGIN_SUPABASE_URL : env.VITE_STORY_PROJECTS_SUPABASE_URL;
  const key = login ? env.VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY : env.VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY;
  const api = login ? env.VITE_LOGIN_API_BASE_URL : env.VITE_API_BASE_URL;
  return validate({
    supabaseUrl: typeof url === "string" ? url : "",
    publishableKey: typeof key === "string" ? key : "",
    apiBaseUrl: typeof api === "string" ? api : "",
  });
}

export interface DevelopmentAuth {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  onSignedOut(listener: () => void): () => void;
  getRecoveryState(): RecoveryState;
  onRecoveryChange(listener: (state: RecoveryState) => void): () => void;
  updatePassword(password: string): Promise<void>;
  invalidateSession?(): void;
}

function isDevelopmentUserToken(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    // Routing guard only, NOT signature verification or authorization. FastAPI
    // validates the token with Supabase Auth before accessing any user data.
    return claims.iss === `${DEVELOPMENT_SUPABASE_URL}/auth/v1` && claims.role === "authenticated";
  } catch { return false; }
}

export function createDevelopmentAuth(settings: DevelopmentConfig, request: typeof fetch = (input, init) => fetch(input, init)): DevelopmentAuth & RegistrationAuth {
  const config = validate(settings);
  const redirect = readRecoveryRedirect();
  const confirmationRedirect = typeof window !== "undefined" && isConfirmationRedirect();
  let recoveryState: RecoveryState = redirect.attempted && !confirmationRedirect ? "checking" : "none";
  let confirmationState: ConfirmationState = confirmationRedirect ? "checking" : "none";
  let confirmationValidated = false;
  let confirmationSessionSeen = false;
  let resolveConfirmationEvent!: () => void;
  const confirmationEvent = new Promise<void>(resolve => { resolveConfirmationEvent = resolve; });
  const confirmationListeners = new Set<(state: ConfirmationState) => void>();
  let signingUp = false;
  let updatingPassword = false;
  let generation = 0;
  let sessionAllowed = true;
  let reloadRequired = false;
  let signingIn = false;
  const recoveryListeners = new Set<(state: RecoveryState) => void>();
  const signedOutListeners = new Set<() => void>();
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let redirectCleanupPending = redirect.attempted;
  let initializationAbandoned = false;
  function clearOwnRecoveryRedirect() {
    if (!redirectCleanupPending) return;
    redirectCleanupPending = false;
    clearRecoveryRedirect();
  }
  function setRecoveryState(state: RecoveryState) {
    recoveryState = state;
    if (state !== "checking") clearTimeout(recoveryTimer);
    recoveryListeners.forEach(listener => listener(state));
  }
  function setConfirmationState(state: ConfirmationState) {
    confirmationState = state;
    if (state !== "checking") clearTimeout(recoveryTimer);
    confirmationListeners.forEach(listener => listener(state));
  }
  function blockSession() {
    generation++;
    sessionAllowed = false;
    signedOutListeners.forEach(listener => listener());
  }
  function stopAutomaticRefresh() {
    try {
      if (typeof client.auth.stopAutoRefresh === "function") void client.auth.stopAutoRefresh().catch(() => {});
    } catch { /* Cleanup failures must not expose SDK details. */ }
  }
  function invalidateSession() {
    // A disposed instance must never erase a callback belonging to its successor.
    initializationAbandoned = true;
    redirectCleanupPending = false;
    clearTimeout(recoveryTimer);
    resolveConfirmationEvent();
    blockSession();
    // Public invalidation runs outside SDK auth callbacks/locks.
    stopAutomaticRefresh();
  }
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (reloadRequired) throw new Error("Reload this development preview before signing in again.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            // A pending SDK operation cannot reliably be canceled. Never reuse
            // its eventual session after a timeout; a reload discards memory.
            clearOwnRecoveryRedirect();
            reloadRequired = true;
            invalidateSession();
            if (["checking", "ready"].includes(recoveryState)) setRecoveryState("invalid");
            if (confirmationState === "checking") setConfirmationState("invalid");
            reject(new Error("Authentication took too long. Reload this development preview and try again."));
          }, AUTH_TIMEOUT_MS);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }
  function canProcessCallback(params: Record<string, string>, type: "recovery" | "signup") {
    return params.type === type && !params.error && !params.error_code && !params.error_description &&
      isDevelopmentUserToken(params.access_token || "") && Boolean(params.refresh_token) &&
      params.token_type === "bearer" && Number.isFinite(Number(params.expires_in)) && Number(params.expires_in) > 0 &&
      (!params.expires_at || (Number.isFinite(Number(params.expires_at)) && Number(params.expires_at) > Date.now() / 1000));
  }
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false, autoRefreshToken: true, flowType: "implicit", debug: false,
      // This only selects a callback for SDK validation. URL claims NEVER enable the form.
      detectSessionInUrl: (_url, params) => canProcessCallback(params, confirmationRedirect ? "signup" : "recovery"),
      storageKey: "memy-story-projects-development-only",
    },
    global: { fetch: privateAuthFetch(request, {
      authOrigin: DEVELOPMENT_SUPABASE_URL, timeoutMs: AUTH_TIMEOUT_MS, allowRequest: () => !reloadRequired,
      sessionGeneration: () => generation,
      allowSignUp: () => signingUp,
    }) },
  });
  // Synchronous only: SDK callbacks run under its auth lock. Subscribe immediately,
  // before initialization completes, and retain the state for later UI subscribers.
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && confirmationState === "checking" && !initializationAbandoned && !reloadRequired) {
      // The SDK has fetched this user from Auth. A URL claim alone cannot reach
      // this branch. Cleanup runs after initialization, outside the auth lock.
      confirmationValidated = Boolean(session && isDevelopmentUserToken(session.access_token) &&
        session.user?.id && session.user.is_anonymous === false && session.user.email_confirmed_at &&
        session.expires_at && session.expires_at > Date.now() / 1000);
      confirmationSessionSeen = Boolean(session);
      resolveConfirmationEvent();
    } else if (event === "PASSWORD_RECOVERY" && !confirmationRedirect && !initializationAbandoned && !reloadRequired && !["finishing", "complete", "cleanup-failed"].includes(recoveryState)) {
      blockSession();
      const valid = session && isDevelopmentUserToken(session.access_token) &&
        session.user?.id && !session.user.is_anonymous && session.expires_at && session.expires_at > Date.now() / 1000;
      setRecoveryState(valid ? "ready" : "invalid");
    } else if (event === "SIGNED_OUT") {
      blockSession();
      if (recoveryState === "ready") setRecoveryState("invalid");
    }
  });
  if (confirmationRedirect) sessionAllowed = false;
  if (redirect.attempted || confirmationRedirect) recoveryTimer = setTimeout(() => {
    clearOwnRecoveryRedirect();
    reloadRequired = true;
    invalidateSession();
    if (confirmationRedirect) setConfirmationState("invalid");
    else setRecoveryState("invalid");
  }, AUTH_TIMEOUT_MS);
  const sdkInitialization = client.auth.initialize();
  const stopAbandonedInitialization = () => {
    // The SDK's initialization finally block can recreate its visibility
    // listener/ticker after an earlier stop. Observe the real promise too.
    if (initializationAbandoned) stopAutomaticRefresh();
  };
  void sdkInitialization.then(stopAbandonedInitialization, stopAbandonedInitialization);
  const initialization = bounded(() => sdkInitialization).then(async ({ error }) => {
    clearOwnRecoveryRedirect();
    if (initializationAbandoned || reloadRequired) {
      if (recoveryState === "checking") setRecoveryState("invalid");
      if (confirmationState === "checking") setConfirmationState("invalid");
      return;
    }
    if (error) sessionAllowed = false;
    if (confirmationRedirect) {
      sessionAllowed = false;
      // Even an invalid/unconfirmed SDK session must never be reused for projects.
      if (error || !canProcessCallback(redirect.params, "signup")) {
        setConfirmationState("invalid");
        return;
      }
      try {
        // auth-js emits its URL SIGNED_IN event on a later task. Wait for that
        // validated event without calling asynchronous SDK methods in it.
        await bounded(() => confirmationEvent);
        if (initializationAbandoned || reloadRequired) throw new Error();
        if (confirmationSessionSeen) {
          const result = await bounded(() => client.auth.signOut({ scope: "local" }));
          if (result.error || initializationAbandoned || reloadRequired) throw new Error();
        }
        setConfirmationState(confirmationValidated ? "complete" : "invalid");
      } catch {
        reloadRequired = true;
        invalidateSession();
        setConfirmationState("cleanup-failed");
      }
    } else if (redirect.attempted && (error || !canProcessCallback(redirect.params, "recovery"))) setRecoveryState("invalid");
  }).catch(() => {
    sessionAllowed = false;
    clearOwnRecoveryRedirect();
    if (confirmationRedirect) setConfirmationState("invalid");
    else if (redirect.attempted) setRecoveryState("invalid");
  });
  return {
    getConfirmationState: () => confirmationState,
    onConfirmationChange(listener) {
      confirmationListeners.add(listener);
      listener(confirmationState);
      return () => { confirmationListeners.delete(listener); };
    },
    async signUp(email, password) {
      if (typeof window === "undefined" || !["http://127.0.0.1:5173", "http://localhost:5173"].includes(window.location.origin)) throw new RegistrationError("configuration");
      if (signingUp || signingIn || reloadRequired || recoveryState !== "none" || confirmationState !== "none") throw new RegistrationError("failed");
      signingUp = true;
      sessionAllowed = false;
      const attempt = ++generation;
      try {
        const { data, error } = await bounded(async () => {
          await initialization;
          if (reloadRequired || initializationAbandoned || attempt !== generation) throw new Error();
          return client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: CONFIRMATION_REDIRECT_URL } });
        });
        if (reloadRequired || initializationAbandoned || attempt !== generation) throw new Error();
        if (data.session) {
          // Confirmation may be disabled in the project. Never accept this
          // session as an ordinary login, regardless of what the SDK emitted.
          try {
            const cleanup = await bounded(() => client.auth.signOut({ scope: "local" }));
            if (cleanup.error) throw new Error();
          } catch {
            reloadRequired = true;
            invalidateSession();
            setConfirmationState("cleanup-failed");
            throw new RegistrationError("cleanup");
          }
          throw new RegistrationError("configuration");
        }
        if (error) {
          // Auth may obfuscate existing accounts as success or return a code.
          // Both outcomes get the identical Check Your Email screen.
          if (["user_already_exists", "email_exists"].includes(error.code || "")) return;
          if (error.code === "weak_password") throw new RegistrationError("weak");
          if (error.code === "email_address_invalid") throw new RegistrationError("invalid-email");
          if (error.status === 429 || ["over_request_rate_limit", "over_email_send_rate_limit"].includes(error.code || "")) throw new RegistrationError("rate-limit");
          throw new RegistrationError("failed");
        }
      } catch (error) {
        throw error instanceof RegistrationError ? error : new RegistrationError(reloadRequired ? "timeout" : "failed");
      } finally { signingUp = false; }
    },
    async signIn(email, password) {
      const initialState = recoveryState;
      if (signingIn || signingUp || ["checking", "cleanup-failed"].includes(confirmationState) || !["none", "invalid", "complete"].includes(initialState)) throw new Error("Finish password recovery before signing in.");
      signingIn = true;
      sessionAllowed = false;
      const attempt = ++generation;
      try {
        const { data, error } = await bounded(async () => {
          await initialization;
          if (reloadRequired || attempt !== generation) throw new Error();
          return client.auth.signInWithPassword({ email, password });
        });
        if (error || !data.session || !isDevelopmentUserToken(data.session.access_token) || recoveryState !== initialState || attempt !== generation || reloadRequired) throw new Error();
        setRecoveryState("none");
        setConfirmationState("none");
        sessionAllowed = true;
        if (typeof client.auth.startAutoRefresh === "function") void client.auth.startAutoRefresh().catch(() => {});
      } catch {
        throw new Error("Could not sign in. Check your development account or reload the preview and try again.");
      } finally { signingIn = false; }
    },
    async signOut() {
      invalidateSession();
      if (signingIn || signingUp) reloadRequired = true;
      try {
        const { error } = await bounded(() => client.auth.signOut({ scope: "local" }));
        if (error) throw new Error();
      } catch {
        reloadRequired = true;
        throw new Error("Your projects are hidden. Reload this preview to clear the session before signing in again.");
      }
    },
    async getAccessToken() {
      if (confirmationState !== "none" || signingUp || recoveryState !== "none" || !sessionAllowed || reloadRequired) return null;
      const attempt = generation;
      try {
        const session = await bounded(async () => {
          await initialization;
          if (!sessionAllowed || attempt !== generation || recoveryState !== "none") return null;
          const result = await client.auth.getSession();
          if (result.error || !result.data.session) return null;
          if (!result.data.session.expires_at || result.data.session.expires_at <= Date.now() / 1000) {
            if (!sessionAllowed || attempt !== generation || recoveryState !== "none") return null;
            const refreshed = await client.auth.refreshSession();
            return refreshed.error ? null : refreshed.data.session;
          }
          return result.data.session;
        });
        return recoveryState === "none" && sessionAllowed && !reloadRequired && attempt === generation &&
          session?.expires_at && session.expires_at > Date.now() / 1000 && isDevelopmentUserToken(session.access_token)
          ? session.access_token : null;
      } catch { return null; }
    },
    onSignedOut(listener) {
      signedOutListeners.add(listener);
      return () => { signedOutListeners.delete(listener); };
    },
    invalidateSession,
    getRecoveryState: () => recoveryState,
    onRecoveryChange(listener) {
      recoveryListeners.add(listener);
      listener(recoveryState);
      return () => { recoveryListeners.delete(listener); };
    },
    async updatePassword(password) {
      if (recoveryState !== "ready" || updatingPassword) throw new PasswordRecoveryError("invalid");
      updatingPassword = true;
      try {
        const { data, error } = await bounded(() => client.auth.updateUser({ password }));
        if (error) {
          if (error.code === "weak_password") throw new PasswordRecoveryError("weak");
          if (error.code === "same_password") throw new PasswordRecoveryError("same");
          if (error.status === 401 || error.status === 403 || error.name === "AuthSessionMissingError") {
            setRecoveryState("invalid");
            throw new PasswordRecoveryError("invalid");
          }
          throw new PasswordRecoveryError("failed");
        }
        if (!data.user || recoveryState !== "ready") throw new PasswordRecoveryError("invalid");
        setRecoveryState("finishing");
        // Never allow the recovery session to become a normal project session.
        try {
          const result = await bounded(() => client.auth.signOut({ scope: "local" }));
          setRecoveryState(result.error ? "cleanup-failed" : "complete");
        } catch { setRecoveryState("cleanup-failed"); }
      } catch (error) {
        throw error instanceof PasswordRecoveryError ? error : new PasswordRecoveryError("failed");
      } finally { updatingPassword = false; }
    },
  };
}
