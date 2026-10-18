import path from "node:path";
import { defineConfig } from "vitest/config";

const config = {
  envFile: false as const,
  envDir: path.resolve(__dirname, "src/development/login"),
  envPrefix: "__MEMY_LOGIN_TEST_NO_ENV_",
  plugins: [],
  css: { postcss: { plugins: [] } },
  esbuild: { jsx: "automatic" as const },
  server: { host: "127.0.0.1", hmr: false as const, watch: null },
  resolve: { preserveSymlinks: true, alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://127.0.0.1:5173/" } },
    globals: true,
    setupFiles: ["src/features/onboarding/test-setup.ts", "src/development/story-projects/test-network.ts"],
    include: ["src/features/onboarding/*.test.ts*", "src/entry/*.test.ts*", "src/features/login/*.test.ts*",
      "src/development/login/*.test.ts*", "src/development/story-projects/*.test.ts*", "src/lib/api/story-projects.test.ts", "src/test/example.test.ts"],
    allowOnly: false,
    cache: false as const,
  },
};

export default defineConfig(config);
