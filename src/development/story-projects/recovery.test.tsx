import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createDevelopmentAuth, DEVELOPMENT_SUPABASE_URL, type DevelopmentAuth } from "./development";
import { clearRecoveryRedirect, privateAuthFetch, readRecoveryRedirect } from "./recovery";
import MyStoryProjects from "./MyStoryProjects";
import { createStoryProjectsClient } from "@/lib/api/story-projects";

vi.mock("@supabase/supabase-js", async importOriginal => {
  const original = await importOriginal<typeof import("@supabase/supabase-js")>();
  return { ...original, createClient: vi.fn() };
});

const config = { supabaseUrl: DEVELOPMENT_SUPABASE_URL, publishableKey: "sb_publishable_synthetic_only", apiBaseUrl: "http://127.0.0.1:8000" };
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "fake@example.invalid", is_anonymous: false };
const accessToken = (issuer = DEVELOPMENT_SUPABASE_URL) => [
  btoa('{"alg":"HS256","typ":"JWT"}'),
  btoa(JSON.stringify({ iss: `${issuer}/auth/v1`, sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })),
  "synthetic-signature",
].join(".");
const recoveryParams = () => ({ type: "recovery", access_token: accessToken(), refresh_token: "synthetic-private-refresh-token", token_type: "bearer", expires_in: "3600" });
const clients: Pick<ReturnType<typeof createClient>, "auth">[] = [];
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  window.history.replaceState(null, "", "/story-projects.html");
  localStorage.clear(); sessionStorage.clear();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => init?.method === "POST"
    ? new Response(null, { status: 204 })
    : new Response(JSON.stringify(user), { status: 200 }));
  const { createClient: realCreateClient } = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  vi.mocked(createClient).mockReset().mockImplementation((url, key, options) => {
    // The installed SDK really parses the URL, verifies its user via a mocked
    // /auth/v1/user response, saves an in-memory session, and emits its own event.
    const client = realCreateClient(url, key, { ...options, global: { ...options?.global, fetch: privateAuthFetch(transport) } });
    clients.push(client);
    return client as unknown as ReturnType<typeof createClient>;
  });
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.auth.stopAutoRefresh();
  const logs = JSON.stringify([log.mock.calls, warn.mock.calls, errorLog.mock.calls], (_key, value) =>
    value instanceof Error ? { ...value, name: value.name, message: value.message, stack: value.stack } : value);
  expect(logs).not.toContain("synthetic-private-refresh-token");
  expect(logs).not.toContain(accessToken());
  expect(logs).not.toContain("Synthetic-New-Password-2048!");
  window.history.replaceState(null, "", "/story-projects.html");
});

function openRedirect(params = recoveryParams(), query = false): DevelopmentAuth {
  const credentials = new URLSearchParams(params).toString();
  window.history.replaceState(null, "", `/story-projects.html${query ? "?" : "#"}${credentials}`);
  return createDevelopmentAuth(config);
}

