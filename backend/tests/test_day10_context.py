"""Offline Day 10 checks for project-scoped mock conversation continuity.

These tests use ``httpx.MockTransport`` and fictional rows.  They prove the
FastAPI/gateway/provider contract, not hosted Supabase RLS or a real AI model.
The deterministic mock deliberately receives structured non-rejected
memories, not free-form message history from an older session.
"""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.conversation_provider import MockConversationProvider


SUPABASE_URL = "https://offline-day10.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "10000000-0000-4000-8000-000000000001"
PROJECT_ID = "20000000-0000-4000-8000-000000000001"
CURRENT_SESSION_ID = "30000000-0000-4000-8000-000000000001"
OLD_SESSION_ID = "30000000-0000-4000-8000-000000000002"
CURRENT_USER_MESSAGE_ID = "40000000-0000-4000-8000-000000000001"
CURRENT_ASSISTANT_MESSAGE_ID = "40000000-0000-4000-8000-000000000002"
OLD_SOURCE_MESSAGE_ID = "40000000-0000-4000-8000-000000000003"
NEW_FACT_ID = "50000000-0000-4000-8000-000000000001"
OLD_CONFIRMED_FACT_ID = "50000000-0000-4000-8000-000000000002"
OLD_REJECTED_FACT_ID = "50000000-0000-4000-8000-000000000003"
CLARIFICATION_ID = "60000000-0000-4000-8000-000000000001"
IDEMPOTENCY_KEY = "70000000-0000-4000-8000-000000000001"

CREATED_AT = "2026-10-23T08:00:00Z"
UPDATED_AT = "2026-10-23T08:05:00Z"
NEW_MOVE = "We moved to Lund in 1978."
CODE_SWITCH_TEXT = "Jag flyttade till Lund 1978."
PRIVATE_OLD_NARRATIVE = "a private unstructured detail that is not a memory"


def settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
        conversation_mode="mock",
    )


def project_row() -> dict[str, Any]:
    return {
        "id": PROJECT_ID,
        "user_id": USER_ID,
        "title": "Fictional continuity test",
        "description": None,
        "language": "en",
        "status": "draft",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
    }


def session_row() -> dict[str, Any]:
    return {
        "id": CURRENT_SESSION_ID,
        "project_id": PROJECT_ID,
        "language": "en",
        "status": "active",
        "created_at": UPDATED_AT,
        "updated_at": UPDATED_AT,
        "ended_at": None,
    }


def confirmed_prior_fact() -> dict[str, Any]:
    return {
        "id": OLD_CONFIRMED_FACT_ID,
        "project_id": PROJECT_ID,
        "session_id": OLD_SESSION_ID,
        "source_message_id": OLD_SOURCE_MESSAGE_ID,
        "fact_type": "event",
        "value": "Malmö",
        "evidence": "I moved to Malmö in 1974",
        "year": 1974,
        "slot": "move",
        "uncertain": False,
        "status": "confirmed",
        "corrected_value": "1976",
        "version": 3,
        "created_at": CREATED_AT,
        "updated_at": UPDATED_AT,
    }


def rejected_prior_fact() -> dict[str, Any]:
    return {
        **confirmed_prior_fact(),
        "id": OLD_REJECTED_FACT_ID,
        "value": "Stockholm",
        "evidence": "I moved to Stockholm in 1999",
        "year": 1999,
        "status": "rejected",
        "corrected_value": None,
        "version": 2,
    }


def message_row(
    message_id: str,
    *,
    sequence: int,
    role: str,
    text: str,
) -> dict[str, Any]:
    return {
        "id": message_id,
        "session_id": CURRENT_SESSION_ID,
        "sequence": sequence,
        "role": role,
        "text": text,
        "language": "en",
        "created_at": UPDATED_AT,
    }


