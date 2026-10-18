// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { transformWithEsbuild, type ViteDevServer } from "vite";
import { createEntryConfig as configurePreview } from "../../vite.entry.config";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const config = () => configurePreview({ command: "serve", mode: "entry" });
const read = (name: string) => readFileSync(path.resolve(process.cwd(), name), "utf8");

describe("safe real-entrance preview configuration", () => {
  it("rejects builds and other modes", () => {
    expect(() => configurePreview({ command: "build", mode: "entry" })).toThrow("Development preview only");
    expect(() => configurePreview({ command: "serve", mode: "development" })).toThrow("Development preview only");
  });

  it("binds only loopback with no port fallback, proxy, CORS or HMR", () => {
    const { server } = config();
    expect(server).toMatchObject({ host: "127.0.0.1", port: 5176, strictPort: true, hmr: false, cors: false, open: false, watch: null });
    expect(server).not.toHaveProperty("proxy");
    expect(server.headers["Content-Security-Policy"]).toContain("connect-src 'none'");
    expect(server.headers["Permissions-Policy"]).toContain("microphone=()");
  });

  it("does not load legacy plugins, root environment or PostCSS configuration", () => {
    const settings = config();
    expect(settings.envDir).toBe(path.resolve("src/development/entry"));
    expect(settings.envPrefix).not.toContain("VITE_");
    expect(settings.plugins.map(plugin => plugin.name)).toEqual(["memy-entry-preview-only"]);
    expect(settings.css.postcss).toEqual({ plugins: [] });
    expect(settings.optimizeDeps.entries).toEqual(["entry-review.html"]);
    expect(settings.optimizeDeps.noDiscovery).toBe(true);
    expect(settings.appType).toBe("mpa");
  });

  it("fails closed if an accidental preview environment file exists", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    expect(config).toThrow("requires no environment files");
  });

  it("fails closed if an inherited variable uses the otherwise unused exposure prefix", () => {
    vi.stubEnv("__MEMY_ENTRY_NO_ENV_SYNTHETIC", "synthetic-do-not-expose");
    try {
      expect(config).toThrow("requires no exposed environment variables");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prebundles both automatic JSX runtimes, including the scene's jsxDEV runtime", async () => {
    const settings = config();
    const filename = "src/features/onboarding/MemoryBookScene.tsx";
    const transformed = await transformWithEsbuild(read(filename), filename, { ...settings.esbuild, jsxDev: true });
    expect(transformed.code).toContain("jsxDEV");
    expect(transformed.code).toMatch(/from ["']react\/jsx-dev-runtime["']/);
    expect(settings.optimizeDeps.include).toEqual(["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]);
  });

  it("uses the real main entry and no remote assets in the safe HTML", () => {
    const html = read("entry-review.html");
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(html).toContain("<title>Memy");
    expect(html).not.toMatch(/https?:\/\/|src\/App|index\.css/);
    expect(read("src/main.tsx")).toContain("./entry/bootstrap");
  });

  it("strips the injected Vite socket client without removing the real main entry", () => {
    const hook = config().plugins[0].transformIndexHtml;
    if (!hook || typeof hook === "function" || !("handler" in hook)) throw new Error("Expected post HTML transform");
    expect(hook.order).toBe("post");
    const entry = '<script type="module" src="/src/main.tsx"></script>';
    expect(hook.handler('<script type="module" src="/@vite/client"></script>' + entry,
      { path: "/entry-review.html", filename: path.resolve("entry-review.html") })).toBe(entry);
  });

  const resolver = () => config().plugins[0].resolveId as (id: string, importer?: string) => string | undefined;

  it("substitutes the inert legacy module only for the actual bootstrap import", () => {
    const resolve = resolver();
    expect(resolve("./LegacyApplication", path.resolve("src/entry/bootstrap.tsx"))).toBe(path.resolve("src/development/entry/LegacyBypass.tsx"));
    expect(resolve("./LegacyApplication", path.resolve("src/entry/bootstrap.tsx") + "?v=synthetic")).toBe(path.resolve("src/development/entry/LegacyBypass.tsx"));
    expect(() => resolve("./LegacyApplication.tsx", path.resolve("src/entry/bootstrap.tsx"))).toThrow("Legacy application");
    expect(() => resolve("./LegacyApplication", path.resolve("src/entry/Entrance.tsx"))).toThrow("Legacy application");
  });

  it.each([
    "/src/App.tsx", "/src/integrations/supabase/client.ts", "/src/pages/TestRecording.tsx",
    "@supabase/supabase-js", "@lovable.dev/mcp-js",
  ])("refuses legacy application code and service SDK imports: %s", id => {
    expect(() => resolver()(id, path.resolve("src/entry/bootstrap.tsx"))).toThrow();
  });

  it.each([
    "./Entrance", "./Entrance.tsx", "../features/onboarding/onboarding-state",
    "../features/onboarding/OnboardingExperience.tsx", "react", "react-dom/client",
  ])("allows the actual safe runtime's required imports: %s", id => {
    expect(() => resolver()(id, path.resolve("src/entry/bootstrap.tsx"))).not.toThrow();
  });

  async function middlewareRequest(url: string, options: { host?: string; method?: string; failTransform?: boolean } = {}) {
    const use = vi.fn();
    const transformIndexHtml = options.failTransform
      ? vi.fn().mockRejectedValue(new Error("synthetic transform failure"))
      : vi.fn(async (_pathname: string, html: string) => html);
    const hook = config().plugins[0].configureServer;
    if (typeof hook !== "function") throw new Error("Expected server middleware");
    hook({ middlewares: { use }, transformIndexHtml } as unknown as ViteDevServer);
    const middleware = use.mock.calls[0][0] as (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
    const request = { url, method: options.method ?? "GET", headers: { host: options.host ?? "127.0.0.1:5176", accept: "text/html" } } as IncomingMessage;
    const responseHeaders: Record<string, string> = {};
    const response = { statusCode: 200, setHeader: vi.fn((name: string, value: string) => { responseHeaders[name] = value; }), end: vi.fn() };
    const next = vi.fn();
    await middleware(request, response as unknown as ServerResponse, next);
    return { request, response, responseHeaders, next, transformIndexHtml };
  }

  it.each([
    "/", "/index.html", "/entry-review.html", "/aterstall-losenord", "/.lovable/oauth/consent",
    "/auth/callback", "/dashboard", "/bok/fake/preview", "/test-spela-in", "/unknown-deep-link",
  ])("serves only the safe HTML for navigation without rewriting the request: %s", async pathname => {
    const url = pathname + "?code=synthetic-do-not-log";
    const result = await middlewareRequest(url);
    expect(result.request.url).toBe(url);
    expect(result.response.statusCode).toBe(200);
    expect(result.response.end).toHaveBeenCalledWith(expect.stringContaining('src="/src/main.tsx"'));
    expect(result.transformIndexHtml).toHaveBeenCalledWith("/entry-review.html", expect.any(String));
    expect(result.next).not.toHaveBeenCalled();
    expect(result.responseHeaders["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(result.responseHeaders["Content-Security-Policy"]).toContain("connect-src 'none'");
    expect(result.responseHeaders["Referrer-Policy"]).toBe("no-referrer");
  });

  it.each([
    "/src/main.tsx", "/src/entry/bootstrap.tsx", "/src/entry/Entrance.tsx",
    "/src/development/entry/LegacyBypass.tsx", "/src/features/onboarding/MemoryBookScene.tsx",
    "/src/features/onboarding/onboarding.css?inline", "/@vite/env",
    "/node_modules/react/jsx-dev-runtime.js", "/.entry-cache.local/deps/react.js?v=synthetic",
  ])("permits only required runtime asset paths: %s", async url => {
    const result = await middlewareRequest(url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.response.end).not.toHaveBeenCalled();
  });

  it.each([
    "/src/App.tsx", "/src/entry/LegacyApplication.tsx", "/src/integrations/supabase/client.ts",
    "/src/features/onboarding/OnboardingExperience.test.tsx", "/src/features/onboarding/test-setup.ts",
    "/story-projects.html", "/onboarding-review.html", "/backend", "/supabase/config.toml",
    "/docs/web-onboarding.md", "/.env", "/.git/config", "/@fs/private",
    "/src/features/onboarding/../../App.tsx", "/node_modules/react/../../.env",
    "/.entry-cache.local/deps/../../.git/config", "/node_modules/@supabase/supabase-js/dist/module/index.js",
    "/src/entry/..%5c..%5c.env", "/src/main.tsx%00", "/node_modules/react/.env.local",
  ])("denies private or legacy requests even with an HTML accept header: %s", async url => {
    const result = await middlewareRequest(url);
    expect(result.response.statusCode).toBe(404);
    expect(result.next).not.toHaveBeenCalled();
    expect(result.transformIndexHtml).not.toHaveBeenCalled();
    expect(result.responseHeaders["Content-Security-Policy"]).toContain("connect-src 'none'");
  });

  it("rejects non-loopback hosts and unsupported methods without redirects", async () => {
    const untrusted = await middlewareRequest("/?code=synthetic-only", { host: "untrusted.invalid:5176" });
    expect(untrusted.response.statusCode).toBe(403);
    const post = await middlewareRequest("/", { method: "POST" });
    expect(post.response.statusCode).toBe(405);
    expect(post.responseHeaders.Allow).toBe("GET, HEAD");
    expect(untrusted.responseHeaders.Location).toBeUndefined();
  });

  it("supports HEAD without returning document contents", async () => {
    const result = await middlewareRequest("/", { method: "HEAD" });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.end).toHaveBeenCalledWith(undefined);
  });

  it("uses generic errors without echoing malformed URLs or credentials", async () => {
    const malformed = await middlewareRequest("/%E0%A4%A?code=synthetic-only");
    expect(malformed.response.statusCode).toBe(400);
    expect(malformed.response.end).toHaveBeenCalledWith("Invalid preview request.");
    const failure = await middlewareRequest("/?code=synthetic-only", { failTransform: true });
    expect(failure.response.statusCode).toBe(500);
    expect(failure.response.end).toHaveBeenCalledWith("The isolated preview could not be rendered.");
  });
});
