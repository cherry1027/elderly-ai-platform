import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
USER_ACCESS_TOKEN = "test-user-access-token"

ALICE_ID = "11111111-1111-4111-8111-111111111111"
BOB_ID = "22222222-2222-4222-8222-222222222222"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
BOB_PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

PROJECT_RESPONSE = {
    "id": PROJECT_ID,
    "title": "Minnen från Malmö",
    "description": "Barndomens berättelser",
    "language": "sv",
    "status": "draft",
    "created_at": "2026-10-17T08:00:00Z",
    "updated_at": "2026-10-17T08:00:00Z",
}
PROJECT_FROM_SUPABASE = {
    **PROJECT_RESPONSE,
    "user_id": ALICE_ID,
}
SESSION_RESPONSE = {
    "id": SESSION_ID,
    "project_id": PROJECT_ID,
    "language": "sv",
    "status": "active",
    "created_at": "2026-10-17T08:05:00Z",
    "updated_at": "2026-10-17T08:05:00Z",
    "ended_at": None,
}

DataHandler = Callable[[httpx.Request], httpx.Response]


def configured_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )


def assert_upstream_credentials(request: httpx.Request) -> None:
    assert request.url.host == "test-project.supabase.co"
    assert request.headers["apikey"] == PUBLISHABLE_KEY
    assert request.headers["authorization"] == f"Bearer {USER_ACCESS_TOKEN}"


def authenticated_handler(
    data_handler: DataHandler,
    *,
    auth_payload: dict[str, Any] | None = None,
) -> DataHandler:
    def handler(request: httpx.Request) -> httpx.Response:
        assert_upstream_credentials(request)
        if request.url.path == "/auth/v1/user":
            assert request.method == "GET"
            return httpx.Response(
                200,
                json=auth_payload
                if auth_payload is not None
                else {"id": ALICE_ID, "email": "alice@example.test"},
            )
        assert request.url.path.startswith("/rest/v1/")
        return data_handler(request)

    return handler


def request_json(request: httpx.Request) -> Any:
    return json.loads(request.content.decode("utf-8"))


def assert_owned_project_filter(request: httpx.Request) -> None:
    assert request.url.params.get("id") == f"eq.{PROJECT_ID}"
    assert request.url.params.get("user_id") == f"eq.{ALICE_ID}"


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status
    payload = response.json()
    assert set(payload) == {"error"}
    assert set(payload["error"]) == {"code", "message"}
    assert payload["error"]["code"] == code
    assert isinstance(payload["error"]["message"], str)
    assert payload["error"]["message"]


def test_create_project_trims_swedish_title_and_derives_user_id():
    seen: list[tuple[str, str]] = []

    def data_handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/story_projects"
        assert "return=representation" in request.headers.get("prefer", "")
        assert request_json(request) == {
            "user_id": ALICE_ID,
            "title": "Minnen från Malmö",
            "description": "Barndomens berättelser",
            "language": "sv",
        }
        return httpx.Response(201, json=[PROJECT_FROM_SUPABASE])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json={
                "title": "  Minnen från Malmö  ",
                "description": "Barndomens berättelser",
                "language": "sv",
            },
        )

    assert response.status_code == 201
    assert response.json() == PROJECT_RESPONSE
    assert seen == [("POST", "/rest/v1/story_projects")]


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "   ", "language": "sv"},
        {"title": "x" * 121, "language": "sv"},
        {"title": "Valid", "language": "de"},
        {"title": "Valid", "language": "en", "description": "x" * 4001},
    ],
)
def test_create_project_rejects_invalid_fields_with_stable_error(payload):
    def no_data_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"validation failure reached Data API: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(no_data_calls))
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize(
    "forged_field,forged_value",
    [("user_id", BOB_ID), ("status", "completed")],
)
def test_create_project_rejects_forged_server_owned_fields(
    forged_field, forged_value
):
    def no_data_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"forged field reached Data API: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(no_data_calls))
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json={"title": "Valid", "language": "sv", forged_field: forged_value},
        )

    assert_error(response, 422, "VALIDATION_ERROR")


