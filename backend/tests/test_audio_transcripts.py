"""Offline persistence and replay tests for Day 3 audio transcripts.

These tests intentionally use an injected provider and an httpx MockTransport.
They never contact Supabase or a speech-to-text service.
"""

from __future__ import annotations

import hashlib
import io
import json
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import av
import httpx
import pytest
from fastapi.testclient import TestClient

import app.api.audio as audio_api
from app.core.config import Settings
from app.main import create_app


SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"
USER_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
IDEMPOTENCY_KEY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
REQUEST_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CLAIM_TOKEN = "ffffffff-ffff-4fff-8fff-ffffffffffff"
TRANSCRIPT_ID = "22222222-2222-4222-8222-222222222222"
CREATED_AT = "2026-10-18T08:06:00Z"


def configured_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )


def make_wav(seconds: float = 0.05) -> bytes:
    output = io.BytesIO()
    rate = 8_000
    samples = max(1, round(seconds * rate))
    with av.open(output, mode="w", format="wav") as container:
        stream = container.add_stream("pcm_s16le", rate=rate)
        stream.layout = "mono"
        frame = av.AudioFrame(format="s16", layout="mono", samples=samples)
        frame.sample_rate = rate
        frame.pts = 0
        frame.time_base = Fraction(1, rate)
        for plane in frame.planes:
            plane.update(bytes(plane.buffer_size))
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return output.getvalue()


@pytest.fixture(scope="module")
def wav_bytes() -> bytes:
    return make_wav()


def project_row(language: str = "sv") -> dict[str, Any]:
    return {
        "id": PROJECT_ID,
        "user_id": USER_ID,
        "title": "Minnen",
        "description": None,
        "language": language,
        "status": "draft",
        "created_at": "2026-10-18T08:00:00Z",
        "updated_at": "2026-10-18T08:00:00Z",
    }


def session_row(language: str = "sv") -> dict[str, Any]:
    return {
        "id": SESSION_ID,
        "project_id": PROJECT_ID,
        "language": language,
        "status": "active",
        "created_at": "2026-10-18T08:05:00Z",
        "updated_at": "2026-10-18T08:05:00Z",
        "ended_at": None,
    }


def transcript_row(text: str, language: str = "sv") -> dict[str, Any]:
    return {
        "transcript_id": TRANSCRIPT_ID,
        "session_id": SESSION_ID,
        "language": language,
        "text": text,
        "status": "completed",
        "created_at": CREATED_AT,
    }


def claimed_row(language: str = "sv") -> dict[str, Any]:
    return {
        "outcome": "claimed",
        "request_id": REQUEST_ID,
        "claim_token": CLAIM_TOKEN,
        "status": "processing",
        "transcript_id": None,
        "session_id": SESSION_ID,
        "language": language,
        "text": None,
        "created_at": None,
        "attempt_count": 1,
    }


def in_progress_row(language: str = "sv") -> dict[str, Any]:
    row = claimed_row(language)
    row.update(outcome="in_progress", claim_token=None)
    return row


def completed_claim(text: str, language: str = "sv") -> dict[str, Any]:
    return {
        "outcome": "completed",
        "request_id": REQUEST_ID,
        "claim_token": None,
        "status": "completed",
        "transcript_id": TRANSCRIPT_ID,
        "session_id": SESSION_ID,
        "language": language,
        "text": text,
        "created_at": CREATED_AT,
        "attempt_count": 1,
    }


