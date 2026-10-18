// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { transformWithEsbuild, type ViteDevServer } from "vite";
import { createOnboardingConfig as configurePreview } from "../../../vite.onboarding.config";

const config = () => configurePreview({ command: "serve", mode: "onboarding" });
const read = (name: string) => readFileSync(path.resolve(process.cwd(), name), "utf8");

describe("isolated preview configuration", () => {
  it("rejects builds and other modes", () => {
    expect(() => configurePreview({ command: "build", mode: "onboarding" })).toThrow("Development preview only");
    expect(() => configurePreview({ command: "serve", mode: "development" })).toThrow("Development preview only");
  });

  it("binds only loopback with no port fallback, CORS, HMR or proxy", () => {
    const { server } = config();
    expect(server).toMatchObject({ host: "127.0.0.1", port: 5175, strictPort: true, hmr: false, cors: false, open: false });
    expect(server).not.toHaveProperty("proxy");
    expect(server.headers["Content-Security-Policy"]).toContain("connect-src 'none'");
    expect(server.headers["Permissions-Policy"]).toContain("microphone=()");
    expect(server.headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("uses no legacy plugins, root environment or PostCSS configuration", () => {
    const settings = config();
    expect(settings.envDir).toBe(path.resolve("src/development/onboarding"));
    expect(settings.envPrefix).not.toContain("VITE_");
    expect(settings.plugins.map(plugin => plugin.name)).toEqual(["memy-onboarding-preview-only"]);
    expect(settings.css.postcss).toEqual({ plugins: [] });
    expect(settings.optimizeDeps.entries).toEqual(["onboarding-review.html"]);
    expect(settings.optimizeDeps.noDiscovery).toBe(true);
  });

  it("prebundles the development runtime requested by the actual scene JSX", async () => {
    const settings = config();
    // Vite's development transform enables jsxDev by default. With discovery
    // disabled, its injected CommonJS runtime must be included explicitly.
    const scene = "src/features/onboarding/MemoryBookScene.tsx";
    const transformed = await transformWithEsbuild(read(scene), scene, {
      ...settings.esbuild, jsxDev: true,
    });
    const runtime = transformed.code.match(/from ["'](react\/jsx-dev-runtime)["']/)?.[1];
    expect(runtime).toBe("react/jsx-dev-runtime");
    expect(transformed.code).toContain("jsxDEV");
    expect(settings.optimizeDeps.include).toContain(runtime);
  });

  it("removes only Vite's injected socket client and keeps the actual entry", () => {
    const plugin = config().plugins[0];
    const hook = plugin.transformIndexHtml;
    if (!hook || typeof hook === "function" || !("handler" in hook)) throw new Error("Expected post HTML transform");
    expect(hook.order).toBe("post");
    const entry = '<script type="module" src="/src/development/onboarding/main.tsx"></script>';
    expect(hook.handler('<script type="module" src="/@vite/client"></script>' + entry)).toBe(entry);
  });

  function middlewareRequest(url: string, host = "127.0.0.1:5175") {
    const use = vi.fn();
    const plugin = config().plugins[0];
    const hook = plugin.configureServer;
    if (typeof hook !== "function") throw new Error("Expected server middleware");
    hook({ middlewares: { use } } as unknown as ViteDevServer);
    const middleware = use.mock.calls[0][0] as (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    const request = { url, headers: { host } } as IncomingMessage;
    const response = { statusCode: 200, end: vi.fn() };
    const next = vi.fn();
    middleware(request, response as unknown as ServerResponse, next);
    return { request, response, next };
  }

  it.each([
    "/onboarding-review.html", "/src/development/onboarding/main.tsx",
    "/src/features/onboarding/onboarding.css", "/src/features/onboarding/MemoryBookScene.tsx",
    "/.onboarding-cache.local/deps/react.js?v=synthetic", "/node_modules/react/jsx-runtime.js",
  ])("permits only the preview's required asset paths: %s", url => {
    const result = middlewareRequest(url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.response.end).not.toHaveBeenCalled();
  });

  it.each([
    "/", "/index.html", "/src/main.tsx", "/src/App.tsx", "/story-projects.html",
    "/backend/README.md", "/supabase/config.toml", "/.env", "/.git/config",
    "/src/features/onboarding/../../App.tsx", "/node_modules/.env",
  ])("refuses legacy or private content: %s", url => {
    const result = middlewareRequest(url);
    expect(result.response.statusCode).toBe(404);
    expect(result.next).not.toHaveBeenCalled();
  });

  it("rejects a non-loopback Host header", () => {
    const result = middlewareRequest("/onboarding-review.html", "untrusted.invalid:5175");
    expect(result.response.statusCode).toBe(403);
    expect(result.next).not.toHaveBeenCalled();
  });

  it("does not redirect, rewrite or echo a misdirected callback URL", () => {
    const url = "/onboarding-review.html?code=synthetic-only";
    const result = middlewareRequest(url);
    expect(result.request.url).toBe(url);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.response.end).not.toHaveBeenCalled();
  });

  it("handles malformed URI syntax without echoing it", () => {
    const result = middlewareRequest("/src/features/onboarding/%E0%A4%A");
    expect(result.response.statusCode).toBe(400);
    expect(result.response.end).toHaveBeenCalledWith("Invalid preview request.");
  });

  it("loads styles directly without Vite style-client imports or remote assets", () => {
    const html = read("onboarding-review.html");
    const main = read("src/development/onboarding/main.tsx");
    expect(html).toContain('<link rel="stylesheet" href="/src/features/onboarding/onboarding.css"');
    expect(main).not.toMatch(/import.*\.css/);
    expect(html + main).not.toMatch(/https?:\/\//);
  });

  it("contains responsive rules, large controls and static reduced-motion compositions", () => {
    const css = read("src/features/onboarding/onboarding.css");
    expect(css).toContain("@media (max-width: 370px)");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('data-motion="off"');
    expect(css).toContain("animation: none !important");
    expect(css).not.toMatch(/@import|url\(|infinite/);
  });
});
