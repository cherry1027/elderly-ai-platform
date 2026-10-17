import { defineConfig } from "vitest/config";
import path from "node:path";

const config = {
  envFile: false as const,
  plugins: [],
  server: { host: "127.0.0.1", hmr: false as const, watch: null },
  resolve: { preserveSymlinks: true, alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/development/story-projects/test-network.ts"],
    include: ["src/lib/api/story-projects.test.ts", "src/development/story-projects/*.test.ts*", "src/test/example.test.ts"],
    allowOnly: false,
    cache: false as const,
  },
};

export default defineConfig(config);