class FakeProvider:
    enabled = True

    def __init__(self, result: object = "Ett bevarat minne", error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[tuple[bool, str]] = []

    async def transcribe(self, path: Path, language: str) -> str:
        self.calls.append((path.is_file(), language))
        if self.error is not None:
            raise self.error
        return self.result  # type: ignore[return-value]


class NeverProvider(FakeProvider):
    async def transcribe(self, path: Path, language: str) -> str:
        pytest.fail("provider must not be called")


class Scenario:
    """Small deterministic Supabase/Auth double with request capture."""

    def __init__(self, *, language: str = "sv", text: str = "Ett bevarat minne"):
        self.language = language
        self.text = text
        self.session_rows: object = [session_row(language)]
        self.project_rows: object = [project_row(language)]
        self.claim_response: tuple[int, object] = (200, [claimed_row(language)])
        self.complete_response: tuple[int, object] = (200, [transcript_row(text, language)])
        self.fail_response: tuple[int, object] = (
            200,
            [{"request_id": REQUEST_ID, "status": "failed", "attempt_count": 1}],
        )
        self.transcript_rows: object = [transcript_row(text, language)]
        self.events: list[str] = []
        self.payloads: dict[str, list[dict[str, Any]]] = {
            "claim": [], "complete": [], "fail": []
        }
        self.transcript_params: list[dict[str, str]] = []

    @staticmethod
    def _reply(spec: tuple[int, object]) -> httpx.Response:
        status, body = spec
        return httpx.Response(status, json=body)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "test-project.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        path = request.url.path
        if path == "/auth/v1/user":
            self.events.append("auth")
            return httpx.Response(200, json={"id": USER_ID, "email": "owner@example.test"})
        if path == "/rest/v1/conversation_sessions":
            self.events.append("session")
            assert request.method == "GET"
            assert request.url.params.get("id") == f"eq.{SESSION_ID}"
            assert request.url.params.get("limit") == "1"
            return httpx.Response(200, json=self.session_rows)
        if path == "/rest/v1/story_projects":
            self.events.append("project")
            assert request.method == "GET"
            assert request.url.params.get("id") == f"eq.{PROJECT_ID}"
            assert request.url.params.get("user_id") == f"eq.{USER_ID}"
            return httpx.Response(200, json=self.project_rows)
        if path == "/rest/v1/rpc/claim_audio_transcription":
            self.events.append("claim")
            self.payloads["claim"].append(json.loads(request.content))
            return self._reply(self.claim_response)
        if path == "/rest/v1/rpc/complete_audio_transcription":
            self.events.append("complete")
            self.payloads["complete"].append(json.loads(request.content))
            return self._reply(self.complete_response)
        if path == "/rest/v1/rpc/fail_audio_transcription":
            self.events.append("fail")
            self.payloads["fail"].append(json.loads(request.content))
            return self._reply(self.fail_response)
        if path == "/rest/v1/audio_transcripts":
            self.events.append("transcripts")
            assert request.method == "GET"
            self.transcript_params.append(dict(request.url.params))
            return httpx.Response(200, json=self.transcript_rows)
        pytest.fail(f"unexpected upstream request: {request.method} {request.url}")


def make_app(scenario: Scenario, provider=None):
    return create_app(
        configured_settings(),
        transport=httpx.MockTransport(scenario),
        transcription_provider=provider,
    )


def headers(*, include_auth: bool = True) -> dict[str, str]:
    result = {"Idempotency-Key": IDEMPOTENCY_KEY}
    if include_auth:
        result["Authorization"] = f"Bearer {ACCESS_TOKEN}"
    return result


def post_recording(client: TestClient, content: bytes, language: str = "sv"):
    return client.post(
        f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
        headers=headers(),
        files=[
            ("file", ("recording.wav", content, "audio/wav")),
            ("language", (None, language)),
            ("consent", (None, "true")),
        ],
    )


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    ("language", "text"),
    [
        ("sv", "  Jag minns räksmörgåsen.\nNästa rad.  "),
        ("en", "  I remember the summer garden.\nNext line.  "),
    ],
)
def test_success_preserves_original_text_and_sends_durable_claim(language, text, wav_bytes):
    scenario = Scenario(language=language, text=text)
    provider = FakeProvider(result=text)
    with TestClient(make_app(scenario, provider)) as client:
        response = post_recording(client, wav_bytes, language)

    assert response.status_code == 200, response.text
    assert response.json() == transcript_row(text, language)
    assert provider.calls == [(True, language)]
    assert scenario.events == ["auth", "session", "project", "claim", "complete"]
    assert scenario.payloads["claim"] == [{
        "p_project_id": PROJECT_ID,
        "p_session_id": SESSION_ID,
        "p_idempotency_key": IDEMPOTENCY_KEY,
        "p_content_sha256": hashlib.sha256(wav_bytes).hexdigest(),
        "p_language": language,
    }]
    assert scenario.payloads["complete"] == [{
        "p_request_id": REQUEST_ID,
        "p_claim_token": CLAIM_TOKEN,
        "p_original_text": text,
    }]
    assert scenario.payloads["fail"] == []


