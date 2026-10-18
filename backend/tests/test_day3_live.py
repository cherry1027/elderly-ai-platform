"""Opt-in hosted Auth/RLS/API acceptance with a FREE, explicit test double.

This verifies storage and isolation, NOT speech recognition. It creates only
synthetic projects and deletes only their IDs. No provider API is contacted.
"""

import io
import os
import wave
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def wav_fixture(seconds=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\0\0" * int(seconds * 8000))
    return output.getvalue()


class FictionalProvider:
    enabled = True
    calls = 0
    fail = False

    async def transcribe(self, path, language):
        assert path.exists()
        self.calls += 1
        if self.fail:
            raise RuntimeError("Synthetic provider failure; no external provider was called.")
        return {
            "sv": "Fiktivt test: Jag föddes i Malmö 1974.",
            "en": "Fictional test: I moved to London in 1985.",
        }[language]


@pytest.mark.integration
@pytest.mark.skipif(
    os.getenv("RUN_MEMY_DAY3_INTEGRATION") != "1",
    reason="requires dedicated development project, two existing user tokens and explicit opt-in",
)
@pytest.mark.parametrize("language", ["sv", "en"])
def test_live_audio_persistence_and_two_user_isolation(language):
    settings = Settings()
    base_url = str(settings.supabase_url).rstrip("/")
    if base_url != "https://edbkuunyeyxnyenmmqud.supabase.co":
        pytest.fail("Live writes are allowed only against the dedicated development project.")
    tokens = [os.getenv("MEMY_TEST_USER_A_TOKEN"), os.getenv("MEMY_TEST_USER_B_TOKEN")]
    if not all(tokens):
        pytest.fail("Supply two development user tokens locally, never in chat.")
    public_key = settings.supabase_publishable_key.get_secret_value()
    headers_a, headers_b = [{"Authorization": f"Bearer {token}"} for token in tokens]
    provider = FictionalProvider()
    created = []
    with httpx.Client(timeout=10, follow_redirects=False) as upstream:
        ids = []
        for headers in (headers_a, headers_b):
            result = upstream.get(f"{base_url}/auth/v1/user", headers={**headers, "apikey": public_key})
            assert result.status_code == 200, "Both test-user tokens must be valid."
            ids.append(result.json().get("id"))
        assert all(ids) and ids[0] != ids[1], "Two different development users are required."
        try:
            with TestClient(create_app(settings, transcription_provider=provider)) as client:
                for headers in (headers_a, headers_b):
                    result = client.post("/api/v1/story-projects", headers=headers, json={
                        "title": f"Synthetic Day 3 test {uuid4()}", "language": language,
                    })
                    assert result.status_code == 201
                    created.append((result.json()["id"], headers))
                project_id = created[0][0]
                result = client.post(f"/api/v1/story-projects/{project_id}/sessions", headers=headers_a)
                assert result.status_code == 201
                session_id = result.json()["id"]
                path = f"/api/v1/story-sessions/{session_id}"
                content = wav_fixture()
                request_key = str(uuid4())

                def upload(headers=headers_a, *, key=request_key, audio=content):
                    return client.post(f"{path}/transcribe", headers={**headers, "Idempotency-Key": key},
                        files={"file": ("fictional.wav", audio, "audio/wav")},
                        data={"language": language, "consent": "true"})

                assert upload(headers_b).status_code == 404
                assert client.get(f"{path}/transcripts", headers=headers_b).status_code == 404
                assert client.get(f"{path}/transcripts").status_code == 401
                result = upload()
                assert result.status_code == 200
                original = result.json()
                assert original["session_id"] == session_id
                assert original["language"] == language
                assert original["text"].startswith("Fiktivt" if language == "sv" else "Fictional")
                assert upload().json() == original
                assert provider.calls == 1
                assert upload(audio=wav_fixture(0.5)).status_code == 409
                assert provider.calls == 1
                assert client.get(f"{path}/transcripts", headers=headers_a).json() == [original]

                retry_key = str(uuid4())
                provider.fail = True
                assert upload(key=retry_key).status_code == 503
                assert client.get(f"{path}/transcripts", headers=headers_a).json() == [original]
                provider.fail = False
                retry = upload(key=retry_key)
                assert retry.status_code == 200
                assert retry.json()["transcript_id"] != original["transcript_id"]
                originals = client.get(f"{path}/transcripts", headers=headers_a).json()
                assert len(originals) == 2 and original in originals
                assert client.get(f"{path}/transcripts", headers=headers_b).status_code == 404
        finally:
            cleanup_failed = False
            for project_id, headers in created:
                try:
                    result = upstream.delete(f"{base_url}/rest/v1/story_projects",
                        params={"id": f"eq.{project_id}"}, headers={**headers, "apikey": public_key})
                    cleanup_failed |= result.status_code not in (200, 204)
                except httpx.HTTPError:
                    cleanup_failed = True
            if cleanup_failed:
                pytest.fail("Synthetic project cleanup failed; check the development dashboard.")
