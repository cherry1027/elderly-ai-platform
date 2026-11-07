"""Offline typed-chat contracts; mocked acceptance is not real AI/phone evidence."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
from pydantic import ValidationError
import pytest

from app.api.dependencies import get_current_user
from app.api.real_ai import get_real_gateway
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.schemas.real_ai import RealTurn
from tests.test_real_ai_api import (
    FakeGateway, harness, PROJECT, SESSION, TRANSCRIPT, OTHER, NOW, PROV,
)

ORIGINAL = {"mode": "original", "provider": "user", "model": None, "version": 1}
PATH = f"/api/v2/story-sessions/{SESSION}/text-messages"


class TextGateway(FakeGateway):
    def __init__(self, language="en"):
        super().__init__(language)
        self.saved_messages = []
        self.original_inputs = {}
        self.scope_reads = 0
        self.scope_error = None
        self.scope_override = False
        self.scope_result = None
        self.active = True
        self.complete_error = False

    async def get_owned_session(self, resource_id, active=False):
        row = await super().get_owned_session(resource_id, active)
        if active and not self.active:
            raise APIError(409, "SESSION_COMPLETED", "This conversation session is completed.")
        return row

    async def rpc(self, name, payload):
        if name == "check_real_text_chat_scope":
            self.scope_reads += 1
            assert payload == {"p_session_id": str(SESSION)}
            if self.scope_error:
                raise self.scope_error
            if self.scope_override:
                return self.scope_result
            return {"project_id": str(PROJECT), "session_id": str(SESSION), "language": self.language, "input_limit": 4000}
        assert name in {"get_real_ai_operation", "get_real_ai_operation_by_key"}
        for (kind, key), row in self.claims.items():
            if (name.endswith("by_key") and str(key) == payload["p_action_key"] and kind == payload["p_kind"]
                or name == "get_real_ai_operation" and row["operation_id"] == payload["p_operation_id"]):
                return {k: row.get(k) for k in ("operation_id", "kind", "status", "result", "error_code")} | {
                    "project_id": str(PROJECT), "session_id": str(SESSION), "created_at": NOW, "updated_at": NOW}
        raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")

    async def messages(self, session_id, limit=100, offset=0, recent=False):
        await self.get_owned_session(session_id)
        rows = self.saved_messages[-limit:] if recent else self.saved_messages[offset:offset + limit]
        return deepcopy(rows)

    async def claim(self, project_id, session_id, kind, key, fingerprint):
        # Mirror the SQL anti-double-source rule. Typed fingerprints must include
        # the explicit action key so a later intentional "Yes" remains possible.
        for (old_kind, old_key), row in self.claims.items():
            if old_kind == kind and old_key != key and row["digest"] == fingerprint and row["status"] != "failed":
                raise APIError(409, "REAL_AI_CONFLICT", "State changed.")
        return await super().claim(project_id, session_id, kind, key, fingerprint)

    async def complete(self, claim, payload, provenance):
        if "input_text" not in payload:
            result = await super().complete(claim, payload, provenance)
            self.saved_messages.extend([result["user_message"], result["message"]])
            return result
        if self.complete_error:
            raise APIError(503, "SUPABASE_UNAVAILABLE", "The service is unavailable.")
        identifier = claim["operation_id"]
        source = {"source_transcript_id": None, "source_text_input_id": identifier}
        shared = {"project_id": str(PROJECT), "session_id": str(SESSION), "language": self.language,
                  "created_at": NOW, **source}
        user = {**shared, "id": identifier, "role": "user", "text": payload["input_text"],
                "sequence": len(self.saved_messages) + 1, "provenance": ORIGINAL}
        assistant = {**shared, "id": str(uuid4()), "role": "assistant", "text": payload["assistant_text"],
                     "sequence": user["sequence"] + 1, "provenance": provenance}
        result = {"user_message": user, "message": assistant, "memories": [], "mode": "real"}
        self.original_inputs[identifier] = payload["input_text"]
        self.saved_messages.extend([deepcopy(user), deepcopy(assistant)])
        for row in self.claims.values():
            if row["operation_id"] == identifier:
                row.update(status="completed", result=deepcopy(result))
        return result


@pytest.fixture
def text_harness(harness):
    def build(language="en", enabled=True):
        app, _, provider = harness(language, enabled)
        gateway = TextGateway(language)
        app.dependency_overrides[get_real_gateway] = lambda: gateway
        app.dependency_overrides[get_current_user] = lambda: gateway.user
        return app, gateway, provider
    return build


def send(client, text="I grew up in Bristol.", language="en", key=None, path=PATH):
    return client.post(path, json={"text": text, "language": language}, headers={"Idempotency-Key": str(key or uuid4())})


@pytest.mark.parametrize("language,text", [("en", "  I grew up in Bristol.\nWith my sister.  "),
                                             ("sv", "  Jag växte upp i Malmö. År 1978. 🦋\n")])
def test_typed_original_and_reply_saved_once_then_reopened_without_ai(language, text, text_harness):
    app, gateway, provider = text_harness(language)
    key = uuid4()
    with TestClient(app) as client:
        first = send(client, text, language, key)
        replay = send(client, text, language, key)
        reopened = client.get(f"/api/v2/story-sessions/{SESSION}/messages")
    assert first.status_code == replay.status_code == reopened.status_code == 200
    assert first.json() == replay.json()
    user, assistant = first.json()["user_message"], first.json()["message"]
    assert user["text"] == text and user["provenance"] == ORIGINAL
    assert user["source_transcript_id"] is assistant["source_transcript_id"] is None
    assert user["id"] == user["source_text_input_id"] == assistant["source_text_input_id"]
    assert assistant["provenance"]["mode"] == "real" and assistant["language"] == language
    assert reopened.json() == [user, assistant]
    assert list(gateway.original_inputs.values()) == [text]
    assert provider.calls == 1 and len(gateway.claims) == 1
    assert first.headers["cache-control"] == "no-store"


def test_same_short_answer_with_new_explicit_keys_is_allowed(text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        first, second = send(client, "Yes"), send(client, "Yes")
    assert first.status_code == second.status_code == 200
    assert first.json()["user_message"]["id"] != second.json()["user_message"]["id"]
    assert provider.calls == 2 and len(gateway.original_inputs) == 2


def test_changed_original_under_same_key_conflicts_without_duplicate_dispatch(text_harness):
    app, gateway, provider = text_harness(); key = uuid4()
    with TestClient(app) as client:
        assert send(client, "First original", key=key).status_code == 200
        response = send(client, "Changed original", key=key)
    assert response.status_code == 409 and provider.calls == 1
    assert list(gateway.original_inputs.values()) == ["First original"]


@pytest.mark.parametrize("payload", [{"text": "", "language": "en"}, {"text": " \t\n", "language": "en"},
    {"text": "x" * 4001, "language": "en"}, {"text": "hello\x00world", "language": "en"},
    {"text": 42, "language": "en"}, {"text": "hello", "language": "fr"},
    {"text": "hello", "language": "sv"}, {"text": "hello", "language": "en", "user_id": str(OTHER)},
    {"text": "hello", "language": "en", "source_transcript_id": str(TRANSCRIPT)}])
def test_invalid_input_rejected_before_claim_or_provider(payload, text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        response = client.post(PATH, json=payload, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 422 and provider.calls == gateway.claim_count == 0


def test_lone_surrogate_is_rejected_without_leaking_input(text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        response = client.post(PATH, content=b'{"text":"private-\\ud800-original","language":"en"}',
                              headers={"Idempotency-Key": str(uuid4()), "Content-Type": "application/json"})
    assert response.status_code == 422 and provider.calls == gateway.claim_count == 0
    assert "private-" not in response.text


def test_exact_maximum_unicode_length_is_accepted(text_harness):
    app, _, provider = text_harness("sv")
    with TestClient(app) as client:
        response = send(client, "å" * 4000, "sv")
    assert response.status_code == 200 and len(response.json()["user_message"]["text"]) == 4000 and provider.calls == 1


@pytest.mark.parametrize("path,headers", [(PATH, {}), (PATH, {"Idempotency-Key": "bad"}),
    ("/api/v2/story-sessions/not-a-uuid/text-messages", {"Idempotency-Key": str(uuid4())})])
def test_uuid_inputs_required_before_claim(path, headers, text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        response = client.post(path, json={"text": "Hello", "language": "en"}, headers=headers)
    assert response.status_code == 422 and provider.calls == gateway.claim_count == 0


@pytest.mark.parametrize("auth_status", [None, 401, 403])
def test_missing_invalid_expired_authentication_prevents_all_resource_and_ai_access(auth_status):
    requests = []
    def handler(request):
        requests.append(request.url.path)
        assert request.url.path == "/auth/v1/user"
        return httpx.Response(auth_status, json={"private": "upstream-auth-detail"})
    app = create_app(Settings(_env_file=None, supabase_url="https://synthetic.supabase.co", supabase_publishable_key="synthetic-public"),
                     transport=httpx.MockTransport(handler))
    headers = {} if auth_status is None else {"Authorization": "Bearer synthetic-expired-token"}
    with TestClient(app) as client:
        response = client.post(PATH, json={"text": "Original", "language": "en"}, headers={**headers, "Idempotency-Key": str(uuid4())})
    assert response.status_code == 401 and "upstream-auth-detail" not in response.text
    assert len(requests) == (0 if auth_status is None else 1)


@pytest.mark.parametrize("condition,status", [("cross_user", 404), ("completed", 409), ("missing", 404)])
def test_unowned_missing_or_completed_sessions_never_reach_scope_or_ai(condition, status, text_harness):
    app, gateway, provider = text_harness()
    gateway.owned = condition != "cross_user"; gateway.active = condition != "completed"
    path = PATH if condition != "missing" else f"/api/v2/story-sessions/{OTHER}/text-messages"
    with TestClient(app) as client:
        response = send(client, path=path)
    assert response.status_code == status and gateway.scope_reads == gateway.claim_count == provider.calls == 0


@pytest.mark.parametrize("scope", [None, [], {}, {"project_id": str(OTHER), "session_id": str(SESSION), "language": "en", "input_limit": 4000},
    {"project_id": str(PROJECT), "session_id": str(OTHER), "language": "en", "input_limit": 4000},
    {"project_id": str(PROJECT), "session_id": str(SESSION), "language": "sv", "input_limit": 4000},
    {"project_id": str(PROJECT), "session_id": str(SESSION), "language": "en", "input_limit": True}])
def test_unverified_migration_scope_never_dispatches(scope, text_harness):
    app, gateway, provider = text_harness(); gateway.scope_override = True; gateway.scope_result = scope
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "TEXT_CHAT_NOT_READY"
    assert provider.calls == gateway.claim_count == 0


def test_missing_migration_fails_before_provider_claim_or_reservation(text_harness):
    app, gateway, provider = text_harness()
    gateway.scope_error = APIError(503, "SUPABASE_UNAVAILABLE", "The service is unavailable.")
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "TEXT_CHAT_NOT_READY"
    assert gateway.claim_count == provider.calls == 0


def test_closed_gate_never_claims_or_creates_original(text_harness):
    app, gateway, provider = text_harness(enabled=False)
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert provider.calls == gateway.claim_count == 0 and not gateway.original_inputs


def test_closed_allowance_never_claims_or_reserves(text_harness):
    app, gateway, provider = text_harness()
    def closed():
        raise APIError(503, "AI_SPENDING_NOT_APPROVED", "Live AI spending is not approved.")
    app.state.real_ai.require = closed
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "AI_SPENDING_NOT_APPROVED"
    assert gateway.claim_count == provider.calls == 0 and not gateway.original_inputs


def test_existing_real_adapter_runs_only_extraction_and_interviewer_for_typed_turn(text_harness):
    from tests.test_real_ai_provider import ScriptedClient, provider as real_provider
    app, gateway, _ = text_harness("sv")
    scripted = ScriptedClient([{"language": "sv", "facts": []}, {"language": "sv", "text": "Vem var där med dig?"}])
    adapter = real_provider(scripted)
    app.state.real_ai.require = lambda: adapter
    original = "  Jag minns trädgården i Malmö.\n"
    with TestClient(app) as client:
        response = send(client, original, "sv")
    assert response.status_code == 200 and response.json()["user_message"]["text"] == original
    assert [row["operation"] for row in scripted.calls] == ["memory_extraction", "conversation"]
    assert not scripted.transcription_calls and len(gateway.original_inputs) == 1
    assert all(row["payload"]["language"] == "sv" for row in scripted.calls)


def test_typed_context_reads_overlap_before_claim_or_dispatch(text_harness):
    app, gateway, provider = text_harness()
    started = set(); ready = None
    async def read(name):
        nonlocal ready
        if ready is None:
            ready = asyncio.Event()
        assert provider.calls == gateway.claim_count == 0
        started.add(name)
        if len(started) == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 1)
        return []
    gateway.project_memories = lambda *args, **kwargs: read("memories")
    gateway.messages = lambda *args, **kwargs: read("messages")
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 200 and started == {"messages", "memories"} and provider.calls == 1


def test_saved_typed_history_can_be_read_when_paid_ai_is_closed(text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        assert send(client).status_code == 200
        def closed():
            pytest.fail("Reading saved chat must not require paid AI")
        app.state.real_ai.require = closed
        response = client.get(f"/api/v2/story-sessions/{SESSION}/messages")
    assert response.status_code == 200 and len(response.json()) == 2 and provider.calls == 1


def test_provider_input_validation_runs_before_claim(text_harness):
    app, gateway, provider = text_harness()
    def invalid(*args, **kwargs):
        raise APIError(409, "AI_CONTEXT_LIMIT", "Review this story before continuing.")
    provider.validate_turn_input = invalid
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 409 and gateway.claim_count == provider.calls == 0


def test_uncertain_timeout_reconciles_without_resubmitting(text_harness):
    app, gateway, provider = text_harness(); provider.fail = True; key = uuid4()
    with TestClient(app) as client:
        first = send(client, key=key); replay = send(client, key=key)
        status = client.get(f"/api/v2/operations/by-key/conversation/{key}")
    assert first.status_code == 504 and replay.status_code == 409 and status.status_code == 200
    assert replay.json()["error"]["code"] == "AI_OPERATION_UNCERTAIN"
    assert first.headers["x-memy-operation-id"] == replay.headers["x-memy-operation-id"] == status.json()["operation_id"]
    assert status.json()["status"] == "uncertain" and provider.calls == 1
    assert not gateway.original_inputs and not gateway.saved_messages


def test_completed_typed_turn_reconciles_read_only(text_harness):
    app, gateway, provider = text_harness(); key = uuid4()
    with TestClient(app) as client:
        first = send(client, key=key)
        status = client.get(f"/api/v2/operations/by-key/conversation/{key}")
    assert first.status_code == status.status_code == 200 and status.json()["result"] == first.json()
    assert provider.calls == 1 and len(gateway.original_inputs) == 1


def test_failed_completion_does_not_create_partial_originals_or_retry(text_harness):
    app, gateway, provider = text_harness(); gateway.complete_error = True; key = uuid4()
    with TestClient(app) as client:
        first, replay = send(client, key=key), send(client, key=key)
    assert first.status_code == 503 and replay.status_code == 409 and provider.calls == 1
    assert not gateway.original_inputs and not gateway.saved_messages


def test_saved_voice_and_typed_turns_share_ordered_history(text_harness):
    app, gateway, provider = text_harness()
    with TestClient(app) as client:
        voice = client.post(f"/api/v2/story-sessions/{SESSION}/messages",
            json={"source_transcript_id": str(TRANSCRIPT), "language": "en"}, headers={"Idempotency-Key": str(uuid4())})
        typed = send(client, "I also remember the river.")
        history = client.get(f"/api/v2/story-sessions/{SESSION}/messages")
    assert voice.status_code == typed.status_code == history.status_code == 200
    rows = history.json(); assert [r["sequence"] for r in rows] == [1, 2, 3, 4]
    assert rows[0]["source_transcript_id"] == str(TRANSCRIPT) and rows[0]["source_text_input_id"] is None
    assert rows[2]["source_transcript_id"] is None and rows[2]["provenance"] == ORIGINAL
    assert provider.calls == 2


@pytest.mark.parametrize("corruption", ["both_sources", "no_source", "wrong_user_provenance", "wrong_assistant_provenance", "different_sources", "different_scope", "wrong_raw_id", "duplicate_message_id"])
def test_turn_schema_rejects_source_or_provenance_incoherence(corruption):
    source = str(uuid4()); shared = {"project_id": str(PROJECT), "session_id": str(SESSION), "language": "en", "created_at": NOW,
                                   "source_transcript_id": None, "source_text_input_id": source}
    user = {**shared, "id": source, "role": "user", "text": "Original", "sequence": 1, "provenance": ORIGINAL}
    assistant = {**shared, "id": str(uuid4()), "role": "assistant", "text": "A reply", "sequence": 2, "provenance": PROV}
    if corruption == "both_sources": user["source_transcript_id"] = str(TRANSCRIPT)
    if corruption == "no_source": user["source_text_input_id"] = None
    if corruption == "wrong_user_provenance": user["provenance"] = PROV
    if corruption == "wrong_assistant_provenance": assistant["provenance"] = ORIGINAL
    if corruption == "different_sources": assistant["source_text_input_id"] = str(uuid4())
    if corruption == "different_scope": assistant["project_id"] = str(OTHER)
    if corruption == "wrong_raw_id": user["id"] = str(uuid4())
    if corruption == "duplicate_message_id": assistant["id"] = user["id"]
    with pytest.raises(ValidationError):
        RealTurn.model_validate({"user_message": user, "message": assistant, "memories": [], "mode": "real"})


def test_completed_typed_replay_cannot_substitute_another_operation_source(text_harness):
    app, gateway, provider = text_harness(); key = uuid4()
    with TestClient(app) as client:
        assert send(client, key=key).status_code == 200
        row = gateway.claims[("conversation", key)]["result"]; other = str(uuid4())
        row["user_message"]["id"] = row["user_message"]["source_text_input_id"] = row["message"]["source_text_input_id"] = other
        response = send(client, key=key)
    assert response.status_code == 503 and provider.calls == 1 and other not in response.text



def test_typed_scope_and_both_context_reads_share_one_network_wave(text_harness):
    app, gateway, provider = text_harness()
    original_rpc = gateway.rpc
    started, completed = set(), set()
    ready = None
    async def rendezvous(name):
        nonlocal ready
        if ready is None:
            ready = asyncio.Event()
        assert gateway.claim_count == provider.calls == 0
        started.add(name)
        if len(started) == 3:
            ready.set()
        await asyncio.wait_for(ready.wait(), 1)
        completed.add(name)
    async def scope(name, payload):
        await rendezvous("scope")
        return await original_rpc(name, payload)
    async def context(name):
        await rendezvous(name)
        return []
    gateway.rpc = scope
    gateway.project_memories = lambda *args, **kwargs: context("memories")
    gateway.messages = lambda *args, **kwargs: context("messages")
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 200
    assert completed == started == {"scope", "memories", "messages"}
    assert provider.calls == gateway.claim_count == 1


@pytest.mark.parametrize("failure", ["scope", "memories", "messages"])
def test_any_preflight_failure_cancels_and_joins_other_context_reads(failure, text_harness):
    app, gateway, provider = text_harness()
    started, cleaned = set(), set()
    ready = None
    async def read(name):
        nonlocal ready
        if ready is None:
            ready = asyncio.Event()
        started.add(name)
        if len(started) == 3:
            ready.set()
        try:
            await asyncio.wait_for(ready.wait(), 1)
            if name == failure:
                raise APIError(503, "SUPABASE_UNAVAILABLE", "Synthetic failure")
            await asyncio.Future()
        finally:
            cleaned.add(name)
    gateway.rpc = lambda *args, **kwargs: read("scope")
    gateway.project_memories = lambda *args, **kwargs: read("memories")
    gateway.messages = lambda *args, **kwargs: read("messages")
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503
    expected = "TEXT_CHAT_NOT_READY" if failure == "scope" else "SUPABASE_UNAVAILABLE"
    assert response.json()["error"]["code"] == expected
    assert started == cleaned == {"scope", "memories", "messages"}
    assert gateway.claim_count == provider.calls == 0
    assert not gateway.original_inputs


def test_paused_text_policy_fails_before_context_reads(text_harness):
    app, gateway, provider = text_harness()
    app.state.settings.real_ai_conversation_enabled = False
    async def unexpected(*args, **kwargs):
        pytest.fail("Paused conversation must not fetch context")
    gateway.rpc = gateway.project_memories = gateway.messages = unexpected
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert gateway.claim_count == provider.calls == 0
