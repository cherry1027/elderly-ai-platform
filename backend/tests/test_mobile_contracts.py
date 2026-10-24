"""Offline Day 7 mobile contracts; no Expo, real tokens or cloud calls."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app
from app.schemas.conversations import MemoryPatch, MessageCreate
from app.schemas.exports import ContinueStoryRequest, StoryExportRequest
from app.schemas.story_drafts import StoryDraftPatch, StoryGenerationRequest
from app.schemas.story_projects import SessionCreate, StoryProjectCreate, StoryProjectPatch


OPERATIONS = {
    ("GET", "/health"),
    ("GET", "/ready"),
    ("POST", "/api/v1/story-projects"),
    ("GET", "/api/v1/story-projects"),
    ("GET", "/api/v1/story-projects/{project_id}"),
    ("PATCH", "/api/v1/story-projects/{project_id}"),
    ("POST", "/api/v1/story-projects/{project_id}/sessions"),
    ("GET", "/api/v1/story-projects/{project_id}/sessions"),
    ("POST", "/api/v1/story-sessions/{session_id}/transcribe"),
    ("GET", "/api/v1/story-sessions/{session_id}/transcripts"),
    ("POST", "/api/v1/story-sessions/{session_id}/messages"),
    ("GET", "/api/v1/story-sessions/{session_id}/messages"),
    ("GET", "/api/v1/story-sessions/{session_id}/memories"),
    ("GET", "/api/v1/story-sessions/{session_id}/clarifications"),
    ("PATCH", "/api/v1/memories/{fact_id}"),
    ("POST", "/api/v1/story-projects/{project_id}/generate"),
    ("GET", "/api/v1/story-projects/{project_id}/drafts"),
    ("GET", "/api/v1/story-drafts/{draft_id}"),
    ("PATCH", "/api/v1/story-drafts/{draft_id}"),
    ("GET", "/api/v1/story-projects/{project_id}/verification"),
    ("GET", "/api/v1/story-drafts/{draft_id}/history"),
    ("POST", "/api/v1/story-drafts/{draft_id}/export"),
    ("GET", "/api/v1/story-projects/{project_id}/exports"),
    ("GET", "/api/v1/story-exports/{export_id}/download"),
    ("POST", "/api/v1/story-projects/{project_id}/continue"),
}
PROTECTED_OPERATIONS = sorted(item for item in OPERATIONS if item[1].startswith("/api/v1/"))
REQUEST_MODELS = (
    StoryProjectCreate, StoryProjectPatch, SessionCreate, MessageCreate, MemoryPatch,
    StoryGenerationRequest, StoryDraftPatch, StoryExportRequest, ContinueStoryRequest,
)
RESOURCE_UUID = "11111111-1111-4111-8111-111111111111"
USER_UUID = "22222222-2222-4222-8222-222222222222"
NATIVE_TOKEN = "fictional-native-access-token"
PDF_EXPOSED_HEADERS = {
    "content-disposition", "content-length", "x-memy-export-id",
    "x-memy-draft-version", "x-memy-draft-revision", "x-memy-page-count",
}


def settings():
    return Settings(
        _env_file=None,
        supabase_url="https://mobile.test.supabase.co",
        supabase_publishable_key="test-publishable-key",
    )


def test_openapi_keeps_all_25_operations_and_23_user_bearer_contracts():
    schema = create_app(settings()).openapi()
    operations = {
        (method.upper(), path): operation
        for path, item in schema["paths"].items()
        for method, operation in item.items()
        if method in {"get", "post", "patch", "delete", "put"}
    }
    assert set(operations) == OPERATIONS
    assert len(PROTECTED_OPERATIONS) == 23
    for (method, path), operation in operations.items():
        if path.startswith("/api/v1/"):
            assert operation["security"] == [{"SupabaseBearer": []}], (method, path)
        else:
            assert not operation.get("security")
    assert schema["components"]["securitySchemes"]["SupabaseBearer"] == {
        "type": "http", "scheme": "bearer",
        "description": "Supabase Auth user access token from the configured development project.",
    }


@pytest.mark.parametrize("model", REQUEST_MODELS, ids=lambda model: model.__name__)
def test_swagger_request_examples_validate_without_weakening_strict_requests(model):
    components = create_app(settings()).openapi()["components"]["schemas"]
    examples = components[model.__name__]["examples"]
    assert examples
    assert components[model.__name__]["additionalProperties"] is False
    assert model.model_config["strict"] is True
    for example in examples:
        model.model_validate_json(json.dumps(example))
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps({**example, "untrusted_user_id": USER_UUID}))


@pytest.mark.parametrize("method,path", PROTECTED_OPERATIONS)
def test_every_mobile_operation_requires_auth_even_without_browser_origin(method, path):
    def never_contact_supabase(request):
        pytest.fail("Unauthenticated requests must not reach Supabase")

    url = path
    for variable in ("project_id", "session_id", "draft_id", "fact_id", "export_id"):
        url = url.replace("{" + variable + "}", RESOURCE_UUID)
    with TestClient(create_app(settings(), transport=httpx.MockTransport(never_contact_supabase))) as client:
        response = client.request(method, url)
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "AUTHORIZATION_REQUIRED", "message": "Bearer authentication is required."}
    }
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"


def test_native_style_no_origin_request_accepts_verified_token_and_preserves_user_scope():
    calls = []

    def supabase(request):
        calls.append(request.url.path)
        assert request.headers["authorization"] == f"Bearer {NATIVE_TOKEN}"
        assert request.headers["apikey"] == "test-publishable-key"
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": USER_UUID})
        assert request.url.path == "/rest/v1/story_projects"
        assert request.url.params["user_id"] == f"eq.{USER_UUID}"
        return httpx.Response(200, json=[])

    with TestClient(create_app(settings(), transport=httpx.MockTransport(supabase))) as client:
        response = client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {NATIVE_TOKEN}"})
    assert response.status_code == 200
    assert response.json() == []
    assert response.headers["cache-control"] == "no-store"
    assert "access-control-allow-origin" not in response.headers
    assert calls == ["/auth/v1/user", "/rest/v1/story_projects"]


@pytest.mark.parametrize("upstream_status", [400, 401, 403, 422])
def test_native_invalid_or_expired_tokens_do_not_reach_user_data(upstream_status):
    def supabase(request):
        assert request.url.path == "/auth/v1/user"
        return httpx.Response(upstream_status, json={"message": "secret upstream detail"})

    with TestClient(create_app(settings(), transport=httpx.MockTransport(supabase))) as client:
        response = client.get("/api/v1/story-projects", headers={"Authorization": f"Bearer {NATIVE_TOKEN}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_ACCESS_TOKEN"
    assert "secret upstream detail" not in response.text
    assert NATIVE_TOKEN not in response.text


@pytest.mark.parametrize("origin", [
    "http://localhost:8080", "http://127.0.0.1:8080",
    "http://localhost:5173", "http://127.0.0.1:5173",
])
def test_web_preflight_supports_bearer_uuid_retry_and_multipart_headers(origin):
    with TestClient(create_app(settings())) as client:
        response = client.options("/api/v1/story-sessions/" + RESOURCE_UUID + "/transcribe", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,accept-language,idempotency-key",
        })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-credentials" not in response.headers


def test_configured_web_origin_can_read_pdf_headers_on_safe_auth_errors():
    with TestClient(create_app(settings())) as client:
        response = client.get("/api/v1/story-exports/" + RESOURCE_UUID + "/download", headers={
            "Origin": "http://127.0.0.1:5173",
        })
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    exposed = {name.strip().lower() for name in response.headers["access-control-expose-headers"].split(",")}
    assert PDF_EXPOSED_HEADERS <= exposed


def test_unknown_browser_origin_is_not_granted_cors_access():
    with TestClient(create_app(settings())) as client:
        response = client.options("/api/v1/story-projects", headers={
            "Origin": "https://unapproved.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        })
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_openapi_documents_pdf_binary_not_json_and_audio_required_multipart_fields():
    paths = create_app(settings()).openapi()["paths"]
    for method, path, status in (
        ("post", "/api/v1/story-drafts/{draft_id}/export", "201"),
        ("get", "/api/v1/story-exports/{export_id}/download", "200"),
    ):
        content = paths[path][method]["responses"][status]["content"]
        assert "application/pdf" in content
        assert "application/json" not in content
    upload = paths["/api/v1/story-sessions/{session_id}/transcribe"]["post"]
    multipart = upload["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert set(multipart["required"]) == {"file", "language", "consent"}
    assert multipart["properties"]["file"]["format"] == "binary"
    assert multipart["properties"]["consent"]["enum"] == ["true"]
    assert next(header for header in upload["parameters"] if header["name"] == "Idempotency-Key")["required"] is True