class ContinuityStore:
    """Small PostgREST double which enforces the continuity query boundary."""

    def __init__(self, *, conflict_on_append: bool = False) -> None:
        self.project = project_row()
        self.session = session_row()
        self.prior_facts = [confirmed_prior_fact(), rejected_prior_fact()]
        self.original_prior_facts = deepcopy(self.prior_facts)
        self.old_message = {
            "id": OLD_SOURCE_MESSAGE_ID,
            "session_id": OLD_SESSION_ID,
            "sequence": 1,
            "role": "user",
            "text": f"I moved in 1974, plus {PRIVATE_OLD_NARRATIVE}.",
            "language": "en",
            "created_at": CREATED_AT,
        }
        self.current_history: list[dict[str, Any]] = []
        self.conflict_on_append = conflict_on_append
        self.prior_query: dict[str, str] | None = None
        self.append_attempts: list[dict[str, Any]] = []
        self.committed_turns: list[dict[str, Any]] = []
        self.history_queries: list[dict[str, str]] = []
        self.methods: list[tuple[str, str]] = []

    @staticmethod
    def _payload(request: httpx.Request) -> dict[str, Any]:
        return json.loads(request.content)

    def _turn(self, payload: dict[str, Any]) -> dict[str, Any]:
        facts = payload["p_facts"]
        user = message_row(
            CURRENT_USER_MESSAGE_ID,
            sequence=payload["p_expected_sequence"] + 1,
            role="user",
            text=payload["p_text"],
        )
        assistant = message_row(
            CURRENT_ASSISTANT_MESSAGE_ID,
            sequence=payload["p_expected_sequence"] + 2,
            role="assistant",
            text=payload["p_assistant_text"],
        )
        memories = []
        clarifications = []
        for candidate in facts:
            memory = {
                "id": NEW_FACT_ID,
                "project_id": PROJECT_ID,
                "session_id": CURRENT_SESSION_ID,
                "source_message_id": CURRENT_USER_MESSAGE_ID,
                "fact_type": candidate["fact_type"],
                "value": candidate["value"],
                "evidence": candidate["evidence"],
                "year": candidate["year"],
                "slot": candidate["slot"],
                "uncertain": candidate["uncertain"],
                "status": "pending",
                "corrected_value": None,
                "version": 1,
                "created_at": UPDATED_AT,
                "updated_at": UPDATED_AT,
            }
            memories.append(memory)
            if candidate["clarification_question"] is not None:
                clarifications.append({
                    "id": CLARIFICATION_ID,
                    "fact_id": NEW_FACT_ID,
                    "session_id": CURRENT_SESSION_ID,
                    "conflicts_with_fact_id": candidate["conflicts_with_fact_id"],
                    "question": candidate["clarification_question"],
                    "status": "open",
                    "resolution": None,
                    "created_at": UPDATED_AT,
                    "resolved_at": None,
                })
        return {
            "user_message": user,
            "message": assistant,
            "memories": memories,
            "clarifications": clarifications,
            "requires_clarification": bool(clarifications),
            "mode": "mock",
        }

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.methods.append((request.method, request.url.path))
        assert request.url.host == "offline-day10.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        path = request.url.path

        if path == "/auth/v1/user":
            assert request.method == "GET"
            return httpx.Response(200, json={"id": USER_ID})

        if path == "/rest/v1/conversation_sessions":
            assert request.method == "GET"
            params = dict(request.url.params)
            assert params["id"] == f"eq.{CURRENT_SESSION_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=[self.session])

        if path == "/rest/v1/story_projects":
            assert request.method == "GET"
            params = dict(request.url.params)
            assert params["id"] == f"eq.{PROJECT_ID}"
            assert params["user_id"] == f"eq.{USER_ID}"
            assert params["limit"] == "1"
            return httpx.Response(200, json=[self.project])

        if path == "/rest/v1/conversation_message_history":
            assert request.method == "GET"
            params = dict(request.url.params)
            self.history_queries.append(params)
            # The route may read only the current session's latest sequence or
            # its chronological history.  It must never fetch the old session's
            # free-form source as provider context.
            assert params["session_id"] == f"eq.{CURRENT_SESSION_ID}"
            if params["order"] == "sequence.desc":
                rows = self.current_history[-1:] if self.current_history else []
                return httpx.Response(200, json=rows)
            assert params["order"] == "sequence.asc"
            return httpx.Response(200, json=self.current_history)

        if path == "/rest/v1/memory_facts":
            assert request.method == "GET"
            params = dict(request.url.params)
            self.prior_query = params
            assert params["project_id"] == f"eq.{PROJECT_ID}"
            assert params["status"] == "neq.rejected"
            assert params["order"] == "created_at.asc,id.asc"
            assert params["limit"] == "201"
            assert "session_id" not in params
            rows = [fact for fact in self.prior_facts if fact["status"] != "rejected"]
            return httpx.Response(200, json=rows)

        if path == "/rest/v1/rpc/get_conversation_turn":
            assert request.method == "POST"
            return httpx.Response(
                200, content=b"null", headers={"content-type": "application/json"}
            )

        if path == "/rest/v1/rpc/append_conversation_turn":
            assert request.method == "POST"
            payload = self._payload(request)
            self.append_attempts.append(payload)
            if self.conflict_on_append:
                return httpx.Response(409, json={
                    "code": "55000",
                    "message": "private stale context detail must not escape",
                })
            turn = self._turn(payload)
            self.committed_turns.append(turn)
            self.current_history.extend([turn["user_message"], turn["message"]])
            return httpx.Response(200, json=turn)

        raise AssertionError(
            f"unexpected upstream request: {request.method} {request.url}"
        )


def make_app(store: ContinuityStore):
    return create_app(
        settings(),
        transport=httpx.MockTransport(store),
        conversation_provider=MockConversationProvider(),
    )


def headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Idempotency-Key": IDEMPOTENCY_KEY,
    }


def submit(client: TestClient, text: str, *, language: str = "en"):
    return client.post(
        f"/api/v1/story-sessions/{CURRENT_SESSION_ID}/messages",
        headers=headers(),
        json={"text": text, "language": language},
    )


