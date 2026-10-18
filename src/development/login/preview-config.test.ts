// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv, transformWithEsbuild, type ViteDevServer } from "vite";
import { createLoginConfig as configurePreview } from "../../../vite.login.config";

vi.mock("vite", async importOriginal => {
  const actual = await importOriginal<typeof import("vite")>();
  return { ...actual, loadEnv: vi.fn(() => ({})) };
});

const config = () => configurePreview({ command: "serve", mode: "login" });
const read = (name: string) => readFileSync(path.resolve(process.cwd(), name), "utf8");
beforeEach(() => vi.mocked(loadEnv).mockReturnValue({}));

describe("isolated development login preview", () => {
  it("rejects builds and other modes before reading environment values", () => {
    expect(() => configurePreview({ command: "build", mode: "login" })).toThrow("Development preview only");
    expect(() => configurePreview({ command: "serve", mode: "development" })).toThrow("Development preview only");
    expect(loadEnv).not.toHaveBeenCalled();
  });

  it("uses the backend's permitted loopback port with no fallback, proxy, CORS or HMR", () => {
    const { server } = config();
    expect(server).toMatchObject({ host: "127.0.0.1", port: 5173, strictPort: true, open: false, hmr: false, cors: false, watch: null });
    expect(server).not.toHaveProperty("proxy");
  });

  it("loads only the dedicated directory and dedicated exposure prefix", () => {
    const settings = config();
    expect(loadEnv).toHaveBeenCalledWith("login", path.resolve("development/login"), "VITE_LOGIN_");
    expect(settings.envDir).toBe(path.resolve("development/login"));
    expect(settings.envPrefix).toBe("VITE_LOGIN_");
    expect(settings.plugins.map(plugin => plugin.name)).toEqual(["memy-login-development-only"]);
    expect(settings.css.postcss).toEqual({ plugins: [] });
    expect(settings.appType).toBe("mpa");
    expect(settings.optimizeDeps.noDiscovery).toBe(true);
  });

  it("allows missing configuration so the UI can display a safe configuration message", () => {
    expect(config).not.toThrow();
  });

  it("accepts only the approved development project and local API values", () => {
    vi.mocked(loadEnv).mockReturnValue({
      VITE_LOGIN_SUPABASE_URL: "https://edbkuunyeyxnyenmmqud.supabase.co",
      VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
      VITE_LOGIN_API_BASE_URL: "http://127.0.0.1:8000",
    });
    expect(config).not.toThrow();
  });

  it.each([
    ["VITE_LOGIN_SUPABASE_URL", "https://unapproved.invalid"],
    ["VITE_LOGIN_SUPABASE_URL", "https://edbkuunyeyxnyenmmqud.supabase.co/"],
    ["VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY", "sb_secret_synthetic_only"],
    ["VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY", "synthetic-service-role-jwt"],
    ["VITE_LOGIN_API_BASE_URL", "https://unapproved.invalid"],
    ["VITE_LOGIN_API_BASE_URL", "http://127.0.0.1:8001"],
    ["VITE_LOGIN_API_BASE_URL", "http://127.0.0.1:8000/api/v1"],
    ["VITE_LOGIN_API_BASE_URL", "http://synthetic:secret@127.0.0.1:8000"],
    ["VITE_LOGIN_API_BASE_URL", "http://127.0.0.1:8000?credential=synthetic"],
  ])("rejects unsafe %s configuration without echoing its value", (name, value) => {
    vi.mocked(loadEnv).mockReturnValue({ [name]: value });
    let message = "";
    try { config(); } catch (error) { message = (error as Error).message; }
    expect(message).toBe("The login preview requires the approved development project and local API configuration.");
    expect(message).not.toContain(value);
  });

  it("rejects unexpected variables before Vite can expose them", () => {
    vi.mocked(loadEnv).mockReturnValue({ VITE_LOGIN_UNAPPROVED_SECRET: "synthetic-do-not-expose" });
    expect(config).toThrow("Only the three documented login development variables may be exposed.");
  });

  it("limits browser connections to development Auth and the local backend", () => {
    const csp = config().server.headers["Content-Security-Policy"];
    expect(csp).toContain("connect-src https://edbkuunyeyxnyenmmqud.supabase.co/auth/v1/ http://127.0.0.1:8000 http://localhost:8000;");
    expect(csp).not.toMatch(/connect-src[^;]*(\*|wss:|https:;)/);
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(config().server.headers["Permissions-Policy"]).toContain("microphone=()");
    expect(config().server.headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("prebundles the actual SDK, UI dependencies and both automatic JSX runtimes", async () => {
    const settings = config();
    expect(settings.optimizeDeps.include).toEqual(expect.arrayContaining([
      "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@supabase/supabase-js",
      "@radix-ui/react-slot", "@radix-ui/react-label", "class-variance-authority", "clsx", "tailwind-merge",
    ]));
    const filename = "src/features/onboarding/MemoryBookScene.tsx";
    const result = await transformWithEsbuild(read(filename), filename, { ...settings.esbuild, jsxDev: true });
    expect(result.code).toMatch(/from ["']react\/jsx-dev-runtime["']/);
    expect(result.code).toContain("jsxDEV");
  });

  it("uses only the dedicated entry and no remote assets in its HTML", () => {
    const html = read("login-review.html");
    expect(html).toContain('<script type="module" src="/src/development/login/main.tsx"></script>');
    expect(html).not.toMatch(/https?:\/\/|src\/App|index\.css|src\/main\.tsx/);
  });

  it("removes the Vite socket client while preserving the dedicated entry", () => {
    const hook = config().plugins[0].transformIndexHtml;
    if (!hook || typeof hook === "function" || !("handler" in hook)) throw new Error("Expected HTML transform");
    const entry = '<script type="module" src="/src/development/login/main.tsx"></script>';
    expect(hook.handler('<script type="module" src="/@vite/client"></script>' + entry,
      { path: "/login-review.html", filename: path.resolve("login-review.html") })).toBe(entry);
  });

  const resolver = () => config().plugins[0].resolveId as (id: string, importer?: string) => string | undefined;
  it.each([
    "/src/App.tsx", "/src/main.tsx", "/src/entry/bootstrap.tsx", "/src/entry/LegacyApplication.tsx",
    "/src/integrations/supabase/client.ts", "@/integrations/supabase/client",
    "/src/features/login/LoginApplication.test.tsx", "/src/development/story-projects/test-network.ts",
    "@lovable.dev/mcp-js", "@supabase/realtime-js",
  ])("refuses unapproved runtime imports: %s", id => {
    expect(() => resolver()(id, path.resolve("src/development/login/main.tsx"))).toThrow();
  });

  it.each([
    "../../features/login/LoginApplication", "/src/entry/Entrance.tsx", "@/lib/api/story-projects",
    "@/components/ui/button", "../features/onboarding/OnboardingExperience", "@supabase/supabase-js", "react",
  ])("permits only the selected runtime's necessary imports: %s", id => {
    const importer = id.startsWith("../features") ? path.resolve("src/entry/Entrance.tsx") : path.resolve("src/development/login/main.tsx");
    expect(() => resolver()(id, importer)).not.toThrow();
  });

  async function middlewareRequest(url: string, options: { host?: string; method?: string; failTransform?: boolean } = {}) {
    const use = vi.fn();
    const transformIndexHtml = options.failTransform
      ? vi.fn().mockRejectedValue(new Error("synthetic-only"))
      : vi.fn(async (_pathname: string, html: string) => html);
    const hook = config().plugins[0].configureServer;
    if (typeof hook !== "function") throw new Error("Expected middleware");
    hook({ middlewares: { use }, transformIndexHtml } as unknown as ViteDevServer);
    const middleware = use.mock.calls[0][0] as (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
    const request = { url, method: options.method ?? "GET", headers: { host: options.host ?? "127.0.0.1:5173" } } as IncomingMessage;
    const responseHeaders: Record<string, string> = {};
    const response = { statusCode: 200, setHeader: vi.fn((name: string, value: string) => { responseHeaders[name] = value; }), end: vi.fn() };
    const next = vi.fn();
    await middleware(request, response as unknown as ServerResponse, next);
    return { request, response, responseHeaders, next, transformIndexHtml };
  }

  it.each(["/", "/index.html", "/login-review.html", "/story-projects.html", "/aterstall-losenord", "/auth/callback"])(
    "serves the integrated application at %s without consuming the callback URL", async pathname => {
      const url = pathname + "?code=synthetic-do-not-log";
      const result = await middlewareRequest(url);
      expect(result.request.url).toBe(url);
      expect(result.response.statusCode).toBe(200);
      expect(result.transformIndexHtml).toHaveBeenCalledWith("/login-review.html", expect.any(String));
      expect(result.response.end).toHaveBeenCalledWith(expect.stringContaining('/src/development/login/main.tsx'));
      expect(result.responseHeaders["Cache-Control"]).toBe("no-store");
      expect(result.responseHeaders["Referrer-Policy"]).toBe("no-referrer");
      expect(result.next).not.toHaveBeenCalled();
    });

  it.each([
    "/src/development/login/main.tsx", "/src/features/login/LoginApplication.tsx", "/src/features/login/login-runtime.ts", "/src/features/login/login.css?inline",
    "/src/entry/Entrance.tsx", "/src/features/onboarding/MemoryBookScene.tsx", "/src/lib/api/story-projects.ts",
    "/src/development/story-projects/development.ts", "/src/components/ui/input.tsx",
    "/@vite/env", "/.login-cache.local/deps/@supabase_supabase-js.js?v=synthetic",
  ])("permits required runtime assets: %s", async url => {
    const result = await middlewareRequest(url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.response.end).not.toHaveBeenCalled();
  });

  it.each([
    "/src/App.tsx", "/src/main.tsx", "/src/entry/LegacyApplication.tsx", "/src/integrations/supabase/client.ts",
    "/src/features/login/LoginApplication.test.tsx", "/src/development/story-projects/test-network.ts",
    "/dashboard", "/bok/synthetic", "/.lovable/oauth/consent", "/onboarding-review.html", "/entry-review.html",
    "/backend", "/supabase/config.toml", "/docs/web-entry-integration.md", "/.env.local", "/development/login/.env.local",
    "/.git/config", "/@fs/private", "/src/features/login/../../App.tsx", "/node_modules/react/../../.env",
    "/.login-cache.local/deps/../../.git/config", "/src/main.tsx%00", "/node_modules/react/.env.local",
  ])("denies unrelated pages, tests, source and private files: %s", async url => {
    const result = await middlewareRequest(url);
    expect(result.response.statusCode).toBe(404);
    expect(result.next).not.toHaveBeenCalled();
    expect(result.transformIndexHtml).not.toHaveBeenCalled();
    expect(result.responseHeaders["Referrer-Policy"]).toBe("no-referrer");
  });

  it("rejects non-loopback hosts and unsupported methods without redirects", async () => {
    const host = await middlewareRequest("/?code=synthetic", { host: "untrusted.invalid:5173" });
    expect(host.response.statusCode).toBe(403);
    expect(host.responseHeaders.Location).toBeUndefined();
    const post = await middlewareRequest("/", { method: "POST" });
    expect(post.response.statusCode).toBe(405);
    expect(post.responseHeaders.Allow).toBe("GET, HEAD");
  });

  it("supports HEAD without returning document contents", async () => {
    const result = await middlewareRequest("/story-projects.html?code=synthetic", { method: "HEAD" });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.end).toHaveBeenCalledWith(undefined);
  });

  it("returns generic failures without rendering the request or raw exception", async () => {
    const malformed = await middlewareRequest("/%E0%A4%A?code=synthetic");
    expect(malformed.response.statusCode).toBe(400);
    expect(malformed.response.end).toHaveBeenCalledWith("Invalid preview request.");
    const failed = await middlewareRequest("/?code=synthetic", { failTransform: true });
    expect(failed.response.statusCode).toBe(500);
    expect(failed.response.end).toHaveBeenCalledWith("The isolated login preview could not be rendered.");
  });
});
