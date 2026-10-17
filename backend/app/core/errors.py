"""Stable errors which never expose upstream bodies or credentials."""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if exc.status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
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
