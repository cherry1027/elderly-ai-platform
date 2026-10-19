"""Offline API tests for Day 6 PDF exports and story continuation.

All Supabase traffic uses ``httpx.MockTransport`` and PDF bytes are fictional,
deterministic test data.  Nothing in this module contacts cloud services.
"""

from __future__ import annotations

import json
import hashlib
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.services.pdf_export import PdfDocument


SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER_PROJECT_ID = "abababab-abab-4bab-8bab-abababababab"
DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
EXPORT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
MEMORY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
MESSAGE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"

CREATED_AT = "2026-10-19T12:00:00Z"
UPDATED_AT = "2026-10-19T12:05:00Z"
PROJECT_TITLE = "Mitt liv, min berättelse"
ORIGINAL_CONTENT = "Jag växte upp i Malmö."
EDITED_CONTENT = "Jag växte upp i Malmö.\n\nJag minns havet."
PDF_BYTES = b"%PDF-1.4\n% fictional deterministic document\n%%EOF\n"
PDF_FILENAME = "memy-mitt-liv-min-berattelse.pdf"


def configured_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )


def project_row(*, project_id: str = PROJECT_ID) -> dict[str, Any]:
    return {
        "id": project_id,
        "user_id": USER_ID,
        "title": PROJECT_TITLE,
        "description": None,
        "language": "sv",
        "status": "draft",
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    }


def source_memory() -> dict[str, Any]:
    return {
        "memory_id": MEMORY_ID,
        "memory_version": 2,
        "source_message_id": MESSAGE_ID,
        "fact_type": "location",
        "value": "Malmö",
        "evidence": "Jag växte upp i Malmö",
        "corrected_value": None,
        "year": None,
        "slot": "grew_up_location",
        "sentence": ORIGINAL_CONTENT,
    }


def verification_report(
    *,
    status: str = "needs_review",
    method: str = "manual_unverified",
    revision: int = 2,
    sources_current: bool = True,
) -> dict[str, Any]:
    return {
        "status": status,
        "unsupported_claims": [],
        "method": method,
        "checked_revision": revision,
        "checked_at": UPDATED_AT,
        "sources_current": sources_current,
        "reason": "Manual edits require review." if method == "manual_unverified" else None,
    }


def draft_row(
    *,
    content: str = EDITED_CONTENT,
    revision: int = 2,
    status: str = "edited",
) -> dict[str, Any]:
    report = verification_report(revision=revision)
    if revision == 1:
        content = ORIGINAL_CONTENT
        status = "ready_for_review"
        report = verification_report(
            status="passed",
            method="deterministic_mock_v1",
            revision=1,
        )
    return {
        "draft_id": DRAFT_ID,
        "project_id": PROJECT_ID,
        "status": status,
        "language": "sv",
        "style": "warm",
        "version": 1,
        "revision": revision,
        "content": content,
        "original_content": ORIGINAL_CONTENT,
        "mode": "mock",
        "source_memories": [source_memory()],
        "verification": report,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    }


def export_metadata(
    *,
    title: str = PROJECT_TITLE,
    revision: int = 2,
    include_title_page: bool = True,
    include_page_numbers: bool = True,
    filename: str = PDF_FILENAME,
    byte_size: int = len(PDF_BYTES),
    page_count: int = 2,
    content: str = EDITED_CONTENT,
) -> dict[str, Any]:
    return {
        "export_id": EXPORT_ID,
        "project_id": PROJECT_ID,
        "draft_id": DRAFT_ID,
        "draft_version": 1,
        "draft_revision": revision,
        "language": "sv",
        "title": title,
        "format": "pdf",
        "include_title_page": include_title_page,
        "include_page_numbers": include_page_numbers,
        "renderer_version": "memy_pdf_v1",
        "filename": filename,
        "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "byte_size": byte_size,
        "page_count": page_count,
        "created_at": CREATED_AT,
    }


def session_row() -> dict[str, Any]:
    return {
        "id": SESSION_ID,
        "project_id": PROJECT_ID,
        "language": "sv",
        "status": "active",
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
        "ended_at": None,
    }


def continuation_row(*, session_created: bool = False) -> dict[str, Any]:
    return {
        "project_id": PROJECT_ID,
        "language": "sv",
        "session": session_row(),
        "session_created": session_created,
        "latest_draft": draft_row(),
        "generation_triggered": False,
    }


