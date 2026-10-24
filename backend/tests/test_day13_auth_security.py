"""Offline Day 13 authentication coverage; no cloud tokens or calls are used."""

import asyncio
import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.services.auth import MAX_AUTH_RESPONSE_BYTES, authenticate


PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ALICE = "11111111-1111-4111-8111-111111111111"
BOB = "22222222-2222-4222-8222-222222222222"
TOKEN = "fictional-day13-user-access-token"
KEY = "fictional-publishable-key"
BASE_URL = "https://fictional-day13.supabase.co"


def configured_settings(**overrides):
    return Settings(
        _env_file=None,
        supabase_url=BASE_URL,
        supabase_publishable_key=KEY,
        **overrides,
    )


def private_operations():
    application = create_app(Settings(_env_file=None))
    return [
        (method.upper(), path)
        for path, operations in application.openapi()["paths"].items()
        if path.startswith("/api/v1/")
        for method in operations
        if method in {"get", "post", "patch", "put", "delete"}
    ]


OPERATIONS = private_operations()


def send(client, method, path, headers):
    for placeholder in ("project_id", "session_id", "fact_id", "draft_id", "export_id"):
        path = path.replace("{" + placeholder + "}", PROJECT)
    body = None
    if method == "POST" and path == "/api/v1/story-projects":
        body = {"title": "Fictional security test", "language": "en"}
    elif method == "POST" and path.endswith("/messages"):
        body = {"text": "A fictional memory.", "language": "en"}
    elif method == "POST" and path.endswith("/generate"):
        body = {"language": "en", "confirm_generation": True}
    elif method == "PATCH" and "/memories/" in path:
        body = {"status": "confirmed", "expected_version": 1}
    elif method == "PATCH" and "/story-drafts/" in path:
        body = {"content": "Fictional revised story.", "expected_revision": 1}
    elif method == "PATCH":
        body = {"title": "Fictional revised title"}
    elif method in {"POST", "DELETE"} and not path.endswith("/transcribe"):
        body = {}
    return client.request(method, path, headers=headers, json=body)


def assert_unauthorized(response, code):
    assert response.status_code == 401
    assert response.json()["error"]["code"] == code
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"
    assert TOKEN not in response.text


def test_private_operation_inventory_is_not_empty_and_requires_supabase_bearer():
    schema = create_app(Settings(_env_file=None)).openapi()
    assert len(OPERATIONS) >= 23
    for method, path in OPERATIONS:
        assert {"SupabaseBearer": []} in schema["paths"][path][method.lower()]["security"]
    assert not schema["paths"]["/health"]["get"].get("security")
    assert not schema["paths"]["/ready"]["get"].get("security")


@pytest.mark.parametrize("method,path", OPERATIONS)
def test_every_private_operation_rejects_missing_jwt_before_upstream(method, path):
    def reject_network(request):
        pytest.fail("Unauthenticated request attempted upstream access")

    app = create_app(configured_settings(), transport=httpx.MockTransport(reject_network))
    with TestClient(app) as client:
        response = send(client, method, path, {"Idempotency-Key": PROJECT})
    assert_unauthorized(response, "AUTHORIZATION_REQUIRED")


@pytest.mark.parametrize("method,path", OPERATIONS)
@pytest.mark.parametrize("status", [401, 403])
def test_every_private_operation_rejects_expired_or_invalid_online_auth(method, path, status):
    seen = []

    def auth_only(request):
        seen.append(request.url.path)
        assert str(request.url) == BASE_URL + "/auth/v1/user"
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert request.headers["apikey"] == KEY
        return httpx.Response(status, text="Fictional private Auth failure")

    app = create_app(configured_settings(), transport=httpx.MockTransport(auth_only))
    with TestClient(app) as client:
        response = send(client, method, path, {
            "Authorization": f"Bearer {TOKEN}", "Idempotency-Key": PROJECT,
        })
    assert seen == ["/auth/v1/user"]
    assert_unauthorized(response, "INVALID_ACCESS_TOKEN")
    assert "Fictional private Auth failure" not in response.text


@pytest.mark.parametrize("method,path", OPERATIONS)
def test_every_private_operation_rejects_ambiguous_authorization_headers(method, path):
    def reject_network(request):
        pytest.fail("Ambiguous authentication attempted upstream access")

    app = create_app(configured_settings(), transport=httpx.MockTransport(reject_network))
    headers = [
        ("Authorization", f"Bearer {TOKEN}"),
        ("authorization", "Bearer different-fictional-user"),
        ("Idempotency-Key", PROJECT),
    ]
    with TestClient(app) as client:
        response = send(client, method, path, headers)
    assert_unauthorized(response, "INVALID_ACCESS_TOKEN")


def test_auth_uses_online_identity_not_an_unverified_jwt_subject_and_rechecks_each_request():
    claimed_subject = base64.urlsafe_b64encode(json.dumps({"sub": BOB}).encode()).decode().rstrip("=")
    forged_token = f"eyJhbGciOiJub25lIn0.{claimed_subject}.fictional-signature"
    auth_calls = 0

    def handler(request):
        nonlocal auth_calls
        assert request.headers["authorization"] == f"Bearer {forged_token}"
        if request.url.path == "/auth/v1/user":
            auth_calls += 1
            return httpx.Response(200, json={"id": ALICE}) if auth_calls == 1 else httpx.Response(401)
        assert request.url.path == "/rest/v1/story_projects"
        assert request.url.params["user_id"] == f"eq.{ALICE}"
        assert BOB not in str(request.url)
        return httpx.Response(200, json=[])

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {forged_token}"}
        assert client.get("/api/v1/story-projects", headers=headers).json() == []
        assert client.get("/api/v1/story-projects", headers=headers).status_code == 401
    assert auth_calls == 2


