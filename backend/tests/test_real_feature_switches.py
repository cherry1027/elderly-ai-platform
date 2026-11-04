"""Feature-specific controls remain authoritative even for direct API calls."""

from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.services.real_ai_runtime import RealAIRuntime
from tests.test_real_ai_runtime import configured
from tests.test_real_text_chat import text_harness, send
from tests.test_real_text_only import install
from tests.test_real_ai_api import PROJECT, harness


def test_chat_and_writing_can_stay_available_with_both_audio_features_paused(tmp_path, monkeypatch):
    settings = configured(tmp_path, real_ai_speech_enabled=False, real_ai_transcription_enabled=False,
        real_ai_transcription_model="gpt-transcribe", real_ai_speech_model="gpt-realtime-2.1-mini")
    # The configured() helper allowlists only gpt-test, use a fake provider and
    # isolate feature behavior from approval-model validation.
    runtime = RealAIRuntime(settings, provider=object())
    monkeypatch.setattr(runtime, "require", lambda: runtime.provider)
    monkeypatch.setattr(runtime.governor, "check_budget", lambda **kwargs: None)
    capabilities = runtime.capabilities()
    assert capabilities["conversation"] and capabilities["writing"]
    assert not capabilities["speech"] and not capabilities["transcription"]


@pytest.mark.parametrize("text_only", [False, True])
def test_capabilities_do_not_offer_a_two_stage_reply_with_only_one_attempt_left(tmp_path, text_only):
    settings = configured(tmp_path, real_ai_text_only=text_only)
    runtime = RealAIRuntime(settings, provider=object())
    runtime.governor.reserve("conversation", "gpt-test")
    capabilities = runtime.capabilities()
    assert not capabilities["conversation"] and not capabilities["writing"]
    assert capabilities["enabled"] is (not text_only)
    assert capabilities["reason"] == ("AI_USAGE_LIMIT" if text_only else "READY")


def test_direct_disabled_chat_fails_without_claim_or_provider_dispatch(tmp_path, text_harness):
    app, gateway, provider = text_harness()
    install(app, tmp_path, provider, real_ai_text_only=False, real_ai_conversation_enabled=False)
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert gateway.claim_count == provider.calls == 0


def test_direct_disabled_writing_fails_before_context_read_or_provider_dispatch(tmp_path, text_harness):
    app, gateway, provider = text_harness()
    install(app, tmp_path, provider, real_ai_text_only=False, real_ai_writing_enabled=False)
    async def forbidden(*args):
        pytest.fail("Disabled story generation must not read generation inputs")
    gateway.context = forbidden
    with TestClient(app) as client:
        response = client.post(f"/api/v2/story-projects/{PROJECT}/generate",
            json={"language": "en", "style": "warm", "confirm_generation": True},
            headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 503 and response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert gateway.claim_count == provider.calls == 0
