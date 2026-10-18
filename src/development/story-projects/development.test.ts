// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createDevelopmentAuth, DEVELOPMENT_SUPABASE_URL, readDevelopmentConfig } from "./development";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
const env = {
  DEV: true, MODE: "story-projects", VITE_STORY_PROJECTS_SUPABASE_URL: DEVELOPMENT_SUPABASE_URL,
  VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only", VITE_API_BASE_URL: "http://127.0.0.1:8000",
};
const token = (issuer = DEVELOPMENT_SUPABASE_URL, role = "authenticated") =>
  [btoa('{"alg":"HS256"}'), btoa(JSON.stringify({ iss: `${issuer}/auth/v1`, role })), "synthetic-signature"].join(".");
const session = (access_token = token(), expires_at = Date.now() / 1000 + 3600) => ({ access_token, expires_at });
let sdk: {
  signInWithPassword: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>; refreshSession: ReturnType<typeof vi.fn>; onAuthStateChange: ReturnType<typeof vi.fn>;
  initialize: ReturnType<typeof vi.fn>; updateUser: ReturnType<typeof vi.fn>;
};
const unsubscribe = vi.fn();
beforeEach(() => {
  sdk = {
    initialize: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: "synthetic-user" } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe } } }),
  };
  vi.mocked(createClient).mockClear().mockReturnValue({ auth: sdk } as unknown as ReturnType<typeof createClient>);
});

