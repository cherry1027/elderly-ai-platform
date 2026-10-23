"""Bound public readiness load without making real outbound requests."""

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.supabase import ReadinessProbe

SETTINGS = Settings(_env_file=None, supabase_url="https://example.supabase.co",
                    supabase_publishable_key="synthetic-publishable")


@pytest.mark.parametrize("status", [200, 401, 503])
def test_success_and_failure_probe_results_cool_down_then_refresh(status):
    async def scenario():
        calls = []
        now = [100.0]

        def upstream(request):
            calls.append(request)
            return httpx.Response(status)

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            probe = ReadinessProbe(SETTINGS, client, clock=lambda: now[0])
            expected = None if status == 200 else "SUPABASE_UNAVAILABLE"
            assert await probe.check() == expected
            for _ in range(10):
                assert await probe.check() == expected
            assert len(calls) == 1
            now[0] += 2
            assert await probe.check() == expected
            assert len(calls) == 2

    asyncio.run(scenario())


def test_concurrent_cold_requests_do_not_create_upstream_fanout_and_cancel_recovers():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def upstream(request):
            calls.append(request)
            entered.set()
            await release.wait()
            return httpx.Response(200)

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            probe = ReadinessProbe(SETTINGS, client)
            first = asyncio.create_task(probe.check())
            await entered.wait()
            assert await probe.check() == "SUPABASE_UNAVAILABLE"
            assert len(calls) == 1
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            release.set()
            assert await probe.check() is None
            assert len(calls) == 2

    asyncio.run(scenario())


def test_route_keeps_public_payload_and_no_store_with_cached_probe():
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(200)

    with TestClient(create_app(SETTINGS, transport=httpx.MockTransport(upstream))) as client:
        for _ in range(5):
            response = client.get("/ready")
            assert response.json() == {"status": "ok", "service": "memy-ai-backend", "database": "ok"}
            assert response.headers["cache-control"] == "no-store"
    assert len(calls) == 1
