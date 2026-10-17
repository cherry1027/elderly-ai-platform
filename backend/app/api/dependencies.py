import re
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import APIError, invalid_token
from app.services.auth import AuthenticatedUser, authenticate
from app.services.resources import SupabaseGateway

bearer = HTTPBearer(
    auto_error=False,
    scheme_name="SupabaseBearer",
    description="Supabase Auth user access token from the configured development project.",
)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthenticatedUser:
    if credentials is None:
        raise APIError(401, "AUTHORIZATION_REQUIRED", "Bearer authentication is required.")
    token = credentials.credentials
    if len(token) > 16384 or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", token):
        raise invalid_token()
    return await authenticate(
        request.app.state.settings, request.app.state.http_client, token
    )


def get_gateway(
    request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)]
) -> SupabaseGateway:
    return SupabaseGateway(request.app.state.settings, request.app.state.http_client, user)
