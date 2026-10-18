import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from "vite";

const root = __dirname;
const previewEnvDir = path.resolve(root, "src/development/onboarding");

function previewOnly() {
  return {
    name: "memy-onboarding-preview-only",
    // No hot reload is needed for this review. Vite 5 injects its socket client
    // even with hmr:false; a direct CSS <link> avoids its style-module import.
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*><\/script>/g, "");
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // Never include the request URL in logs or errors: it might be an
        // accidentally misdirected authentication link. Never redirect it.
        const host = request.headers.host;
        if (host !== "127.0.0.1:5175" && host !== "localhost:5175") {
          response.statusCode = 403;
          response.end("This preview accepts loopback requests only.");
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
        const allowed = pathname === "/onboarding-review.html" || pathname === "/@vite/client" ||
          pathname === "/@vite/env" || pathname === "/src/development/onboarding/main.tsx" ||
          pathname.startsWith("/src/features/onboarding/") || pathname.startsWith("/node_modules/") ||
          pathname.startsWith("/.onboarding-cache.local/deps/");
        if (!allowed || pathname.split("/").some(segment => segment === ".." || segment.startsWith(".env"))) {
          response.statusCode = 404;
          response.end("Only the isolated onboarding preview is available on this server.");
          return;
        }
        next();
      });
    },
  } satisfies Plugin;
}

export function createOnboardingConfig({ command, mode }: ConfigEnv) {
  if (command !== "serve" || mode !== "onboarding") {
    throw new Error("Development preview only. Use --config vite.onboarding.config.ts --mode onboarding.");
  }
  // Vite must never load the root/legacy .env or a later accidental preview env.
  for (const name of [".env", ".env.local", ".env.onboarding", ".env.onboarding.local"]) {
    if (existsSync(path.join(previewEnvDir, name))) {
      throw new Error("The onboarding preview requires no environment files. Remove its local environment configuration first.");
    }
  }
  return {
    root,
    envDir: previewEnvDir,
    envPrefix: "__MEMY_ONBOARDING_NO_ENV_",
    cacheDir: path.resolve(root, ".onboarding-cache.local"),
    plugins: [previewOnly()],
    appType: "mpa",
    esbuild: { jsx: "automatic" },
    css: { postcss: { plugins: [] } },
    resolve: { preserveSymlinks: true },
    optimizeDeps: {
      entries: ["onboarding-review.html"],
      noDiscovery: true,
      include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: {
      host: "127.0.0.1", port: 5175, strictPort: true, open: false,
      hmr: false, cors: false, watch: null,
      fs: { strict: true, allow: [root], deny: ["**/.env*", "**/.git/**", "**/backend/**", "**/supabase/**"] },
      headers: {
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Permissions-Policy": "microphone=(), camera=(), geolocation=()",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  } satisfies UserConfig;
}

export default defineConfig(createOnboardingConfig);
