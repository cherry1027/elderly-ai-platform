// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import { AUTH_TIMEOUT_MS, createDevelopmentAuth, DEVELOPMENT_SUPABASE_URL } from "./development";

// Exercise the installed SDK, including its real redirect/session processing,
// while every HTTP response comes from an injected synthetic transport.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const config = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: "sb_publishable_synthetic_only", apiBaseUrl: "http://127.0.0.1:8000" };
const email = "synthetic-registration@example.invalid";
const password = "synthetic-private-registration-password";
const refreshToken = "synthetic-private-registration-refresh";
const accessTokens = new Set<string>();
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email,
  is_anonymous: false, email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [{ provider: "email" }] };
function jwt(origin = DEVELOPMENT_SUPABASE_URL) {
  const value = [btoa('{"alg":"HS256"}'), btoa(JSON.stringify({ iss: `${origin}/auth/v1`, sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })), "synthetic"].join(".");
  accessTokens.add(value);
  return value;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function session() {
  return { access_token: jwt(), refresh_token: refreshToken, token_type: "bearer", expires_in: 3600, user };
}
function callback(changes: Record<string, string> = {}) {
  const parameters = new URLSearchParams({ type: "signup", access_token: jwt(), refresh_token: refreshToken,
    token_type: "bearer", expires_in: "3600", ...changes });
  window.history.replaceState(null, "", `/auth/callback#${parameters}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function pathname(input: Parameters<typeof fetch>[0]) {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
}
type Auth = ReturnType<typeof createDevelopmentAuth>;
let clients: ReturnType<typeof createClient>[];
let adapters: Auth[];
let logs: ReturnType<typeof vi.spyOn>[];
function auth(transport: typeof fetch) {
  const adapter = createDevelopmentAuth(config, transport);
  adapters.push(adapter);
  return adapter;
}

beforeEach(async () => {
  window.history.replaceState(null, "", "/");
  clients = [];
  adapters = [];
  // Repeated isolated clients trigger the SDK's harmless instance-count warning.
  // Capture every diagnostic so credentials cannot silently leak in error paths.
  logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
  for (const log of logs) log.mockImplementation(() => {});
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  vi.mocked(createClient).mockReset().mockImplementation((url, key, options) => {
    const client = actual.createClient(url, key, options);
    clients.push(client);
    return client;
  });
});
afterEach(async () => {
  for (const adapter of adapters) adapter.invalidateSession?.();
  for (const client of clients) await client.auth.stopAutoRefresh();
  vi.useRealTimers();
  const output = JSON.stringify(logs.map(log => log.mock.calls));
  for (const privateValue of [email, password, refreshToken, config.publishableKey, ...accessTokens]) expect(output).not.toContain(privateValue);
});

describe("real SDK registration with synthetic HTTP only", () => {
  it("requests confirmation without enabling a project token or retaining a password", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(user));
    const adapter = auth(transport);
    await adapter.signUp(email, password);
    expect(transport).toHaveBeenCalledOnce();
    const [target, options] = transport.mock.calls[0];
    expect(pathname(target)).toBe("/auth/v1/signup");
    const url = new URL(String(target));
    expect(url.origin).toBe(DEVELOPMENT_SUPABASE_URL);
    expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:5173/auth/callback");
    expect(JSON.parse(String(options?.body))).toMatchObject({ email, password });
    expect(options).toMatchObject({ method: "POST", cache: "no-store", credentials: "omit", redirect: "error" });
    expect(await adapter.getAccessToken()).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("treats an obfuscated existing-account response like any confirmation-required success", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ ...user, identities: [] }));
    const adapter = auth(transport);
    await expect(adapter.signUp(email, password)).resolves.toBeUndefined();
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each(["user_already_exists", "email_exists"])("does not reveal an existing account through the %s error", async code => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ code, msg: `${email} ${password}` }, 422));
    const adapter = auth(transport);
    await expect(adapter.signUp(email, password)).resolves.toBeUndefined();
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    ["weak_password", "weak"],
    ["over_request_rate_limit", "rate-limit"],
    ["over_email_send_rate_limit", "rate-limit"],
    ["unexpected-provider-code", "failed"],
  ])("maps %s to a credential-free %s error", async (code, kind) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ code, msg: `${email} ${password} ${refreshToken}` }, 422));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = auth(transport);
    let caught: unknown;
    try { await adapter.signUp(email, password); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ kind });
    const output = `${String(caught)} ${JSON.stringify(errorLog.mock.calls)}`;
    for (const privateValue of [email, password, refreshToken]) expect(output).not.toContain(privateValue);
    expect(await adapter.getAccessToken()).toBeNull();
  });

  it("rejects an unexpected immediate signup session and clears it locally", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(
      pathname(input) === "/auth/v1/signup" ? json(session()) : new Response(null, { status: 204 })));
    const adapter = auth(transport);
    await expect(adapter.signUp(email, password)).rejects.toMatchObject({ kind: "configuration" });
    expect(await adapter.getAccessToken()).toBeNull();
    const logout = transport.mock.calls.find(([input]) => pathname(input) === "/auth/v1/logout");
    expect(logout).toBeDefined();
    expect(new URL(String(logout?.[0])).searchParams.get("scope")).toBe("local");
    expect(transport.mock.calls.some(([input]) => pathname(input).startsWith("/rest/"))).toBe(false);
  });

  it("sanitizes a rejected network request without retrying signup or enabling projects", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error(`${email} ${password} ${refreshToken}`));
    const adapter = auth(transport);
    await expect(adapter.signUp(email, password)).rejects.toMatchObject({ kind: "failed" });
    expect(transport).toHaveBeenCalledOnce();
    expect(await adapter.getAccessToken()).toBeNull();
  });

  it("does not allow signup HTTP outside an explicit registration operation", async () => {
    const transport = vi.fn<typeof fetch>();
    const adapter = auth(transport);
    // Test the actual configured SDK transport rather than a source assertion.
    const options = vi.mocked(createClient).mock.calls.at(-1)?.[2];
    const guarded = options?.global?.fetch;
    expect(guarded).toBeDefined();
    const rejected = await guarded!(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/signup`, { method: "POST" });
    expect(rejected.status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
    expect(await adapter.getAccessToken()).toBeNull();
  });

  it("requires reload when an unexpected signup session cannot be cleared", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(
      pathname(input) === "/auth/v1/signup" ? json(session()) : json({ code: "unexpected_failure" }, 500)));
    const adapter = auth(transport);
    await expect(adapter.signUp(email, password)).rejects.toMatchObject({ kind: "cleanup" });
    expect(adapter.getConfirmationState()).toBe("cleanup-failed");
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signIn(email, password)).rejects.toThrow();
  });

  it("fences a late signup response after its timeout", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const adapter = auth(transport);
    const attempted = expect(adapter.signUp(email, password)).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    await attempted;
    pending.resolve(json(session()));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signIn(email, password)).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("blocks token reads and overlapping signup while signup HTTP is pending", async () => {
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const adapter = auth(transport);
    const attempted = adapter.signUp(email, password);
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signUp(email, password)).rejects.toThrow();
    pending.resolve(json(user));
    await attempted;
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each(["https://unapproved.example.invalid", "http://192.168.1.2:5173", "http://127.0.0.1:8080"])("blocks signup outside the reviewed loopback preview origin: %s", async origin => {
    const transport = vi.fn<typeof fetch>();
    const adapter = auth(transport);
    expect(await adapter.getAccessToken()).toBeNull();
    const originalWindow = window;
    vi.stubGlobal("window", { location: new URL(origin) });
    try {
      await expect(adapter.signUp(email, password)).rejects.toMatchObject({ kind: "configuration" });
      expect(transport).not.toHaveBeenCalled();
    } finally { vi.stubGlobal("window", originalWindow); }
  });
});

