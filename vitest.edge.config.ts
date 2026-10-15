import { defineConfig } from "vitest/config";

export default defineConfig({
  // Do not load the project .env or the application Vite/MCP plugins.
  envDir: "supabase/functions/deletion-reminders",
  plugins: [],
  // The supplied dependency copy has no symlinks; avoid native realpath restrictions.
  resolve: { preserveSymlinks: true },
  test: {
    environment: "node",
    include: ["supabase/functions/deletion-reminders/handler.test.ts"],
    setupFiles: [],
    allowOnly: false,
  },
});