describe("actual installed SDK recovery with fake HTTP only (not live Supabase)", () => {
  it.each([false, true])("accepts SDK-validated recovery in a %s query URL and scrubs credentials", async query => {
    const auth = openRedirect(recoveryParams(), query);
    expect(auth.getRecoveryState()).toBe("checking");
    expect(await auth.getAccessToken()).toBeNull();
    await waitFor(() => expect(auth.getRecoveryState()).toBe("ready"));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toBe(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`);
    expect(window.location.search + window.location.hash).toBe("");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    expect(await auth.getAccessToken()).toBeNull();
  });
  it.each([
    { type: "recovery" },
    { code: "synthetic-private-unsupported-pkce-code" },
    { error: "access_denied", error_code: "otp_expired", error_description: "synthetic-private-refresh-token" },
  ])("never accepts untrusted/missing/expired/unsupported URL claims %#", async params => {
    const auth = openRedirect(params as ReturnType<typeof recoveryParams>);
    await waitFor(() => expect(auth.getRecoveryState()).toBe("invalid"));
    expect(transport).not.toHaveBeenCalled();
    expect(window.location.search + window.location.hash).toBe("");
    await expect(auth.updatePassword("Synthetic-New-Password-2048!")).rejects.toThrow("invalid");
    expect(await auth.getAccessToken()).toBeNull();
  });
  it.each(["signup", "magiclink", "recovery-wrong-project", "expired"])("rejects a %s callback without attempting Auth HTTP", async type => {
    const params = recoveryParams();
    if (type === "recovery-wrong-project") params.access_token = accessToken("https://legacy.example.invalid");
    else if (type === "expired") Object.assign(params, { expires_at: "1" });
    else params.type = type;
    const auth = openRedirect(params);
    await waitFor(() => expect(auth.getRecoveryState()).toBe("invalid"));
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires the SDK's server-side user validation, not merely a plausible URL token", async () => {
    transport.mockResolvedValue(new Response(JSON.stringify({ error_code: "bad_jwt", msg: "synthetic-private-refresh-token" }), { status: 401 }));
    const auth = openRedirect(); const projects = vi.fn();
    render(<MyStoryProjects auth={auth} loadProjects={projects} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid, expired");
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("synthetic-private-refresh-token");
    expect(projects).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBeNull();
  });
  it("handles failed SDK validation without exposing transport credentials in the page or SDK logs", async () => {
    transport.mockRejectedValue(new Error("synthetic-private-refresh-token Synthetic-New-Password-2048!"));
    const auth = openRedirect(); const load = vi.fn();
    render(<MyStoryProjects auth={auth} loadProjects={load} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified");
    expect(auth.getRecoveryState()).toBe("invalid");
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ message: "Development authentication request failed." }));
  });
  it("runs the real SDK updateUser and local sign-out, with no story HTTP until fresh normal sign-in", async () => {
    const password = "Synthetic-New-Password-2048!";
    const auth = openRedirect(); const projectHttp = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const api = createStoryProjectsClient({ baseUrl: config.apiBaseUrl, getAccessToken: auth.getAccessToken, request: projectHttp });
    const load = vi.fn(api.list);
    render(<MyStoryProjects auth={auth} loadProjects={load} />);
    await screen.findByLabelText("New Password");
    await expect(api.list()).rejects.toThrow("Please sign in");
    expect(projectHttp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: password } });
    fireEvent.submit(screen.getByRole("form", { name: "Choose a new password" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("updated successfully"));
    const update = transport.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(update?.[0]).toBe(`${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`);
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({ password, code_challenge: null, code_challenge_method: null });
    expect(transport.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      `GET ${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`,
      `PUT ${DEVELOPMENT_SUPABASE_URL}/auth/v1/user`,
      `POST ${DEVELOPMENT_SUPABASE_URL}/auth/v1/logout?scope=local`,
    ]);
    expect(await auth.getAccessToken()).toBeNull(); expect(load).not.toHaveBeenCalled();
    expect(projectHttp).not.toHaveBeenCalled(); expect(document.body).not.toHaveTextContent(password);
    transport.mockResolvedValue(new Response(JSON.stringify({
      access_token: accessToken(), refresh_token: "synthetic-private-refresh-token", expires_in: 3600, token_type: "bearer", user,
    }), { status: 200 }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    fireEvent.submit(screen.getByRole("form", { name: "Sign in to development" }));
    expect(await screen.findByText("You have no story projects yet.")).toBeVisible();
    expect(auth.getRecoveryState()).toBe("none"); expect(load).toHaveBeenCalledTimes(1); expect(projectHttp).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent(password);
  });
  it("enforces the project's actual password policy through Supabase, without exposing its raw error", async () => {
    const auth = openRedirect(); await waitFor(() => expect(auth.getRecoveryState()).toBe("ready"));
    transport.mockImplementation(async () => new Response(JSON.stringify({
      error_code: "weak_password", msg: "synthetic-private-refresh-token", weak_password: { reasons: ["length", "characters"] },
    }), { status: 422 }));
    await expect(auth.updatePassword("Synthetic-New-Password-2048!")).rejects.toThrow("does not meet the development project's password rules");
    expect(auth.getRecoveryState()).toBe("ready"); expect(await auth.getAccessToken()).toBeNull();
  });
  it("keeps a still-pending SDK initialization blocked and survives a late UI subscription", async () => {
    let resolve!: (response: Response) => void;
    transport.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const auth = openRedirect();
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    expect(await auth.getAccessToken()).toBeNull();
    resolve(new Response(JSON.stringify(user), { status: 200 }));
    await waitFor(() => expect(auth.getRecoveryState()).toBe("ready"));
    const listener = vi.fn(); auth.onRecoveryChange(listener);
    expect(listener).toHaveBeenCalledWith("ready");
  });
});

describe("recovery URL privacy", () => {
  it("removes auth parameters from history without copying them to page text", () => {
    window.history.replaceState(null, "", "/story-projects.html?keep=ok&refresh_token=synthetic-private-refresh-token#type=recovery&access_token=synthetic-private-token");
    expect(readRecoveryRedirect().attempted).toBe(true); clearRecoveryRedirect();
    expect(window.location.search).toBe("?keep=ok"); expect(window.location.hash).toBe("");
    expect(readRecoveryRedirect().attempted).toBe(false);
  });
  it("leaves unrelated page URLs intact", () => {
    window.history.replaceState(null, "", "/story-projects.html?keep=ok#heading");
    clearRecoveryRedirect(); expect(window.location.search + window.location.hash).toBe("?keep=ok#heading");
  });
});

describe("SDK error privacy", () => {
  it("keeps only allowlisted error codes and removes server-echoed credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: "weak_password", message: "synthetic-private-refresh-token Synthetic-New-Password-2048!", debug: accessToken(),
    }), { status: 422 }));
    const response = await privateAuthFetch(request)("https://auth.example.invalid");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error_code: "weak_password", msg: "Development authentication request failed." });
    expect(request).toHaveBeenCalledWith("https://auth.example.invalid", {
      credentials: "omit", cache: "no-store", redirect: "error",
    });
  });
  it("sanitizes unknown errors and non-JSON error responses", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "synthetic-private-refresh-token" }), { status: 400 }))
      .mockResolvedValueOnce(new Response("Synthetic-New-Password-2048!", { status: 500 }));
    const fetch = privateAuthFetch(request);
    for (let index = 0; index < 2; index++) {
      const result = await fetch("https://auth.example.invalid");
      expect(await result.json()).toEqual({ error_code: "unexpected_failure", msg: "Development authentication request failed." });
    }
  });
  it("replaces transport exceptions with a fixed message before the SDK can log them", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic-private-refresh-token Synthetic-New-Password-2048!"));
    await expect(privateAuthFetch(request)("https://auth.example.invalid")).rejects.toThrow(/^Development authentication request failed\.$/);
  });
});
