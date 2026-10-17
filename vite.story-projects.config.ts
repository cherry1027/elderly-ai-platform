import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

// Deliberately independent of the legacy Vite/MCP configuration and root .env.
export default defineConfig(({ command, mode }) => {
  if (command !== "serve" || mode !== "story-projects") {
    throw new Error("This preview is development-only. Use the setup guide in docs/web-story-projects.md.");
  }
  return {
    envDir: path.resolve(__dirname, "development/story-projects"),
    envPrefix: ["VITE_STORY_PROJECTS_", "VITE_API_"],
    plugins: [react()],
    appType: "mpa",
    server: { host: "127.0.0.1", port: 5173, strictPort: true, open: "/story-projects.html" },
    resolve: { preserveSymlinks: true, alias: { "@": path.resolve(__dirname, "src") } },
  };
});
