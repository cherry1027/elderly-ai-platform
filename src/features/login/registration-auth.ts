export type ConfirmationState = "none" | "checking" | "complete" | "invalid" | "cleanup-failed";

export interface RegistrationAuth {
  signUp(email: string, password: string): Promise<void>;
  getConfirmationState(): ConfirmationState;
  onConfirmationChange(listener: (state: ConfirmationState) => void): () => void;
}

// Proposed development callback, pending Charan's allowlist/template approval.
// Never derive an email redirect from untrusted URL input or fall back to production.
export const CONFIRMATION_REDIRECT_URL = "http://127.0.0.1:5173/auth/callback";

export class RegistrationError extends Error {
  constructor(public readonly kind: "invalid-email" | "weak" | "rate-limit" | "failed" | "configuration" | "cleanup" | "timeout") {
    super("Development registration could not be completed.");
    this.name = "RegistrationError";
  }
}

export function isConfirmationRedirect(location: Pick<Location, "pathname" | "search" | "hash"> = window.location): boolean {
  const params = Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, "")));
  new URLSearchParams(location.search).forEach((value, key) => { params[key] = value; });
  // This selects UI/SDK validation only. It never authenticates a caller.
  return params.type === "signup" || (location.pathname === "/auth/callback" && params.type !== "recovery");
}