def test_list_projects_is_owned_paginated_and_a_plain_array():
    def data_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/rest/v1/story_projects"
        assert request.url.params.get("user_id") == f"eq.{ALICE_ID}"
        assert request.url.params.get("limit") == "50"
        assert request.url.params.get("offset") == "0"
        return httpx.Response(200, json=[PROJECT_FROM_SUPABASE])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.status_code == 200
    assert response.json() == [PROJECT_RESPONSE]


def test_list_projects_forwards_explicit_pagination_and_can_be_empty():
    def data_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/rest/v1/story_projects"
        assert request.url.params.get("user_id") == f"eq.{ALICE_ID}"
        assert request.url.params.get("limit") == "2"
        assert request.url.params.get("offset") == "3"
        return httpx.Response(200, json=[])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects?limit=2&offset=3",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_project_list_rejects_pagination_outside_bounds(query):
    def no_data_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"invalid pagination reached Data API: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(no_data_calls))
    )
    with TestClient(app) as client:
        response = client.get(
            f"/api/v1/story-projects?{query}",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert_error(response, 422, "VALIDATION_ERROR")


def test_get_project_filters_by_project_and_authenticated_owner():
    def data_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/rest/v1/story_projects"
        assert_owned_project_filter(request)
        return httpx.Response(200, json=[PROJECT_FROM_SUPABASE])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.status_code == 200
    assert response.json() == PROJECT_RESPONSE


def test_patch_project_allows_only_mutable_fields_and_owner_filter():
    updated = {
        **PROJECT_FROM_SUPABASE,
        "title": "Ett nytt kapitel",
        "description": None,
        "updated_at": "2026-10-17T09:00:00Z",
    }

    def data_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PATCH"
        assert request.url.path == "/rest/v1/story_projects"
        assert_owned_project_filter(request)
        assert "return=representation" in request.headers.get("prefer", "")
        assert request_json(request) == {
            "title": "Ett nytt kapitel",
            "description": None,
        }
        return httpx.Response(200, json=[updated])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.patch(
            f"/api/v1/story-projects/{PROJECT_ID}",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json={"title": "  Ett nytt kapitel  ", "description": None},
        )

    assert response.status_code == 200
    assert response.json() == {
        **PROJECT_RESPONSE,
        "title": "Ett nytt kapitel",
        "description": None,
        "updated_at": "2026-10-17T09:00:00Z",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "   "},
        {"language": "en"},
        {"user_id": BOB_ID},
        {"status": "completed"},
    ],
)
def test_patch_project_rejects_empty_invalid_or_immutable_fields(payload):
    def no_data_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"invalid patch reached Data API: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(no_data_calls))
    )
    with TestClient(app) as client:
        response = client.patch(
            f"/api/v1/story-projects/{PROJECT_ID}",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")


def test_create_session_inherits_owned_project_language():
    seen: list[tuple[str, str]] = []

    def data_handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "GET" and request.url.path == "/rest/v1/story_projects":
            assert_owned_project_filter(request)
            return httpx.Response(200, json=[PROJECT_FROM_SUPABASE])
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/conversation_sessions"
        assert "return=representation" in request.headers.get("prefer", "")
        assert request_json(request) == {
            "project_id": PROJECT_ID,
            "language": PROJECT_RESPONSE["language"],
        }
        return httpx.Response(201, json=[SESSION_RESPONSE])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/sessions",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.status_code == 201
    assert response.json() == SESSION_RESPONSE
    assert seen == [
        ("GET", "/rest/v1/story_projects"),
        ("POST", "/rest/v1/conversation_sessions"),
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {"project_id": BOB_PROJECT_ID},
        {"language": "en"},
        {"project_id": BOB_PROJECT_ID, "language": "en"},
    ],
)
def test_create_session_rejects_foreign_parent_or_language_override(payload):
    def no_data_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"session override reached Data API: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(no_data_calls))
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/sessions",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")


