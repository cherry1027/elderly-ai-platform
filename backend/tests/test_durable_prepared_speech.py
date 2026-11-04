"""Prepared reply recovery across process-cache restart, with paid AI closed."""

import base64
from datetime import datetime
import os

from fastapi.testclient import TestClient
import pytest

from app.services.encrypted_speech_cache import EncryptedSpeechCache
from tests.test_prepared_speech import prepared_fixture
from tests.test_real_ai_api import OWNER, harness  # noqa: F401


@pytest.mark.parametrize("language", ["en", "sv"])
def test_owned_prepared_audio_replays_after_runtime_shutdown_without_paid_activation(harness, tmp_path, language):
    app, gateway, provider, assistant, speech, saved, data = prepared_fixture(harness, language=language, cache=False)
    private = tmp_path / "private"
    private.mkdir(mode=0o700)
    path, key = private / "speech.sqlite3", base64.urlsafe_b64encode(os.urandom(32)).decode()
    app.state.real_ai.cache = EncryptedSpeechCache(path, key)
    app.state.real_ai.cache.put(OWNER, speech, data, saved["audio_sha256"],
                               expires_at=datetime.fromisoformat(saved["expires_at"]).timestamp())
    with TestClient(app) as client:
        assert client.get(f"/api/v2/conversation-messages/{assistant}/speech").status_code == 200
    # Lifespan close must preserve unexpired encrypted audio. A new object stands
    # in for a new process and must use the same private volume and secret key.
    app.state.real_ai.cache = EncryptedSpeechCache(path, key)
    with TestClient(app) as client:
        metadata = client.get(f"/api/v2/conversation-messages/{assistant}/speech")
        audio = client.get(f"/api/v2/spoken-replies/{speech}/audio")
    assert metadata.status_code == audio.status_code == 200
    assert metadata.json()["speech_id"] == str(speech)
    assert audio.content == data
    assert audio.headers["cache-control"] == "private, no-store"
    assert provider.calls == gateway.claim_count == 0
