"""Public AI release fences and offline failure/source persistence contracts.

Auth/PostgREST use explicit MockTransport doubles. These checks prove public
route behavior, not live OpenAI quality or PostgreSQL transaction semantics.
"""

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from tests import test_audio_transcripts as audio
from tests import test_conversations as conversations
from tests import test_story_drafts as drafts


class ForbiddenLiveProvider:
    """Injected only after startup to exercise route-level defense in depth."""

    mode = "openai"
    enabled = True

    def __init__(self):
        self.calls = []

    async def transcribe(self, *_args):
        self.calls.append("transcribe")
        pytest.fail("runtime-mutated public provider made a paid transcription attempt")

    async def respond(self, *_args):
        self.calls.append("respond")
        pytest.fail("runtime-mutated public provider made a paid conversation attempt")

    async def write(self, *_args):
        self.calls.append("write")
        pytest.fail("runtime-mutated public provider made a paid story attempt")


@pytest.mark.parametrize("language", ["en", "sv"])
def test_runtime_mutated_live_audio_is_blocked_before_claim_or_provider(language):
    scenario = audio.Scenario(language=language)
    provider = ForbiddenLiveProvider()
    app = audio.make_app(scenario)
    with TestClient(app) as client:
        app.state.transcription_provider = provider
        response = audio.post_recording(client, audio.make_wav(), language)

    audio.assert_error(response, 503, "LIVE_AI_RELEASE_BLOCKED")
    assert provider.calls == []
    assert scenario.events == ["auth", "session", "project"]
    assert scenario.payloads == {"claim": [], "complete": [], "fail": []}


@pytest.mark.parametrize("language", ["en", "sv"])
def test_runtime_mutated_live_conversation_is_blocked_before_provider_or_append(language):
    scenario = conversations.Scenario()
    scenario.session_rows[0]["language"] = language
    scenario.project_rows[0]["language"] = language
    provider = ForbiddenLiveProvider()
    app = conversations.make_app(scenario)
    with TestClient(app) as client:
        app.state.conversation_provider = provider
        response = client.post(
            f"/api/v1/story-sessions/{conversations.SESSION_ID}/messages",
            headers=conversations.auth_headers(with_key=True),
            json={"text": "A fictional memory.", "language": language},
        )

    conversations.assert_error(response, 503, "CONVERSATION_DISABLED")
    assert provider.calls == []
    # The owned replay lookup is read-only, despite PostgREST using POST for
    # RPC transport. No append or correction RPC may follow the release gate.
    assert scenario.events == ["auth", "session", "project", "get_conversation_turn"]
    assert scenario.rpc_payloads["append_conversation_turn"] == []
    assert scenario.rpc_payloads["resolve_memory_fact"] == []


@pytest.mark.parametrize("language", ["en", "sv"])
def test_runtime_mutated_live_story_is_blocked_before_provider_context_or_save(language):
    scenario = drafts.Scenario()
    scenario.project_rows[0]["language"] = language
    provider = ForbiddenLiveProvider()
    app = drafts.make_app(scenario)
    with TestClient(app) as client:
        app.state.story_writer = provider
        response = drafts.generate(client, json_body={
            "language": language, "style": "warm", "confirm_generation": True,
        })

    drafts.assert_error(response, 503, "STORY_GENERATION_DISABLED")
    assert provider.calls == []
    assert scenario.events == ["auth", "project", "get_story_generation"]
    assert scenario.rpc_payloads["load_story_context"] == []
    assert scenario.rpc_payloads["save_story_generation"] == []
    assert scenario.rpc_payloads["edit_story_draft"] == []


def test_source_based_extraction_preserves_original_and_returns_only_pending_candidates():
    scenario = conversations.Scenario()
    original = "  " + conversations.SOURCE_TEXT + "\n  "
    scenario.source_rows[0]["text"] = original
    scenario.append_turn["user_message"]["text"] = original
    before = deepcopy(scenario.source_rows)
    provider = conversations.FakeProvider()
    with TestClient(conversations.make_app(scenario, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{conversations.SESSION_ID}/messages",
            headers=conversations.auth_headers(with_key=True),
            json={"source_message_id": conversations.USER_MESSAGE_ID, "language": "sv"},
        )

    assert response.status_code == 201, response.text
    result = response.json()
    assert result["user_message"]["text"] == original
    assert result["user_message"]["id"] == conversations.USER_MESSAGE_ID
    assert result["memories"]
    assert all(item["status"] == "pending" and item["corrected_value"] is None
               and item["source_message_id"] == conversations.USER_MESSAGE_ID
               for item in result["memories"])
    append = scenario.rpc_payloads["append_conversation_turn"][0]
    assert append["p_text"] == original
    assert append["p_source_message_id"] == conversations.USER_MESSAGE_ID
    assert all("status" not in candidate and "corrected_value" not in candidate
               for candidate in append["p_facts"])
    assert scenario.source_rows == before
    assert scenario.rpc_payloads["resolve_memory_fact"] == []


def test_failed_extraction_of_existing_source_does_not_append_or_change_original():
    scenario = conversations.Scenario()
    before_sources = deepcopy(scenario.source_rows)
    before_memories = deepcopy(scenario.memory_rows)
    private_detail = "synthetic-private-provider-error"
    provider = conversations.FakeProvider(error=RuntimeError(private_detail))
    with TestClient(conversations.make_app(scenario, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{conversations.SESSION_ID}/messages",
            headers=conversations.auth_headers(with_key=True),
            json={"source_message_id": conversations.USER_MESSAGE_ID, "language": "sv"},
        )

    conversations.assert_error(response, 503, "CONVERSATION_INVALID_RESPONSE")
    assert private_detail not in response.text
    assert conversations.SOURCE_TEXT not in response.text
    assert len(provider.calls) == 1
    assert scenario.source_rows == before_sources
    assert scenario.memory_rows == before_memories
    assert scenario.rpc_payloads["append_conversation_turn"] == []
    assert scenario.rpc_payloads["resolve_memory_fact"] == []


@pytest.mark.parametrize("failure", ["provider_error", "unsupported_prose"])
def test_failed_story_attempt_cannot_replace_prior_drafts_or_source_snapshots(failure):
    scenario = drafts.Scenario()
    before = deepcopy(scenario.results)
    writer = drafts.FakeWriter(
        content=drafts.UNSUPPORTED_CONTENT if failure == "unsupported_prose" else drafts.SUPPORTED_CONTENT,
        error=RuntimeError("synthetic-private-error") if failure == "provider_error" else None,
    )
    with TestClient(drafts.make_app(scenario, writer)) as client:
        response = drafts.generate(client)

    expected = (503, "STORY_WRITER_INVALID_RESPONSE") if failure == "provider_error" else (422, "DRAFT_VERIFICATION_FAILED")
    drafts.assert_error(response, *expected)
    assert "synthetic-private-error" not in response.text
    assert drafts.UNSUPPORTED_CONTENT not in response.text
    assert len(writer.calls) == 1
    assert scenario.results == before
    assert scenario.rpc_payloads["save_story_generation"] == []
    assert scenario.rpc_payloads["edit_story_draft"] == []
