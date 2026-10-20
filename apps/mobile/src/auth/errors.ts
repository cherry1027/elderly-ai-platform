export type AuthErrorKind =
  | 'configuration' | 'credentials' | 'confirmation' | 'rate-limit'
  | 'network' | 'timeout' | 'session' | 'storage' | 'cleanup' | 'unknown';

// Messages deliberately contain no SDK response, URL, email, or credentials.
export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind) {
    super(`Authentication ${kind}.`);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

export function authErrorKind(error: unknown): AuthErrorKind {
  if (error instanceof AuthError) return error.kind;
  if (!error || typeof error !== 'object') return 'unknown';
  const value = error as { status?: unknown; code?: unknown; name?: unknown; originalError?: unknown };
  if (value.originalError instanceof AuthError) return value.originalError.kind;
  if (value.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(String(value.code))) return 'rate-limit';
  if (value.code === 'email_not_confirmed') return 'confirmation';
  if (value.code === 'invalid_credentials') return 'credentials';
  if (value.status === 401 || value.status === 403 || ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(String(value.code))) return 'session';
  if (value.name === 'AuthRetryableFetchError' || value.name === 'TypeError') return 'network';
  if (value.name === 'AbortError') return 'timeout';
  return 'unknown';
}
