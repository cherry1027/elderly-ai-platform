// This flag belongs to this browser profile and origin, never to a user account.
export const COMPLETION_KEY = "memy.onboarding.v1";

export function hasCompletedIntroduction(): boolean {
  try {
    return window.localStorage.getItem(COMPLETION_KEY) === "complete";
  } catch {
    return false;
  }
}

export function completeIntroduction(): boolean {
  try {
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    return true;
  } catch {
    return false;
  }
}

export function isEntrancePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html";
}

const authenticationKeys = new Set([
  "access_token", "refresh_token", "provider_token", "provider_refresh_token",
  "code", "token", "token_hash", "error", "error_code", "error_description",
  "expires_in", "expires_at", "token_type",
]);
const authenticationTypes = new Set([
  "recovery", "signup", "invite", "magiclink", "email_change", "email",
]);

function hasAuthenticationMarkers(parameters: URLSearchParams): boolean {
  for (const key of parameters.keys()) {
    const name = key.toLowerCase();
    if (authenticationKeys.has(name)) return true;
    if (name === "type" && parameters.getAll(key).some(value => authenticationTypes.has(value.toLowerCase()))) return true;
  }
  return false;
}

export function isAuthenticationCallback(
  location: Pick<Location, "pathname" | "search" | "hash">,
): boolean {
  // Preserve every existing deep link. At the entrance, ordinary marketing
  // parameters and section anchors must not suppress a first introduction.
  if (!isEntrancePath(location.pathname) &&
      !["/onboarding-review.html", "/login-review.html"].includes(location.pathname)) return true;
  // Inspect marker names and the non-secret auth type only. Never consume,
  // rewrite, log, or display credential values from the original URL.
  return hasAuthenticationMarkers(new URLSearchParams(location.search)) ||
    hasAuthenticationMarkers(new URLSearchParams(location.hash.replace(/^#/, "")));
}
