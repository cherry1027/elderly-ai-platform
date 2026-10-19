"""Offline end-to-end journey through the deterministic Days 2-6 backend.

The stateful transport below behaves like the narrow Auth/PostgREST surface the
application uses.  It deliberately is not a SQL emulator (the migrations have
their own PGlite suite); its purpose is to prove that the real FastAPI routes,
mock conversation provider, mock story writer and PDF renderer compose without
cloud access or paid services.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from typing import Any

import httpx
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.core.config import Settings
from app.main import create_app


SUPABASE_URL = "https://journey.test.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "71000000-0000-4000-8000-000000000001"
PROJECT_ID = "72000000-0000-4000-8000-000000000001"
SESSION_ID = "73000000-0000-4000-8000-000000000001"
USER_MESSAGE_IDS = (
    "74000000-0000-4000-8000-000000000001",
    "74000000-0000-4000-8000-000000000003",
)
ASSISTANT_MESSAGE_IDS = (
    "74000000-0000-4000-8000-000000000002",
    "74000000-0000-4000-8000-000000000004",
)
MEMORY_IDS = (
    "75000000-0000-4000-8000-000000000001",
    "75000000-0000-4000-8000-000000000002",
)
DRAFT_IDS = (
    "76000000-0000-4000-8000-000000000001",
    "76000000-0000-4000-8000-000000000002",
)
EXPORT_ID = "77000000-0000-4000-8000-000000000001"
TURN_KEYS = (
    "78000000-0000-4000-8000-000000000001",
    "78000000-0000-4000-8000-000000000002",
)
GENERATION_KEYS = (
    "79000000-0000-4000-8000-000000000001",
    "79000000-0000-4000-8000-000000000002",
)

CREATED_AT = "2026-10-19T14:00:00Z"
UPDATED_AT = "2026-10-19T14:05:00Z"
PROJECT_TITLE = "Mitt liv, min berättelse"
FIRST_SOURCE_TEXT = "Jag växte upp i Malmö."
SECOND_SOURCE_TEXT = "Jag kände mig glad."
MANUAL_CONTENT = FIRST_SOURCE_TEXT + "\n\nJag minns havet."


def settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
        conversation_mode="mock",
        story_generation_mode="mock",
    )


def body(request: httpx.Request) -> dict[str, Any]:
    return json.loads(request.content.decode("utf-8"))


class JourneyStore:
    """Stateful, owner-scoped Auth/PostgREST test double."""

    def __init__(self) -> None:
        self.project: dict[str, Any] | None = None
        self.session: dict[str, Any] | None = None
        self.messages: list[dict[str, Any]] = []
        self.memories: list[dict[str, Any]] = []
        self.turns: dict[str, dict[str, Any]] = {}
        self.drafts: list[dict[str, Any]] = []
        self.generations: dict[str, dict[str, Any]] = {}
        self.exports: dict[str, dict[str, Any]] = {}
        self.events: list[str] = []

    @staticmethod
    def _json_null() -> httpx.Response:
        return httpx.Response(
            200, content=b"null", headers={"content-type": "application/json"}
        )

    def _assert_credentials(self, request: httpx.Request) -> None:
        assert request.url.host == "journey.test.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"

    def _project_relation(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            values = body(request)
            assert values == {
                "title": PROJECT_TITLE,
                "language": "sv",
                "description": "En verifierad testberättelse",
                "user_id": USER_ID,
            }
            self.project = {
                "id": PROJECT_ID,
                "user_id": USER_ID,
                **values,
                "status": "draft",
                "created_at": CREATED_AT,
                "updated_at": CREATED_AT,
            }
            return httpx.Response(201, json=[deepcopy(self.project)])

        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("user_id") == f"eq.{USER_ID}"
        if "id" in params:
            assert params["id"] == f"eq.{PROJECT_ID}"
            assert params.get("limit") == "1"
        return httpx.Response(
            200,
            json=[] if self.project is None else [deepcopy(self.project)],
        )

    def _session_relation(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            values = body(request)
            assert values == {"project_id": PROJECT_ID, "language": "sv"}
            self.session = {
                "id": SESSION_ID,
                **values,
                "status": "active",
                "created_at": CREATED_AT,
                "updated_at": CREATED_AT,
                "ended_at": None,
            }
            return httpx.Response(201, json=[deepcopy(self.session)])

        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("id") == f"eq.{SESSION_ID}"
        assert params.get("limit") == "1"
        return httpx.Response(
            200,
            json=[] if self.session is None else [deepcopy(self.session)],
        )

    def _message_history(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("session_id") == f"eq.{SESSION_ID}"
        rows = self.messages
        if "id" in params:
            selected = params["id"].removeprefix("eq.")
            rows = [row for row in rows if row["id"] == selected]
        elif params.get("order") == "sequence.desc":
            rows = sorted(rows, key=lambda row: row["sequence"], reverse=True)[:1]
        else:
            rows = sorted(rows, key=lambda row: row["sequence"])
        return httpx.Response(200, json=deepcopy(rows))

    def _memory_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        if "id" in params:
            selected = params["id"].removeprefix("eq.")
            rows = [row for row in self.memories if row["id"] == selected]
        elif "project_id" in params:
            assert params["project_id"] == f"eq.{PROJECT_ID}"
            assert params.get("status") == "neq.rejected"
            rows = [row for row in self.memories if row["status"] != "rejected"]
        else:
            rows = list(self.memories)
        return httpx.Response(200, json=deepcopy(rows))

    @staticmethod
    def _sentence(memory: dict[str, Any]) -> str:
        if memory["slot"] == "grew_up_location":
            return f'Jag växte upp i {memory["corrected_value"] or memory["value"]}.'
        if memory["fact_type"] == "emotion":
            return f'Jag kände mig {str(memory["corrected_value"] or memory["value"]).lower()}.'
        raise AssertionError("journey introduced an unsupported synthetic memory")

    def _source(self, memory: dict[str, Any]) -> dict[str, Any]:
        return {
            "memory_id": memory["id"],
            "memory_version": memory["version"],
            "source_message_id": memory["source_message_id"],
            "fact_type": memory["fact_type"],
            "value": memory["value"],
            "evidence": memory["evidence"],
            "corrected_value": memory["corrected_value"],
            "year": memory["year"],
            "slot": memory["slot"],
            "sentence": self._sentence(memory),
        }

    def _story_context(self) -> dict[str, Any]:
        confirmed = [memory for memory in self.memories if memory["status"] == "confirmed"]
        sources = [self._source(memory) for memory in confirmed]
        canonical = "\n\n".join(source["sentence"] for source in sources)
        token_payload = [
            {"id": source["memory_id"], "version": source["memory_version"]}
            for source in sources
        ]
        token = sha256(
            json.dumps(token_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return {
            "project_id": PROJECT_ID,
            "language": "sv",
            "context_token": token,
            "confirmed_count": len(confirmed),
            "source_memories": sources,
            "excluded_memories": [
                {"memory_id": memory["id"], "reason": memory["status"]}
                for memory in self.memories
                if memory["status"] in {"pending", "rejected"}
            ],
            "blocking_clarifications": [],
            "canonical_content": canonical,
        }

    @staticmethod
    def _passed_report(revision: int = 1) -> dict[str, Any]:
        return {
            "status": "passed",
            "unsupported_claims": [],
            "method": "deterministic_mock_v1",
            "checked_revision": revision,
            "checked_at": UPDATED_AT,
            "sources_current": True,
            "reason": None,
        }

    @staticmethod
    def _edited_report(revision: int) -> dict[str, Any]:
        return {
            "status": "needs_review",
            "unsupported_claims": [],
            "method": "manual_unverified",
            "checked_revision": revision,
            "checked_at": UPDATED_AT,
            "sources_current": True,
            "reason": "Manual edits require review",
        }

    def _conversation_rpc(
        self, name: str, payload: dict[str, Any]
    ) -> httpx.Response:
        if name == "get_conversation_turn":
            cached = self.turns.get(payload["p_idempotency_key"])
            return self._json_null() if cached is None else httpx.Response(200, json=deepcopy(cached))

        if name == "append_conversation_turn":
            turn_index = len(self.turns)
            assert turn_index < len(USER_MESSAGE_IDS)
            assert payload["p_session_id"] == SESSION_ID
            assert payload["p_expected_sequence"] == len(self.messages)
            expected_versions = sorted(
                (
                    {"id": memory["id"], "version": memory["version"]}
                    for memory in self.memories
                    if memory["status"] != "rejected"
                ),
                key=lambda item: item["id"],
            )
            assert payload["p_context_versions"] == expected_versions

            user_message = {
                "id": USER_MESSAGE_IDS[turn_index],
                "session_id": SESSION_ID,
                "sequence": len(self.messages) + 1,
                "role": "user",
                "text": payload["p_text"],
                "language": "sv",
                "created_at": CREATED_AT,
            }
            assistant_message = {
                "id": ASSISTANT_MESSAGE_IDS[turn_index],
                "session_id": SESSION_ID,
                "sequence": len(self.messages) + 2,
                "role": "assistant",
                "text": payload["p_assistant_text"],
                "language": "sv",
                "created_at": CREATED_AT,
            }
            self.messages.extend((user_message, assistant_message))

            new_memories = []
            for candidate in payload["p_facts"]:
                assert candidate["clarification_question"] is None
                assert candidate["conflicts_with_fact_id"] is None
                memory = {
                    "id": MEMORY_IDS[len(self.memories)],
                    "project_id": PROJECT_ID,
                    "session_id": SESSION_ID,
                    "source_message_id": user_message["id"],
                    "fact_type": candidate["fact_type"],
                    "value": candidate["value"],
                    "evidence": candidate["evidence"],
                    "year": candidate["year"],
                    "slot": candidate["slot"],
                    "uncertain": candidate["uncertain"],
                    "status": "pending",
                    "corrected_value": None,
                    "version": 1,
                    "created_at": CREATED_AT,
                    "updated_at": CREATED_AT,
                }
                self.memories.append(memory)
                new_memories.append(memory)

            turn = {
                "user_message": user_message,
                "message": assistant_message,
                "memories": new_memories,
                "clarifications": [],
                "requires_clarification": False,
                "mode": "mock",
            }
            self.turns[payload["p_idempotency_key"]] = deepcopy(turn)
            return httpx.Response(200, json=turn)

        assert name == "resolve_memory_fact"
        memory = next(
            row for row in self.memories if row["id"] == payload["p_fact_id"]
        )
        assert memory["version"] == payload["p_expected_version"]
        memory.update(
            status=payload["p_status"],
            corrected_value=payload["p_corrected_value"],
            version=memory["version"] + 1,
            updated_at=UPDATED_AT,
        )
        if len([row for row in self.memories if row["status"] == "confirmed"]) > 1:
            for draft in self.drafts:
                draft["verification"]["sources_current"] = False
                draft["verification"]["reason"] = (
                    "Source memories changed after this draft was generated"
                )
        return httpx.Response(200, json=deepcopy(memory))

    def _story_rpc(self, name: str, payload: dict[str, Any]) -> httpx.Response:
        if name == "get_story_generation":
            draft = self.generations.get(payload["p_idempotency_key"])
            return self._json_null() if draft is None else httpx.Response(200, json=deepcopy(draft))

        if name == "load_story_context":
            assert payload == {"p_project_id": PROJECT_ID}
            return httpx.Response(200, json=self._story_context())

        if name == "save_story_generation":
            context = self._story_context()
            assert payload["p_project_id"] == PROJECT_ID
            assert payload["p_language"] == "sv"
            assert payload["p_style"] == "warm"
            assert payload["p_confirm_generation"] is True
            assert payload["p_context_token"] == context["context_token"]
            assert payload["p_content"] == context["canonical_content"]
            index = len(self.drafts)
            draft = {
                "draft_id": DRAFT_IDS[index],
                "project_id": PROJECT_ID,
                "status": "ready_for_review",
                "language": "sv",
                "style": "warm",
                "version": index + 1,
                "revision": 1,
                "content": payload["p_content"],
                "original_content": payload["p_content"],
                "mode": "mock",
                "source_memories": deepcopy(context["source_memories"]),
                "verification": self._passed_report(),
                "created_at": CREATED_AT,
                "updated_at": CREATED_AT,
            }
            self.drafts.append(draft)
            self.generations[payload["p_idempotency_key"]] = draft
            return httpx.Response(200, json=deepcopy(draft))

        if name == "get_story_draft":
            draft = next(row for row in self.drafts if row["draft_id"] == payload["p_draft_id"])
            return httpx.Response(200, json=deepcopy(draft))

        assert name == "edit_story_draft"
        draft = next(row for row in self.drafts if row["draft_id"] == payload["p_draft_id"])
        assert draft["revision"] == payload["p_expected_revision"]
        draft.update(
            content=payload["p_content"],
            status="edited",
            revision=draft["revision"] + 1,
            verification=self._edited_report(draft["revision"] + 1),
            updated_at=UPDATED_AT,
        )
        return httpx.Response(200, json=deepcopy(draft))

    def _export_rpc(self, name: str, payload: dict[str, Any]) -> httpx.Response:
        if name == "load_story_export_context":
            draft = next(row for row in self.drafts if row["draft_id"] == payload["p_draft_id"])
            return httpx.Response(
                200,
                json={"draft": deepcopy(draft), "project_title": PROJECT_TITLE},
            )

        if name == "record_story_export":
            draft = next(row for row in self.drafts if row["draft_id"] == payload["p_draft_id"])
            assert payload["p_expected_revision"] == draft["revision"]
            assert payload["p_expected_title"] == PROJECT_TITLE
            metadata = {
                "export_id": EXPORT_ID,
                "project_id": PROJECT_ID,
                "draft_id": draft["draft_id"],
                "draft_version": draft["version"],
                "draft_revision": draft["revision"],
                "language": draft["language"],
                "title": PROJECT_TITLE,
                "format": "pdf",
                "include_title_page": payload["p_include_title_page"],
                "include_page_numbers": payload["p_include_page_numbers"],
                "renderer_version": payload["p_renderer_version"],
                "filename": payload["p_filename"],
                "content_sha256": sha256(draft["content"].encode()).hexdigest(),
                "byte_size": payload["p_byte_size"],
                "page_count": payload["p_page_count"],
                "created_at": UPDATED_AT,
            }
            self.exports[EXPORT_ID] = {
                "export": metadata,
                "content": draft["content"],
            }
            return httpx.Response(200, json=deepcopy(metadata))

        if name == "get_story_export":
            saved = self.exports[payload["p_export_id"]]
            return httpx.Response(200, json=deepcopy(saved))

        assert name == "continue_story_project"
        assert payload == {"p_project_id": PROJECT_ID}
        latest = max(self.drafts, key=lambda row: row["version"]) if self.drafts else None
        return httpx.Response(
            200,
            json={
                "project_id": PROJECT_ID,
                "language": "sv",
                "session": deepcopy(self.session),
                "session_created": False,
                "latest_draft": deepcopy(latest),
                "generation_triggered": False,
            },
        )

    def _rpc(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.removeprefix("/rest/v1/rpc/")
        payload = body(request)
        self.events.append(name)
        if name in {
            "get_conversation_turn",
            "append_conversation_turn",
            "resolve_memory_fact",
        }:
            return self._conversation_rpc(name, payload)
        if name in {
            "get_story_generation",
            "load_story_context",
            "save_story_generation",
            "get_story_draft",
            "edit_story_draft",
        }:
            return self._story_rpc(name, payload)
        if name in {
            "load_story_export_context",
            "record_story_export",
            "get_story_export",
            "continue_story_project",
        }:
            return self._export_rpc(name, payload)
        raise AssertionError(f"unexpected RPC: {name}")

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self._assert_credentials(request)
        path = request.url.path
        if path == "/auth/v1/user":
            assert request.method == "GET"
            return httpx.Response(
                200, json={"id": USER_ID, "email": "journey@example.test"}
            )
        if path == "/rest/v1/story_projects":
            return self._project_relation(request)
        if path == "/rest/v1/conversation_sessions":
            return self._session_relation(request)
        if path == "/rest/v1/conversation_message_history":
            return self._message_history(request)
        if path == "/rest/v1/memory_facts":
            return self._memory_relation(request)
        if path.startswith("/rest/v1/rpc/"):
            assert request.method == "POST"
            return self._rpc(request)
        raise AssertionError(f"unexpected upstream request: {request.method} {request.url}")


def auth_headers(*, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    if key is not None:
        result["Idempotency-Key"] = key
    return result


def pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


def test_full_mock_journey_preserves_reviewed_history_and_requires_explicit_regeneration():
    store = JourneyStore()
    app = create_app(settings(), transport=httpx.MockTransport(store))

    with TestClient(app) as client:
        created_project = client.post(
            "/api/v1/story-projects",
            headers=auth_headers(),
            json={
                "title": PROJECT_TITLE,
                "description": "En verifierad testberättelse",
                "language": "sv",
            },
        )
        assert created_project.status_code == 201, created_project.text
        assert created_project.json()["id"] == PROJECT_ID

        created_session = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/sessions",
            headers=auth_headers(),
            json={},
        )
        assert created_session.status_code == 201, created_session.text
        assert created_session.json()["id"] == SESSION_ID

        first_turn = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(key=TURN_KEYS[0]),
            json={"text": FIRST_SOURCE_TEXT, "language": "sv"},
        )
        assert first_turn.status_code == 201, first_turn.text
        first_memory = first_turn.json()["memories"][0]
        assert first_memory["value"] == "Malmö"
        assert first_memory["evidence"] == "Jag växte upp i Malmö"
        assert first_memory["status"] == "pending"

        confirmed_first = client.patch(
            f'/api/v1/memories/{first_memory["id"]}',
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 1},
        )
        assert confirmed_first.status_code == 200, confirmed_first.text
        assert confirmed_first.json()["version"] == 2

        generated_first = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/generate",
            headers=auth_headers(key=GENERATION_KEYS[0]),
            json={"language": "sv", "confirm_generation": True},
        )
        assert generated_first.status_code == 201, generated_first.text
        first_draft = generated_first.json()
        assert first_draft["version"] == 1
        assert first_draft["content"] == FIRST_SOURCE_TEXT
        assert first_draft["verification"]["status"] == "passed"

        edited = client.patch(
            f'/api/v1/story-drafts/{first_draft["draft_id"]}',
            headers=auth_headers(),
            json={"content": MANUAL_CONTENT, "expected_revision": 1},
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["revision"] == 2
        assert edited.json()["verification"]["status"] == "needs_review"
        assert edited.json()["original_content"] == FIRST_SOURCE_TEXT

        exported = client.post(
            f'/api/v1/story-drafts/{first_draft["draft_id"]}/export',
            headers=auth_headers(),
            json={},
        )
        assert exported.status_code == 201, exported.text
        assert exported.headers["content-type"].startswith("application/pdf")
        assert exported.headers["x-memy-export-id"] == EXPORT_ID
        assert MANUAL_CONTENT.split("\n\n")[0] in pdf_text(exported.content)
        assert "Jag minns havet." in pdf_text(exported.content)
        first_pdf = exported.content

        continued = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/continue",
            headers=auth_headers(),
            json={},
        )
        assert continued.status_code == 200, continued.text
        assert continued.json()["session_created"] is False
        assert continued.json()["generation_triggered"] is False
        assert continued.json()["latest_draft"]["content"] == MANUAL_CONTENT
        assert len(store.drafts) == 1

        second_turn = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(key=TURN_KEYS[1]),
            json={"text": SECOND_SOURCE_TEXT, "language": "sv"},
        )
        assert second_turn.status_code == 201, second_turn.text
        second_memory = second_turn.json()["memories"][0]
        assert second_memory["fact_type"] == "emotion"
        assert second_memory["value"] == "glad"

        confirmed_second = client.patch(
            f'/api/v1/memories/{second_memory["id"]}',
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 1},
        )
        assert confirmed_second.status_code == 200, confirmed_second.text
        assert len(store.drafts) == 1  # Confirming a fact never regenerates implicitly.

        generated_second = client.post(
            f"/api/v1/story-projects/{PROJECT_ID}/generate",
            headers=auth_headers(key=GENERATION_KEYS[1]),
            json={"language": "sv", "style": "warm", "confirm_generation": True},
        )
        assert generated_second.status_code == 201, generated_second.text
        second_draft = generated_second.json()
        assert second_draft["version"] == 2
        assert second_draft["draft_id"] != first_draft["draft_id"]
        assert second_draft["content"] == FIRST_SOURCE_TEXT + "\n\n" + SECOND_SOURCE_TEXT

        preserved_old_draft = client.get(
            f'/api/v1/story-drafts/{first_draft["draft_id"]}',
            headers=auth_headers(),
        )
        assert preserved_old_draft.status_code == 200, preserved_old_draft.text
        assert preserved_old_draft.json()["content"] == MANUAL_CONTENT
        assert preserved_old_draft.json()["revision"] == 2
        assert preserved_old_draft.json()["verification"]["sources_current"] is False

        downloaded = client.get(
            f"/api/v1/story-exports/{EXPORT_ID}/download",
            headers=auth_headers(),
        )
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.headers["x-memy-draft-version"] == "1"
        assert downloaded.headers["x-memy-draft-revision"] == "2"
        assert downloaded.content == first_pdf
        downloaded_text = pdf_text(downloaded.content)
        assert FIRST_SOURCE_TEXT in downloaded_text
        assert "Jag minns havet." in downloaded_text
        assert SECOND_SOURCE_TEXT not in downloaded_text

    assert len(store.messages) == 4
    assert len(store.memories) == 2
    assert len(store.drafts) == 2
    assert set(store.generations) == set(GENERATION_KEYS)
    assert set(store.exports) == {EXPORT_ID}
