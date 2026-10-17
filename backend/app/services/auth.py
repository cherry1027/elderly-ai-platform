"""Online Supabase Auth verification; never trust a decoded, unverified JWT."""

from dataclasses import dataclass, field
from uuid import UUID

import httpx
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import APIError, invalid_token, unavailable


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: UUID
    access_token: SecretStr = field(repr=False)


async def authenticate(
    settings: Settings, client: httpx.AsyncClient, token: str
) -> AuthenticatedUser:
    if not settings.supabase_configured:
        raise APIError(503, "SUPABASE_NOT_CONFIGURED", "The service is not configured.")
    url = str(settings.supabase_url).rstrip("/")
    try:
        response = await client.get(
            f"{url}/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key.get_secret_value(),
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx.HTTPError:
        raise unavailable() from None

    if response.status_code in (400, 401, 403, 422):
        raise invalid_token()
    if response.status_code != 200:
        raise unavailable()
    try:
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
            raise ValueError
        user_id = UUID(payload["id"])
    except (ValueError, TypeError):
        raise unavailable() from None
    return AuthenticatedUser(user_id, SecretStr(token))
