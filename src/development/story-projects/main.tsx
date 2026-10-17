import { createRoot } from "react-dom/client";
import { createStoryProjectsClient } from "@/lib/api/story-projects";
import { createDevelopmentAuth, readDevelopmentConfig } from "./development";
import MyStoryProjects from "./MyStoryProjects";
import { clearRecoveryRedirect } from "./recovery";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
try {
  const config = readDevelopmentConfig(import.meta.env);
  const auth = createDevelopmentAuth(config);
  const client = createStoryProjectsClient({ baseUrl: config.apiBaseUrl, getAccessToken: auth.getAccessToken });
  root.render(<MyStoryProjects auth={auth} loadProjects={client.list} />);
} catch {
  clearRecoveryRedirect();
  // Never display environment values or raw SDK/configuration exceptions.
  root.render(<main className="mx-auto max-w-2xl space-y-4 p-8">
    <h1 className="text-2xl font-bold">My Story Projects</h1>
    <p role="alert">This development preview is not configured. Follow docs/web-story-projects.md in this checkout.</p>
  </main>);
}
