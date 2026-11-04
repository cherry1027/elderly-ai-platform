"""Text-only policy and real governor exercised with synthetic HTTP responses only."""

from datetime import datetime, timedelta, timezone
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
from pydantic import SecretStr
import pytest

from app.core.config import Settings
from app.services.openai_client import OpenAIClient
from app.services.real_ai_provider import RealAIProvider
from app.services.real_ai_runtime import RealAIRuntime
from tests.test_real_ai_api import harness, PROJECT, SESSION, TRANSCRIPT, NOW, PROV
from tests.test_real_text_chat import text_harness, send


def install(app, tmp_path, provider, **changes):
    private = (tmp_path / "synthetic-text-only").resolve()
    private.mkdir(mode=0o700)
    approval = private / "approval.json"
    approval.write_text(json.dumps({
        "approval_id": "synthetic-text-only-window", "approved_by": "offline test",
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "max_calls": 2, "max_calls_per_minute": 2, "budget_microusd": 2000,
        "reserve_per_call_microusd": 1000,
        "allowed_models": ["gpt-test", "gpt-transcribe", "gpt-realtime-2.1-mini"],
    }))
    approval.chmod(0o600)
    settings = Settings(_env_file=None, **{
        "supabase_url": "https://synthetic.supabase.co", "supabase_publishable_key": "synthetic-public",
        "supabase_secret_key": "synthetic-server-only", "openai_api_key": "synthetic-never-used",
        "real_ai_enabled": True, "real_ai_text_only": True,
        "openai_text_model": "gpt-test", "openai_verifier_model": "gpt-test",
        "real_ai_transcription_model": "gpt-transcribe", "real_ai_speech_model": "gpt-realtime-2.1-mini",
        "live_ai_approval_path": approval, "ai_usage_ledger_path": private / "usage.sqlite3", **changes,
    })
    app.state.settings = settings
    app.state.real_ai = RealAIRuntime(settings, provider=provider)
    return app.state.real_ai


def test_text_only_capabilities_are_truthful_without_touching_the_ledger(tmp_path, text_harness):
    app, _, provider = text_harness()
    runtime = install(app, tmp_path, provider)
    with TestClient(app) as client:
        response = client.get("/api/v2/capabilities")
    assert response.json() == {"contract": "real-v2", "mode": "real", "enabled": True,
        "transcription": False, "conversation": True, "writing": False, "speech": False, "reason": "READY"}
    assert not runtime.settings.ai_usage_ledger_path.exists() and provider.calls == 0


def test_text_only_without_global_enable_remains_closed(tmp_path, text_harness):
    app, gateway, provider = text_harness()
    runtime = install(app, tmp_path, provider, real_ai_enabled=False)
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503 and response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert not any(runtime.capabilities()[name] for name in ("enabled", "transcription", "conversation", "writing", "speech"))
    assert gateway.claim_count == provider.calls == 0 and not runtime.settings.ai_usage_ledger_path.exists()


@pytest.mark.parametrize("action", ["transcription", "voice-conversation", "generation", "speech"])
def test_direct_nontext_requests_never_parse_audio_claim_reserve_or_dispatch(action, tmp_path, text_harness, monkeypatch):
    app, gateway, provider = text_harness()
    runtime = install(app, tmp_path, provider)
    assistant_id = uuid4()
    async def assistant(*args):
        return {"id": str(assistant_id), "project_id": str(PROJECT), "session_id": str(SESSION),
            "role": "assistant", "language": "en", "text": "A synthetic reply.", "sequence": 2,
            "source_transcript_id": str(TRANSCRIPT), "created_at": NOW, "provenance": PROV}
    if action == "speech":
        gateway.one = assistant
    async def no_audio(*args):
        pytest.fail("Paused audio must not be parsed")
    async def no_context(*args):
        pytest.fail("Paused writing must not obtain a generation snapshot")
    monkeypatch.setattr("app.api.real_ai.read_recording", no_audio)
    gateway.context = no_context
    paths = {
        "transcription": (f"/api/v2/story-sessions/{SESSION}/transcribe", {"content": b"not multipart"}),
        "voice-conversation": (f"/api/v2/story-sessions/{SESSION}/messages", {"json": {"source_transcript_id": str(TRANSCRIPT), "language": "en"}}),
        "generation": (f"/api/v2/story-projects/{PROJECT}/generate", {"json": {"language": "en", "style": "warm", "confirm_generation": True}}),
        "speech": (f"/api/v2/conversation-messages/{assistant_id}/speech", {"json": {"language": "en"}}),
    }
    path, body = paths[action]
    with TestClient(app) as client:
        response = client.post(path, **body, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 503 and response.json()["error"]["code"] == "LIVE_AI_DISABLED"
    assert "x-memy-operation-id" not in response.headers
    assert gateway.claim_count == provider.calls == 0 and not runtime.settings.ai_usage_ledger_path.exists()


def test_text_only_never_constructs_the_speech_provider(tmp_path, text_harness, monkeypatch):
    app, _, _ = text_harness()
    runtime = install(app, tmp_path, object())
    monkeypatch.setattr("app.services.real_ai_runtime.RealtimeSpeechProvider", lambda *a, **k: pytest.fail("No speech adapter"))
    actual = RealAIRuntime(runtime.settings)
    assert actual.provider is not None and actual.provider._speech is None
    assert not runtime.settings.ai_usage_ledger_path.exists()


def test_typed_turn_reserves_two_attempts_in_one_existing_ledger_and_replay_costs_zero(tmp_path, text_harness):
    app, gateway, _ = text_harness()
    runtime = install(app, tmp_path, object())
    seen = []
    def transport(request):
        body = json.loads(request.content)
        operation = body["text"]["format"]["name"]
        seen.append(operation)
        value = {"language": "en", "facts": []} if operation == "memory_extraction" else {"language": "en", "text": "Who was with you?"}
        return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "role": "assistant",
            "status": "completed", "content": [{"type": "output_text", "text": json.dumps(value)}]}]})
    adapter = OpenAIClient(SecretStr("synthetic-never-used"), "gpt-test", runtime.governor,
        transport=httpx.MockTransport(transport))
    runtime.provider = RealAIProvider(adapter, transcription_model="gpt-transcribe")
    ledger = runtime.settings.ai_usage_ledger_path
    key = uuid4()
    with TestClient(app) as client:
        first = send(client, "  I remember my garden.\n", key=key)
        replay = send(client, "  I remember my garden.\n", key=key)
        over_limit = send(client, "A different explicit turn.")
        history = client.get(f"/api/v2/story-sessions/{SESSION}/messages")
    assert first.status_code == replay.status_code == history.status_code == 200
    assert first.json() == replay.json() and first.json()["user_message"]["text"] == "  I remember my garden.\n"
    assert over_limit.status_code == 429 and over_limit.json()["error"]["code"] == "AI_USAGE_LIMIT"
    assert seen == ["memory_extraction", "conversation"]
    with sqlite3.connect(ledger) as database:
        rows = database.execute("SELECT approval_id, operation, ceiling_microusd FROM reservations ORDER BY rowid").fetchall()
        counters = database.execute("SELECT reserved_calls,reserved_microusd FROM approvals").fetchall()
    assert rows == [("synthetic-text-only-window", "memory_extraction", 1000), ("synthetic-text-only-window", "conversation", 1000)]
    assert counters == [(2, 2000)] and len(gateway.original_inputs) == 1