def fake_pdf_document(
    *,
    data: bytes = PDF_BYTES,
    page_count: int = 2,
    filename: str = PDF_FILENAME,
) -> PdfDocument:
    return PdfDocument(data=data, page_count=page_count, filename=filename)


class FakePdfRenderer:
    renderer_version = "memy_pdf_v1"

    def __init__(
        self,
        document: object | None = None,
        error: Exception | None = None,
    ):
        self.document = fake_pdf_document() if document is None else document
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def render(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.document


class NeverRenderer(FakePdfRenderer):
    def render(self, **kwargs):
        pytest.fail("PDF renderer must not be called")


class Scenario:
    """Auth/PostgREST double with exact user-JWT and RPC capture."""

    RPC_NAMES = {
        "load_story_export_context",
        "record_story_export",
        "get_story_export",
        "list_story_exports",
        "continue_story_project",
    }

    def __init__(self):
        self.project_rows: object = [project_row()]
        self.results: dict[str, object] = {
            "load_story_export_context": {
                "draft": draft_row(),
                "project_title": PROJECT_TITLE,
            },
            "record_story_export": export_metadata(),
            "get_story_export": {
                "export": export_metadata(revision=1, content=ORIGINAL_CONTENT),
                "content": ORIGINAL_CONTENT,
            },
            "list_story_exports": [export_metadata()],
            "continue_story_project": continuation_row(),
        }
        self.statuses: dict[str, int] = {}
        self.errors: dict[str, object] = {}
        self.events: list[str] = []
        self.rpc_payloads: dict[str, list[dict[str, Any]]] = {
            name: [] for name in self.RPC_NAMES
        }
        self.project_params: list[dict[str, str]] = []

    def _rpc(self, name: str, request: httpx.Request) -> httpx.Response:
        self.events.append(name)
        self.rpc_payloads[name].append(json.loads(request.content))
        error = self.errors.get(name)
        if isinstance(error, Exception):
            raise error
        if error is not None:
            return httpx.Response(self.statuses.get(name, 500), json=error)
        return httpx.Response(self.statuses.get(name, 200), json=self.results[name])

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "test-project.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        path = request.url.path
        if path == "/auth/v1/user":
            self.events.append("auth")
            assert request.method == "GET"
            return httpx.Response(200, json={"id": USER_ID, "email": "owner@example.test"})
        if path == "/rest/v1/story_projects":
            self.events.append("project")
            assert request.method == "GET"
            params = dict(request.url.params)
            self.project_params.append(params)
            assert params["user_id"] == f"eq.{USER_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=self.project_rows)
        prefix = "/rest/v1/rpc/"
        if path.startswith(prefix):
            assert request.method == "POST"
            name = path.removeprefix(prefix)
            assert name in self.RPC_NAMES
            return self._rpc(name, request)
        pytest.fail(f"unexpected upstream request: {request.method} {request.url}")


def make_app(scenario: Scenario, renderer: object | None = None):
    return create_app(
        configured_settings(),
        transport=httpx.MockTransport(scenario),
        pdf_renderer=renderer or FakePdfRenderer(),
    )


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {ACCESS_TOKEN}"}


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.json()["error"]["message"]
    assert "no-store" in response.headers["cache-control"]


def assert_pdf_response(response, *, revision: int = 2) -> None:
    assert response.status_code in (200, 201), response.text
    assert response.content == PDF_BYTES
    assert response.headers["content-type"] == "application/pdf"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert PDF_FILENAME in disposition
    assert "\r" not in disposition and "\n" not in disposition
    assert response.headers["x-memy-export-id"] == EXPORT_ID
    assert response.headers["x-memy-draft-version"] == "1"
    assert response.headers["x-memy-draft-revision"] == str(revision)
    assert response.headers["x-memy-page-count"] == "2"
    cache_tokens = {
        token.strip() for token in response.headers["cache-control"].split(",")
    }
    assert cache_tokens == {"private", "no-store"}
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_export_selected_edited_revision_and_record_audit_before_returning_pdf():
    scenario = Scenario()
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert response.status_code == 201
    assert_pdf_response(response)
    assert scenario.rpc_payloads["load_story_export_context"] == [{
        "p_draft_id": DRAFT_ID,
    }]
    assert renderer.calls == [{
        "title": PROJECT_TITLE,
        "content": EDITED_CONTENT,
        "language": "sv",
        "draft_version": 1,
        "draft_revision": 2,
        "include_title_page": True,
        "include_page_numbers": True,
    }]
    assert scenario.rpc_payloads["record_story_export"] == [{
        "p_draft_id": DRAFT_ID,
        "p_expected_revision": 2,
        "p_expected_title": PROJECT_TITLE,
        "p_include_title_page": True,
        "p_include_page_numbers": True,
        "p_renderer_version": "memy_pdf_v1",
        "p_filename": PDF_FILENAME,
        "p_byte_size": len(PDF_BYTES),
        "p_page_count": 2,
    }]
    assert scenario.project_params[-1]["id"] == f"eq.{PROJECT_ID}"
    assert scenario.events.index("record_story_export") > scenario.events.index("project")


def test_export_accepts_no_body_and_uses_documented_defaults():
    scenario = Scenario()
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers()
        )

    assert_pdf_response(response)
    assert renderer.calls[0]["include_title_page"] is True
    assert renderer.calls[0]["include_page_numbers"] is True