def test_previous_session_confirmed_correction_drives_new_session_conflict() -> None:
    store = ContinuityStore()

    with TestClient(make_app(store)) as client:
        response = submit(client, NEW_MOVE)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_message"]["session_id"] == CURRENT_SESSION_ID
    assert body["user_message"]["text"] == NEW_MOVE
    assert body["message"]["language"] == "en"
    assert body["message"]["text"].endswith(
        "You previously said 1976. Is 1978 a separate move, or a correction to 1976?"
    )
    assert PRIVATE_OLD_NARRATIVE not in response.text

    assert len(body["memories"]) == 1
    proposed = body["memories"][0]
    assert proposed["source_message_id"] == CURRENT_USER_MESSAGE_ID
    assert proposed["status"] == "pending"
    assert proposed["corrected_value"] is None
    assert body["clarifications"][0]["conflicts_with_fact_id"] == OLD_CONFIRMED_FACT_ID

    append = store.append_attempts[0]
    assert append["p_context_versions"] == [
        {"id": OLD_CONFIRMED_FACT_ID, "version": 3}
    ]
    assert append["p_facts"][0]["conflicts_with_fact_id"] == OLD_CONFIRMED_FACT_ID
    assert OLD_REJECTED_FACT_ID not in json.dumps(append)
    assert store.prior_query is not None
    assert store.prior_facts == store.original_prior_facts
    assert store.prior_facts[0]["source_message_id"] == OLD_SOURCE_MESSAGE_ID
    assert all(
        query["session_id"] == f"eq.{CURRENT_SESSION_ID}"
        for query in store.history_queries
    )


def test_stale_previous_session_context_returns_atomic_conflict() -> None:
    store = ContinuityStore(conflict_on_append=True)

    with TestClient(make_app(store)) as client:
        response = submit(client, NEW_MOVE)

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "CONVERSATION_CHANGED",
            "message": "The conversation changed; reload and retry.",
        }
    }
    assert response.headers["cache-control"] == "no-store"
    assert "private stale context" not in response.text
    assert len(store.append_attempts) == 1
    assert store.append_attempts[0]["p_context_versions"] == [
        {"id": OLD_CONFIRMED_FACT_ID, "version": 3}
    ]
    assert store.committed_turns == []
    assert store.current_history == []
    assert store.prior_facts == store.original_prior_facts


def test_brief_code_switch_keeps_project_language_and_uses_safe_fallback() -> None:
    store = ContinuityStore()
    # No accepted prior fact should influence this language-boundary check.
    store.prior_facts = [rejected_prior_fact()]
    store.original_prior_facts = deepcopy(store.prior_facts)

    with TestClient(make_app(store)) as client:
        response = submit(client, CODE_SWITCH_TEXT, language="en")
        wrong_language = submit(client, CODE_SWITCH_TEXT, language="sv")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_message"]["text"] == CODE_SWITCH_TEXT
    assert body["user_message"]["language"] == "en"
    assert body["message"]["language"] == "en"
    assert body["message"]["text"] == "Thank you for sharing. I’m listening."
    assert body["memories"] == []
    assert body["clarifications"] == []
    assert body["requires_clarification"] is False
    assert store.append_attempts[0]["p_language"] == "en"
    assert store.append_attempts[0]["p_facts"] == []
    assert store.append_attempts[0]["p_context_versions"] == []
    assert store.session["language"] == "en"
    assert store.project["language"] == "en"

    assert wrong_language.status_code == 422
    assert wrong_language.json()["error"]["code"] == "LANGUAGE_MISMATCH"
    # The mismatch is rejected before a replay lookup, provider work or append.
    assert len(store.append_attempts) == 1


def test_history_read_stays_owned_current_session_and_chronological() -> None:
    store = ContinuityStore()
    store.current_history = [
        message_row(
            CURRENT_USER_MESSAGE_ID,
            sequence=1,
            role="user",
            text="I grew up in Lund.",
        ),
        message_row(
            CURRENT_ASSISTANT_MESSAGE_ID,
            sequence=2,
            role="assistant",
            text="Thank you for sharing that memory.",
        ),
    ]

    with TestClient(make_app(store)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{CURRENT_SESSION_ID}/messages?limit=50&offset=0",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )

    assert response.status_code == 200, response.text
    assert [message["sequence"] for message in response.json()] == [1, 2]
    assert all(
        message["session_id"] == CURRENT_SESSION_ID for message in response.json()
    )
    assert OLD_SOURCE_MESSAGE_ID not in response.text
    assert PRIVATE_OLD_NARRATIVE not in response.text
    history = store.history_queries[-1]
    assert history["session_id"] == f"eq.{CURRENT_SESSION_ID}"
    assert history["order"] == "sequence.asc"
    assert history["limit"] == "50"
    assert history["offset"] == "0"
    assert store.prior_query is None