describe("isolated development configuration", () => {
  it("accepts only the dedicated dev settings and normalizes the API URL", () => {
    expect(readDevelopmentConfig({ ...env, VITE_API_BASE_URL: env.VITE_API_BASE_URL + "/api/v1/" })).toEqual({
      supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: env.VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY, apiBaseUrl: env.VITE_API_BASE_URL,
    });
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    { DEV: false }, { MODE: "production" }, { MODE: "development" },
    { VITE_STORY_PROJECTS_SUPABASE_URL: "https://pxejznayegywcctnssxb.supabase.co" },
    { VITE_STORY_PROJECTS_SUPABASE_URL: "" }, { VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: "" },
    { VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic" },
    { VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: "synthetic-service-role-key" },
    { VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: token() },
    { VITE_API_BASE_URL: "https://api.production.example.invalid" },
    { VITE_API_BASE_URL: "http://192.168.1.2:8000" }, { VITE_API_BASE_URL: "http://localhost:5176" }, { VITE_API_BASE_URL: "" },
  ])("fails closed for invalid settings %# before client creation", changes => {
    expect(() => readDevelopmentConfig({ ...env, ...changes })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
  it("never falls back to legacy VITE_SUPABASE settings", () => {
    expect(() => readDevelopmentConfig({ DEV: true, MODE: "story-projects",
      VITE_SUPABASE_URL: DEVELOPMENT_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_legacy" })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
  it("revalidates a configuration passed directly to the factory", () => {
    expect(() => createDevelopmentAuth({ ...readDevelopmentConfig(env), supabaseUrl: "https://legacy.example.invalid" })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("development Supabase auth binding", () => {
  it("uses only the dev project and in-memory auth, selecting only recovery URL tokens", () => {
    createDevelopmentAuth(readDevelopmentConfig(env));
    expect(createClient).toHaveBeenCalledExactlyOnceWith(DEVELOPMENT_SUPABASE_URL, env.VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, flowType: "implicit", debug: false,
        detectSessionInUrl: expect.any(Function), storageKey: "memy-story-projects-development-only" },
      global: { fetch: expect.any(Function) },
    });
  });
  it("signs in directly with the dedicated client and obtains the token through getSession", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    await auth.signIn("synthetic@example.invalid", "synthetic-password");
    expect(sdk.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "synthetic@example.invalid", password: "synthetic-password" });
    expect(await auth.getAccessToken()).toBe(token());
    expect(sdk.getSession).toHaveBeenCalledTimes(1);
  });
  it.each([token("https://pxejznayegywcctnssxb.supabase.co"), token(DEVELOPMENT_SUPABASE_URL, "anon"), token(DEVELOPMENT_SUPABASE_URL, "service_role"), "bad-token"])("does not forward a wrong-project or non-user token %#", async access_token => {
    sdk.getSession.mockResolvedValue({ data: { session: session(access_token) }, error: null });
    expect(await createDevelopmentAuth(readDevelopmentConfig(env)).getAccessToken()).toBeNull();
  });
  it("returns no token for a missing session", async () => {
    sdk.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await createDevelopmentAuth(readDevelopmentConfig(env)).getAccessToken()).toBeNull();
  });
  it("refreshes an expired session through the SDK", async () => {
    sdk.getSession.mockResolvedValue({ data: { session: session(token(), 1) }, error: null });
    expect(await createDevelopmentAuth(readDevelopmentConfig(env)).getAccessToken()).toBe(token());
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });
  it("fails closed if refresh fails or returns an expired token", async () => {
    sdk.getSession.mockResolvedValue({ data: { session: session(token(), 1) }, error: null });
    sdk.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("synthetic-private-error") })
      .mockResolvedValueOnce({ data: { session: session(token(), 1) }, error: null });
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    expect(await auth.getAccessToken()).toBeNull(); expect(await auth.getAccessToken()).toBeNull();
  });
  it("sanitizes sign-in and sign-out errors", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    sdk.signInWithPassword.mockResolvedValue({ data: { session: null }, error: new Error("synthetic-private-error") });
    sdk.signOut.mockResolvedValue({ error: new Error("synthetic-private-error") });
    await expect(auth.signIn("fake", "fake")).rejects.not.toThrow("synthetic-private-error");
    await expect(auth.signOut()).rejects.not.toThrow("synthetic-private-error");
  });
  it("signs out only this development session and unsubscribes its listener", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); const listener = vi.fn();
    const dispose = auth.onSignedOut(listener);
    const callback = sdk.onAuthStateChange.mock.calls[0][0];
    callback("TOKEN_REFRESHED"); expect(listener).not.toHaveBeenCalled();
    callback("SIGNED_OUT"); expect(listener).toHaveBeenCalledTimes(1);
    await auth.signOut(); expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    dispose(); callback("SIGNED_OUT"); expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("recovery authentication boundary", () => {
  function recover(access_token = token(), expires_at = Date.now() / 1000 + 3600) {
    const callback = sdk.onAuthStateChange.mock.calls[0][0];
    return callback("PASSWORD_RECOVERY", { ...session(access_token, expires_at), user: { id: "synthetic-user" } });
  }
  it("synchronously retains a validated recovery event before UI subscription, without SDK calls in the callback", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    expect(recover()).toBeUndefined();
    const listener = vi.fn(); const dispose = auth.onRecoveryChange(listener);
    expect(listener).toHaveBeenLastCalledWith("ready");
    expect(sdk.getSession).not.toHaveBeenCalled(); expect(sdk.updateUser).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled();
    expect(await auth.getAccessToken()).toBeNull();
    await expect(auth.signIn("fake", "fake")).rejects.toThrow("Finish password recovery");
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    dispose(); sdk.onAuthStateChange.mock.calls[0][0]("SIGNED_OUT");
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each([token("https://legacy.example.invalid"), token(DEVELOPMENT_SUPABASE_URL, "anon"), "forged"])("rejects a recovery event with a wrong-project or invalid session %#", async value => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover(value);
    expect(auth.getRecoveryState()).toBe("invalid"); expect(await auth.getAccessToken()).toBeNull();
    await expect(auth.updatePassword("synthetic-new-password")).rejects.toThrow(); expect(sdk.updateUser).not.toHaveBeenCalled();
  });
  it("rejects expired and anonymous recovery sessions", () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover(token(), 1);
    expect(auth.getRecoveryState()).toBe("invalid");
    sdk.onAuthStateChange.mock.calls[0][0]("PASSWORD_RECOVERY", { ...session(), user: { id: "fake", is_anonymous: true } });
    expect(auth.getRecoveryState()).toBe("invalid");
  });
  it("does not treat ordinary SDK events as recovery permission", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    const callback = sdk.onAuthStateChange.mock.calls[0][0];
    callback("INITIAL_SESSION", session()); callback("SIGNED_IN", session()); callback("USER_UPDATED", session());
    expect(auth.getRecoveryState()).toBe("none");
    await expect(auth.updatePassword("synthetic-new-password")).rejects.toThrow(); expect(sdk.updateUser).not.toHaveBeenCalled();
  });
  it("updates only the password, closes the recovery session locally, and requires a fresh password sign-in", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    await auth.updatePassword("synthetic-new-password");
    expect(sdk.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "synthetic-new-password" });
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(auth.getRecoveryState()).toBe("complete"); expect(await auth.getAccessToken()).toBeNull();
    await auth.signIn("fake@example.invalid", "synthetic-new-password");
    expect(auth.getRecoveryState()).toBe("none"); expect(await auth.getAccessToken()).toBe(token());
  });
  it.each(["weak_password", "same_password", "unexpected"])("sanitizes %s errors and keeps project access blocked", async code => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    sdk.updateUser.mockResolvedValue({ data: { user: null }, error: { code, message: "synthetic-private-password-token" } });
    await expect(auth.updatePassword("synthetic-new-password")).rejects.not.toThrow("synthetic-private-password-token");
    expect(auth.getRecoveryState()).toBe("ready"); expect(await auth.getAccessToken()).toBeNull();
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
  it("sanitizes thrown errors and fails closed for an expired recovery session during update", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    sdk.updateUser.mockRejectedValueOnce(new Error("synthetic-private-password-token"));
    await expect(auth.updatePassword("synthetic-new-password")).rejects.not.toThrow("synthetic-private-password-token");
    sdk.updateUser.mockResolvedValue({ data: { user: null }, error: { status: 401, message: "synthetic-private-token" } });
    await expect(auth.updatePassword("synthetic-new-password")).rejects.toThrow("invalid, expired");
    expect(auth.getRecoveryState()).toBe("invalid"); expect(await auth.getAccessToken()).toBeNull();
  });
  it("keeps a failed recovery-session cleanup blocked and does not offer normal sign-in until a full reload", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    sdk.signOut.mockResolvedValue({ error: new Error("synthetic-private-token") });
    await auth.updatePassword("synthetic-new-password");
    expect(auth.getRecoveryState()).toBe("cleanup-failed"); expect(await auth.getAccessToken()).toBeNull();
    await expect(auth.signIn("fake", "fake")).rejects.toThrow();
  });
  it("keeps thrown cleanup errors private after a confirmed password update", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    sdk.signOut.mockRejectedValue(new Error("synthetic-private-token"));
    await auth.updatePassword("synthetic-new-password");
    expect(auth.getRecoveryState()).toBe("cleanup-failed"); expect(await auth.getAccessToken()).toBeNull();
  });
  it("prevents concurrent password updates even when called outside the UI", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env)); recover();
    let resolve!: (value: unknown) => void;
    sdk.updateUser.mockReturnValue(new Promise(done => { resolve = done; }));
    const first = auth.updatePassword("synthetic-new-password");
    await expect(auth.updatePassword("another-synthetic-password")).rejects.toThrow();
    expect(sdk.updateUser).toHaveBeenCalledTimes(1);
    resolve({ data: { user: { id: "synthetic-user" } }, error: null });
    await first; expect(auth.getRecoveryState()).toBe("complete");
  });
  it("blocks a token read or normal sign-in that overlaps a recovery event", async () => {
    const auth = createDevelopmentAuth(readDevelopmentConfig(env));
    const read = auth.getAccessToken(); recover(); expect(await read).toBeNull();
    // A fresh factory represents a new page without recovery.
    const next = createDevelopmentAuth(readDevelopmentConfig(env));
    const login = next.signIn("fake", "fake");
    sdk.onAuthStateChange.mock.calls[1][0]("PASSWORD_RECOVERY", { ...session(), user: { id: "fake" } });
    await expect(login).rejects.toThrow(); expect(next.getRecoveryState()).toBe("ready");
  });
});