def test_export_options_are_forwarded_without_client_owned_metadata():
    scenario = Scenario()
    scenario.results["record_story_export"] = export_metadata(
        include_title_page=False,
        include_page_numbers=False,
    )
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={
                "format": "pdf",
                "include_title_page": False,
                "include_page_numbers": False,
            },
        )

    assert_pdf_response(response)
    assert renderer.calls[0]["include_title_page"] is False
    assert renderer.calls[0]["include_page_numbers"] is False
    payload = scenario.rpc_payloads["record_story_export"][0]
    assert payload["p_include_title_page"] is False
    assert payload["p_include_page_numbers"] is False


@pytest.mark.parametrize(
    "body",
    [
        None,
        {"format": "docx"},
        {"include_title_page": "true"},
        {"include_title_page": 1},
        {"include_page_numbers": "false"},
        {"include_page_numbers": 0},
        {"format": "pdf", "user_id": USER_ID},
        {"format": "pdf", "draft_revision": 99},
    ],
)
def test_export_rejects_null_invalid_boolean_and_server_owned_fields(body):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            content=b"null" if body is None else None,
            json=None if body is None else body,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["load_story_export_context"] == []
    assert scenario.rpc_payloads["record_story_export"] == []


def test_export_requires_bearer_without_rendering_or_contacting_supabase():
    def no_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"missing authentication reached upstream: {request.url}")

    app = create_app(
        configured_settings(),
        transport=httpx.MockTransport(no_calls),
        pdf_renderer=NeverRenderer(),
    )
    with TestClient(app) as client:
        response = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", json={})

    assert_error(response, 401, "AUTHORIZATION_REQUIRED")
    assert response.headers["www-authenticate"] == "Bearer"


def test_export_hides_missing_or_foreign_draft_and_never_renders():
    scenario = Scenario()
    scenario.statuses["load_story_export_context"] = 404
    scenario.errors["load_story_export_context"] = {
        "code": "P0002",
        "message": "private foreign resource detail",
    }
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 404, "RESOURCE_NOT_FOUND")
    assert "private" not in response.text
    assert scenario.rpc_payloads["record_story_export"] == []


@pytest.mark.parametrize(
    "document",
    [
        fake_pdf_document(data="not-bytes"),
        fake_pdf_document(data=b"not a pdf"),
        fake_pdf_document(data=b"%PDF-1.4 missing trailer"),
        fake_pdf_document(page_count=0),
        fake_pdf_document(page_count=True),
        fake_pdf_document(filename="../private.pdf"),
        fake_pdf_document(filename="unsafe\r\nX-Forged: yes.pdf"),
        fake_pdf_document(filename="story.txt"),
    ],
)
def test_faulty_renderer_output_is_sanitized_and_never_audited(document):
    scenario = Scenario()
    with TestClient(make_app(scenario, FakePdfRenderer(document=document))) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 503, "PDF_GENERATION_FAILED")
    assert scenario.rpc_payloads["record_story_export"] == []
    assert ACCESS_TOKEN not in response.text
    assert "X-Forged" not in response.headers


