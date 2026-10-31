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


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    operation_id = getattr(exc, "operation_id", None)
    if operation_id is not None:
        try:
            headers["X-Memy-Operation-Id"] = str(UUID(str(operation_id)))
        except (ValueError, TypeError):
            pass
    if exc.status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if exc.status_code == 429:
        headers["Retry-After"] = "60"
    elif exc.code == "API_BUSY":
        headers["Retry-After"] = "1"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
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
