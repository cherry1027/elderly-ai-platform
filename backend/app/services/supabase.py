import httpx
import asyncio
import time

from app.core.config import Settings


class SupabaseUnavailable(Exception):
    """The configured Supabase data API could not be reached successfully."""


class ReadinessProbe:
    """One in-flight probe, with a short server-local success/failure cooldown.

    A concurrent cold request receives the existing unavailable response instead
    of spawning more upstream calls. This is not an ingress DDoS control.
    """

    def __init__(self, settings, client, *, clock=time.monotonic):
        self.settings = settings
        self.client = client
        self.clock = clock
        self._until = 0.0
        self._error = None
        self._lock = asyncio.Lock()

    async def check(self) -> str | None:
        if self.clock() < self._until:
            return self._error
        if self._lock.locked():
            return "SUPABASE_UNAVAILABLE"
        async with self._lock:
            try:
                await check_supabase(self.settings, self.client)
                error = None
            except SupabaseUnavailable as exc:
                error = str(exc)
            self._error = error
            self._until = self.clock() + 2.0
            return error


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