describe("actual SDK signup confirmation validation and session cleanup", () => {
  it("validates the callback via Auth, signs out locally, and requires fresh password sign-in", async () => {
    callback();
    const transport = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(
      pathname(input) === "/auth/v1/user" ? json(user) :
      pathname(input) === "/auth/v1/token" ? json(session()) : new Response(null, { status: 204 })));
    const adapter = auth(transport);
    const listener = vi.fn();
    adapter.onConfirmationChange(listener);
    expect(await adapter.getAccessToken()).toBeNull();
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("complete"));
    expect(transport.mock.calls.map(([input]) => pathname(input))).toEqual(["/auth/v1/user", "/auth/v1/logout"]);
    expect(listener).toHaveBeenCalledWith("complete");
    expect(adapter.getRecoveryState()).toBe("none");
    expect(await adapter.getAccessToken()).toBeNull();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    await adapter.signIn(email, password);
    expect(await adapter.getAccessToken()).toBe(jwt());
    expect(transport.mock.calls.map(([input]) => pathname(input))).toEqual(["/auth/v1/user", "/auth/v1/logout", "/auth/v1/token"]);
  });

  it("blocks token acquisition and signup while the callback is still being verified", async () => {
    callback();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockImplementation(input => pathname(input) === "/auth/v1/user"
      ? pending.promise : Promise.resolve(new Response(null, { status: 204 })));
    const adapter = auth(transport);
    expect(adapter.getConfirmationState()).toBe("checking");
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signUp(email, password)).rejects.toThrow();
    await expect(adapter.signIn(email, password)).rejects.toThrow();
    pending.resolve(json(user));
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("complete"));
    expect(transport.mock.calls.map(([input]) => pathname(input))).toEqual(["/auth/v1/user", "/auth/v1/logout"]);
  });

  it.each(["bad_jwt", "session_not_found"])("rejects a forged or reused callback rejected by Auth (%s)", async code => {
    callback();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ code, msg: `${refreshToken} ${jwt()}` }, 401));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("invalid"));
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).toHaveBeenCalledOnce();
    expect(pathname(transport.mock.calls[0][0])).toBe("/auth/v1/user");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(refreshToken);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(jwt());
    expect(window.location.hash).toBe("");
  });

  it.each<Record<string, string>>([
    { access_token: jwt("https://unapproved.example.invalid") },
    { expires_at: "1" },
    { refresh_token: "" },
    { access_token: "" },
    { token_type: "not-bearer" },
  ])("does not send malformed or wrong-project callback credentials to Auth %#", async changes => {
    callback(changes);
    const transport = vi.fn<typeof fetch>();
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("invalid"));
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not accept a URL parameter claiming signup without a verified session", async () => {
    window.history.replaceState(null, "", "/auth/callback?type=signup");
    const transport = vi.fn<typeof fetch>();
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("invalid"));
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    `?code=synthetic-unapproved-pkce-code`,
    `#type=signup&error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent(`${email} ${password}`)}`,
  ])("rejects unsupported or expired confirmation URL data without contacting Auth %#", async parameters => {
    window.history.replaceState(null, "", `/auth/callback${parameters}`);
    const transport = vi.fn<typeof fetch>();
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("invalid"));
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
  });

  it.each([
    { is_anonymous: true },
    { email_confirmed_at: null },
  ])("rejects a verified Auth user without permanent confirmed-email status %#", async changes => {
    callback();
    const transport = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(
      pathname(input) === "/auth/v1/user" ? json({ ...user, ...changes }) : new Response(null, { status: 204 })));
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("invalid"));
    expect(await adapter.getAccessToken()).toBeNull();
    expect(transport.mock.calls.map(([input]) => pathname(input))).toEqual(["/auth/v1/user", "/auth/v1/logout"]);
  });

  it("keeps projects blocked and requires reload after callback cleanup fails", async () => {
    callback();
    const transport = vi.fn<typeof fetch>().mockImplementation(input => Promise.resolve(
      pathname(input) === "/auth/v1/user" ? json(user) : json({ code: "unexpected_failure", msg: refreshToken }, 500)));
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getConfirmationState()).toBe("cleanup-failed"));
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signIn(email, password)).rejects.toThrow();
    expect(transport.mock.calls.map(([input]) => pathname(input))).toEqual(["/auth/v1/user", "/auth/v1/logout"]);
  });

  it("leaves a newer callback untouched when its old initialization is abandoned", async () => {
    callback();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const adapter = auth(transport);
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    adapter.invalidateSession?.();
    window.history.replaceState(null, "", "/auth/callback#type=signup&access_token=new-synthetic-callback");
    pending.resolve(json(user));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.location.hash).toContain("new-synthetic-callback");
    expect(await adapter.getAccessToken()).toBeNull();
    expect(adapter.getConfirmationState()).not.toBe("complete");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not erase a newer callback when abandoned confirmation logout finishes late", async () => {
    callback();
    const pending = deferred<Response>();
    const transport = vi.fn<typeof fetch>().mockImplementation(input => pathname(input) === "/auth/v1/user"
      ? Promise.resolve(json(user)) : pending.promise);
    const adapter = auth(transport);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    adapter.invalidateSession?.();
    window.history.replaceState(null, "", "/auth/callback#type=signup&access_token=new-synthetic-callback");
    pending.resolve(new Response(null, { status: 204 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.location.hash).toContain("new-synthetic-callback");
    expect(await adapter.getAccessToken()).toBeNull();
    expect(adapter.getConfirmationState()).not.toBe("complete");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("retains the distinct validated password-recovery flow without signup or project access", async () => {
    callback({ type: "recovery" });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(user));
    const adapter = auth(transport);
    await waitFor(() => expect(adapter.getRecoveryState()).toBe("ready"));
    expect(adapter.getConfirmationState()).toBe("none");
    expect(await adapter.getAccessToken()).toBeNull();
    await expect(adapter.signUp(email, password)).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
    expect(pathname(transport.mock.calls[0][0])).toBe("/auth/v1/user");
  });
});
