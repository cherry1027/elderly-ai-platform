"""Typed replies use the same explicit speech and free recovery paths, offline."""

from datetime import datetime, timezone
from hashlib import sha256
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
from pydantic import SecretStr

from app.api.dependencies import get_current_user
from app.main import create_app
from app.services.auth import AuthenticatedUser
from app.services.openai_client import mark_ai_dispatched
from app.services.real_ai_provider import SpeechAudio
from app.services.real_ai_runtime import SpeechCache
from tests.test_real_ai_resources import (
    OWNER, PROJECT, SESSION, STAMP, PROVENANCE, USER_TOKEN, SERVER_SECRET, settings,
    project_row, session_row, assert_user_headers,
)
from tests.test_real_ai_reconciliation import wav_bytes
from tests.test_real_text_chat_resources import typed_rows, source, TEXT_OPERATION


def test_typed_assistant_can_be_spoken_explicitly_then_recovered_without_more_ai():
    assistant = typed_rows()[1]
    operation, nonce, speech_id = (str(uuid4()) for _ in range(3))
    saved = []
    provider_calls = []
    requests = []
    data = wav_bytes()

    def handler(request):
        requests.append(request.url.path)
        if request.url.path.endswith("/rpc/claim_real_ai_operation"):
            assert request.headers["apikey"] == SERVER_SECRET and "authorization" not in request.headers
            return httpx.Response(200, json={"operation_id": operation, "kind": "speech", "status": "in_progress",
                                            "claimed": True, "claim_token": nonce, "result": None, "error_code": None})
        if request.url.path.endswith("/rpc/complete_real_ai_operation"):
            assert request.headers["apikey"] == SERVER_SECRET
            payload = json.loads(request.content)
            assert payload["p_operation_id"] == operation and payload["p_claim_token"] == nonce
            metadata = {**payload["p_result"], "speech_id": speech_id, "owner_id": str(OWNER),
                        "project_id": str(PROJECT), "session_id": str(SESSION), "operation_id": operation,
                        "provenance": PROVENANCE, "created_at": STAMP}
            saved.append(metadata)
            return httpx.Response(200, json={key: value for key, value in metadata.items() if key not in {"owner_id", "operation_id"}})
        assert_user_headers(request)
        if request.url.path.endswith("/real_conversation_messages"):
            assert request.url.params["id"] == "eq." + assistant["id"]
            return httpx.Response(200, json=[assistant])
        if request.url.path.endswith("/story_projects"):
            return httpx.Response(200, json=[project_row()])
        if request.url.path.endswith("/conversation_sessions"):
            return httpx.Response(200, json=[session_row()])
        if request.url.path.endswith("/rpc/get_real_text_chat_sources"):
            assert json.loads(request.content) == {"p_session_id": str(SESSION), "p_operation_ids": [TEXT_OPERATION]}
            return httpx.Response(200, json={"sources": [source()]})
        assert request.url.path.endswith("/real_speech")
        return httpx.Response(200, json=saved)

    async def synthesize(text, language):
        provider_calls.append((text, language))
        mark_ai_dispatched()
        return SpeechAudio(data, "audio/wav", sha256(data).hexdigest(), .01, "synthetic-speech-model", "marin")

    app = create_app(settings(), transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(OWNER, SecretStr(USER_TOKEN))
    app.state.real_ai = SimpleNamespace(require=lambda: SimpleNamespace(synthesize=synthesize), cache=SpeechCache())
    with TestClient(app) as client:
        first = client.post(f"/api/v2/conversation-messages/{assistant['id']}/speech",
                            json={"language": "en"}, headers={"Idempotency-Key": str(uuid4())})
        assert first.status_code == 200, first.text
        def no_paid_recovery():
            raise AssertionError("Prepared speech recovery must not open the AI gate")
        app.state.real_ai.require = no_paid_recovery
        recovered = client.get(f"/api/v2/conversation-messages/{assistant['id']}/speech")
        audio = client.get(f"/api/v2/spoken-replies/{speech_id}/audio")
    assert recovered.status_code == audio.status_code == 200
    assert recovered.json() == first.json() and audio.content == data
    assert provider_calls == [(assistant["text"], "en")]
    assert requests.count("/rest/v1/rpc/claim_real_ai_operation") == 1
    assert requests.count("/rest/v1/rpc/complete_real_ai_operation") == 1
