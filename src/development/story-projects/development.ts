import { createClient } from "@supabase/supabase-js";
import { StoryProjectsError, storyProjectsUrl } from "@/lib/api/story-projects";
import { clearRecoveryRedirect, PasswordRecoveryError, privateAuthFetch, readRecoveryRedirect, type RecoveryState } from "./recovery";

export const DEVELOPMENT_SUPABASE_URL = "https://edbkuunyeyxnyenmmqud.supabase.co";

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
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname)) {
    throw new StoryProjectsError("configuration");
  }
  return { ...config, apiBaseUrl: endpoint.origin };
}

export function readDevelopmentConfig(env: Record<string, unknown>): DevelopmentConfig {
  if (env.DEV !== true || env.MODE !== "story-projects") throw new StoryProjectsError("configuration");
  return validate({
    supabaseUrl: typeof env.VITE_STORY_PROJECTS_SUPABASE_URL === "string" ? env.VITE_STORY_PROJECTS_SUPABASE_URL : "",
    publishableKey: typeof env.VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY === "string" ? env.VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY : "",
    apiBaseUrl: typeof env.VITE_API_BASE_URL === "string" ? env.VITE_API_BASE_URL : "",
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

export function createDevelopmentAuth(settings: DevelopmentConfig): DevelopmentAuth {
  const config = validate(settings);
  const redirect = readRecoveryRedirect();
  let recoveryState: RecoveryState = redirect.attempted ? "checking" : "none";
  let updatingPassword = false;
  const recoveryListeners = new Set<(state: RecoveryState) => void>();
  function setRecoveryState(state: RecoveryState) {
    recoveryState = state;
    recoveryListeners.forEach(listener => listener(state));
  }
  function canProcessRecovery(params: Record<string, string>) {
    return params.type === "recovery" && !params.error && !params.error_code && !params.error_description &&
      isDevelopmentUserToken(params.access_token || "") && Boolean(params.refresh_token) &&
      params.token_type === "bearer" && Number.isFinite(Number(params.expires_in)) && Number(params.expires_in) > 0 &&
      (!params.expires_at || (Number.isFinite(Number(params.expires_at)) && Number(params.expires_at) > Date.now() / 1000));
  }
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false, autoRefreshToken: true, flowType: "implicit", debug: false,
      // This only selects a callback for SDK validation. URL claims NEVER enable the form.
      detectSessionInUrl: (_url, params) => canProcessRecovery(params),
      storageKey: "memy-story-projects-development-only",
    },
    global: { fetch: privateAuthFetch((input, init) => fetch(input, init)) },
  });
  // Synchronous only: SDK callbacks run under its auth lock. Subscribe immediately,
  // before initialization completes, and retain the state for later UI subscribers.
  client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && !["finishing", "complete", "cleanup-failed"].includes(recoveryState)) {
      const valid = session && isDevelopmentUserToken(session.access_token) &&
        session.user?.id && !session.user.is_anonymous && session.expires_at && session.expires_at > Date.now() / 1000;
      setRecoveryState(valid ? "ready" : "invalid");
    } else if (event === "SIGNED_OUT" && recoveryState === "ready") {
      setRecoveryState("invalid");
    }
  });
  void client.auth.initialize().then(({ error }) => {
    clearRecoveryRedirect();
    if (redirect.attempted && (error || !canProcessRecovery(redirect.params))) setRecoveryState("invalid");
  }).catch(() => {
    clearRecoveryRedirect();
    if (redirect.attempted) setRecoveryState("invalid");
  });
  return {
    async signIn(email, password) {
      const initialState = recoveryState;
      if (!["none", "invalid", "complete"].includes(initialState)) throw new Error("Finish password recovery before signing in.");
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data.session || !isDevelopmentUserToken(data.session.access_token) || recoveryState !== initialState) throw new Error();
        setRecoveryState("none");
      } catch {
        throw new Error("Could not sign in. Use an account from the approved development project.");
      }
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new Error("Could not sign out. Please try again.");
    },
    async getAccessToken() {
      if (recoveryState !== "none") return null;
      const result = await client.auth.getSession();
      let session = result.data.session;
      if (result.error || !session) return null;
      if (!session.expires_at || session.expires_at <= Date.now() / 1000) {
        const refreshed = await client.auth.refreshSession();
        if (refreshed.error) return null;
        session = refreshed.data.session;
      }
      return recoveryState === "none" && session?.expires_at && session.expires_at > Date.now() / 1000 &&
        isDevelopmentUserToken(session.access_token) ? session.access_token : null;
    },
    onSignedOut(listener) {
      const { data } = client.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") listener(); });
      return () => data.subscription.unsubscribe();
    },
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
        const { data, error } = await client.auth.updateUser({ password });
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
          const result = await client.auth.signOut({ scope: "local" });
          setRecoveryState(result.error ? "cleanup-failed" : "complete");
        } catch { setRecoveryState("cleanup-failed"); }
      } catch (error) {
        throw error instanceof PasswordRecoveryError ? error : new PasswordRecoveryError("failed");
      } finally { updatingPassword = false; }
    },
  };
}
