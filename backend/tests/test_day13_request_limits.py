"""Offline resource admission, verified-identity rate and response privacy checks."""

import asyncio
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.api_safety import APISafetyMiddleware
from app.core.config import Settings
from app.core.errors import APIError
from app.core.request_limits import UserRateLimiter
from app.main import create_app

ALICE = UUID("11111111-1111-4111-8111-111111111111")
BOB = UUID("22222222-2222-4222-8222-222222222222")


def test_rate_allowance_is_rolling_per_user_and_has_bounded_memory():
    now = [100.0]
    limiter = UserRateLimiter(2, max_users=2, clock=lambda: now[0])
    limiter.check(ALICE)
    now[0] += 20
    limiter.check(ALICE)
    limiter.check(BOB)
    with pytest.raises(APIError) as limited:
        limiter.check(ALICE)
    assert (limited.value.status_code, limited.value.code) == (429, "RATE_LIMITED")
    with pytest.raises(APIError) as full:
        limiter.check(UUID(int=3))
    assert (full.value.status_code, full.value.code) == (503, "API_BUSY")
    assert len(limiter._users) == 2
    assert all(isinstance(key, UUID) for key in limiter._users)
    assert all(len(values) <= 2 for values in limiter._users.values())
    now[0] = 160
    limiter.check(ALICE)  # First request expired, not the more recent request.
    with pytest.raises(APIError):
        limiter.check(ALICE)
    now[0] = 221
    limiter.check(UUID(int=3))
    assert len(limiter._users) <= 2


@pytest.mark.parametrize("value", [0, -1, 601, True, "120", None])
def test_limiter_cannot_be_disabled_or_unbounded(value):
    with pytest.raises(ValueError):
        UserRateLimiter(value)


@pytest.mark.parametrize("field,value", [("api_requests_per_minute", 0), ("api_requests_per_minute", 601),
                                         ("api_max_concurrent_requests", 0), ("api_max_concurrent_requests", 257)])
def test_configuration_limits_fail_closed(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


def test_actual_auth_then_rate_limit_isolated_by_verified_user_and_explicit_retry():
    data_calls = []

    def upstream(request):
        if request.url.path == "/auth/v1/user":
            identity = BOB if request.headers["authorization"] == "Bearer bob" else ALICE
            return httpx.Response(200, json={"id": str(identity)})
        data_calls.append(request)
        return httpx.Response(200, json=[])

    app = create_app(Settings(_env_file=None, supabase_url="https://example.supabase.co",
                             supabase_publishable_key="synthetic-publishable", api_requests_per_minute=1),
                     transport=httpx.MockTransport(upstream))
    with TestClient(app) as client:
        assert app.state.http_client._trust_env is False
        assert client.get("/api/v1/story-projects", headers={"Authorization": "Bearer alice"}).status_code == 200
        result = client.get("/api/v1/story-projects", headers={"Authorization": "Bearer alice"})
        assert result.status_code == 429
        assert result.json()["error"]["code"] == "RATE_LIMITED"
        assert result.headers["retry-after"] == "60"
        assert client.get("/api/v1/story-projects", headers={"Authorization": "Bearer bob"}).status_code == 200
        assert client.get("/health").status_code == 200
    assert len(data_calls) == 2


def test_concurrent_admission_rejects_before_body_and_recovers_after_cancel():
    async def scenario():
        entered, blocked = asyncio.Event(), asyncio.Event()

        async def downstream(scope, receive, send):
            entered.set()
            await blocked.wait()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        app = APISafetyMiddleware(downstream, max_concurrent_requests=1)
        scope = {"type": "http", "path": "/api/v1/test", "headers": []}
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        async def never_read():
            pytest.fail("Busy request must not buffer a body")

        first = asyncio.create_task(app(scope, receive, send))
        await entered.wait()
        await app(scope, never_read, send)
        assert sent[0]["status"] == 503
        headers = dict(sent[0]["headers"])
        assert headers[b"retry-after"] == b"1"
        assert headers[b"cache-control"] == b"no-store"
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert app._active_requests == 0
        blocked.set()
        await app(scope, receive, send)
        assert sent[-2]["status"] == 200
        assert app._active_requests == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("case", ["auth", "oversize", "not_found", "failure"])
def test_privacy_headers_survive_early_errors(case):
    app = create_app(Settings(_env_file=None))

    @app.get("/api/v1/failure-probe")
    async def failure():
        raise RuntimeError("private-story-and-synthetic-secret")

    with TestClient(app) as client:
        if case == "auth":
            response = client.get("/api/v1/story-projects")
        elif case == "oversize":
            response = client.post("/api/v1/story-projects", content=b"x" * 262145)
        else:
            response = client.get("/api/v1/" + ("failure-probe" if case == "failure" else "missing"))
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "private-story-and-synthetic-secret" not in response.text


def test_all_business_operations_document_rate_limit_errors():
    for path, item in create_app(Settings(_env_file=None)).openapi()["paths"].items():
        if path.startswith("/api/v1/"):
            for method, operation in item.items():
                if method in {"get", "post", "patch"}:
                    assert "429" in operation["responses"]
