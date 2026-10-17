export type RecoveryState = "none" | "checking" | "ready" | "invalid" | "finishing" | "complete" | "cleanup-failed";

export const INVALID_RECOVERY_MESSAGE = "This recovery link is invalid, expired, already used, or could not be verified. Ask Charan for a fresh development recovery email and open its newest link.";

const credentialParameters = [
  "access_token", "refresh_token", "provider_token", "provider_refresh_token",
  "expires_in", "expires_at", "token_type", "type", "code", "token", "token_hash",
  "error", "error_code", "error_description",
];

export function readRecoveryRedirect(): { attempted: boolean; params: Record<string, string> } {
  if (typeof window === "undefined") return { attempted: false, params: {} };
  const url = new URL(window.location.href);
  // Match the SDK: query parameters take precedence over the fragment.
  const params = Object.fromEntries(new URLSearchParams(url.hash.slice(1)));
  url.searchParams.forEach((value, key) => { params[key] = value; });
  return { attempted: credentialParameters.some(key => key in params), params };
}

export function clearRecoveryRedirect() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!readRecoveryRedirect().attempted) return;
  credentialParameters.forEach(key => url.searchParams.delete(key));
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

export class PasswordRecoveryError extends Error {
  constructor(kind: "invalid" | "weak" | "same" | "failed") {
    super({
      invalid: INVALID_RECOVERY_MESSAGE,
      weak: "That password does not meet the development project's password rules. Try a longer, stronger password with a mix of character types.",
      same: "Choose a new password different from your previous password.",
      failed: "Could not update your password. Check your connection and try again, or ask Charan for a fresh recovery email.",
    }[kind]);
  }
}

export function privateAuthFetch(request: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      const response = await request(input, { ...init, credentials: "omit", cache: "no-store", redirect: "error" });
      if (response.ok) return response;
      // The SDK can log raw Auth errors during initialization/refresh. Preserve
      // only known machine codes; never pass server messages or request details.
      const body = await response.json().catch(() => null);
      const code = body?.error_code ?? body?.code;
      const allowed = ["weak_password", "same_password", "session_not_found", "refresh_token_not_found",
        "refresh_token_already_used", "bad_jwt", "user_not_found"];
      return new Response(JSON.stringify({
        error_code: allowed.includes(code) ? code : "unexpected_failure",
        msg: "Development authentication request failed.",
      }), { status: response.status, headers: { "Content-Type": "application/json" } });
    } catch { throw new Error("Development authentication request failed."); }
  };
}
