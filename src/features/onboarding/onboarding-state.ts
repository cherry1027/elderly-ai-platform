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

export function isAuthenticationCallback(
  location: Pick<Location, "pathname" | "search" | "hash">,
): boolean {
  // Only the bare review URL may run onboarding. Conservatively exempt ALL
  // query strings/fragments and other routes without parsing credential values.
  // This preview must never process, redirect, scrub, or log an auth callback.
  return location.pathname !== "/onboarding-review.html" ||
    location.search !== "" || location.hash !== "";
}
