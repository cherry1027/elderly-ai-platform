"""Offline API tests for Day 5 story generation, verification and editing.

All Auth and PostgREST traffic is served by ``httpx.MockTransport``.  The
suite never contacts Supabase or an AI provider and uses only fictional data.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
MEMORY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
HISTORY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CLARIFICATION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333"

CREATED_AT = "2026-10-19T10:00:00Z"
UPDATED_AT = "2026-10-19T10:05:00Z"
SUPPORTED_CONTENT = "Jag bodde i Malmö år 1974."
EDITED_CONTENT = "Jag bodde i Malmö år 1975."
UNSUPPORTED_CONTENT = "Jag föddes på Mars och blev astronaut."
CONTEXT_TOKEN = "a" * 64


def configured_settings(*, mode: str = "mock") -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
        story_generation_mode=mode,
    )


def project_row(*, language: str = "sv") -> dict[str, Any]:
    return {
        "id": PROJECT_ID,
        "user_id": USER_ID,
        "title": "Min berättelse",
        "description": None,
        "language": language,
        "status": "draft",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
    }


def source_memory() -> dict[str, Any]:
    return {
        "memory_id": MEMORY_ID,
        "memory_version": 2,
        "source_message_id": MESSAGE_ID,
        "fact_type": "location",
        "value": "Malmö",
        "evidence": "Jag bodde i Malmö år 1974.",
        "corrected_value": None,
        "year": 1974,
        "slot": "home",
        "sentence": SUPPORTED_CONTENT,
    }


def verification_report(
    *,
    status: str = "passed",
    method: str = "deterministic_mock_v1",
    checked_revision: int | None = 1,
    sources_current: bool = True,
    unsupported_claims: list[str] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "unsupported_claims": [] if unsupported_claims is None else unsupported_claims,
        "method": method,
        "checked_revision": checked_revision,
        "checked_at": None if method == "none" else UPDATED_AT,
        "sources_current": sources_current,
        "reason": reason,
    }


def draft_row(
    *,
    content: str = SUPPORTED_CONTENT,
    original_content: str = SUPPORTED_CONTENT,
    status: str = "ready_for_review",
    version: int = 1,
    revision: int = 1,
    verification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "draft_id": DRAFT_ID,
        "project_id": PROJECT_ID,
        "status": status,
        "language": "sv",
        "style": "warm",
        "version": version,
        "revision": revision,
        "content": content,
        "original_content": original_content,
        "mode": "mock",
        "source_memories": [source_memory()],
        "verification": verification or verification_report(),
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT if revision > 1 else CREATED_AT,
    }


def edited_draft_row() -> dict[str, Any]:
    return draft_row(
        content=EDITED_CONTENT,
        status="edited",
        revision=2,
        verification=verification_report(
            status="needs_review",
            method="manual_unverified",
            checked_revision=2,
            reason="Manual edits require review.",
        ),
    )


def context_row() -> dict[str, Any]:
    return {
        "project_id": PROJECT_ID,
        "language": "sv",
        "context_token": CONTEXT_TOKEN,
        "confirmed_count": 1,
        "source_memories": [source_memory()],
        "excluded_memories": [],
        "blocking_clarifications": [],
        "canonical_content": SUPPORTED_CONTENT,
    }


def project_verification(
    *, verification: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "project_id": PROJECT_ID,
        "draft_id": DRAFT_ID,
        "version": 1,
        "revision": 1,
        "verification": verification or verification_report(),
    }


def history_row() -> dict[str, Any]:
    return {
        "id": HISTORY_ID,
        "draft_id": DRAFT_ID,
        "revision": 2,
        "previous_content": SUPPORTED_CONTENT,
        "content": EDITED_CONTENT,
        "created_at": UPDATED_AT,
    }


class FakeWriter:
    mode = "mock"

    def __init__(self, content: str = SUPPORTED_CONTENT, error: Exception | None = None):
        self.content = content
        self.error = error
        self.calls: list[tuple[str, str, list[dict[str, Any]]]] = []

    async def write(
        self, language: str, style: str, source_memories: list[dict[str, Any]]
    ) -> str:
        self.calls.append((language, style, source_memories))
        if self.error is not None:
            raise self.error
        return self.content


class NeverWriter(FakeWriter):
    async def write(
        self, language: str, style: str, source_memories: list[dict[str, Any]]
    ) -> str:
        pytest.fail("story writer must not be called")


class DisabledWriter:
    mode = "disabled"

    async def write(
        self, language: str, style: str, source_memories: list[dict[str, Any]]
    ) -> str:
        pytest.fail("disabled writer must not be called")


class Scenario:
    """Auth/PostgREST test double with exact RPC interaction capture."""

    RPC_NAMES = {
        "get_story_generation",
        "load_story_context",
        "save_story_generation",
        "get_story_draft",
        "list_story_drafts",
        "edit_story_draft",
        "get_story_project_verification",
        "list_story_edit_history",
    }

    def __init__(self):
        self.project_rows: object = [project_row()]
        self.results: dict[str, object] = {
            "get_story_generation": None,
            "load_story_context": context_row(),
            "save_story_generation": draft_row(),
            "get_story_draft": draft_row(),
            "list_story_drafts": [draft_row()],
            "edit_story_draft": edited_draft_row(),
            "get_story_project_verification": project_verification(),
            "list_story_edit_history": [history_row()],
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
        result = self.results[name]
        if result is None:
            return httpx.Response(
                self.statuses.get(name, 200),
                content=b"null",
                headers={"content-type": "application/json"},
            )
        return httpx.Response(self.statuses.get(name, 200), json=result)

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
            assert params["id"] == f"eq.{PROJECT_ID}"
            assert params["user_id"] == f"eq.{USER_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=self.project_rows)
        rpc_prefix = "/rest/v1/rpc/"
        if path.startswith(rpc_prefix):
            assert request.method == "POST"
            name = path.removeprefix(rpc_prefix)
            assert name in self.RPC_NAMES
            return self._rpc(name, request)
        pytest.fail(f"unexpected upstream request: {request.method} {request.url}")


def make_app(scenario: Scenario, writer: object | None = None, *, mode: str = "mock"):
    return create_app(
        configured_settings(mode=mode),
        transport=httpx.MockTransport(scenario),
        story_writer=writer or FakeWriter(),
    )


def auth_headers(*, with_key: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    if with_key:
        headers["Idempotency-Key"] = IDEMPOTENCY_KEY
    return headers


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.json()["error"]["message"]
    assert response.headers["cache-control"] == "no-store"


def generate(client: TestClient, *, json_body: dict[str, Any] | None = None):
    return client.post(
        f"/api/v1/story-projects/{PROJECT_ID}/generate",
        headers=auth_headers(with_key=True),
        json=json_body
        or {"language": "sv", "style": "warm", "confirm_generation": True},
    )


def test_generate_is_explicit_owned_verified_and_saved_atomically():
    scenario = Scenario()
    writer = FakeWriter()
    with TestClient(make_app(scenario, writer)) as client:
        response = generate(
            client,
            json_body={"language": "sv", "confirm_generation": True},
        )

    assert response.status_code == 201, response.text
    assert response.json() == draft_row()
    assert response.headers["cache-control"] == "no-store"
    assert scenario.events == [
        "auth",
        "project",
        "get_story_generation",
        "load_story_context",
        "save_story_generation",
    ]
    assert scenario.rpc_payloads["get_story_generation"] == [{
        "p_project_id": PROJECT_ID,
        "p_idempotency_key": IDEMPOTENCY_KEY,
        "p_language": "sv",
        "p_style": "warm",
    }]
    assert scenario.rpc_payloads["load_story_context"] == [{
        "p_project_id": PROJECT_ID,
    }]
    assert scenario.rpc_payloads["save_story_generation"] == [{
        "p_project_id": PROJECT_ID,
        "p_idempotency_key": IDEMPOTENCY_KEY,
        "p_language": "sv",
        "p_style": "warm",
        "p_confirm_generation": True,
        "p_context_token": CONTEXT_TOKEN,
        "p_content": SUPPORTED_CONTENT,
    }]
    assert writer.calls == [("sv", "warm", [source_memory()])]


@pytest.mark.parametrize(
    "payload",
    [
        {"language": "sv"},
        {"language": "sv", "confirm_generation": False},
        {"language": "sv", "confirm_generation": "true"},
        {"language": "sv", "confirm_generation": 1},
        {"language": "de", "confirm_generation": True},
        {"language": "sv", "style": "formal", "confirm_generation": True},
        {"language": "sv", "confirm_generation": True, "user_id": USER_ID},
        {"language": "sv", "confirm_generation": True, "status": "passed"},
    ],
)
def test_generate_requires_strict_explicit_consent_and_rejects_forged_fields(payload):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverWriter())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/generate",
            headers=auth_headers(with_key=True),
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["save_story_generation"] == []


@pytest.mark.parametrize("key", [None, "", "not-a-uuid", "1" * 65])
def test_generate_requires_uuid_idempotency_key(key):
    scenario = Scenario()
    headers = auth_headers()
    if key is not None:
        headers["Idempotency-Key"] = key
    with TestClient(make_app(scenario, NeverWriter())) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/generate",
            headers=headers,
            json={"language": "sv", "confirm_generation": True},
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["save_story_generation"] == []


def test_generate_requires_bearer_without_contacting_supabase():
    def no_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"missing authentication reached upstream: {request.url}")

    app = create_app(
        configured_settings(),
        transport=httpx.MockTransport(no_calls),
        story_writer=NeverWriter(),
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/generate",
            headers={"Idempotency-Key": IDEMPOTENCY_KEY},
            json={"language": "sv", "confirm_generation": True},
        )

    assert_error(response, 401, "AUTHORIZATION_REQUIRED")
    assert response.headers["www-authenticate"] == "Bearer"


def test_generate_hides_missing_or_foreign_project_before_rpc_or_writer():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario, NeverWriter())) as client:
        response = generate(client)

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.events == ["auth", "project"]
    assert not any(scenario.rpc_payloads.values())


def test_generate_rejects_language_different_from_owned_project():
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverWriter())) as client:
        response = generate(
            client,
            json_body={"language": "en", "confirm_generation": True},
        )

    assert_error(response, 422, "LANGUAGE_MISMATCH")
    assert scenario.events == ["auth", "project"]
    assert scenario.rpc_payloads["get_story_generation"] == []


def test_committed_replay_returns_current_edited_draft_even_when_mode_disabled():
    scenario = Scenario()
    scenario.results["get_story_generation"] = edited_draft_row()
    with TestClient(make_app(scenario, DisabledWriter(), mode="disabled")) as client:
        response = generate(client)

    assert response.status_code == 201, response.text
    assert response.json() == edited_draft_row()
    assert scenario.events == ["auth", "project", "get_story_generation"]
    assert scenario.rpc_payloads["load_story_context"] == []
    assert scenario.rpc_payloads["save_story_generation"] == []


def test_disabled_generation_checks_replay_but_performs_no_new_work():
    scenario = Scenario()
    with TestClient(make_app(scenario, DisabledWriter(), mode="disabled")) as client:
        response = generate(client)

    assert_error(response, 503, "STORY_GENERATION_DISABLED")
    assert scenario.events == ["auth", "project", "get_story_generation"]
    assert scenario.rpc_payloads["load_story_context"] == []
    assert scenario.rpc_payloads["save_story_generation"] == []


@pytest.mark.parametrize(
    ("context", "code"),
    [
        (
            {
                **context_row(),
                "blocking_clarifications": [CLARIFICATION_ID],
            },
            "CLARIFICATION_REQUIRED",
        ),
        (
            {
                **context_row(),
                "confirmed_count": 0,
                "source_memories": [],
                "excluded_memories": [
                    {"memory_id": MEMORY_ID, "reason": "pending"}
                ],
                "canonical_content": "",
            },
            "NO_CONFIRMED_MEMORIES",
        ),
        (
            {
                **context_row(),
                "source_memories": [],
                "excluded_memories": [
                    {"memory_id": MEMORY_ID, "reason": "unsupported"}
                ],
                "canonical_content": "",
            },
            "NO_SUPPORTED_MEMORIES",
        ),
    ],
)
def test_generation_blocks_unresolved_or_unusable_memory_context(context, code):
    scenario = Scenario()
    scenario.results["load_story_context"] = context
    with TestClient(make_app(scenario, NeverWriter())) as client:
        response = generate(client)

    assert_error(response, 409, code)
    assert scenario.rpc_payloads["save_story_generation"] == []


def test_unsupported_writer_content_is_never_saved_or_reported_as_passed():
    scenario = Scenario()
    writer = FakeWriter(UNSUPPORTED_CONTENT)
    with TestClient(make_app(scenario, writer)) as client:
        response = generate(client)

    assert_error(response, 422, "DRAFT_VERIFICATION_FAILED")
    assert response.json()["error"]["code"] != "passed"
    assert scenario.rpc_payloads["save_story_generation"] == []
    assert writer.calls == [("sv", "warm", [source_memory()])]


def test_writer_failure_is_sanitized_and_never_saved():
    scenario = Scenario()
    writer = FakeWriter(error=RuntimeError("private provider detail " + ACCESS_TOKEN))
    with TestClient(make_app(scenario, writer)) as client:
        response = generate(client)

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "STORY_WRITER_INVALID_RESPONSE"
    assert "private" not in response.text
    assert ACCESS_TOKEN not in response.text
    assert scenario.rpc_payloads["save_story_generation"] == []


def test_list_drafts_is_owned_plain_array_with_bounded_pagination():
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/drafts?limit=2&offset=3",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json() == [draft_row()]
    assert scenario.rpc_payloads["list_story_drafts"] == [{
        "p_project_id": PROJECT_ID,
        "p_limit": 2,
        "p_offset": 3,
    }]
    assert scenario.events == ["auth", "project", "list_story_drafts"]


def test_project_verification_can_report_stale_sources_without_claiming_passed():
    scenario = Scenario()
    stale = verification_report(
        status="stale_sources",
        sources_current=False,
        reason="Confirmed source memories changed.",
    )
    scenario.results["get_story_project_verification"] = project_verification(
        verification=stale
    )
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/verification",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json()["verification"] == stale
    assert response.json()["verification"]["status"] != "passed"
    assert scenario.rpc_payloads["get_story_project_verification"] == [{
        "p_project_id": PROJECT_ID,
    }]


def test_project_without_a_draft_has_explicit_not_generated_verification():
    scenario = Scenario()
    report = verification_report(
        status="not_generated",
        method="none",
        checked_revision=None,
        reason="No story has been generated.",
    )
    scenario.results["get_story_project_verification"] = {
        "project_id": PROJECT_ID,
        "draft_id": None,
        "version": None,
        "revision": None,
        "verification": report,
    }
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-projects/{PROJECT_ID}/verification",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json()["verification"]["status"] == "not_generated"


def test_get_draft_uses_rpc_ownership_and_rechecks_its_parent_project():
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert response.status_code == 200, response.text
    assert response.json() == draft_row()
    assert scenario.rpc_payloads["get_story_draft"] == [{"p_draft_id": DRAFT_ID}]
    assert scenario.events == ["auth", "get_story_draft", "project"]


def test_get_draft_never_exposes_a_row_whose_parent_is_not_owned():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.events == ["auth", "get_story_draft", "project"]


def test_edited_draft_remains_needs_review_when_sources_are_stale():
    scenario = Scenario()
    report = verification_report(
        status="needs_review",
        method="manual_unverified",
        checked_revision=2,
        sources_current=False,
        reason="Source memories changed after this draft was edited.",
    )
    expected = draft_row(
        content=EDITED_CONTENT,
        status="edited",
        revision=2,
        verification=report,
    )
    scenario.results["get_story_draft"] = expected
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert response.status_code == 200, response.text
    assert response.json() == expected
    assert response.json()["verification"]["status"] == "needs_review"
    assert response.json()["verification"]["sources_current"] is False


def test_edited_draft_cannot_disguise_manual_review_as_stale_verification():
    scenario = Scenario()
    scenario.results["get_story_draft"] = draft_row(
        content=EDITED_CONTENT,
        status="edited",
        revision=2,
        verification=verification_report(
            status="stale_sources",
            method="manual_unverified",
            checked_revision=2,
            sources_current=False,
            reason="Source memories changed.",
        ),
    )
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")

def test_ready_for_review_draft_cannot_hide_a_later_revision():
    scenario = Scenario()
    scenario.results["get_story_draft"] = draft_row(
        status="ready_for_review",
        revision=2,
        verification=verification_report(checked_revision=2),
    )
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")


def test_edit_preserves_revision_history_and_marks_content_unverified():
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/story-drafts/{DRAFT_ID}",
            headers=auth_headers(),
            json={"content": f"  {EDITED_CONTENT}  ", "expected_revision": 1},
        )

    assert response.status_code == 200, response.text
    assert response.json() == edited_draft_row()
    report = response.json()["verification"]
    assert report["status"] == "needs_review"
    assert report["method"] == "manual_unverified"
    assert report["status"] != "passed"
    assert scenario.rpc_payloads["edit_story_draft"] == [{
        "p_draft_id": DRAFT_ID,
        "p_expected_revision": 1,
        "p_content": EDITED_CONTENT,
    }]
    assert scenario.events == [
        "auth", "get_story_draft", "project", "edit_story_draft"
    ]


def test_edit_rejects_database_response_that_marks_manual_content_passed():
    scenario = Scenario()
    scenario.results["edit_story_draft"] = draft_row(
        content=EDITED_CONTENT,
        status="edited",
        revision=2,
        verification=verification_report(status="passed"),
    )
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/story-drafts/{DRAFT_ID}",
            headers=auth_headers(),
            json={"content": EDITED_CONTENT, "expected_revision": 1},
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert '"status":"passed"' not in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {"content": "valid"},
        {"content": "valid", "expected_revision": 0},
        {"content": "   ", "expected_revision": 1},
        {"content": "x" * 20001, "expected_revision": 1},
        {"content": "valid", "expected_revision": 1, "user_id": USER_ID},
        {"content": "valid", "expected_revision": 1, "status": "passed"},
    ],
)
def test_edit_rejects_invalid_or_server_owned_fields_without_rpc(payload):
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/story-drafts/{DRAFT_ID}",
            headers=auth_headers(),
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["edit_story_draft"] == []


def test_edit_history_is_a_plain_owned_array_with_pagination():
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}/history?limit=2&offset=3",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json() == [history_row()]
    assert scenario.rpc_payloads["list_story_edit_history"] == [{
        "p_draft_id": DRAFT_ID,
        "p_limit": 2,
        "p_offset": 3,
    }]
    assert scenario.events == [
        "auth", "get_story_draft", "project", "list_story_edit_history"
    ]


@pytest.mark.parametrize(
    ("path", "rpc_name"),
    [
        (f"/api/v1/story-projects/{PROJECT_ID}/drafts", "list_story_drafts"),
        (f"/api/v1/story-drafts/{DRAFT_ID}/history", "list_story_edit_history"),
    ],
)
@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "offset=100001"])
def test_list_routes_reject_pagination_outside_contract(path, rpc_name, query):
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.get(f"{path}?{query}", headers=auth_headers())

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads[rpc_name] == []


@pytest.mark.parametrize(
    ("upstream_code", "upstream_status", "expected_status", "expected_code"),
    [
        ("P0002", 400, 404, "RESOURCE_NOT_FOUND"),
        ("23505", 409, 409, "IDEMPOTENCY_CONFLICT"),
        ("55000", 409, 409, "STORY_CONTEXT_CHANGED"),
        ("22023", 400, 422, "VALIDATION_ERROR"),
        ("54000", 500, 409, "CONTEXT_LIMIT"),
    ],
)
def test_story_rpc_errors_are_mapped_without_leaking_database_details(
    upstream_code, upstream_status, expected_status, expected_code
):
    scenario = Scenario()
    scenario.statuses["save_story_generation"] = upstream_status
    scenario.errors["save_story_generation"] = {
        "code": upstream_code,
        "message": "private database detail " + ACCESS_TOKEN,
    }
    with TestClient(make_app(scenario)) as client:
        response = generate(client)

    assert_error(response, expected_status, expected_code)
    assert "private" not in response.text
    assert ACCESS_TOKEN not in response.text


def test_malformed_draft_from_database_is_sanitized():
    scenario = Scenario()
    scenario.results["get_story_draft"] = {**draft_row(), "mode": "paid-real-ai"}
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{DRAFT_ID}", headers=auth_headers()
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
