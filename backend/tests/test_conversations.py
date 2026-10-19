"""Offline API tests for Day 4 simulated conversations and reviewed memories.

All upstream Auth/PostgREST traffic is handled by ``httpx.MockTransport``.
No test in this module contacts Supabase or an AI service.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from types import SimpleNamespace
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
OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
IDEMPOTENCY_KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
USER_MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
ASSISTANT_MESSAGE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
FACT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
CLARIFICATION_ID = "33333333-3333-4333-8333-333333333333"
PRIOR_FACT_ID_A = "44444444-4444-4444-8444-444444444444"
PRIOR_FACT_ID_B = "55555555-5555-4555-8555-555555555555"
CREATED_AT = "2026-10-19T08:00:00Z"
UPDATED_AT = "2026-10-19T08:01:00Z"
SOURCE_TEXT = "Jag bodde i Malmo 1968."
ASSISTANT_TEXT = "Tack, jag har sparat minnet om Malmo."


def configured_settings(*, mode: str = "mock") -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
        conversation_mode=mode,
    )


def project_row() -> dict[str, Any]:
    return {
        "id": PROJECT_ID,
        "user_id": USER_ID,
        "title": "Minnen",
        "description": None,
        "language": "sv",
        "status": "draft",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
    }


def session_row(*, status: str = "active") -> dict[str, Any]:
    return {
        "id": SESSION_ID,
        "project_id": PROJECT_ID,
        "language": "sv",
        "status": status,
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
        "ended_at": None if status == "active" else UPDATED_AT,
    }


def message_row(
    *,
    message_id: str = USER_MESSAGE_ID,
    sequence: int = 1,
    role: str = "user",
    text: str = SOURCE_TEXT,
) -> dict[str, Any]:
    return {
        "id": message_id,
        "session_id": SESSION_ID,
        "sequence": sequence,
        "role": role,
        "text": text,
        "language": "sv",
        "created_at": CREATED_AT,
    }


def memory_row(
    *,
    fact_id: str = FACT_ID,
    status: str = "pending",
    corrected_value: str | None = None,
    version: int = 1,
) -> dict[str, Any]:
    return {
        "id": fact_id,
        "project_id": PROJECT_ID,
        "session_id": SESSION_ID,
        "source_message_id": USER_MESSAGE_ID,
        "fact_type": "location",
        "value": "Malmo",
        "evidence": "Malmo",
        "year": None,
        "slot": "home",
        "uncertain": True,
        "status": status,
        "corrected_value": corrected_value,
        "version": version,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT if version > 1 else CREATED_AT,
    }


def clarification_row() -> dict[str, Any]:
    return {
        "id": CLARIFICATION_ID,
        "fact_id": FACT_ID,
        "session_id": SESSION_ID,
        "conflicts_with_fact_id": None,
        "question": "Vilket ar var det?",
        "status": "open",
        "resolution": None,
        "created_at": CREATED_AT,
        "resolved_at": None,
    }


def turn_row() -> dict[str, Any]:
    return {
        "user_message": message_row(),
        "message": message_row(
            message_id=ASSISTANT_MESSAGE_ID,
            sequence=2,
            role="assistant",
            text=ASSISTANT_TEXT,
        ),
        "memories": [memory_row()],
        "clarifications": [clarification_row()],
        "requires_clarification": True,
        "mode": "mock",
    }


@dataclass
class Candidate:
    fact_type: str = "location"
    value: str = "Malmo"
    evidence: str = "Malmo"
    year: int | None = None
    slot: str | None = "home"
    uncertain: bool = True
    clarification_question: str | None = "Vilket ar var det?"
    conflicts_with_fact_id: str | None = None


class FakeProvider:
    mode = "mock"

    def __init__(
        self,
        *,
        text: Any = ASSISTANT_TEXT,
        facts: Any = None,
        error: Exception | None = None,
    ):
        self.text = text
        self.facts = [Candidate()] if facts is None else facts
        self.error = error
        self.calls: list[tuple[str, str, list[dict[str, Any]]]] = []

    async def respond(self, text: str, language: str, prior_facts: list[dict]):
        self.calls.append((text, language, prior_facts))
        if self.error is not None:
            raise self.error
        return SimpleNamespace(text=self.text, facts=self.facts)


class NeverProvider(FakeProvider):
    async def respond(self, text: str, language: str, prior_facts: list[dict]):
        pytest.fail("conversation provider must not be called")


class DisabledProvider:
    mode = "disabled"

    async def respond(self, text: str, language: str, prior_facts: list[dict]):
        pytest.fail("disabled provider must not be called")


class Scenario:
    """Deterministic Auth/PostgREST double with interaction capture."""

    def __init__(self):
        self.session_rows: object = [session_row()]
        self.project_rows: object = [project_row()]
        self.source_rows: object = [message_row()]
        self.message_rows: object = [message_row(), turn_row()["message"]]
        self.latest_rows: object = []
        self.prior_rows: object = []
        self.memory_rows: object = [memory_row()]
        self.clarification_rows: object = [clarification_row()]
        self.get_turn: object = None
        self.append_turn: object = turn_row()
        self.resolve_turn: object = memory_row(
            status="confirmed", corrected_value="Malmo stad", version=2
        )
        self.rpc_status: dict[str, int] = {}
        self.rpc_errors: dict[str, object] = {}
        self.events: list[str] = []
        self.rpc_payloads: dict[str, list[dict[str, Any]]] = {
            "get_conversation_turn": [],
            "append_conversation_turn": [],
            "resolve_memory_fact": [],
        }
        self.params: dict[str, list[dict[str, str]]] = {
            "sessions": [],
            "projects": [],
            "messages": [],
            "memories": [],
            "clarifications": [],
        }

    def _rpc(self, name: str, request: httpx.Request) -> httpx.Response:
        self.events.append(name)
        self.rpc_payloads[name].append(json.loads(request.content))
        error = self.rpc_errors.get(name)
        if isinstance(error, Exception):
            raise error
        if error is not None:
            return httpx.Response(self.rpc_status.get(name, 500), json=error)
        body = {
            "get_conversation_turn": self.get_turn,
            "append_conversation_turn": self.append_turn,
            "resolve_memory_fact": self.resolve_turn,
        }[name]
        if body is None:
            return httpx.Response(
                self.rpc_status.get(name, 200),
                content=b"null",
                headers={"content-type": "application/json"},
            )
        return httpx.Response(self.rpc_status.get(name, 200), json=body)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "test-project.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        path = request.url.path
        if path == "/auth/v1/user":
            self.events.append("auth")
            assert request.method == "GET"
            return httpx.Response(200, json={"id": USER_ID, "email": "owner@example.test"})
        if path == "/rest/v1/conversation_sessions":
            self.events.append("session")
            assert request.method == "GET"
            params = dict(request.url.params)
            self.params["sessions"].append(params)
            assert params["id"] == f"eq.{SESSION_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=self.session_rows)
        if path == "/rest/v1/story_projects":
            self.events.append("project")
            assert request.method == "GET"
            params = dict(request.url.params)
            self.params["projects"].append(params)
            assert params["id"] == f"eq.{PROJECT_ID}"
            assert params["user_id"] == f"eq.{USER_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=self.project_rows)
        if path == "/rest/v1/conversation_message_history":
            assert request.method == "GET"
            params = dict(request.url.params)
            self.params["messages"].append(params)
            if "id" in params:
                self.events.append("source")
                return httpx.Response(200, json=self.source_rows)
            if params.get("order") == "sequence.desc":
                self.events.append("latest")
                return httpx.Response(200, json=self.latest_rows)
            self.events.append("messages")
            return httpx.Response(200, json=self.message_rows)
        if path == "/rest/v1/memory_facts":
            assert request.method == "GET"
            params = dict(request.url.params)
            self.params["memories"].append(params)
            if "id" in params:
                self.events.append("memory")
                return httpx.Response(200, json=self.memory_rows)
            if "project_id" in params:
                self.events.append("prior")
                return httpx.Response(200, json=self.prior_rows)
            self.events.append("memories")
            return httpx.Response(200, json=self.memory_rows)
        if path == "/rest/v1/memory_clarifications":
            assert request.method == "GET"
            self.events.append("clarifications")
            self.params["clarifications"].append(dict(request.url.params))
            return httpx.Response(200, json=self.clarification_rows)
        rpc_prefix = "/rest/v1/rpc/"
        if path.startswith(rpc_prefix):
            assert request.method == "POST"
            name = path.removeprefix(rpc_prefix)
            assert name in self.rpc_payloads
            return self._rpc(name, request)
        pytest.fail(f"unexpected upstream request: {request.method} {request.url}")


def make_app(scenario: Scenario, provider: object | None = None):
    return create_app(
        configured_settings(),
        transport=httpx.MockTransport(scenario),
        conversation_provider=provider or FakeProvider(),
    )


def auth_headers(*, with_key: bool = False) -> dict[str, str]:
    result = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    if with_key:
        result["Idempotency-Key"] = IDEMPOTENCY_KEY
    return result


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.json()["error"]["message"]
    assert response.headers["cache-control"] == "no-store"


def test_submit_message_is_owned_atomic_and_uses_only_the_user_jwt():
    scenario = Scenario()
    provider = FakeProvider()
    with TestClient(make_app(scenario, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": f"  {SOURCE_TEXT}  ", "language": "sv"},
        )

    assert response.status_code == 201, response.text
    assert response.json() == turn_row()
    assert response.headers["cache-control"] == "no-store"
    assert scenario.events == [
        "auth", "session", "project", "get_conversation_turn", "latest", "prior",
        "append_conversation_turn",
    ]
    base = {
        "p_session_id": SESSION_ID,
        "p_idempotency_key": IDEMPOTENCY_KEY,
        "p_text": SOURCE_TEXT,
        "p_language": "sv",
        "p_source_message_id": None,
    }
    assert scenario.rpc_payloads["get_conversation_turn"] == [base]
    assert scenario.rpc_payloads["append_conversation_turn"] == [{
        **base,
        "p_expected_sequence": 0,
        "p_assistant_text": ASSISTANT_TEXT,
        "p_facts": [{
            "fact_type": "location",
            "value": "Malmo",
            "evidence": "Malmo",
            "year": None,
            "slot": "home",
            "uncertain": True,
            "clarification_question": "Vilket ar var det?",
            "conflicts_with_fact_id": None,
        }],
        "p_context_versions": [],
    }]
    assert provider.calls == [(SOURCE_TEXT, "sv", [])]


def test_all_prior_fact_versions_are_sorted_and_bound_to_atomic_append():
    scenario = Scenario()
    scenario.prior_rows = [
        memory_row(
            fact_id=PRIOR_FACT_ID_B,
            status="confirmed",
            version=4,
        ),
        memory_row(fact_id=PRIOR_FACT_ID_A, version=2),
    ]
    provider = FakeProvider()
    with TestClient(make_app(scenario, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert response.status_code == 201, response.text
    assert scenario.rpc_payloads["append_conversation_turn"][0][
        "p_context_versions"
    ] == [
        {"id": PRIOR_FACT_ID_A, "version": 2},
        {"id": PRIOR_FACT_ID_B, "version": 4},
    ]
    assert [fact["id"] for fact in provider.calls[0][2]] == [
        PRIOR_FACT_ID_B,
        PRIOR_FACT_ID_A,
    ]


def test_completed_idempotent_replay_skips_context_provider_and_append():
    scenario = Scenario()
    scenario.get_turn = turn_row()
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert response.status_code == 201
    assert response.json() == turn_row()
    assert scenario.events == ["auth", "session", "project", "get_conversation_turn"]
    assert scenario.rpc_payloads["append_conversation_turn"] == []


def test_existing_owned_source_message_is_loaded_before_replay():
    scenario = Scenario()
    scenario.get_turn = turn_row()
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"source_message_id": USER_MESSAGE_ID, "language": "sv"},
        )

    assert response.status_code == 201
    assert scenario.events == [
        "auth", "session", "project", "source", "get_conversation_turn"
    ]
    source_params = scenario.params["messages"][0]
    assert source_params["id"] == f"eq.{USER_MESSAGE_ID}"
    assert source_params["session_id"] == f"eq.{SESSION_ID}"
    assert scenario.rpc_payloads["get_conversation_turn"][0] == {
        "p_session_id": SESSION_ID,
        "p_idempotency_key": IDEMPOTENCY_KEY,
        "p_text": SOURCE_TEXT,
        "p_language": "sv",
        "p_source_message_id": USER_MESSAGE_ID,
    }


def test_already_processed_source_cannot_create_a_second_turn():
    scenario = Scenario()
    scenario.rpc_status["append_conversation_turn"] = 409
    scenario.rpc_errors["append_conversation_turn"] = {
        "code": "23505",
        "message": "private source uniqueness detail",
    }
    with TestClient(make_app(scenario, FakeProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"source_message_id": USER_MESSAGE_ID, "language": "sv"},
        )

    assert_error(response, 409, "IDEMPOTENCY_CONFLICT")
    assert "private" not in response.text
    assert len(scenario.rpc_payloads["append_conversation_turn"]) == 1
    assert scenario.rpc_payloads["append_conversation_turn"][0][
        "p_source_message_id"
    ] == USER_MESSAGE_ID


@pytest.mark.parametrize(
    "payload",
    [
        {"language": "sv"},
        {"text": " ", "language": "sv"},
        {"text": "x" * 4001, "language": "sv"},
        {"text": SOURCE_TEXT, "source_message_id": USER_MESSAGE_ID, "language": "sv"},
        {"text": SOURCE_TEXT, "language": "de"},
        {"text": SOURCE_TEXT, "language": "sv", "user_id": OTHER_USER_ID},
    ],
)
def test_submit_rejects_invalid_or_forged_input_without_mutation(payload):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["append_conversation_turn"] == []


@pytest.mark.parametrize("key", ["not-a-uuid", "", "1" * 65])
def test_submit_requires_uuid_idempotency_key(key):
    scenario = Scenario()
    headers = auth_headers()
    headers["Idempotency-Key"] = key
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=headers,
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["append_conversation_turn"] == []


def test_submit_requires_bearer_and_never_contacts_supabase_without_it():
    def no_calls(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"missing authentication reached upstream: {request.url}")

    app = create_app(
        configured_settings(),
        transport=httpx.MockTransport(no_calls),
        conversation_provider=NeverProvider(),
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers={"Idempotency-Key": IDEMPOTENCY_KEY},
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 401, "AUTHORIZATION_REQUIRED")
    assert response.headers["www-authenticate"] == "Bearer"


def test_submit_hides_missing_or_foreign_session_before_provider():
    scenario = Scenario()
    scenario.session_rows = []
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 404, "SESSION_NOT_FOUND")
    assert scenario.events == ["auth", "session"]


def test_submit_hides_session_whose_parent_is_not_owned():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.events == ["auth", "session", "project"]


def test_submit_rejects_language_mismatch_before_rpc_or_provider():
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": "A valid English memory", "language": "en"},
        )

    assert_error(response, 422, "LANGUAGE_MISMATCH")
    assert scenario.events == ["auth", "session", "project"]


def test_disabled_conversation_mode_performs_no_mutation_or_provider_work():
    scenario = Scenario()
    app = create_app(
        configured_settings(mode="disabled"),
        transport=httpx.MockTransport(scenario),
        conversation_provider=DisabledProvider(),
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 503, "CONVERSATION_DISABLED")
    assert scenario.events == [
        "auth", "session", "project", "get_conversation_turn"
    ]
    assert scenario.rpc_payloads["append_conversation_turn"] == []


def test_disabled_mode_still_returns_a_committed_lost_response_replay():
    scenario = Scenario()
    scenario.get_turn = turn_row()
    app = create_app(
        configured_settings(mode="disabled"),
        transport=httpx.MockTransport(scenario),
        conversation_provider=DisabledProvider(),
    )
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert response.status_code == 201
    assert response.json() == turn_row()
    assert scenario.events == [
        "auth", "session", "project", "get_conversation_turn"
    ]
    assert scenario.rpc_payloads["append_conversation_turn"] == []


def test_provider_failure_is_sanitized_and_never_appends():
    scenario = Scenario()
    provider = FakeProvider(error=RuntimeError("private provider detail: " + ACCESS_TOKEN))
    with TestClient(make_app(scenario, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 503, "CONVERSATION_INVALID_RESPONSE")
    assert ACCESS_TOKEN not in response.text
    assert SOURCE_TEXT not in response.text
    assert scenario.rpc_payloads["append_conversation_turn"] == []


@pytest.mark.parametrize(
    ("text", "facts"),
    [
        (" ", []),
        ("x" * 2001, []),
        (ASSISTANT_TEXT, [Candidate(value="invented", evidence="invented")]),
        (ASSISTANT_TEXT, [Candidate()] * 9),
    ],
)
def test_invalid_provider_result_is_rejected_without_append(text, facts):
    scenario = Scenario()
    with TestClient(make_app(scenario, FakeProvider(text=text, facts=facts))) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 503, "CONVERSATION_INVALID_RESPONSE")
    assert scenario.rpc_payloads["append_conversation_turn"] == []


def test_context_over_200_returns_conflict_instead_of_silent_truncation():
    scenario = Scenario()
    scenario.prior_rows = [memory_row()] * 201
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 409, "CONTEXT_LIMIT")
    params = scenario.params["memories"][0]
    assert params["project_id"] == f"eq.{PROJECT_ID}"
    assert params["status"] == "neq.rejected"
    assert params["limit"] == "201"
    assert scenario.rpc_payloads["append_conversation_turn"] == []


@pytest.mark.parametrize(
    ("status", "body", "expected_status", "code"),
    [
        (401, {"message": "private token detail"}, 401, "INVALID_ACCESS_TOKEN"),
        (403, {"code": "42501", "message": "private policy detail"}, 403, "ACCESS_DENIED"),
        (409, {"code": "55000", "message": "private race detail"}, 409, "CONVERSATION_CHANGED"),
        (500, {"message": "private database detail"}, 503, "SUPABASE_UNAVAILABLE"),
    ],
)
def test_append_upstream_errors_are_mapped_without_leaking_details(
    status, body, expected_status, code
):
    scenario = Scenario()
    scenario.rpc_status["append_conversation_turn"] = status
    scenario.rpc_errors["append_conversation_turn"] = body
    with TestClient(make_app(scenario, FakeProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, expected_status, code)
    assert "private" not in response.text


def test_malformed_turn_from_database_is_unavailable():
    scenario = Scenario()
    scenario.append_turn = {**turn_row(), "mode": "real"}
    with TestClient(make_app(scenario, FakeProvider())) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(with_key=True),
            json={"text": SOURCE_TEXT, "language": "sv"},
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")


@pytest.mark.parametrize(
    ("suffix", "event", "rows"),
    [
        ("messages", "messages", [message_row(), turn_row()["message"]]),
        ("memories", "memories", [memory_row()]),
        ("clarifications", "clarifications", [clarification_row()]),
    ],
)
def test_owned_lists_are_plain_arrays_with_bounded_pagination(suffix, event, rows):
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/{suffix}?limit=2&offset=3",
            headers=auth_headers(),
        )

    assert response.status_code == 200, response.text
    assert response.json() == rows
    params = scenario.params[suffix][0]
    assert params["session_id"] == f"eq.{SESSION_ID}"
    assert params["limit"] == "2"
    assert params["offset"] == "3"
    if suffix == "messages":
        assert params["order"] == "sequence.asc"
    assert scenario.events == ["auth", "session", "project", event]


@pytest.mark.parametrize("suffix", ["messages", "memories", "clarifications"])
@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "offset=100001"])
def test_lists_reject_pagination_outside_contract(suffix, query):
    scenario = Scenario()
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/{suffix}?{query}",
            headers=auth_headers(),
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert not any(event in scenario.events for event in ("messages", "memories", "clarifications"))


@pytest.mark.parametrize("suffix", ["messages", "memories", "clarifications"])
def test_lists_hide_missing_session(suffix):
    scenario = Scenario()
    scenario.session_rows = []
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/{suffix}",
            headers=auth_headers(),
        )

    assert_error(response, 404, "SESSION_NOT_FOUND")
    assert scenario.events == ["auth", "session"]


@pytest.mark.parametrize(
    ("suffix", "attribute", "bad_row"),
    [
        ("messages", "message_rows", {**message_row(), "session_id": PROJECT_ID}),
        ("memories", "memory_rows", {**memory_row(), "project_id": SESSION_ID}),
        ("clarifications", "clarification_rows", {**clarification_row(), "status": "resolved"}),
    ],
)
def test_lists_reject_malformed_or_cross_resource_upstream_rows(
    suffix, attribute, bad_row
):
    scenario = Scenario()
    setattr(scenario, attribute, [bad_row])
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/{suffix}",
            headers=auth_headers(),
        )

    assert_error(response, 503, "SUPABASE_UNAVAILABLE")


def test_confirm_memory_uses_owned_source_and_optimistic_version():
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json={
                "status": "confirmed",
                "corrected_value": "  Malmo stad  ",
                "expected_version": 1,
            },
        )

    assert response.status_code == 200, response.text
    assert response.json() == memory_row(
        status="confirmed", corrected_value="Malmo stad", version=2
    )
    assert scenario.params["memories"][0]["id"] == f"eq.{FACT_ID}"
    assert scenario.params["projects"][0]["user_id"] == f"eq.{USER_ID}"
    assert scenario.rpc_payloads["resolve_memory_fact"] == [{
        "p_fact_id": FACT_ID,
        "p_status": "confirmed",
        "p_corrected_value": "Malmo stad",
        "p_expected_version": 1,
    }]
    assert scenario.events == [
        "auth", "memory", "session", "project", "resolve_memory_fact"
    ]


def test_reject_memory_sends_explicit_null_correction():
    scenario = Scenario()
    scenario.resolve_turn = memory_row(status="rejected", version=2)
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json={"status": "rejected", "expected_version": 1},
        )

    assert response.status_code == 200
    assert scenario.rpc_payloads["resolve_memory_fact"][0]["p_corrected_value"] is None


def test_confirm_without_correction_preserves_existing_corrected_value():
    scenario = Scenario()
    existing = memory_row(
        status="confirmed", corrected_value="Malmo stad", version=2
    )
    scenario.memory_rows = [existing]
    scenario.resolve_turn = existing
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 2},
        )

    assert response.status_code == 200, response.text
    assert response.json() == existing
    assert scenario.rpc_payloads["resolve_memory_fact"] == [{
        "p_fact_id": FACT_ID,
        "p_status": "confirmed",
        "p_corrected_value": "Malmo stad",
        "p_expected_version": 2,
    }]


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "confirmed"},
        {"status": "confirmed", "expected_version": 0},
        {"status": "confirmed", "expected_version": 1, "corrected_value": None},
        {"status": "confirmed", "expected_version": 1, "corrected_value": " "},
        {"status": "rejected", "expected_version": 1, "corrected_value": "change"},
        {"status": "pending", "expected_version": 1},
        {"status": "confirmed", "expected_version": 1, "value": "forged"},
    ],
)
def test_memory_patch_rejects_invalid_or_server_owned_fields(payload):
    scenario = Scenario()
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json=payload,
        )

    assert_error(response, 422, "VALIDATION_ERROR")
    assert scenario.rpc_payloads["resolve_memory_fact"] == []


def test_memory_not_visible_through_rls_is_not_found_without_rpc():
    scenario = Scenario()
    scenario.memory_rows = []
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 1},
        )

    assert_error(response, 404, "MEMORY_NOT_FOUND")
    assert scenario.events == ["auth", "memory"]
    assert scenario.rpc_payloads["resolve_memory_fact"] == []


def test_memory_version_conflict_is_sanitized():
    scenario = Scenario()
    scenario.rpc_status["resolve_memory_fact"] = 409
    scenario.rpc_errors["resolve_memory_fact"] = {
        "code": "55000",
        "message": "private concurrent update detail",
    }
    with TestClient(make_app(scenario)) as client:
        response = client.patch(
            f"/api/v1/memories/{FACT_ID}",
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 1},
        )

    assert_error(response, 409, "CONVERSATION_CHANGED")
    assert "private" not in response.text

