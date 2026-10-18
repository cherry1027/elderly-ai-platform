// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import { AUTH_TIMEOUT_MS, createDevelopmentAuth, DEVELOPMENT_SUPABASE_URL, readDevelopmentConfig } from "./development";
import { clearRecoveryRedirect, privateAuthFetch, readRecoveryRedirect } from "./recovery";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
const token = [btoa('{"alg":"HS256"}'), btoa(JSON.stringify({ iss: `${DEVELOPMENT_SUPABASE_URL}/auth/v1`, role: "authenticated" })), "synthetic"].join(".");
const session = () => ({ access_token: token, expires_at: Date.now() / 1000 + 3600, user: { id: "synthetic-user", is_anonymous: false } });
const config = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: "sb_publishable_synthetic_only", apiBaseUrl: "http://127.0.0.1:8000" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let sdk: Record<"initialize" | "signInWithPassword" | "signOut" | "getSession" | "refreshSession" | "onAuthStateChange" | "updateUser" | "stopAutoRefresh" | "startAutoRefresh", ReturnType<typeof vi.fn>>;
beforeEach(() => {
  sdk = {
    initialize: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: "synthetic-user" } }, error: null }),
    stopAutoRefresh: vi.fn().mockResolvedValue(undefined),
    startAutoRefresh: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(createClient).mockReset().mockReturnValue({ auth: sdk } as unknown as ReturnType<typeof createClient>);
});
afterEach(() => vi.useRealTimers());

