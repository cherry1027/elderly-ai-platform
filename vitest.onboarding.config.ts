import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: path.resolve(__dirname, "src/development/onboarding"),
  envPrefix: "__MEMY_ONBOARDING_NO_ENV_",
  plugins: [],
  css: { postcss: { plugins: [] } },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", hmr: false, watch: null },
  resolve: { preserveSymlinks: true },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://127.0.0.1:5175/onboarding-review.html" } },
    globals: true,
    setupFiles: ["src/features/onboarding/test-setup.ts"],
    include: ["src/features/onboarding/*.test.ts*", "src/test/example.test.ts"],
    allowOnly: false,
    cache: false,
  },
});
