"""Free, owned recovery of prepared speech; no hosted or provider requests."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest

from app.core.errors import APIError
from app.services.real_ai_provider import SpeechAudio
from tests.test_real_ai_api import OWNER, PROJECT, SESSION, harness
from tests.test_real_ai_reconciliation import (
    ReconciliationGateway, install_gateway, seed_completed_speech, wav_bytes,
)


class RecoveryGateway(ReconciliationGateway):
    def __init__(self, language="en"):
        super().__init__(language)
        self.speech_rows = []
        self.list_reads = []

    async def one(self, table, field, resource_id):
        if not self.owned:
            raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        return await super().one(table, field, resource_id)

    async def rows(self, table, *, filters, limit, order):
        self.list_reads.append((table, deepcopy(filters), limit, order))
        return deepcopy(self.speech_rows)


def prepared_fixture(harness, *, language="en", expiry=None, cache=True):
    app, _, provider = harness(language, enabled=False)
    gateway = RecoveryGateway(language)
    install_gateway(app, gateway)
    data = wav_bytes()
    assistant, speech, saved = seed_completed_speech(
        gateway, expires_at=(expiry or datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat(),
        data=data, key=uuid4(),
    )
    gateway.speech_rows = [saved]
    if cache:
        app.state.real_ai.cache.put(OWNER, speech, data, saved["audio_sha256"])

    def no_paid_activation():
        raise AssertionError("Prepared speech recovery must not inspect the paid gate")

    app.state.real_ai.require = no_paid_activation
    return app, gateway, provider, assistant, speech, saved, data


@pytest.mark.parametrize("language", ["en", "sv"])
def test_prepared_speech_get_recovers_latest_owned_metadata_with_paid_gate_closed(harness, language):
    app, gateway, provider, assistant, speech, saved, data = prepared_fixture(harness, language=language)
    with TestClient(app) as client:
        first = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
        second = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
        audio = client.get(f"/api/v2/spoken-replies/{speech}/audio")
    assert first.status_code == second.status_code == audio.status_code == 200
    assert first.json() == second.json()
    assert first.json()["speech_id"] == str(speech)
    assert first.json()["assistant_message_id"] == str(assistant)
    assert first.json()["language"] == language
    assert audio.content == data
    assert "no-store" in first.headers["cache-control"]
    assert gateway.list_reads == [("real_speech", {
        "assistant_message_id": f"eq.{assistant}", "project_id": f"eq.{PROJECT}",
        "session_id": f"eq.{SESSION}",
    }, 1, "created_at.desc,speech_id.desc")] * 2
    assert gateway.reads == [
        ("real_conversation_messages", "id", assistant),
        ("real_conversation_messages", "id", assistant),
        ("real_speech", "speech_id", speech),
        ("real_conversation_messages", "id", assistant),
    ]
    assert provider.calls == gateway.claim_count == gateway.failures == 0
    assert gateway.rpc_calls == []


def test_prepared_speech_cross_user_denial_happens_before_list_or_cache_read(harness):
    app, gateway, provider, assistant, *_ = prepared_fixture(harness)
    gateway.owned = False

    def forbidden_cache_read(*args):
        raise AssertionError("Cross-user speech must never reach the cache")

    app.state.real_ai.cache.get = forbidden_cache_read
    with TestClient(app) as client:
        response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
    assert response.status_code == 404
    assert gateway.list_reads == []
    assert provider.calls == gateway.claim_count == 0


def test_prepared_speech_rejects_user_messages_before_listing(harness):
    app, gateway, provider, assistant, *_ = prepared_fixture(harness)
    gateway.local_rows[("real_conversation_messages", assistant)]["role"] = "user"
    with TestClient(app) as client:
        response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ASSISTANT_MESSAGE_REQUIRED"
    assert gateway.list_reads == []
    assert provider.calls == gateway.claim_count == 0


def test_prepared_speech_missing_metadata_is_404_without_paid_work(harness):
    app, gateway, provider, assistant, *_ = prepared_fixture(harness)
    gateway.speech_rows = []
    with TestClient(app) as client:
        response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
    assert response.status_code == 404
    assert provider.calls == gateway.claim_count == 0


@pytest.mark.parametrize("condition", ["expired", "evicted"])
def test_prepared_speech_expired_or_evicted_is_410_without_resynthesis(harness, condition):
    app, gateway, provider, assistant, *_ = prepared_fixture(
        harness, expiry=datetime.now(timezone.utc) - timedelta(seconds=1) if condition == "expired" else None,
        cache=condition != "evicted",
    )
    with TestClient(app) as client:
        for _ in range(2):
            response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
            assert response.status_code == 410
            assert response.json()["error"]["code"] == "SPEECH_EXPIRED"
    assert provider.calls == gateway.claim_count == 0
    assert gateway.rpc_calls == []


@pytest.mark.parametrize("field", ["assistant_message_id", "project_id", "session_id"])
def test_prepared_speech_rejects_a_mismatched_result_scope_before_cache(harness, field):
    app, gateway, provider, assistant, *_ = prepared_fixture(harness)
    gateway.speech_rows[0][field] = str(uuid4())

    def forbidden_cache_read(*args):
        raise AssertionError("Invalid scope must never reach the cache")

    app.state.real_ai.cache.get = forbidden_cache_read
    with TestClient(app) as client:
        response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
    assert response.status_code == 503
    assert provider.calls == gateway.claim_count == 0


def test_prepared_speech_rejects_normalized_language_mismatch(harness):
    app, gateway, provider, assistant, *_ = prepared_fixture(harness)
    normalize = gateway.normalize_result

    async def wrong_language(kind, row, *, speech_assistant=None):
        return {**await normalize(kind, row, speech_assistant=speech_assistant), "language": "sv"}

    gateway.normalize_result = wrong_language
    with TestClient(app) as client:
        response = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
    assert response.status_code == 503
    assert provider.calls == gateway.claim_count == 0


_PREVIEW = "https://memy-visual-redesign-preview.onrender.com"
_LIVE = "https://memy-pilot.onrender.com"


@pytest.mark.parametrize("language,origin,enabled,expected_voice", [
    ("sv", _PREVIEW, True, "cedar"),
    ("en", _PREVIEW, True, "marin"),
    ("sv", _LIVE, True, "marin"),
    ("sv", _PREVIEW + ".example", True, "marin"),
    ("sv", None, True, "marin"),
    ("sv", _PREVIEW, False, "marin"),
])
def test_cedar_selection_uses_only_preview_and_owned_swedish_reply(harness, language, origin, enabled, expected_voice):
    app, _, provider = harness(language)
    app.state.settings.real_ai_swedish_preview_cedar = enabled
    gateway = RecoveryGateway(language)
    install_gateway(app, gateway)
    data = wav_bytes()
    assistant, _, _ = seed_completed_speech(gateway, data=data, key=uuid4(),
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat())
    calls = []

    async def synthesize(text, spoken_language, *, voice="marin"):
        calls.append((spoken_language, voice))
        return SpeechAudio(data, "audio/wav", sha256(data).hexdigest(), .01, "fixture", voice)

    provider.synthesize = synthesize
    headers = {"Idempotency-Key": str(uuid4())}
    if origin is not None:
        headers["Origin"] = origin
    with TestClient(app) as client:
        response = client.post(f"/api/v2/conversation-messages/{assistant}/speech",
                               json={"language": language}, headers=headers)
    assert response.status_code == 200, response.text
    assert calls == [(language, expected_voice)]


def test_preview_speech_replay_partitions_preserve_live_and_do_not_repeat_a_charge(harness):
    app, _, provider = harness("sv")
    app.state.settings.real_ai_swedish_preview_cedar = True
    gateway = RecoveryGateway("sv")
    install_gateway(app, gateway)
    data = wav_bytes()
    assistant, live_id, saved_live = seed_completed_speech(gateway, data=data, key=uuid4(),
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat())
    app.state.real_ai.cache.put(OWNER, live_id, data, saved_live["audio_sha256"])
    gateway.speech_rows = [saved_live]
    calls = []

    async def synthesize(text, language, *, voice):
        calls.append(voice)
        return SpeechAudio(data, "audio/wav", sha256(data).hexdigest(), .01, "fixture", voice)

    provider.synthesize = synthesize
    preview_headers, live_headers = {"Origin": _PREVIEW}, {"Origin": _LIVE}
    key = str(uuid4())
    endpoint = f"/api/v2/conversation-messages/{assistant}/speech"
    with TestClient(app) as client:
        assert client.get(endpoint, headers=preview_headers).status_code == 410
        first = client.post(endpoint, json={"language": "sv"}, headers={**preview_headers, "Idempotency-Key": key})
        assert first.status_code == 200, first.text
        preview_id = first.json()["speech_id"]
        gateway.speech_rows.insert(0, gateway.local_rows[("real_speech", UUID(preview_id))])

        repeat = client.post(endpoint, json={"language": "sv"}, headers={**preview_headers, "Idempotency-Key": key})
        assert repeat.status_code == 200 and repeat.json() == first.json()
        assert client.post(endpoint, json={"language": "sv"}, headers={**live_headers, "Idempotency-Key": key}).status_code == 410
        assert client.get(endpoint, headers=preview_headers).json()["speech_id"] == preview_id
        assert client.get(endpoint, headers=live_headers).json()["speech_id"] == str(live_id)
        assert client.get(f"/api/v2/spoken-replies/{preview_id}/audio", headers=preview_headers).content == data
        assert client.get(f"/api/v2/spoken-replies/{preview_id}/audio", headers=live_headers).status_code == 410
        assert client.get(f"/api/v2/spoken-replies/{live_id}/audio", headers=live_headers).content == data
        assert client.get(f"/api/v2/spoken-replies/{live_id}/audio", headers=preview_headers).status_code == 410
    assert calls == ["cedar"]