def test_renderer_validation_error_is_preserved_without_audit_record():
    scenario = Scenario()
    renderer = FakePdfRenderer(
        error=APIError(422, "EMPTY_STORY_DRAFT", "The story draft is empty.")
    )
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 422, "EMPTY_STORY_DRAFT")
    assert scenario.rpc_payloads["record_story_export"] == []


def test_unexpected_renderer_error_is_sanitized_without_audit_record():
    scenario = Scenario()
    renderer = FakePdfRenderer(
        error=RuntimeError("private renderer detail " + ACCESS_TOKEN)
    )
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 503, "PDF_GENERATION_FAILED")
    assert "private" not in response.text
    assert ACCESS_TOKEN not in response.text
    assert scenario.rpc_payloads["record_story_export"] == []


def test_audit_conflict_returns_json_and_never_releases_unrecorded_pdf_bytes():
    scenario = Scenario()
    scenario.statuses["record_story_export"] = 409
    scenario.errors["record_story_export"] = {
        "code": "55000",
        "message": "private changed revision detail " + ACCESS_TOKEN,
    }
    with TestClient(make_app(scenario)) as client:
        response = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 409, "EXPORT_SOURCE_CHANGED")
    assert response.headers["content-type"].startswith("application/json")
    assert PDF_BYTES not in response.content
    assert "private" not in response.text
    assert ACCESS_TOKEN not in response.text


def test_repeated_identical_export_can_reuse_audit_identity_without_revision_change():
    scenario = Scenario()
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        first = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )
        second = client.post(
            f"/api/v1/story-drafts/{DRAFT_ID}/export",
            headers=auth_headers(),
            json={},
        )

    assert_pdf_response(first)
    assert_pdf_response(second)
    assert first.headers["x-memy-export-id"] == second.headers["x-memy-export-id"]
    assert len(renderer.calls) == 2
    assert len(scenario.rpc_payloads["record_story_export"]) == 2
    assert all(
        payload["p_expected_revision"] == 2
        for payload in scenario.rpc_payloads["record_story_export"]
    )


def test_list_exports_is_owned_paginated_and_plain_array():
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/exports?limit=2&offset=3",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json() == [export_metadata()]
    assert scenario.rpc_payloads["list_story_exports"] == [{
        "p_project_id": PROJECT_ID,
        "p_limit": 2,
        "p_offset": 3,
    }]
    assert scenario.events.index("project") < scenario.events.index("list_story_exports")


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "offset=100001"])
def test_list_exports_rejects_pagination_outside_contract(query):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/exports?{query}",
            headers=auth_headers(),
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["list_story_exports"] == []


def test_list_exports_hides_foreign_project_before_rpc():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/exports",
            headers=auth_headers(),
        )

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.rpc_payloads["list_story_exports"] == []


def test_download_renders_the_recorded_historical_revision_read_only():
    scenario = Scenario()
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )

    assert response.status_code == 200
    assert_pdf_response(response, revision=1)
    assert scenario.rpc_payloads["get_story_export"] == [{
        "p_export_id": EXPORT_ID,
    }]
    assert renderer.calls == [{
        "title": PROJECT_TITLE,
        "content": ORIGINAL_CONTENT,
        "language": "sv",
        "draft_version": 1,
        "draft_revision": 1,
        "include_title_page": True,
        "include_page_numbers": True,
    }]
    assert scenario.rpc_payloads["record_story_export"] == []
    assert scenario.project_params[-1]["id"] == f"eq.{PROJECT_ID}"


def test_repeated_download_is_read_only_and_does_not_change_selected_revision():
    scenario = Scenario()
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        first = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )
        second = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )

    assert_pdf_response(first, revision=1)
    assert_pdf_response(second, revision=1)
    assert len(scenario.rpc_payloads["get_story_export"]) == 2
    assert scenario.rpc_payloads["record_story_export"] == []
    assert all(call["content"] == ORIGINAL_CONTENT for call in renderer.calls)


def test_download_hides_foreign_export_and_never_renders():
    scenario = Scenario()
    scenario.statuses["get_story_export"] = 404
    scenario.errors["get_story_export"] = {
        "code": "P0002",
        "message": "private foreign export detail",
    }
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )

    assert_error(response, 404, "RESOURCE_NOT_FOUND")
    assert "private" not in response.text


