import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from "vite";

const root = __dirname;
const environmentDirectory = path.resolve(root, "src/development/entry");
const environmentPrefix = "__MEMY_ENTRY_NO_ENV_";
const safeLegacyModule = path.resolve(environmentDirectory, "LegacyBypass.tsx");
const sourcePaths = new Set([
  "/src/main.tsx",
  "/src/entry/bootstrap.tsx",
  "/src/entry/Entrance.tsx",
  "/src/development/entry/LegacyBypass.tsx",
  "/src/features/onboarding/MemoryBookScene.tsx",
  "/src/features/onboarding/OnboardingExperience.tsx",
  "/src/features/onboarding/copy.ts",
  "/src/features/onboarding/onboarding-state.ts",
  "/src/features/onboarding/onboarding.css",
]);
const headers = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
  const absolute = normalized.startsWith(".") && importer
    ? path.resolve(path.dirname(cleanId(importer)), normalized)
    : normalized.startsWith("/src/") ? path.resolve(root, normalized.slice(1)) : normalized;
  const relative = path.relative(root, absolute).replace(/\\/g, "/");
  if (!relative.startsWith("src/")) return undefined;
  const candidate = `/${relative}`;
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(value => sourcePaths.has(value)) ?? candidate;
}

function isNavigation(pathname: string) {
  if (["/", "/index.html", "/entry-review.html", "/.lovable/oauth/consent"].includes(pathname)) return true;
  // Serve the real bootstrap for deep links, never source/private files. The
  // bootstrap bypasses onboarding for those routes; its legacy module is inert here.
  return !/^\/(src|node_modules|backend|supabase|development|docs|public)(\/|$)/i.test(pathname) &&
    /^\/(?:[\p{L}\p{N}_~-]+\/?)+$/u.test(pathname);
}

function entryPreview(): Plugin {
  return {
    name: "memy-entry-preview-only",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "./LegacyApplication" && importer &&
        cleanId(importer) === cleanId(path.resolve(root, "src/entry/bootstrap.tsx"))) {
        return safeLegacyModule;
      }
      const requestedSource = sourcePath(id, importer);
      if (requestedSource && !sourcePaths.has(requestedSource)) {
        throw new Error("Legacy application modules are unavailable in the isolated entrance preview.");
      }
      if (/(?:^|[/@])(?:supabase|lovable)(?:[/.-]|$)/i.test(id)) {
        throw new Error("Service SDKs are unavailable in the isolated entrance preview.");
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Vite 5 injects a socket client even with HMR disabled. This preview
        // uses inline CSS and needs neither that client nor its connection.
        return html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>/g, "");
      },
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        // These run before Vite's own header middleware, including on failures.
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
        const host = request.headers.host;
        if (host !== "127.0.0.1:5176" && host !== "localhost:5176") {
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
          pathname.split("/").some(segment => segment === ".." || segment.startsWith(".env"));
        if (!invalid && isNavigation(pathname)) {
          try {
            const html = await server.transformIndexHtml("/entry-review.html", readFileSync(path.resolve(root, "entry-review.html"), "utf8"));
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(request.method === "HEAD" ? undefined : html);
          } catch {
            // Never expose or log a possibly credential-bearing request URL.
            response.statusCode = 500;
            response.end("The isolated preview could not be rendered.");
          }
          return;
        }
        const asset = sourcePaths.has(pathname) || pathname === "/@vite/env" ||
          /^\/node_modules\/(react|react-dom|scheduler)\//.test(pathname) ||
          pathname.startsWith("/.entry-cache.local/deps/");
        if (invalid || !asset || pathname.split("/").some(segment => segment === ".git")) {
          response.statusCode = 404;
          response.end("Only the isolated entrance preview is available on this server.");
          return;
        }
        next();
      });
    },
  };
}

export function createEntryConfig({ command, mode }: ConfigEnv) {
  if (command !== "serve" || mode !== "entry") {
    throw new Error("Development preview only. Use --config vite.entry.config.ts --mode entry.");
  }
  if (Object.keys(process.env).some(name => name.startsWith(environmentPrefix))) {
    throw new Error("The entrance preview requires no exposed environment variables.");
  }
  for (const name of [".env", ".env.local", ".env.entry", ".env.entry.local"]) {
    if (existsSync(path.join(environmentDirectory, name))) {
      throw new Error("The entrance preview requires no environment files. Remove its local environment configuration first.");
    }
  }
  return {
    root,
    envDir: environmentDirectory,
    envPrefix: environmentPrefix,
    cacheDir: path.resolve(root, ".entry-cache.local"),
    plugins: [entryPreview()],
    appType: "mpa",
    esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [] } },
    resolve: { preserveSymlinks: true },
    optimizeDeps: {
      entries: ["entry-review.html"],
      noDiscovery: true,
      include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: {
      host: "127.0.0.1", port: 5176, strictPort: true, open: false,
      hmr: false, cors: false, watch: null,
      fs: { strict: true, allow: [root], deny: ["**/.env*", "**/.git/**", "**/backend/**", "**/supabase/**"] },
      headers,
    },
  } satisfies UserConfig;
}

export default defineConfig(createEntryConfig);