@pytest.mark.parametrize("method,path", [
    operation for operation in OPERATIONS if operation[1] != "/api/v1/story-projects"
])
def test_every_resource_scoped_operation_hides_foreign_resources_without_mutation(method, path):
    """RLS-hidden rows/RPCs stay sanitized; this is not a live RLS claim."""
    seen = []

    def handler(request):
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert request.headers["apikey"] == KEY
        seen.append((request.method, request.url.path))
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": ALICE})
        if request.url.path == "/rest/v1/story_projects":
            assert request.method in {"GET", "PATCH"}
            assert request.url.params["user_id"] == f"eq.{ALICE}"
            assert request.url.params["id"] == f"eq.{PROJECT}"
            return httpx.Response(200, json=[])
        if request.url.path in {"/rest/v1/conversation_sessions", "/rest/v1/memory_facts"}:
            assert request.method == "GET"
            return httpx.Response(200, json=[])
        if request.url.path in {
            "/rest/v1/rpc/get_story_draft", "/rest/v1/rpc/load_story_export_context",
            "/rest/v1/rpc/get_story_export",
        }:
            return httpx.Response(404, json={"code": "P0002", "message": "Fictional private resource details"})
        pytest.fail("Unauthorized scope reached child content, a write RPC, or rendering audit")

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = send(client, method, path, {
            "Authorization": f"Bearer {TOKEN}", "Idempotency-Key": PROJECT,
        })
    assert response.status_code == 404
    assert seen[0] == ("GET", "/auth/v1/user")
    assert "Fictional private resource details" not in response.text
    assert TOKEN not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_auth_redirect_is_not_followed_even_with_a_redirect_following_client():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://fictional-attacker.invalid/collect"})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True) as client:
            with pytest.raises(APIError) as caught:
                await authenticate(configured_settings(), client, TOKEN)
        assert caught.value.code == "SUPABASE_UNAVAILABLE"

    asyncio.run(exercise())
    assert seen == [BASE_URL + "/auth/v1/user"]


@pytest.mark.parametrize("body", [
    b'{"id":"' + ALICE.encode() + b'","id":"' + BOB.encode() + b'"}',
    b'{"id":"' + ALICE.encode() + b'","metadata":{"x":1,"x":2}}',
    b"[" * 2000 + b"]" * 2000,
    b"\xff",
    b'{"id":"' + ALICE.encode() + b'","padding":"' + b"x" * MAX_AUTH_RESPONSE_BYTES + b'"}',
], ids=["duplicate-identity", "duplicate-metadata", "excessive-depth", "invalid-utf8", "oversized"])
def test_malformed_ambiguous_or_oversized_auth_payload_fails_closed(body):
    def handler(request):
        assert request.url.path == "/auth/v1/user"
        return httpx.Response(200, content=body)

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SUPABASE_UNAVAILABLE"
    assert ALICE not in response.text
    assert BOB not in response.text
    assert TOKEN not in response.text


def test_streamed_auth_payload_is_bounded_and_closed_without_reading_the_rest():
    class LargeAuthBody(httpx.AsyncByteStream):
        chunks = 0
        closed = False

        async def __aiter__(self):
            for _ in range(100):
                self.chunks += 1
                yield b"x" * 65536

        async def aclose(self):
            self.closed = True

    stream = LargeAuthBody()

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, stream=stream),
        )) as client:
            with pytest.raises(APIError) as caught:
                await authenticate(configured_settings(), client, TOKEN)
        assert caught.value.code == "SUPABASE_UNAVAILABLE"

    asyncio.run(exercise())
    assert stream.chunks == MAX_AUTH_RESPONSE_BYTES // 65536 + 1
    assert stream.closed


def test_slow_streaming_auth_response_has_a_total_deadline_and_is_closed():
    class SlowAuthBody(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b'{"id":"'
            await asyncio.sleep(0.2)
            yield ALICE.encode() + b'"}'

        async def aclose(self):
            self.closed = True

    stream = SlowAuthBody()

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, stream=stream),
        ), timeout=None) as client:
            with pytest.raises(APIError) as caught:
                await authenticate(configured_settings(request_timeout_seconds=0.01), client, TOKEN)
        assert caught.value.code == "SUPABASE_UNAVAILABLE"

    asyncio.run(exercise())
    assert stream.closed


def test_invalid_tokens_never_consume_authenticated_user_rate_allowance():
    class AllowanceSpy:
        users = []

        def check(self, user_id):
            self.users.append(str(user_id))

    calls = 0

    def handler(request):
        nonlocal calls
        if request.url.path == "/auth/v1/user":
            calls += 1
            return httpx.Response(401) if calls == 1 else httpx.Response(200, json={"id": ALICE})
        return httpx.Response(200, json=[])

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    limiter = AllowanceSpy()
    app.state.user_rate_limiter = limiter
    with TestClient(app) as client:
        assert client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 401
        assert limiter.users == []
        assert client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
    assert limiter.users == [ALICE]
