import httpx

from app.core.config import Settings


class SupabaseUnavailable(Exception):
    """The configured Supabase data API could not be reached successfully."""


async def check_supabase(settings: Settings, client: httpx.AsyncClient) -> None:
    """Probe the profiles relation without reading records or bypassing RLS.

    This confirms the data API, supplied key and relation are reachable. It does
    not prove authenticated ownership policies or migration deployment status.
    """
    if not settings.supabase_configured:
        raise SupabaseUnavailable("SUPABASE_NOT_CONFIGURED")

    url = str(settings.supabase_url).rstrip("/")
    try:
        response = await client.head(
            f"{url}/rest/v1/profiles",
            params={"select": "id", "limit": "0"},
            headers={
                "apikey": settings.supabase_publishable_key.get_secret_value(),
            },
        )
        response.raise_for_status()
    except httpx.HTTPError:
        # Never expose upstream response bodies, URLs, or credentials to callers.
        raise SupabaseUnavailable("SUPABASE_UNAVAILABLE") from None