def test_completed_replay_never_calls_provider_or_completion(wav_bytes):
    text = "Redan klart åäö"
    scenario = Scenario(text=text)
    scenario.claim_response = (200, [completed_claim(text)])
    provider = NeverProvider()
    with TestClient(make_app(scenario, provider)) as client:
        response = post_recording(client, wav_bytes)
    assert response.status_code == 200
    assert response.json() == transcript_row(text)
    assert scenario.events == ["auth", "session", "project", "claim"]
    assert scenario.payloads["complete"] == scenario.payloads["fail"] == []


def test_in_progress_claim_returns_conflict_without_provider(wav_bytes):
    scenario = Scenario()
    scenario.claim_response = (200, [in_progress_row()])
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 409, "TRANSCRIPTION_IN_PROGRESS")
    assert scenario.events == ["auth", "session", "project", "claim"]


@pytest.mark.parametrize("sqlstate", ["23505", "55000"])
def test_same_key_conflicts_are_sanitized(sqlstate, wav_bytes):
    scenario = Scenario()
    scenario.claim_response = (
        400,
        {"code": sqlstate, "message": "private database conflict", "details": ACCESS_TOKEN},
    )
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 409, "TRANSCRIPTION_CONFLICT")
    assert "private database" not in response.text
    assert ACCESS_TOKEN not in response.text
    assert scenario.payloads["complete"] == scenario.payloads["fail"] == []


@pytest.mark.parametrize(
    "bad_text",
    [None, "", "   \n", "x" * 32_001, "contains\0nul", "\ud800"],
)
def test_invalid_provider_text_fails_claim_without_completing(bad_text, wav_bytes):
    scenario = Scenario()
    provider = FakeProvider(result=bad_text)
    with TestClient(make_app(scenario, provider)) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "TRANSCRIPTION_INVALID_RESPONSE")
    assert scenario.payloads["complete"] == []
    assert scenario.payloads["fail"] == [{
        "p_request_id": REQUEST_ID,
        "p_claim_token": CLAIM_TOKEN,
        "p_failure_code": "TRANSCRIPTION_INVALID_RESPONSE",
    }]


def test_provider_exception_is_sanitized_and_marks_claim_failed(wav_bytes):
    scenario = Scenario()
    provider = FakeProvider(error=RuntimeError(f"provider secret: {ACCESS_TOKEN}"))
    with TestClient(make_app(scenario, provider)) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "TRANSCRIPTION_UNAVAILABLE")
    assert ACCESS_TOKEN not in response.text
    assert "provider secret" not in response.text
    assert scenario.payloads["complete"] == []
    assert scenario.payloads["fail"][0]["p_failure_code"] == "TRANSCRIPTION_UNAVAILABLE"


def test_provider_timeout_marks_claim_failed(monkeypatch, wav_bytes):
    scenario = Scenario()
    provider = FakeProvider()

    async def immediate_timeout(awaitable, *, timeout):
        assert timeout == 60
        awaitable.close()
        raise TimeoutError

    # Replace only the audio route's module binding. Mutating asyncio.wait_for
    # itself would also break the independent 12-second subprocess probe.
    monkeypatch.setattr(audio_api, "asyncio", SimpleNamespace(wait_for=immediate_timeout))
    with TestClient(make_app(scenario, provider)) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 504, "TRANSCRIPTION_TIMEOUT")
    assert scenario.payloads["complete"] == []
    assert scenario.payloads["fail"][0]["p_failure_code"] == "TRANSCRIPTION_TIMEOUT"


def test_complete_database_failure_is_sanitized_and_attempts_recovery(wav_bytes):
    scenario = Scenario()
    scenario.complete_response = (
        500,
        {"message": f"private upstream body {ACCESS_TOKEN}"},
    )
    with TestClient(make_app(scenario, FakeProvider(result=scenario.text))) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert ACCESS_TOKEN not in response.text
    assert scenario.payloads["fail"][0]["p_failure_code"] == "TRANSCRIPTION_UNAVAILABLE"


def test_failure_rpc_outage_does_not_replace_provider_error(wav_bytes):
    scenario = Scenario()
    scenario.fail_response = (500, {"message": f"database secret {ACCESS_TOKEN}"})
    with TestClient(make_app(scenario, FakeProvider(error=RuntimeError("provider detail")))) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "TRANSCRIPTION_UNAVAILABLE")
    assert "provider detail" not in response.text
    assert "database secret" not in response.text


