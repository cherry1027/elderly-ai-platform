"""Online Supabase Auth verification; never trust a decoded, unverified JWT."""

from dataclasses import dataclass, field
import asyncio
import json
from uuid import UUID

import httpx
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import APIError, invalid_token, unavailable


MAX_AUTH_RESPONSE_BYTES = 262_144


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    """An ambiguous upstream user identifier must never authenticate anyone."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate authentication response field")
        result[key] = value
    return result


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
        # HTTPX's per-chunk timeout alone permits a slow upstream response to
        # keep an authentication slot alive indefinitely. Bound total time too.
        async with asyncio.timeout(settings.request_timeout_seconds):
            async with client.stream(
                "GET",
                f"{url}/auth/v1/user",
                headers={
                    "apikey": settings.supabase_publishable_key.get_secret_value(),
                    "Authorization": f"Bearer {token}",
                },
                follow_redirects=False,
            ) as response:
                if response.status_code in (400, 401, 403, 422):
                    raise invalid_token()
                if response.status_code != 200:
                    raise unavailable()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > MAX_AUTH_RESPONSE_BYTES:
                        raise unavailable()
                    body.extend(chunk)
    except (httpx.HTTPError, TimeoutError):
        raise unavailable() from None

    try:
        payload = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object)
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
            raise ValueError
        user_id = UUID(payload["id"])
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise unavailable() from None
    return AuthenticatedUser(user_id, SecretStr(token))
