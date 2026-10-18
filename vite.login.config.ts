import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type ConfigEnv, type Plugin, type UserConfig } from "vite";

const root = __dirname;
const environmentDirectory = path.resolve(root, "development/login");
const environmentNames = new Set([
  "VITE_LOGIN_SUPABASE_URL", "VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY", "VITE_LOGIN_API_BASE_URL",
]);
const developmentAuthOrigin = "https://edbkuunyeyxnyenmmqud.supabase.co";
const sourcePaths = new Set([
  "/src/development/login/main.tsx",
  "/src/features/login/LoginApplication.tsx", "/src/features/login/login-runtime.ts", "/src/features/login/login.css",
  "/src/entry/Entrance.tsx",
  "/src/features/onboarding/MemoryBookScene.tsx", "/src/features/onboarding/OnboardingExperience.tsx",
  "/src/features/onboarding/copy.ts", "/src/features/onboarding/onboarding-state.ts",
  "/src/features/onboarding/onboarding.css",
  "/src/development/story-projects/MyStoryProjects.tsx", "/src/development/story-projects/PasswordRecovery.tsx",
  "/src/development/story-projects/development.ts", "/src/development/story-projects/recovery.ts",
  "/src/lib/api/story-projects.ts", "/src/lib/utils.ts",
  "/src/components/ui/button.tsx", "/src/components/ui/card.tsx",
  "/src/components/ui/input.tsx", "/src/components/ui/label.tsx",
]);
const navigationPaths = new Set([
  "/", "/index.html", "/login-review.html", "/story-projects.html", "/aterstall-losenord", "/auth/callback",
]);
const headers = {
  "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${developmentAuthOrigin}/auth/v1/ http://127.0.0.1:8000 http://localhost:8000; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "Permissions-Policy": "microphone=(), camera=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function cleanId(id: string) {
  return id.split("?")[0].replace(/\\/g, "/");
}

function sourcePath(id: string, importer?: string) {
  const normalized = cleanId(id);
  const absolute = normalized.startsWith("@/") ? path.resolve(root, "src", normalized.slice(2))
    : normalized.startsWith(".") && importer ? path.resolve(path.dirname(cleanId(importer)), normalized)
      : normalized.startsWith("/src/") ? path.resolve(root, normalized.slice(1)) : normalized;
  const relative = path.relative(root, absolute).replace(/\\/g, "/");
  if (!relative.startsWith("src/")) return undefined;
  const candidate = `/${relative}`;
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(value => sourcePaths.has(value)) ?? candidate;
}

function loginPreview(): Plugin {
  return {
    name: "memy-login-development-only",
    enforce: "pre",
    resolveId(id, importer) {
      const requestedSource = sourcePath(id, importer);
      if (requestedSource && !sourcePaths.has(requestedSource)) {
        throw new Error("This module is unavailable in the isolated login preview.");
      }
      if (/(?:^|[/@])lovable(?:[/.-]|$)/i.test(id) ||
        (id.startsWith("@supabase/") && id !== "@supabase/supabase-js")) {
        throw new Error("This service SDK is unavailable in the isolated login preview.");
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>/g, "");
      },
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        // These headers also protect responses handled before Vite's middleware.
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
        if (!["127.0.0.1:5173", "localhost:5173"].includes(request.headers.host ?? "")) {
          response.statusCode = 403;
          response.end("This preview accepts loopback requests only.");
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end("Only preview navigation is available.");
          return;
        }
        let pathname: string;
        try {
          pathname = decodeURIComponent((request.url ?? "").split("?")[0]);
        } catch {
          response.statusCode = 400;
          response.end("Invalid preview request.");
          return;
        }
        const invalid = pathname.includes("\\") || pathname.includes("\0") ||
          pathname.split("/").some(segment => segment === ".." || segment === ".git" || segment.startsWith(".env"));
        if (!invalid && navigationPaths.has(pathname)) {
          try {
            // The callback URL never reaches HTML transformation, errors or logs.
            const html = await server.transformIndexHtml("/login-review.html", readFileSync(path.resolve(root, "login-review.html"), "utf8"));
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(request.method === "HEAD" ? undefined : html);
          } catch {
            response.statusCode = 500;
            response.end("The isolated login preview could not be rendered.");
          }
          return;
        }
        const asset = sourcePaths.has(pathname) || pathname === "/@vite/env" ||
          /^\/node_modules\/(react|react-dom|scheduler)\//.test(pathname) ||
          pathname.startsWith("/.login-cache.local/deps/");
        if (invalid || !asset) {
          response.statusCode = 404;
          response.end("Only the isolated login preview is available on this server.");
          return;
        }
        next();
      });
    },
  };
}

export function createLoginConfig({ command, mode }: ConfigEnv) {
  if (command !== "serve" || mode !== "login") {
    throw new Error("Development preview only. Use --config vite.login.config.ts --mode login.");
  }
  // loadEnv reads this directory only. No legacy root .env is loaded.
  const environment = loadEnv(mode, environmentDirectory, "VITE_LOGIN_");
  if (Object.keys(environment).some(name => !environmentNames.has(name))) {
    throw new Error("Only the three documented login development variables may be exposed.");
  }
  const url = environment.VITE_LOGIN_SUPABASE_URL;
  const key = environment.VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY;
  const api = environment.VITE_LOGIN_API_BASE_URL;
  if ((url && url !== developmentAuthOrigin) || (key && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) ||
    (api && !["http://127.0.0.1:8000", "http://localhost:8000"].includes(api))) {
    throw new Error("The login preview requires the approved development project and local API configuration.");
  }
  return {
    root,
    envDir: environmentDirectory,
    envPrefix: "VITE_LOGIN_",
    cacheDir: path.resolve(root, ".login-cache.local"),
    plugins: [loginPreview()],
    appType: "mpa",
    esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [] } },
    resolve: { preserveSymlinks: true, alias: { "@": path.resolve(root, "src") } },
    optimizeDeps: {
      entries: ["login-review.html"],
      noDiscovery: true,
      include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@supabase/supabase-js",
        "@radix-ui/react-slot", "@radix-ui/react-label", "class-variance-authority", "clsx", "tailwind-merge"],
    },
    server: {
      host: "127.0.0.1", port: 5173, strictPort: true, open: false,
      hmr: false, cors: false, watch: null,
      fs: { strict: true, allow: [root], deny: ["**/.env*", "**/.git/**", "**/backend/**", "**/supabase/**"] },
      headers,
    },
  } satisfies UserConfig;
}

export default defineConfig(createLoginConfig);
