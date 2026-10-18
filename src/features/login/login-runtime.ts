import { createDevelopmentAuth, readDevelopmentConfig, type DevelopmentAuth } from "../../development/story-projects/development";
import { createStoryProjectsClient, type StoryProject } from "../../lib/api/story-projects";
import { isAuthenticationCallback } from "../onboarding/onboarding-state";

export interface LoginRuntime {
  auth: DevelopmentAuth;
  loadProjects: (signal: AbortSignal) => Promise<StoryProject[]>;
}

// No configuration is read and no SDK client is created until Login or an
// authentication callback is opened. The preview supplies only dedicated env.
export function createLoginRuntime(): LoginRuntime {
  const settings = readDevelopmentConfig(import.meta.env);
  const auth = createDevelopmentAuth(settings);
  const api = createStoryProjectsClient({ baseUrl: settings.apiBaseUrl, getAccessToken: auth.getAccessToken });
  return { auth, loadProjects: signal => api.list(signal) };
}

const allowedPaths = new Set(["/", "/index.html", "/login-review.html", "/story-projects.html", "/aterstall-losenord", "/auth/callback"]);

export function loginLocation(location: Pick<Location, "pathname" | "search" | "hash">): "entrance" | "auth" | "unsupported" {
  if (!allowedPaths.has(location.pathname)) return "unsupported";
  if (["/story-projects.html", "/aterstall-losenord", "/auth/callback"].includes(location.pathname)) return "auth";
  // The review filename is an alias for the main entrance, not a legacy path.
  return isAuthenticationCallback({ ...location, pathname: "/" }) ? "auth" : "entrance";
}