@pytest.mark.parametrize(
    "claim_body",
    [
        {"not": "a list"},
        [],
        [claimed_row(), claimed_row()],
        [{**claimed_row(), "session_id": "99999999-9999-4999-8999-999999999999"}],
        [{**claimed_row(), "extra_private_field": "must reject"}],
    ],
)
def test_malformed_claim_response_never_calls_provider_or_failure(claim_body, wav_bytes):
    scenario = Scenario()
    scenario.claim_response = (200, claim_body)
    with TestClient(make_app(scenario, NeverProvider())) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert scenario.payloads["complete"] == scenario.payloads["fail"] == []


def test_malformed_completion_is_failed_and_not_returned(wav_bytes):
    scenario = Scenario()
    scenario.complete_response = (
        200,
        [{**transcript_row(scenario.text), "session_id": "99999999-9999-4999-8999-999999999999"}],
    )
    with TestClient(make_app(scenario, FakeProvider(result=scenario.text))) as client:
        response = post_recording(client, wav_bytes)
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
    assert len(scenario.payloads["fail"]) == 1


def test_get_transcripts_preserves_text_and_applies_filters_and_pagination():
    first = transcript_row("  Första minnet\n")
    second = {
        **transcript_row("Second memory"),
        "transcript_id": "33333333-3333-4333-8333-333333333333",
    }
    scenario = Scenario()
    scenario.transcript_rows = [first, second]
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/transcripts?limit=2&offset=7",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
    assert response.status_code == 200, response.text
    assert [item["text"] for item in response.json()] == ["  Första minnet\n", "Second memory"]
    assert scenario.events == ["auth", "session", "project", "transcripts"]
    assert scenario.transcript_params == [{
        "select": "transcript_id,session_id,language,text,status,created_at",
        "session_id": f"eq.{SESSION_ID}",
        "order": "created_at.asc,transcript_id.asc",
        "limit": "2",
        "offset": "7",
    }]


def test_get_missing_or_cross_user_session_is_hidden_before_transcript_query():
    scenario = Scenario()
    scenario.session_rows = []
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/transcripts",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
    assert_error(response, 404, "SESSION_NOT_FOUND")
    assert scenario.events == ["auth", "session"]


def test_get_session_with_unowned_parent_is_rejected_before_transcript_query():
    scenario = Scenario()
    scenario.project_rows = []
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/transcripts",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
    assert_error(response, 404, "PROJECT_NOT_FOUND")
    assert scenario.events == ["auth", "session", "project"]


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        (f"/api/v1/story-sessions/{SESSION_ID}/transcripts", 401, "AUTHORIZATION_REQUIRED"),
        ("/api/v1/story-sessions/not-a-uuid/transcripts", 422, "VALIDATION_ERROR"),
        (f"/api/v1/story-sessions/{SESSION_ID}/transcripts?limit=0", 422, "VALIDATION_ERROR"),
        (f"/api/v1/story-sessions/{SESSION_ID}/transcripts?offset=-1", 422, "VALIDATION_ERROR"),
    ],
)
def test_get_rejects_unauthenticated_or_invalid_requests(path, status, code):
    scenario = Scenario()
    request_headers = {} if status == 401 else {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    with TestClient(make_app(scenario)) as client:
        response = client.get(path, headers=request_headers)
    assert_error(response, status, code)
    # Missing auth is stopped locally. With a syntactically valid bearer token,
    # FastAPI resolves authentication before validating the path/query values,
    # but no session/project/transcript request may occur.
    assert scenario.events == ([] if status == 401 else ["auth"])


@pytest.mark.parametrize(
    "bad_rows",
    [
        {"not": "a list"},
        [{**transcript_row("text"), "session_id": "99999999-9999-4999-8999-999999999999"}],
        [{**transcript_row("text"), "language": "en"}],
        [{**transcript_row("text"), "text": "   "}],
        [{**transcript_row("text"), "provider_debug": "must reject"}],
    ],
)
def test_get_rejects_malformed_upstream_transcript_data(bad_rows):
    scenario = Scenario()
    scenario.transcript_rows = bad_rows
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/transcripts",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")


def test_get_rejects_more_rows_than_requested_limit():
    scenario = Scenario()
    scenario.transcript_rows = [
        transcript_row("one"),
        {**transcript_row("two"), "transcript_id": "33333333-3333-4333-8333-333333333333"},
    ]
    with TestClient(make_app(scenario)) as client:
        response = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/transcripts?limit=1",
            headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
        )
    assert_error(response, 503, "SUPABASE_UNAVAILABLE")
