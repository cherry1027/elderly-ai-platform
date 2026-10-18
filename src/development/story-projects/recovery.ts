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
  const authTypes = ["recovery", "signup", "invite", "magiclink", "email_change", "email"];
  return { attempted: credentialParameters.some(key => key !== "type" && key in params) || authTypes.includes(params.type), params };
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
  constructor(public readonly kind: "invalid" | "weak" | "same" | "failed") {
    super({
      invalid: INVALID_RECOVERY_MESSAGE,
      weak: "That password does not meet the development project's password rules. Try a longer, stronger password with a mix of character types.",
      same: "Choose a new password different from your previous password.",
      failed: "Could not update your password. Check your connection and try again, or ask Charan for a fresh recovery email.",
    }[kind]);
  }
}

export function privateAuthFetch(request: typeof fetch, options: {
  authOrigin?: string;
  timeoutMs?: number;
  allowRequest?: () => boolean;
  sessionGeneration?: () => number;
  allowSignUp?: () => boolean;
} = {}): typeof fetch {
  return async (input, init) => {
    const failure = (status: number) => new Response(JSON.stringify({
      error_code: "unexpected_failure", msg: "Development authentication request failed.",
    }), { status, headers: { "Content-Type": "application/json" } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const sourceSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    const generation = options.sessionGeneration?.();
    const abandoned = () => options.sessionGeneration && options.sessionGeneration() !== generation;
    try {
      if (options.allowRequest && !options.allowRequest()) return failure(400);
      if (options.authOrigin) {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const approved = (url.pathname === "/auth/v1/signup" && method === "POST" && options.allowSignUp?.() === true) ||
          (url.pathname === "/auth/v1/token" && method === "POST") ||
          (url.pathname === "/auth/v1/user" && ["GET", "PUT"].includes(method)) ||
          (url.pathname === "/auth/v1/logout" && method === "POST" && url.searchParams.get("scope") === "local");
        if (url.origin !== options.authOrigin || url.username || url.password || url.hash || !approved) return failure(400);
      }
      sourceSignal?.addEventListener("abort", abort, { once: true });
      if (sourceSignal?.aborted) controller.abort();
      const work = async () => {
        const response = await request(input, { ...init, credentials: "omit", cache: "no-store", redirect: "error",
          ...(options.timeoutMs ? { signal: controller.signal } : {}) });
        // Supabase may save a session and clear the URL after reading a valid
        // response. Never deliver an abandoned instance's late response to it.
        if (abandoned()) return failure(400);
        if (response.ok) {
          // Bound body consumption as well as response headers. Only the SDK
          // receives successful Auth payloads; no credentials are logged.
          if (!options.timeoutMs) return response;
          const body = [204, 205, 304].includes(response.status) ? null : await response.text();
          if (abandoned()) return failure(400);
          return new Response(body, { status: response.status, headers: response.headers });
        }
        // The SDK can log raw Auth errors during initialization/refresh. Keep
        // only known machine codes; never server messages or request details.
        const body = await response.json().catch(() => null);
        const code = body?.error_code ?? body?.code;
        const allowed = ["weak_password", "same_password", "session_not_found", "refresh_token_not_found",
          "refresh_token_already_used", "bad_jwt", "user_not_found", "email_address_invalid",
          "over_request_rate_limit", "over_email_send_rate_limit", "user_already_exists", "email_exists"];
        return new Response(JSON.stringify({
          error_code: allowed.includes(code) ? code : "unexpected_failure",
          msg: "Development authentication request failed.",
        }), { status: response.status, headers: { "Content-Type": "application/json" } });
      };
      if (!options.timeoutMs) return await work();
      return await Promise.race([work(), new Promise<Response>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(failure(408)); }, options.timeoutMs);
      })]);
    } catch { throw new Error("Development authentication request failed."); }
    finally {
      clearTimeout(timer);
      sourceSignal?.removeEventListener("abort", abort);
    }
  };
}