def test_download_never_uses_title_as_an_unsanitized_header_value():
    scenario = Scenario()
    malicious_title = "My story\r\nX-Token: " + ACCESS_TOKEN
    scenario.results["get_story_export"] = {
        "export": export_metadata(
            title=malicious_title, revision=1, content=ORIGINAL_CONTENT
        ),
        "content": ORIGINAL_CONTENT,
    }
    renderer = FakePdfRenderer()
    with TestClient(make_app(scenario, renderer)) as client:
        response = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )

    assert_pdf_response(response, revision=1)
    header_text = "\n".join(f"{key}: {value}" for key, value in response.headers.items())
    assert malicious_title not in header_text
    assert ACCESS_TOKEN not in header_text
    assert "x-token" not in response.headers


def test_continue_existing_project_returns_latest_draft_without_generation():
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/continue",
            headers=auth_headers(),
            json={},
        )

    assert response.status_code == 200, response.text
    assert response.json() == continuation_row()
    assert response.json()["generation_triggered"] is False
    assert response.json()["latest_draft"]["content"] == EDITED_CONTENT
    assert response.json()["latest_draft"]["revision"] == 2
    assert response.json()["session_created"] is False
    assert scenario.rpc_payloads["continue_story_project"] == [{
        "p_project_id": PROJECT_ID,
    }]
    assert scenario.events.index("project") < scenario.events.index("continue_story_project")
    assert scenario.rpc_payloads["record_story_export"] == []


def test_continue_without_body_can_create_session_but_never_a_draft():
    scenario = Scenario()
    scenario.results["continue_story_project"] = {
        **continuation_row(session_created=True),
        "latest_draft": None,
    }
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/continue",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json()["session_created"] is True
    assert response.json()["latest_draft"] is None
    assert response.json()["generation_triggered"] is False


@pytest.mark.parametrize("body", [None, {"generate": True}, {"user_id": USER_ID}])
def test_continue_rejects_null_or_unknown_fields_without_rpc(body):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/continue",
            headers=auth_headers(),
            content=b"null" if body is None else None,
            json=None if body is None else body,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["continue_story_project"] == []


def test_continue_hides_foreign_project_without_session_or_generation_mutation():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/continue",
            headers=auth_headers(),
            json={},
        )

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.rpc_payloads["continue_story_project"] == []


@pytest.mark.parametrize(
    ("rpc_name", "upstream_status", "upstream_code", "status", "code"),
    [
        ("get_story_export", 400, "P0002", 404, "RESOURCE_NOT_FOUND"),
        ("record_story_export", 409, "55000", 409, "EXPORT_SOURCE_CHANGED"),
        ("list_story_exports", 400, "22023", 422, "VALIDATION_ERROR"),
        ("continue_story_project", 403, "42501", 403, "ACCESS_DENIED"),
    ],
)
def test_export_rpc_errors_are_stable_and_sanitized(
    rpc_name, upstream_status, upstream_code, status, code
):
    scenario = Scenario()
    scenario.statuses[rpc_name] = upstream_status
    scenario.errors[rpc_name] = {
        "code": upstream_code,
        "message": "private database detail " + ACCESS_TOKEN,
    }
    with TestClient(make_app(scenario)) as client:
        if rpc_name == "get_story_export":
            response = client.get(
                f"/api/v1/story-exports/{EXPORT_ID}/download",
                headers=auth_headers(),
            )
        elif rpc_name == "record_story_export":
            response = client.post(
                f"/api/v1/story-drafts/{DRAFT_ID}/export",
                headers=auth_headers(),
                json={},
            )
        elif rpc_name == "list_story_exports":
            response = client.get(
                f"/api/v1/story-projects/{PROJECT_ID}/exports",
                headers=auth_headers(),
            )
        else:
            response = client.post(
                f"/api/v1/story-projects/{PROJECT_ID}/continue",
                headers=auth_headers(),
                json={},
            )

    assert_error(response, status, code)
    assert "private" not in response.text
    assert ACCESS_TOKEN not in response.text


def test_malformed_export_payload_is_unavailable_without_rendering():
    scenario = Scenario()
    scenario.results["get_story_export"] = {
        "export": {**export_metadata(), "renderer_version": "paid-vendor"},
        "content": ORIGINAL_CONTENT,
    }
    with TestClient(make_app(scenario, NeverRenderer())) as client:
        response = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