describe("login-only development configuration", () => {
  const env = { DEV: true, MODE: "login", VITE_LOGIN_SUPABASE_URL: config.supabaseUrl,
    VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, VITE_LOGIN_API_BASE_URL: config.apiBaseUrl };
  it("accepts the explicit login settings and optional API prefix", () => {
    expect(readDevelopmentConfig({ ...env, VITE_LOGIN_API_BASE_URL: `${config.apiBaseUrl}/api/v1/` })).toEqual(config);
  });
  it.each([
    { VITE_LOGIN_SUPABASE_URL: "https://legacy.example.invalid" },
    { VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic" },
    { VITE_LOGIN_API_BASE_URL: "http://127.0.0.1:5176" },
    { VITE_LOGIN_API_BASE_URL: "http://192.168.1.2:8000" },
    { MODE: "production" }, { DEV: false },
  ])("rejects unsafe login configuration %#", changes => {
    expect(() => readDevelopmentConfig({ ...env, ...changes })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
  it("does not fall back to old story or legacy environment names in login mode", () => {
    expect(() => readDevelopmentConfig({ DEV: true, MODE: "login", VITE_STORY_PROJECTS_SUPABASE_URL: config.supabaseUrl,
      VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY: config.publishableKey, VITE_API_BASE_URL: config.apiBaseUrl,
      VITE_SUPABASE_URL: config.supabaseUrl })).toThrow();
  });
});

describe("ordinary URL parameters", () => {
  it.each(["?type=book#chapter", "?utm_source=review#chapter", "?language=sv"])("does not misclassify or erase %s", suffix => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { href: `http://127.0.0.1:5173/${suffix}` }, history: { replaceState },
    } });
    try {
      expect(readRecoveryRedirect().attempted).toBe(false);
      clearRecoveryRedirect(); expect(replaceState).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});

describe("initialization owns only its original recovery URL", () => {
  it("stops SDK refresh again when abandoned raw initialization eventually settles", async () => {
    const pending = deferred<{ error: null }>(); sdk.initialize.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    auth.invalidateSession?.();
    expect(sdk.stopAutoRefresh).toHaveBeenCalledOnce();
    pending.resolve({ error: null });
    await waitFor(() => expect(sdk.stopAutoRefresh).toHaveBeenCalledTimes(2));
  });
  it("does not scrub a new callback when an ordinary initialization completes late", async () => {
    const pending = deferred<{ error: null }>(); sdk.initialize.mockReturnValue(pending.promise);
    createDevelopmentAuth(config);
    window.history.replaceState(null, "", "/#type=recovery&access_token=new-synthetic-callback");
    pending.resolve({ error: null });
    await waitFor(() => expect(window.location.hash).toContain("new-synthetic-callback"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.location.hash).toContain("new-synthetic-callback");
  });
  it("abandons its cleanup and recovery timer on public invalidation", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/#type=recovery&access_token=old-synthetic-callback");
    const pending = deferred<{ error: null }>(); sdk.initialize.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    auth.invalidateSession?.();
    sdk.onAuthStateChange.mock.calls[0][0]("PASSWORD_RECOVERY", session());
    expect(auth.getRecoveryState()).not.toBe("ready");
    window.history.replaceState(null, "", "/#type=recovery&access_token=new-synthetic-callback");
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    pending.resolve({ error: null }); await Promise.resolve(); await Promise.resolve();
    expect(window.location.hash).toContain("new-synthetic-callback");
  });
  it("prevents the actual SDK's abandoned recovery HTTP from clearing a newer callback", async () => {
    const { createClient: actualCreateClient } = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    const clients: ReturnType<typeof actualCreateClient>[] = [];
    vi.mocked(createClient).mockImplementation((url, key, options) => {
      const client = actualCreateClient(url, key, options);
      clients.push(client);
      return client;
    });
    const old = new URLSearchParams({ type: "recovery", access_token: token, refresh_token: "old-synthetic-refresh",
      token_type: "bearer", expires_in: "3600" });
    window.history.replaceState(null, "", `/#${old}`);
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const auth = createDevelopmentAuth(config, transport);
      await waitFor(() => expect(transport).toHaveBeenCalledOnce());
      auth.invalidateSession?.();
      window.history.replaceState(null, "", "/#type=recovery&access_token=new-synthetic-callback");
      pending.resolve(new Response(JSON.stringify({ id: "synthetic-user", is_anonymous: false }), { status: 200 }));
      await waitFor(() => expect(auth.getRecoveryState()).toBe("invalid"));
      expect(window.location.hash).toContain("new-synthetic-callback");
      expect(await auth.getAccessToken()).toBeNull();
      expect(transport).toHaveBeenCalledOnce();
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("old-synthetic-refresh");
    } finally {
      for (const client of clients) await client.auth.stopAutoRefresh();
    }
  });
});

describe("bounded SDK operations and abandoned-session fencing", () => {
  it("allows fresh sign-in after successful logout and restarts SDK refresh", async () => {
    const auth = createDevelopmentAuth(config);
    await auth.signOut();
    expect(await auth.getAccessToken()).toBeNull();
    await auth.signIn("fake@example.invalid", "fake");
    expect(await auth.getAccessToken()).toBe(token);
    expect(sdk.startAutoRefresh).toHaveBeenCalledOnce();
  });
  it("times out initialization and ignores a late recovery event", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ error: null }>(); sdk.initialize.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    const attempt = expect(auth.signIn("fake@example.invalid", "synthetic-private-password")).rejects.toThrow("Could not sign in");
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); await attempt;
    pending.resolve({ error: null });
    sdk.onAuthStateChange.mock.calls[0][0]("PASSWORD_RECOVERY", session());
    expect(auth.getRecoveryState()).not.toBe("ready");
    expect(await auth.getAccessToken()).toBeNull();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });
  it("does not expose a session from a sign-in completing after its timeout", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ data: { session: ReturnType<typeof session> }; error: null }>();
    sdk.signInWithPassword.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    const attempt = expect(auth.signIn("fake@example.invalid", "synthetic-private-password")).rejects.toThrow("Could not sign in");
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); await attempt;
    pending.resolve({ data: { session: session() }, error: null }); await Promise.resolve();
    expect(await auth.getAccessToken()).toBeNull();
    await expect(auth.signIn("fake@example.invalid", "fake")).rejects.toThrow();
    expect(sdk.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(sdk.stopAutoRefresh).toHaveBeenCalled();
  });
  it.each(["getSession", "refreshSession"] as const)("bounds a hanging %s and blocks its eventual token", async method => {
    vi.useFakeTimers();
    const pending = deferred<{ data: { session: ReturnType<typeof session> }; error: null }>();
    if (method === "refreshSession") sdk.getSession.mockResolvedValue({ data: { session: { ...session(), expires_at: 1 } }, error: null });
    sdk[method].mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    const read = auth.getAccessToken();
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); expect(await read).toBeNull();
    pending.resolve({ data: { session: session() }, error: null }); await Promise.resolve();
    expect(await auth.getAccessToken()).toBeNull();
  });
  it("invalidates synchronously before a failed sign-out and requires reload", async () => {
    sdk.signOut.mockResolvedValue({ error: new Error("synthetic-private-token") });
    const auth = createDevelopmentAuth(config); const listener = vi.fn();
    auth.onSignedOut(listener);
    expect(await auth.getAccessToken()).toBe(token);
    const attempt = auth.signOut();
    expect(listener).toHaveBeenCalledOnce();
    expect(await auth.getAccessToken()).toBeNull();
    await expect(attempt).rejects.toThrow("projects are hidden");
    await expect(auth.signIn("fake@example.invalid", "fake")).rejects.toThrow();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });
  it("bounds sign-out even when the SDK never settles", async () => {
    vi.useFakeTimers(); sdk.signOut.mockReturnValue(new Promise(() => {}));
    const auth = createDevelopmentAuth(config);
    const attempt = expect(auth.signOut()).rejects.toThrow("projects are hidden");
    expect(await auth.getAccessToken()).toBeNull();
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); await attempt;
  });
  it("prevents a pending token read surviving explicit local invalidation", async () => {
    const pending = deferred<{ data: { session: ReturnType<typeof session> }; error: null }>();
    sdk.getSession.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config); const read = auth.getAccessToken();
    auth.invalidateSession?.(); pending.resolve({ data: { session: session() }, error: null });
    expect(await read).toBeNull(); expect(await auth.getAccessToken()).toBeNull();
  });
  it("bounds password updates and never promotes a late recovery result into project access", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ data: { user: { id: string } }; error: null }>();
    sdk.updateUser.mockReturnValue(pending.promise);
    const auth = createDevelopmentAuth(config);
    sdk.onAuthStateChange.mock.calls[0][0]("PASSWORD_RECOVERY", session());
    const update = expect(auth.updatePassword("synthetic-private-password")).rejects.toMatchObject({ kind: "failed" });
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); await update;
    pending.resolve({ data: { user: { id: "synthetic-user" } }, error: null }); await Promise.resolve();
    expect(auth.getRecoveryState()).toBe("invalid"); expect(await auth.getAccessToken()).toBeNull();
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
  it("keeps SDK callbacks synchronous and performs no SDK operations inside them", () => {
    const auth = createDevelopmentAuth(config);
    const callback = sdk.onAuthStateChange.mock.calls[0][0];
    expect(callback("PASSWORD_RECOVERY", session())).toBeUndefined();
    expect(callback("SIGNED_OUT")).toBeUndefined();
    expect(auth.getRecoveryState()).toBe("invalid");
    expect(sdk.stopAutoRefresh).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled(); expect(sdk.getSession).not.toHaveBeenCalled();
  });
});

