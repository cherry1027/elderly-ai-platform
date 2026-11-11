"""Offline reconciliation regressions; no hosted traffic or real model calls."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import json
from types import SimpleNamespace
from uuid import UUID, uuid4
import wave

from fastapi.testclient import TestClient
import httpx
from pydantic import SecretStr
import pytest

from app.api.dependencies import get_current_user
from app.api.real_ai import digest, get_real_gateway
from app.core.errors import APIError
from app.services.auth import AuthenticatedUser
from app.services.openai_client import OpenAIClient, mark_ai_dispatched
from app.services.real_ai_provider import RealAIProvider
from app.services.real_ai_resources import RealAIGateway
from app.services.real_ai_runtime import SpeechCache
from tests.test_real_ai_api import (
    FakeGateway, NOW, OTHER, OWNER, PROJECT, PROV, SESSION, TRANSCRIPT, harness,
)


def message(identifier, language="en"):
    return {
        "id": str(identifier), "project_id": str(PROJECT), "session_id": str(SESSION),
        "role": "assistant", "language": language, "text": "What do you remember?" if language == "en" else "Vad minns du?",
        "sequence": 2, "source_transcript_id": str(TRANSCRIPT), "created_at": NOW,
        "provenance": PROV,
    }


def wav_bytes():
    output = BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(24_000)
        stream.writeframes(b"\0\0" * 240)
    return output.getvalue()


class ReconciliationGateway(FakeGateway):
    """Reuse real result normalization and staleness checks with local reads."""

    normalize_result = RealAIGateway.normalize_result
    _normalize_result = RealAIGateway._normalize_result
    draft = RealAIGateway.draft

    def __init__(self, language="en"):
        super().__init__(language)
        self.local_rows = {}
        self.reads = []
        self.rpc_calls = []
        self.context_reads = []

    async def one(self, table, field, resource_id):
        self.reads.append((table, field, resource_id))
        row = self.local_rows.get((table, resource_id))
        if row is not None:
            return deepcopy(row)
        return await super().one(table, field, resource_id)

    async def rpc(self, name, payload, **kwargs):
        self.rpc_calls.append((name, deepcopy(payload)))
        if name == "get_real_ai_operation":
            assert payload == {"p_operation_id": self.operation["operation_id"]}
            return deepcopy(self.operation)
        if name == "get_real_ai_operation_by_key":
            assert payload == {"p_kind": self.operation["kind"], "p_action_key": str(self.operation_key)}
            return deepcopy(self.operation)
        raise AssertionError("Unexpected offline RPC")

    async def context(self, project_id):
        self.context_reads.append(project_id)
        assert project_id == PROJECT
        return deepcopy(self.current_context)


def install_gateway(app, gateway):
    app.dependency_overrides[get_real_gateway] = lambda: gateway
    app.dependency_overrides[get_current_user] = lambda: gateway.user


def seed_completed_speech(gateway, *, expires_at, data, key):
    assistant_id, speech_id = uuid4(), uuid4()
    assistant = message(assistant_id, gateway.language)
    gateway.local_rows[("real_conversation_messages", assistant_id)] = assistant
    # This is complete_real_ai_operation's actual SQL result shape: owner_id and
    # operation_id removed, but scope/provenance/created_at still present.
    result = {
        "speech_id": str(speech_id), "project_id": str(PROJECT), "session_id": str(SESSION),
        "assistant_message_id": str(assistant_id), "media_type": "audio/wav",
        "audio_sha256": sha256(data).hexdigest(), "audio_size": len(data),
        "expires_at": expires_at, "provenance": PROV, "created_at": NOW,
    }
    gateway.local_rows[("real_speech", speech_id)] = deepcopy(result)
    gateway.claims[("speech", key)] = {
        "operation_id": str(uuid4()), "kind": "speech", "status": "completed",
        "claimed": False, "result": deepcopy(result), "error_code": None,
        "digest": digest({
            "assistant_id": str(assistant_id),
            "text_sha256": sha256(assistant["text"].encode()).hexdigest(),
            "language": gateway.language,
        }),
    }
    return assistant_id, speech_id, result


@pytest.mark.parametrize("language", ["en", "sv"])
@pytest.mark.parametrize("condition", ["cache-loss", "cache-expiry", "metadata-expiry"])
def test_completed_speech_loss_or_expiry_is_410_without_implicit_resynthesis(language, condition, harness):
    app, _, provider = harness(language)
    gateway = ReconciliationGateway(language)
    install_gateway(app, gateway)
    synth_calls = []

    async def forbidden_synthesis(*args):
        synth_calls.append(args)
        raise AssertionError("A completed speech operation must never synthesize again")

    provider.synthesize = forbidden_synthesis
    clock = [0.0]
    cache = SpeechCache(ttl=5, clock=lambda: clock[0])
    app.state.real_ai.cache = cache
    key = uuid4()
    data = wav_bytes()
    expiry = datetime.now(timezone.utc) + timedelta(seconds=-1 if condition == "metadata-expiry" else 300)
    assistant_id, speech_id, saved = seed_completed_speech(gateway, expires_at=expiry.isoformat(), data=data, key=key)
    if condition != "cache-loss":
        cache.put(OWNER, speech_id, data, saved["audio_sha256"])
    if condition == "cache-expiry":
        clock[0] = 6.0
    with TestClient(app) as client:
        for _ in range(2):
            result = client.post(
                f"/api/v2/conversation-messages/{assistant_id}/speech",
                json={"language": language}, headers={"Idempotency-Key": str(key)},
            )
            assert result.status_code == 410, result.text
            assert result.json()["error"]["code"] == "SPEECH_EXPIRED"
        audio = client.get(f"/api/v2/spoken-replies/{speech_id}/audio")
        assert audio.status_code == 410
        assert audio.json()["error"]["code"] == "SPEECH_EXPIRED"
    assert not synth_calls and provider.calls == 0
    assert gateway.claim_count == 2 and gateway.failures == 0
    assert gateway.claims[("speech", key)]["status"] == "completed"


def test_completed_speech_with_valid_cache_replays_actual_sql_shape_without_cost(harness):
    app, _, provider = harness()
    gateway = ReconciliationGateway()
    install_gateway(app, gateway)
    key = uuid4()
    data = wav_bytes()
    assistant_id, speech_id, saved = seed_completed_speech(
        gateway, expires_at=(datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat(), data=data, key=key,
    )
    app.state.real_ai.cache.put(OWNER, speech_id, data, saved["audio_sha256"])
    with TestClient(app) as client:
        response = client.post(f"/api/v2/conversation-messages/{assistant_id}/speech",
                               json={"language": "en"}, headers={"Idempotency-Key": str(key)})
        audio = client.get(f"/api/v2/spoken-replies/{speech_id}/audio")
    assert response.status_code == audio.status_code == 200
    assert response.json()["speech_id"] == str(speech_id)
    assert response.json()["language"] == "en"
    assert audio.content == data and audio.headers["content-type"] == "audio/wav"
    assert audio.headers["cache-control"] == "private, no-store"
    assert audio.headers["x-memy-audio-sha256"] == saved["audio_sha256"]
    assert provider.calls == gateway.failures == 0


def test_review_of_memory_beyond_first_hundred_fetches_exact_updated_resource(harness):
    app, gateway, provider = harness()
    memory_ids = [uuid4() for _ in range(102)]
    target = memory_ids[-1]
    rows = {identifier: {
        "id": str(identifier), "project_id": str(PROJECT), "session_id": str(SESSION),
        "source_message_id": str(TRANSCRIPT), "fact_type": "location", "value": "Bristol",
        "evidence": "I grew up in Bristol.", "year": None, "slot": "home",
        "uncertain": False, "status": "pending", "corrected_value": None, "version": 1,
        "created_at": NOW, "updated_at": NOW,
    } for identifier in memory_ids}
    exact_reads, rpc_calls, question_reads = [], [], []

    async def one(table, field, resource_id):
        assert table == "real_memories" and field == "id" and resource_id == target
        exact_reads.append(resource_id)
        return deepcopy(rows[resource_id])

    async def rpc(name, payload):
        rpc_calls.append((name, deepcopy(payload)))
        assert name == "review_real_memory" and payload["p_memory_id"] == str(target)
        rows[target].update(status="confirmed", version=2)
        return deepcopy(rows[target])

    async def questions(table, *, filters, limit):
        question_reads.append((table, filters, limit))
        assert table == "real_memory_clarifications"
        assert filters == {"fact_id": f"eq.{target}", "status": "eq.open"}
        return []

    async def forbidden_list(*args, **kwargs):
        raise AssertionError("Memory review must not search the first session page")

    gateway.one, gateway.rpc, gateway.rows, gateway.memories = one, rpc, questions, forbidden_list
    with TestClient(app) as client:
        response = client.patch(f"/api/v2/memories/{target}", json={"status": "confirmed", "expected_version": 1})
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(target)
    assert response.json()["status"] == "confirmed" and response.json()["version"] == 2
    assert response.json()["clarification_question"] is None
    assert exact_reads == [target, target] and len(rpc_calls) == len(question_reads) == 1
    assert all(rows[identifier]["status"] == "pending" for identifier in memory_ids[:-1])
    assert gateway.claim_count == provider.calls == 0



def confirmed_source(memory_id):
    return {
        "memory_id": str(memory_id), "memory_version": 1, "source_message_id": str(TRANSCRIPT),
        "fact_type": "location", "value": "Bristol", "evidence": "I grew up in Bristol.",
        "corrected_value": None, "year": None, "slot": "home", "sentence": "Bristol",
    }


def saved_generation(draft_id, source, content):
    return {
        "draft_id": str(draft_id), "project_id": str(PROJECT), "language": "en", "style": "warm",
        "status": "needs_review", "version": 1, "revision": 1,
        "content": content, "original_content": content,
        "source_memories": [source], "verification": {
            "status": "needs_review", "method": "model_review_v1", "unsupported_claims": [],
            "checked_revision": 1, "checked_at": NOW, "sources_current": True,
            "reason": "Human review required.",
        }, "mode": "real", "provenance": PROV, "created_at": NOW, "updated_at": NOW,
    }


def test_verified_rejection_is_terminal_and_only_a_fresh_explicit_key_can_generate(harness):
    app, _, provider = harness()
    gateway = ReconciliationGateway()
    install_gateway(app, gateway)
    source = confirmed_source(uuid4())
    gateway.current_context = {
        "source_memories": [source], "blocking_clarifications": [], "context_token": "a" * 64,
    }
    attempted, saved = [], []

    async def write(language, style, memories):
        assert (language, style, memories) == ("en", "warm", [source])
        mark_ai_dispatched()
        attempted.append(memories)
        if len(attempted) == 1:
            raise APIError(422, "DRAFT_VERIFICATION_FAILED", "Unsupported story content was not accepted.")
        return source["evidence"]

    async def complete(claim, payload, provenance):
        assert payload == {"content": source["evidence"], "source_memories": [source],
                           "model_review": {"unsupported_claims": []}}
        assert provenance == PROV
        draft_id = uuid4()
        row = saved_generation(draft_id, source, payload["content"])
        gateway.local_rows[("real_story_drafts", draft_id)] = deepcopy(row)
        for operation in gateway.claims.values():
            if operation["operation_id"] == claim["operation_id"]:
                operation.update(status="completed", result=deepcopy(row))
        saved.append(row)
        return row

    provider.write = write
    gateway.complete = complete
    path = f"/api/v2/story-projects/{PROJECT}/generate"
    body = {"language": "en", "style": "warm", "confirm_generation": True}
    failed_key, retry_key = uuid4(), uuid4()
    with TestClient(app) as client:
        rejected = client.post(path, json=body, headers={"Idempotency-Key": str(failed_key)})
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()["error"]["code"] == "DRAFT_VERIFICATION_FAILED"
        operation_id = rejected.headers["x-memy-operation-id"]
        rejected_row = gateway.claims[("generation", failed_key)]
        assert rejected_row["status"] == "failed" and rejected_row["result"] is None
        gateway.operation = {
            "operation_id": operation_id, "project_id": str(PROJECT), "session_id": None,
            "kind": "generation", "status": rejected_row["status"], "error_code": rejected_row["error_code"],
            "created_at": NOW, "updated_at": NOW, "result": rejected_row["result"],
        }
        checked = client.get(f"/api/v2/operations/{operation_id}")
        assert checked.status_code == 200 and checked.json()["status"] == "failed"
        replay = client.post(path, json=body, headers={"Idempotency-Key": str(failed_key)})
        assert replay.status_code == 409 and replay.json()["error"]["code"] == "AI_OPERATION_FAILED"
        assert replay.headers["x-memy-operation-id"] == operation_id
        assert len(attempted) == gateway.failures == 1
        assert saved == []
        retried = client.post(path, json=body, headers={"Idempotency-Key": str(retry_key)})

    assert retried.status_code == 201, retried.text
    assert retried.json()["draft_id"] == saved[0]["draft_id"]
    assert retried.json()["content"] == source["evidence"]
    assert len(attempted) == 2 and len(saved) == gateway.failures == 1
    assert gateway.claims[("generation", retry_key)]["status"] == "completed"
    assert rejected_row["status"] == "failed" and rejected_row["result"] is None


def test_generation_provider_timeout_remains_uncertain_after_dispatch(harness):
    app, gateway, provider = harness()
    source = confirmed_source(uuid4())

    async def context(_project):
        return {"source_memories": [source], "blocking_clarifications": [], "context_token": "a" * 64}

    async def timed_out(*args):
        provider.calls += 1
        mark_ai_dispatched()
        raise APIError(504, "AI_PROVIDER_TIMEOUT", "The AI provider timed out.")

    gateway.context, provider.write = context, timed_out
    key = uuid4()
    with TestClient(app) as client:
        args = {"json": {"language": "en", "style": "warm", "confirm_generation": True},
                "headers": {"Idempotency-Key": str(key)}}
        path = f"/api/v2/story-projects/{PROJECT}/generate"
        failed = client.post(path, **args)
        replay = client.post(path, **args)

    assert failed.status_code == 504 and failed.json()["error"]["code"] == "AI_PROVIDER_TIMEOUT"
    assert replay.status_code == 409 and replay.json()["error"]["code"] == "AI_OPERATION_UNCERTAIN"
    assert failed.headers["x-memy-operation-id"] == replay.headers["x-memy-operation-id"]
    assert provider.calls == gateway.failures == 1
    assert gateway.claims[("generation", key)]["status"] == "uncertain"


@pytest.mark.parametrize(("kind", "code", "status", "expected_status"), [
    ("generation", "DRAFT_VERIFICATION_FAILED", "uncertain", "failed"),
    ("generation", "AI_PROVIDER_TIMEOUT", "uncertain", "uncertain"),
    ("generation", None, "in_progress", "in_progress"),
    ("conversation", "DRAFT_VERIFICATION_FAILED", "uncertain", "uncertain"),
])
def test_saved_operation_reconciliation_preserves_audit_and_requires_ownership(
    harness, kind, code, status, expected_status,
):
    app, _, provider = harness()
    gateway = ReconciliationGateway()
    install_gateway(app, gateway)
    operation_id, gateway.operation_key = uuid4(), uuid4()
    stamp = NOW.replace("+00:00", "Z")
    gateway.operation = {
        "operation_id": str(operation_id), "kind": kind, "status": status,
        "project_id": str(PROJECT), "session_id": None if kind == "generation" else str(SESSION),
        "created_at": stamp, "updated_at": stamp, "error_code": code, "result": None,
    }
    before = deepcopy(gateway.operation)
    routes = (
        f"/api/v2/operations/{operation_id}",
        f"/api/v2/operations/by-key/{kind}/{gateway.operation_key}",
    )

    def forbidden_live_gate():
        raise AssertionError("Operation status reads cannot activate paid AI")

    app.state.real_ai.require = forbidden_live_gate
    with TestClient(app) as client:
        for route in routes:
            response = client.get(route)
            assert response.status_code == 200, response.text
            assert response.json() == {**before, "status": expected_status}
        gateway.user = AuthenticatedUser(OTHER, SecretStr("synthetic-other-user-token"))
        gateway.owned = False
        for route in routes:
            forbidden = client.get(route)
            assert forbidden.status_code == 404
            assert str(operation_id) not in forbidden.text and "DRAFT_VERIFICATION_FAILED" not in forbidden.text

    assert gateway.operation == before
    assert gateway.local_rows == {} and gateway.context_reads == []
    assert provider.calls == gateway.claim_count == gateway.failures == 0


def test_operation_get_refreshes_generation_staleness_without_provider_or_data_mutation(harness):
    app, _, provider = harness()
    gateway = ReconciliationGateway()
    install_gateway(app, gateway)
    operation_id, draft_id, memory_id = uuid4(), uuid4(), uuid4()
    source = confirmed_source(memory_id)
    saved_draft = saved_generation(draft_id, source, "I grew up in Bristol.")
    gateway.local_rows[("real_story_drafts", draft_id)] = deepcopy(saved_draft)
    gateway.operation = {
        "operation_id": str(operation_id), "kind": "generation", "status": "completed",
        "project_id": str(PROJECT), "session_id": None, "created_at": NOW, "updated_at": NOW,
        "error_code": None, "result": deepcopy(saved_draft),
    }
    gateway.current_context = {
        "source_memories": [{**source, "memory_version": 2, "corrected_value": "Bath", "sentence": "Bath"}],
        "blocking_clarifications": [],
    }

    def forbidden_live_gate():
        raise AssertionError("An owned operation read must not require paid AI activation")

    app.state.real_ai.require = forbidden_live_gate
    with TestClient(app) as client:
        response = client.get(f"/api/v2/operations/{operation_id}")
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert result["verification"]["status"] == "stale_sources"
    assert result["verification"]["sources_current"] is False
    assert result["source_memories"] == [source]
    assert result["content"] == saved_draft["content"]
    assert gateway.local_rows[("real_story_drafts", draft_id)] == saved_draft
    assert gateway.operation["result"]["verification"]["status"] == "needs_review"
    assert gateway.context_reads == [PROJECT] and provider.calls == gateway.claim_count == 0
    assert gateway.rpc_calls == [("get_real_ai_operation", {"p_operation_id": str(operation_id)})]


def test_reply_reservation_denial_after_extraction_dispatch_remains_uncertain(harness):
    app, gateway, _ = harness()
    reservations, http_requests = [], []

    class Governor:
        def reserve(self, operation, model):
            reservations.append((operation, model))
            if len(reservations) == 2:
                raise APIError(429, "AI_RATE_LIMIT", "The approved AI request rate was reached.")
            return "synthetic-approved-reservation"

    def transport(request):
        http_requests.append(request)
        assert request.url == "https://api.openai.com/v1/responses"
        body = json.loads(request.content)
        assert body["text"]["format"]["name"] == "memory_extraction"
        return httpx.Response(200, json={
            "status": "completed", "error": None, "output": [{
                "type": "message", "role": "assistant", "status": "completed", "content": [{
                    "type": "output_text", "text": json.dumps({"language": "en", "facts": []}),
                }],
            }],
        })

    provider = RealAIProvider(
        OpenAIClient(SecretStr("synthetic-provider-key"), "gpt-test", Governor(), transport=httpx.MockTransport(transport)),
        transcription_model="gpt-transcribe",
    )
    app.state.real_ai.require = lambda: provider
    key = uuid4()
    with TestClient(app) as client:
        options = {"json": {"source_transcript_id": str(TRANSCRIPT), "language": "en"},
                   "headers": {"Idempotency-Key": str(key)}}
        first = client.post(f"/api/v2/story-sessions/{SESSION}/messages", **options)
        replay = client.post(f"/api/v2/story-sessions/{SESSION}/messages", **options)
    assert first.status_code == 429 and first.json()["error"]["code"] == "AI_RATE_LIMIT"
    assert replay.status_code == 409 and replay.json()["error"]["code"] == "AI_OPERATION_UNCERTAIN"
    assert first.headers["x-memy-operation-id"] == replay.headers["x-memy-operation-id"]
    assert gateway.claims[("conversation", key)]["status"] == "uncertain"
    assert gateway.failures == 1
    assert reservations == [("memory_extraction", "gpt-test"), ("conversation", "gpt-test")]
    assert len(http_requests) == 1
    assert "synthetic-provider-key" not in first.text