def test_list_sessions_verifies_owned_project_then_returns_plain_array():
    seen: list[tuple[str, str]] = []

    def data_handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.url.path == "/rest/v1/story_projects":
            assert request.method == "GET"
            assert_owned_project_filter(request)
            return httpx.Response(200, json=[PROJECT_FROM_SUPABASE])
        assert request.method == "GET"
        assert request.url.path == "/rest/v1/conversation_sessions"
        assert request.url.params.get("project_id") == f"eq.{PROJECT_ID}"
        assert request.url.params.get("limit") == "50"
        assert request.url.params.get("offset") == "0"
        return httpx.Response(200, json=[SESSION_RESPONSE])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/sessions",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.status_code == 200
    assert response.json() == [SESSION_RESPONSE]
    assert seen == [
        ("GET", "/rest/v1/story_projects"),
        ("GET", "/rest/v1/conversation_sessions"),
    ]


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("GET", f"/api/v1/story-projects/{PROJECT_ID}", None),
        ("PATCH", f"/api/v1/story-projects/{PROJECT_ID}", {"title": "Not mine"}),
        ("POST", f"/api/v1/story-projects/{PROJECT_ID}/sessions", None),
        ("GET", f"/api/v1/story-projects/{PROJECT_ID}/sessions", None),
    ],
)
def test_missing_or_cross_user_project_is_404_for_every_scoped_route(
    method, path, payload
):
    data_calls: list[tuple[str, str]] = []

    def data_handler(request: httpx.Request) -> httpx.Response:
        data_calls.append((request.method, request.url.path))
        assert request.url.path == "/rest/v1/story_projects"
        assert request.method in {"GET", "PATCH"}
        assert_owned_project_filter(request)
        return httpx.Response(200, json=[])

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    request_kwargs = {"headers": {"Authorization": f"Bearer {USER_ACCESS_TOKEN}"}}
    if payload is not None:
        request_kwargs["json"] = payload
    with TestClient(app) as client:
        response = client.request(method, path, **request_kwargs)

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert data_calls
    assert all(call[1] == "/rest/v1/story_projects" for call in data_calls)


def test_missing_bearer_is_401_without_upstream_call():
    def unexpected_upstream(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"missing bearer reached upstream: {request.url.path}")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(unexpected_upstream)
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/story-projects")

    assert response.headers.get("www-authenticate") == "Bearer"
    assert_error(response, 401, "AUTHORIZATION_REQUIRED")


@pytest.mark.parametrize("auth_status", [401, 403])
def test_invalid_or_expired_access_token_is_sanitized_401(auth_status):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/auth/v1/user"
        assert_upstream_credentials(request)
        return httpx.Response(auth_status, text="private auth failure details")

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert response.headers.get("www-authenticate") == "Bearer"
    assert_error(response, 401, "INVALID_ACCESS_TOKEN")
    assert "private auth failure details" not in response.text
    assert USER_ACCESS_TOKEN not in response.text


@pytest.mark.parametrize("upstream_status,expected_status,expected_code", [
    (401, 401, "INVALID_ACCESS_TOKEN"),
    (403, 403, "ACCESS_DENIED"),
    (409, 409, "CONFLICT"),
    (429, 503, "SUPABASE_UNAVAILABLE"),
    (500, 503, "SUPABASE_UNAVAILABLE"),
    (503, 503, "SUPABASE_UNAVAILABLE"),
])
def test_data_api_failures_are_sanitized(upstream_status, expected_status, expected_code):
    def data_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/story_projects"
        return httpx.Response(upstream_status, text="private database failure details")

    app = create_app(
        configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler))
    )
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert_error(response, expected_status, expected_code)
    assert "private database failure details" not in response.text
    assert USER_ACCESS_TOKEN not in response.text


@pytest.mark.parametrize("failure_stage", ["auth", "data"])
def test_upstream_network_failures_are_sanitized(failure_stage):
    def handler(request: httpx.Request) -> httpx.Response:
        assert_upstream_credentials(request)
        if failure_stage == "auth" or request.url.path != "/auth/v1/user":
            raise httpx.ConnectError("private network details", request=request)
        return httpx.Response(200, json={"id": ALICE_ID})

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert "private network details" not in response.text
    assert USER_ACCESS_TOKEN not in response.text