describe("approved Auth transport boundary", () => {
  it.each([
    ["https://legacy.example.invalid/auth/v1/token", "POST"],
    [`${DEVELOPMENT_SUPABASE_URL}/rest/v1/story_projects`, "GET"],
    [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`, "POST"],
    [`${DEVELOPMENT_SUPABASE_URL}/auth/v1/logout?scope=global`, "POST"],
  ])("blocks unapproved transport target %s", async (url, method) => {
    const request = vi.fn<typeof fetch>();
    const response = await privateAuthFetch(request, { authOrigin: DEVELOPMENT_SUPABASE_URL, timeoutMs: AUTH_TIMEOUT_MS })(url, { method });
    expect(response.status).toBe(400); expect(request).not.toHaveBeenCalled();
  });
  it("uses uncached, cookie-free, redirect-free Auth fetch with an abort signal", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    await privateAuthFetch(request, { authOrigin: DEVELOPMENT_SUPABASE_URL, timeoutMs: AUTH_TIMEOUT_MS })(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST" });
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      credentials: "omit", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    }));
  });
  it.each(["headers", "body"])("times out hanging Auth response %s without leaking credentials", async phase => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation((_url, _init) => phase === "headers"
      ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream())));
    const response = privateAuthFetch(request, { authOrigin: DEVELOPMENT_SUPABASE_URL, timeoutMs: AUTH_TIMEOUT_MS })(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`);
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    expect((await response).status).toBe(408);
    expect(await (await response).text()).toBe('{"error_code":"unexpected_failure","msg":"Development authentication request failed."}');
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("blocks background requests after a session is abandoned", async () => {
    const request = vi.fn<typeof fetch>();
    const response = await privateAuthFetch(request, { authOrigin: DEVELOPMENT_SUPABASE_URL, allowRequest: () => false })(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST" });
    expect(response.status).toBe(400); expect(request).not.toHaveBeenCalled();
  });
});
