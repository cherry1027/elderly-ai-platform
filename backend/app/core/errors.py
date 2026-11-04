"""Stable errors which never expose upstream bodies or credentials."""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from uuid import UUID


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


# Stable recovery advice supplements existing {error:{code,message}} bodies.
# A closed allowance has no automatic retry time. Never turn it into a 60s wait.
ERROR_RECOVERY = {
    "AI_USAGE_LIMIT": ("contact-operator", "The current AI testing allowance is used up. Your saved work is still available."),
    "AI_GLOBAL_BUDGET_EXHAUSTED": ("contact-operator", "The shared AI testing allowance is used up. Your saved work is still available."),
    "AI_USER_BUDGET_EXHAUSTED": ("contact-operator", "Your AI testing allowance is used up. Your saved work is still available."),
    "AI_SPENDING_NOT_APPROVED": ("contact-operator", "The AI testing window is closed. Your saved work is still available."),
    "AI_USAGE_UNAVAILABLE": ("contact-operator", "AI spending controls need attention. Your saved work is still available."),
    "AI_USER_LIMIT_UNAVAILABLE": ("sign-in", "Please sign in again before using AI. Your saved work is still available."),
    "LIVE_AI_DISABLED": ("contact-operator", "This AI action is paused. Your saved work is still available."),
    "AI_PROVIDER_QUOTA_EXHAUSTED": ("contact-operator", "The AI provider's billing allowance needs attention. Your saved work is still available."),
    "AI_PROVIDER_AUTHENTICATION_FAILED": ("contact-operator", "The AI provider configuration needs attention. Your saved work is still available."),
    "AI_PROVIDER_ACCESS_DENIED": ("contact-operator", "The AI provider configuration needs attention. Your saved work is still available."),
    "REAL_AI_NOT_CONFIGURED": ("contact-operator", "AI configuration is incomplete. Your saved work is still available."),
    "AI_RATE_LIMIT": ("wait", "AI is receiving requests too quickly. Please wait before trying again."),
    "RATE_LIMITED": ("wait", "Too many requests. Please wait before trying again."),
    "AI_BUSY": ("wait", "Memy is busy. Please wait before trying again."),
    "AUDIO_BUSY": ("wait", "Audio processing is busy. Please wait before trying again."),
    "API_BUSY": ("wait", "Memy is busy. Please wait before trying again."),
    "AI_PROVIDER_RATE_LIMIT": ("check-saved", "The AI provider is busy. Check the saved result before trying again."),
    "AI_PROVIDER_TIMEOUT": ("check-saved", "The AI reply timed out. Check the saved result before trying again."),
    "AI_PROVIDER_UNAVAILABLE": ("check-saved", "The AI provider is unavailable. Check the saved result before trying again."),
    "REAL_AI_UNCERTAIN": ("check-saved", "This action may have completed. Check the saved result before trying again."),
    "INVALID_ACCESS_TOKEN": ("sign-in", "Please sign in again to continue."),
    "MISSING_ACCESS_TOKEN": ("sign-in", "Please sign in to continue."),
}


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    recovery = ERROR_RECOVERY.get(exc.code)
    if recovery is not None:
        headers["X-Memy-Recovery"] = recovery[0]
    operation_id = getattr(exc, "operation_id", None)
    if operation_id is not None:
        try:
            headers["X-Memy-Operation-Id"] = str(UUID(str(operation_id)))
        except (ValueError, TypeError):
            pass
    if exc.status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if exc.code in {"AI_RATE_LIMIT", "RATE_LIMITED", "AI_BUSY", "AUDIO_BUSY"}:
        headers["Retry-After"] = "60"
    elif exc.code == "API_BUSY":
        headers["Retry-After"] = "1"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": recovery[1] if recovery else exc.message}},
        headers=headers,
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Pydantic's default error includes raw request input. Do not echo tokens,
    # private titles, or arbitrary extra fields back through validation errors.
    return await api_error_handler(
        request, APIError(422, "VALIDATION_ERROR", "Request validation failed.")
    )


def unavailable() -> APIError:
    return APIError(503, "SUPABASE_UNAVAILABLE", "The service is temporarily unavailable.")


def invalid_token() -> APIError:
    return APIError(401, "INVALID_ACCESS_TOKEN", "A valid access token is required.")