@pytest.mark.parametrize("malformed_stage", ["auth", "data-json", "data-shape"])
def test_malformed_upstream_payloads_are_sanitized(malformed_stage):
    def handler(request: httpx.Request) -> httpx.Response:
        assert_upstream_credentials(request)
        if request.url.path == "/auth/v1/user":
            if malformed_stage == "auth":
                return httpx.Response(200, json={"email": "missing-id@example.test"})
            return httpx.Response(200, json={"id": ALICE_ID})
        assert request.url.path == "/rest/v1/story_projects"
        if malformed_stage == "data-json":
            return httpx.Response(
                200, content=b"not-json", headers={"content-type": "text/plain"}
            )
        return httpx.Response(200, json={"not": "an array"})

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/story-projects",
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"},
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert USER_ACCESS_TOKEN not in response.text


@pytest.mark.parametrize("method,path,payload", [
    ("POST", "/api/v1/story-projects", {"title": "Valid", "language": "sv"}),
    ("GET", "/api/v1/story-projects", None),
    ("GET", f"/api/v1/story-projects/{PROJECT_ID}", None),
    ("PATCH", f"/api/v1/story-projects/{PROJECT_ID}", {"title": "Changed"}),
    ("POST", f"/api/v1/story-projects/{PROJECT_ID}/sessions", None),
    ("GET", f"/api/v1/story-projects/{PROJECT_ID}/sessions", None),
])
def test_all_six_endpoints_require_authentication(method, path, payload):
    def handler(request):
        pytest.fail("Unauthenticated request reached the upstream")

    app = create_app(configured_settings(), transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        kwargs = {} if payload is None else {"json": payload}
        response = client.request(method, path, **kwargs)
    assert_error(response, 401, "AUTHORIZATION_REQUIRED")


@pytest.mark.parametrize("suffix", ["", "/sessions"])
def test_invalid_uuid_is_safe_validation_error(suffix):
    def data_handler(request):
        pytest.fail("Invalid UUID reached the database")

    app = create_app(configured_settings(), transport=httpx.MockTransport(authenticated_handler(data_handler)))
    with TestClient(app) as client:
        response = client.get(f"/api/v1/story-projects/not-a-uuid{suffix}", headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"})
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("payload", [
    {"title": 123, "language": "sv"}, {"title": None, "language": "sv"},
    {"title": "Valid"}, {"title": "Valid", "language": "SV"},
])
def test_project_create_does_not_coerce_or_guess_input(payload):
    app = create_app(configured_settings(), transport=httpx.MockTransport(authenticated_handler(lambda request: pytest.fail("Invalid input reached database"))))
    with TestClient(app) as client:
        response = client.post("/api/v1/story-projects", json=payload, headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"})
    assert_error(response, 422, "VALIDATION_ERROR")


def test_unexpected_cross_user_response_fails_closed_without_leaking_private_title():
    foreign = {**PROJECT_FROM_SUPABASE, "user_id": BOB_ID, "title": "Bob private title"}
    app = create_app(configured_settings(), transport=httpx.MockTransport(authenticated_handler(lambda request: httpx.Response(200, json=[foreign]))))
    with TestClient(app) as client:
        response = client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}"})
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert "Bob private title" not in response.text


def test_openapi_declares_bearer_security_for_every_business_operation():
    with TestClient(create_app(configured_settings())) as client:
        specification = client.get("/openapi.json").json()
    for path, operations in specification["paths"].items():
        if path.startswith("/api/v1/"):
            for operation in operations.values():
                assert operation["security"] == [{"SupabaseBearer": []}]


@pytest.mark.parametrize("body", ["null", " null ", "[]", "123", "\"text\""])
def test_session_creation_rejects_non_object_json_including_explicit_null(body):
    app = create_app(configured_settings(), transport=httpx.MockTransport(authenticated_handler(lambda request: pytest.fail("Invalid session body reached database"))))
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/sessions", content=body,
            headers={"Authorization": f"Bearer {USER_ACCESS_TOKEN}", "Content-Type": "application/json"},
        )
    assert_error(response, 422, "VALIDATION_ERROR")
