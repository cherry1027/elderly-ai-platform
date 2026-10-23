"""Focused offline acceptance for the Day 11 story lifecycle.

The tests compose the real FastAPI routes and deterministic mock providers with
explicit Auth/PostgREST doubles.  They never contact Supabase, a model provider,
or a device.  SQL/RLS concurrency remains covered by the separate database suite.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from tests import test_exports_continuation as exports
from tests import test_mock_journey as journey
from tests import test_story_drafts as drafts


HISTORY_ID = "81000000-0000-4000-8000-000000000001"
CONFLICT_ID = "82000000-0000-4000-8000-000000000001"
SAME_CONTEXT_KEY = "83000000-0000-4000-8000-000000000001"
STALE_CONTENT = journey.MANUAL_CONTENT + "\n\nDetta får inte skriva över revision två."


class Day11JourneyStore(journey.JourneyStore):
    """Add SQL-like edit replay/conflict and read models to the journey double."""

    def __init__(self) -> None:
        super().__init__()
        self.history: list[dict[str, Any]] = []
        self.context_drafts: dict[tuple[str, str, str], dict[str, Any]] = {}

    def _story_rpc(
        self, name: str, payload: dict[str, Any]
    ) -> httpx.Response:
        if name == "save_story_generation":
            identity = (
                payload["p_context_token"],
                payload["p_language"],
                payload["p_style"],
            )
            existing = self.context_drafts.get(identity)
            if existing is not None:
                self.generations[payload["p_idempotency_key"]] = existing
                return httpx.Response(200, json=deepcopy(existing))
            response = super()._story_rpc(name, payload)
            self.context_drafts[identity] = self.drafts[-1]
            return response

        if name == "edit_story_draft":
            draft = next(
                row for row in self.drafts
                if row["draft_id"] == payload["p_draft_id"]
            )
            expected_revision = payload["p_expected_revision"]
            content = payload["p_content"]

            # Match the database's single-step exact replay rule.  A different
            # stale edit is rejected and leaves both the draft and audit intact.
            if (
                draft["revision"] == expected_revision + 1
                and draft["content"] == content
            ):
                return httpx.Response(200, json=deepcopy(draft))
            if draft["revision"] != expected_revision:
                return httpx.Response(
                    409,
                    json={
                        "code": "55000",
                        "message": "private stale edit detail must be sanitized",
                    },
                )
            if draft["content"] == content:
                return httpx.Response(200, json=deepcopy(draft))

            previous_content = draft["content"]
            next_revision = draft["revision"] + 1
            draft.update(
                content=content,
                status="edited",
                revision=next_revision,
                verification=self._edited_report(next_revision),
                updated_at=journey.UPDATED_AT,
            )
            self.history.append(
                {
                    "id": HISTORY_ID,
                    "draft_id": draft["draft_id"],
                    "revision": next_revision,
                    "previous_content": previous_content,
                    "content": content,
                    "created_at": journey.UPDATED_AT,
                }
            )
            return httpx.Response(200, json=deepcopy(draft))

        if name == "get_story_project_verification":
            latest = max(self.drafts, key=lambda row: row["version"])
            return httpx.Response(
                200,
                json={
                    "project_id": journey.PROJECT_ID,
                    "draft_id": latest["draft_id"],
                    "version": latest["version"],
                    "revision": latest["revision"],
                    "verification": deepcopy(latest["verification"]),
                },
            )

        if name == "list_story_edit_history":
            assert payload["p_draft_id"] == journey.DRAFT_IDS[0]
            assert payload["p_limit"] == 50
            assert payload["p_offset"] == 0
            return httpx.Response(
                200,
                json=deepcopy(sorted(
                    self.history, key=lambda row: row["revision"], reverse=True
                )),
            )

        return super()._story_rpc(name, payload)

    def _rpc(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.removeprefix("/rest/v1/rpc/")
        if name in {
            "get_story_project_verification",
            "list_story_edit_history",
        }:
            self.events.append(name)
            return self._story_rpc(name, journey.body(request))
        return super()._rpc(request)


def _create_project_and_session(client: TestClient) -> None:
    project = client.post(
        "/api/v1/story-projects",
        headers=journey.auth_headers(),
        json={
            "title": journey.PROJECT_TITLE,
            "description": "En verifierad testberättelse",
            "language": "sv",
        },
    )
    assert project.status_code == 201, project.text
    session = client.post(
        f"/api/v1/story-projects/{journey.PROJECT_ID}/sessions",
        headers=journey.auth_headers(),
        json={},
    )
    assert session.status_code == 201, session.text


def _message(client: TestClient, text: str, key: str) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/story-sessions/{journey.SESSION_ID}/messages",
        headers=journey.auth_headers(key=key),
        json={"text": text, "language": "sv"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _review(client: TestClient, fact_id: str) -> dict[str, Any]:
    response = client.patch(
        f"/api/v1/memories/{fact_id}",
        headers=journey.auth_headers(),
        json={"status": "confirmed", "expected_version": 1},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _generate(client: TestClient, key: str):
    return client.post(
        f"/api/v1/story-projects/{journey.PROJECT_ID}/generate",
        headers=journey.auth_headers(key=key),
        json={"language": "sv", "style": "warm", "confirm_generation": True},
    )


def test_explicit_story_journey_replays_safely_and_requires_new_action_for_new_facts():
    store = Day11JourneyStore()
    app = create_app(journey.settings(), transport=httpx.MockTransport(store))

    with TestClient(app) as client:
        _create_project_and_session(client)
        first_turn = _message(client, journey.FIRST_SOURCE_TEXT, journey.TURN_KEYS[0])
        first_memory = first_turn["memories"][0]
        assert first_memory["status"] == "pending"

        # Creating a fact and confirming it do not generate prose implicitly.
        assert store.drafts == []
        _review(client, first_memory["id"])
        assert store.drafts == []

        second_turn = _message(client, journey.SECOND_SOURCE_TEXT, journey.TURN_KEYS[1])
        second_memory = second_turn["memories"][0]
        assert second_memory["status"] == "pending"

        missing_consent = client.post(
            f"/api/v1/story-projects/{journey.PROJECT_ID}/generate",
            headers=journey.auth_headers(key=journey.GENERATION_KEYS[0]),
            json={"language": "sv", "confirm_generation": False},
        )
        assert missing_consent.status_code == 422
        assert store.drafts == []

        generated = _generate(client, journey.GENERATION_KEYS[0])
        assert generated.status_code == 201, generated.text
        first_draft = generated.json()
        assert first_draft["content"] == journey.FIRST_SOURCE_TEXT
        assert first_draft["source_memories"] == [store._source(store.memories[0])]
        assert first_draft["verification"]["status"] == "passed"
        assert len(store.drafts) == 1

        replay = _generate(client, journey.GENERATION_KEYS[0])
        assert replay.status_code == 201, replay.text
        assert replay.json()["draft_id"] == first_draft["draft_id"]
        assert len(store.drafts) == 1
        assert len(store.generations) == 1
        assert store.events.count("load_story_context") == 1
        assert store.events.count("save_story_generation") == 1

        same_context_new_action = _generate(client, SAME_CONTEXT_KEY)
        assert same_context_new_action.status_code == 201, same_context_new_action.text
        assert same_context_new_action.json()["draft_id"] == first_draft["draft_id"]
        assert len(store.drafts) == 1
        assert len(store.generations) == 2
        assert store.events.count("load_story_context") == 2
        assert store.events.count("save_story_generation") == 2

        edited = client.patch(
            f"/api/v1/story-drafts/{first_draft['draft_id']}",
            headers=journey.auth_headers(),
            json={"content": journey.MANUAL_CONTENT, "expected_revision": 1},
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["revision"] == 2
        assert edited.json()["original_content"] == journey.FIRST_SOURCE_TEXT
        assert edited.json()["verification"]["status"] == "needs_review"
        assert len(store.history) == 1

        exact_edit_replay = client.patch(
            f"/api/v1/story-drafts/{first_draft['draft_id']}",
            headers=journey.auth_headers(),
            json={"content": journey.MANUAL_CONTENT, "expected_revision": 1},
        )
        assert exact_edit_replay.status_code == 200, exact_edit_replay.text
        assert exact_edit_replay.json()["revision"] == 2
        assert len(store.history) == 1

        stale_edit = client.patch(
            f"/api/v1/story-drafts/{first_draft['draft_id']}",
            headers=journey.auth_headers(),
            json={"content": STALE_CONTENT, "expected_revision": 1},
        )
        assert stale_edit.status_code == 409, stale_edit.text
        assert stale_edit.json()["error"]["code"] == "STORY_CONTEXT_CHANGED"
        assert "private stale" not in stale_edit.text
        assert store.drafts[0]["content"] == journey.MANUAL_CONTENT
        assert len(store.history) == 1

        verification = client.get(
            f"/api/v1/story-projects/{journey.PROJECT_ID}/verification",
            headers=journey.auth_headers(),
        )
        assert verification.status_code == 200, verification.text
        assert verification.json()["revision"] == 2
        assert verification.json()["verification"]["status"] == "needs_review"

        history = client.get(
            f"/api/v1/story-drafts/{first_draft['draft_id']}/history",
            headers=journey.auth_headers(),
        )
        assert history.status_code == 200, history.text
        assert [row["revision"] for row in history.json()] == [2]
        assert history.json()[0]["previous_content"] == journey.FIRST_SOURCE_TEXT

        continued = client.post(
            f"/api/v1/story-projects/{journey.PROJECT_ID}/continue",
            headers=journey.auth_headers(),
            json={},
        )
        assert continued.status_code == 200, continued.text
        assert continued.json()["generation_triggered"] is False
        assert continued.json()["latest_draft"]["content"] == journey.MANUAL_CONTENT
        assert len(store.drafts) == 1

        # A newly confirmed fact only makes the old draft stale; Continue still
        # preserves it.  A different explicit generation action creates v2.
        _review(client, second_memory["id"])
        continued_after_fact = client.post(
            f"/api/v1/story-projects/{journey.PROJECT_ID}/continue",
            headers=journey.auth_headers(),
            json={},
        )
        assert continued_after_fact.status_code == 200, continued_after_fact.text
        assert continued_after_fact.json()["latest_draft"]["version"] == 1
        assert continued_after_fact.json()["latest_draft"]["revision"] == 2
        assert continued_after_fact.json()["generation_triggered"] is False
        assert len(store.drafts) == 1

        regenerated = _generate(client, journey.GENERATION_KEYS[1])
        assert regenerated.status_code == 201, regenerated.text
        assert regenerated.json()["version"] == 2
        assert regenerated.json()["content"] == (
            journey.FIRST_SOURCE_TEXT + "\n\n" + journey.SECOND_SOURCE_TEXT
        )
        assert len(store.drafts) == 2
        assert store.drafts[0]["content"] == journey.MANUAL_CONTENT


def test_unresolved_conflict_and_unsupported_writer_never_save_a_draft():
    conflict = drafts.Scenario()
    conflict.results["load_story_context"] = {
        **drafts.context_row(),
        "excluded_memories": [
            {"memory_id": drafts.MEMORY_ID, "reason": "unresolved"}
        ],
        "source_memories": [],
        "blocking_clarifications": [CONFLICT_ID],
        "canonical_content": "",
    }
    with TestClient(drafts.make_app(conflict, drafts.NeverWriter())) as client:
        response = drafts.generate(client)

    drafts.assert_error(response, 409, "CLARIFICATION_REQUIRED")
    assert conflict.rpc_payloads["save_story_generation"] == []

    unsupported = drafts.Scenario()
    writer = drafts.FakeWriter(drafts.UNSUPPORTED_CONTENT)
    with TestClient(drafts.make_app(unsupported, writer)) as client:
        response = drafts.generate(client)

    drafts.assert_error(response, 422, "DRAFT_VERIFICATION_FAILED")
    assert unsupported.rpc_payloads["save_story_generation"] == []
    assert writer.calls == [("sv", "warm", [drafts.source_memory()])]


def test_parent_ownership_defense_hides_foreign_draft_and_continue():
    foreign_draft = drafts.Scenario()
    foreign_draft.project_rows = []
    with TestClient(drafts.make_app(foreign_draft)) as client:
        response = client.get(
            f"/api/v1/story-drafts/{drafts.DRAFT_ID}",
            headers=drafts.auth_headers(),
        )

    drafts.assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert response.json().get("draft_id") is None

    foreign_continue = exports.Scenario()
    foreign_continue.project_rows = []
    with TestClient(
        exports.make_app(foreign_continue, exports.NeverRenderer())
    ) as client:
        response = client.post(
            f"/api/v1/story-projects/{exports.PROJECT_ID}/continue",
            headers=exports.auth_headers(),
            json={},
        )

    exports.assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert foreign_continue.rpc_payloads["continue_story_project"] == []
