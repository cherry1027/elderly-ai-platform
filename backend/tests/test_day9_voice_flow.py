"""Offline Day 9 audio-to-conversation acceptance and security checks.

These tests exercise the real FastAPI upload and conversation routes with real
AAC/M4A bytes, the explicitly injected fictional transcription simulator, and a
stateful Auth/PostgREST double.  The double is deliberately not proof of hosted
Supabase RLS; migration tests and hosted acceptance cover that separate layer.
No network service, speech provider, or paid AI provider is contacted here.
"""

from __future__ import annotations

from copy import deepcopy
from fractions import Fraction
from io import BytesIO
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any

import av
import httpx
import pytest
from fastapi.testclient import TestClient

import app.api.audio as audio_api
import app.services.audio_upload as audio_upload
from app.core.config import Settings
from app.main import create_app
from app.services.conversation_provider import MockConversationProvider
from app.services.transcription import (
    SIMULATED_TRANSCRIPT_NOTICE,
    SIMULATED_TRANSCRIPTS,
    SimulatedTranscriptionProvider,
)


SUPABASE_URL = "https://day9-offline.test.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "91000000-0000-4000-8000-000000000001"
PROJECT_ID = "92000000-0000-4000-8000-000000000001"
FOREIGN_PROJECT_ID = "92000000-0000-4000-8000-000000000002"
SESSION_ID = "93000000-0000-4000-8000-000000000001"
FOREIGN_SESSION_ID = "93000000-0000-4000-8000-000000000002"
MISSING_SESSION_ID = "93000000-0000-4000-8000-000000000003"
TRANSCRIPT_ID = "94000000-0000-4000-8000-000000000001"
MESSAGE_IDS = {
    2: "94000000-0000-4000-8000-000000000002",
    3: "94000000-0000-4000-8000-000000000003",
    4: "94000000-0000-4000-8000-000000000004",
}
REQUEST_ID = "95000000-0000-4000-8000-000000000001"
CLAIM_TOKEN = "96000000-0000-4000-8000-000000000001"
MEMORY_IDS = (
    "97000000-0000-4000-8000-000000000001",
    "97000000-0000-4000-8000-000000000002",
    "97000000-0000-4000-8000-000000000003",
)
CLARIFICATION_ID = "98000000-0000-4000-8000-000000000001"
AUDIO_KEY = "99000000-0000-4000-8000-000000000001"
SOURCE_TURN_KEY = "99000000-0000-4000-8000-000000000002"
CORRECTION_TURN_KEY = "99000000-0000-4000-8000-000000000003"

CREATED_AT = "2026-10-21T08:00:00Z"
UPDATED_AT = "2026-10-21T08:05:00Z"


def configured_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
        conversation_mode="mock",
    )


def request_body(request: httpx.Request) -> dict[str, Any]:
    return json.loads(request.content.decode("utf-8"))


def make_stereo_m4a(sample_rate: int, seconds: float) -> bytes:
    """Encode actual silent stereo AAC frames in an MP4/M4A container."""
    output = BytesIO()
    with av.open(output, mode="w", format="mp4") as container:
        stream = container.add_stream("aac", rate=sample_rate)
        stream.layout = "stereo"
        remaining = max(1, round(seconds * sample_rate))
        pts = 0
        while remaining:
            samples = min(1_024, remaining)
            frame = av.AudioFrame(format="fltp", layout="stereo", samples=samples)
            frame.sample_rate = sample_rate
            frame.pts = pts
            frame.time_base = Fraction(1, sample_rate)
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            for packet in stream.encode(frame):
                container.mux(packet)
            pts += samples
            remaining -= samples
        for packet in stream.encode(None):
            container.mux(packet)
    return output.getvalue()


@pytest.fixture(scope="module")
def short_m4a() -> dict[str, bytes]:
    # Both rates are common iPhone recording rates and exercise stereo decode.
    return {
        "en": make_stereo_m4a(44_100, 0.20),
        "sv": make_stereo_m4a(48_000, 0.20),
        "different": make_stereo_m4a(44_100, 0.35),
    }


@pytest.fixture(scope="module")
def too_long_m4a() -> bytes:
    return make_stereo_m4a(48_000, 90.20)


class ObservedSimulatedProvider(SimulatedTranscriptionProvider):
    def __init__(self) -> None:
        self.calls: list[tuple[Path, bool, int, str]] = []

    async def transcribe(self, path: Path, language: str) -> str:
        self.calls.append((path, path.is_file(), path.stat().st_size, language))
        return await super().transcribe(path, language)


def track_temporary_directories(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    real_temporary_directory = tempfile.TemporaryDirectory
    paths: list[Path] = []

    class TrackingTemporaryDirectory:
        def __init__(self, *args, **kwargs):
            self.delegate = real_temporary_directory(*args, **kwargs)

        def __enter__(self):
            path = Path(self.delegate.__enter__())
            paths.append(path)
            return str(path)

        def __exit__(self, exc_type, exc, traceback):
            return self.delegate.__exit__(exc_type, exc, traceback)

    monkeypatch.setattr(audio_api, "TemporaryDirectory", TrackingTemporaryDirectory)
    return paths


class VoiceStore:
    """Narrow stateful Auth/PostgREST double for route composition only."""

    def __init__(self, language: str = "en") -> None:
        self.language = language
        self.project = {
            "id": PROJECT_ID,
            "user_id": USER_ID,
            "title": "Fictional voice-flow fixture",
            "description": "Offline simulated data",
            "language": language,
            "status": "draft",
            "created_at": CREATED_AT,
            "updated_at": CREATED_AT,
        }
        self.session = {
            "id": SESSION_ID,
            "project_id": PROJECT_ID,
            "language": language,
            "status": "active",
            "created_at": CREATED_AT,
            "updated_at": CREATED_AT,
            "ended_at": None,
        }
        self.foreign_session = {
            **self.session,
            "id": FOREIGN_SESSION_ID,
            "project_id": FOREIGN_PROJECT_ID,
        }
        self.messages: list[dict[str, Any]] = []
        self.memories: list[dict[str, Any]] = []
        self.clarifications: list[dict[str, Any]] = []
        self.turns: dict[str, dict[str, Any]] = {}
        self.turn_inputs: dict[str, dict[str, Any]] = {}
        self.audio_requests: dict[str, dict[str, Any]] = {}
        self.transcript: dict[str, Any] | None = None
        self.events: list[str] = []

    def _assert_credentials(self, request: httpx.Request) -> None:
        assert request.url.host == "day9-offline.test.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"

    @staticmethod
    def _json_null() -> httpx.Response:
        return httpx.Response(
            200, content=b"null", headers={"content-type": "application/json"}
        )

    @staticmethod
    def _sql_error(code: str, status: int = 400) -> httpx.Response:
        return httpx.Response(
            status,
            json={
                "code": code,
                "message": "private offline database detail",
                "details": ACCESS_TOKEN,
            },
        )

    def _session_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("limit") == "1"
        selected = params.get("id", "").removeprefix("eq.")
        if selected == SESSION_ID:
            rows = [self.session]
        elif selected == FOREIGN_SESSION_ID:
            # Defense-in-depth fixture: expose a valid-shaped child but hide its
            # parent from the explicit user_id project check below. This does
            # not claim to emulate hosted RLS.
            rows = [self.foreign_session]
        else:
            rows = []
        return httpx.Response(200, json=deepcopy(rows))

    def _project_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("user_id") == f"eq.{USER_ID}"
        selected = params.get("id", "").removeprefix("eq.")
        rows = [self.project] if selected == PROJECT_ID else []
        return httpx.Response(200, json=deepcopy(rows))

    def _message_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("session_id") == f"eq.{SESSION_ID}"
        rows = list(self.messages)
        if "id" in params:
            selected = params["id"].removeprefix("eq.")
            rows = [row for row in rows if row["id"] == selected]
        elif params.get("order") == "sequence.desc":
            rows = sorted(rows, key=lambda row: row["sequence"], reverse=True)[:1]
        else:
            rows = sorted(rows, key=lambda row: row["sequence"])
            offset = int(params.get("offset", 0))
            rows = rows[offset : offset + int(params.get("limit", len(rows)))]
        return httpx.Response(200, json=deepcopy(rows))

    def _memory_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        rows = list(self.memories)
        if "id" in params:
            selected = params["id"].removeprefix("eq.")
            rows = [row for row in rows if row["id"] == selected]
        elif "project_id" in params:
            assert params["project_id"] == f"eq.{PROJECT_ID}"
            assert params.get("status") == "neq.rejected"
            rows = [row for row in rows if row["status"] != "rejected"]
        else:
            assert params.get("session_id") == f"eq.{SESSION_ID}"
            offset = int(params.get("offset", 0))
            rows = rows[offset : offset + int(params.get("limit", len(rows)))]
        return httpx.Response(200, json=deepcopy(rows))

    def _clarification_relation(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        params = dict(request.url.params)
        assert params.get("session_id") == f"eq.{SESSION_ID}"
        assert params.get("status") == "eq.open"
        rows = [row for row in self.clarifications if row["status"] == "open"]
        offset = int(params.get("offset", 0))
        rows = rows[offset : offset + int(params.get("limit", len(rows)))]
        return httpx.Response(200, json=deepcopy(rows))

    def _claim_audio(self, payload: dict[str, Any]) -> httpx.Response:
        assert payload["p_project_id"] == PROJECT_ID
        assert payload["p_session_id"] == SESSION_ID
        assert payload["p_language"] == self.language
        key = payload["p_idempotency_key"]
        existing = self.audio_requests.get(key)
        if existing is not None:
            if existing["digest"] != payload["p_content_sha256"]:
                return self._sql_error("23505")
            if existing["status"] == "completed":
                assert self.transcript is not None
                return httpx.Response(200, json=[{
                    "outcome": "completed",
                    "request_id": REQUEST_ID,
                    "claim_token": None,
                    "status": "completed",
                    **deepcopy(self.transcript),
                    "attempt_count": 1,
                }])
            return httpx.Response(200, json=[{
                "outcome": "in_progress",
                "request_id": REQUEST_ID,
                "claim_token": None,
                "status": "processing",
                "transcript_id": None,
                "session_id": SESSION_ID,
                "language": self.language,
                "text": None,
                "created_at": None,
                "attempt_count": 1,
            }])

        self.audio_requests[key] = {
            "digest": payload["p_content_sha256"], "status": "processing"
        }
        return httpx.Response(200, json=[{
            "outcome": "claimed",
            "request_id": REQUEST_ID,
            "claim_token": CLAIM_TOKEN,
            "status": "processing",
            "transcript_id": None,
            "session_id": SESSION_ID,
            "language": self.language,
            "text": None,
            "created_at": None,
            "attempt_count": 1,
        }])

    def _complete_audio(self, payload: dict[str, Any]) -> httpx.Response:
        assert payload == {
            "p_request_id": REQUEST_ID,
            "p_claim_token": CLAIM_TOKEN,
            "p_original_text": SIMULATED_TRANSCRIPTS[self.language],
        }
        request = self.audio_requests[AUDIO_KEY]
        assert request["status"] == "processing"
        assert not self.messages
        source = {
            "id": TRANSCRIPT_ID,
            "session_id": SESSION_ID,
            "sequence": 1,
            "role": "user",
            "text": payload["p_original_text"],
            "language": self.language,
            "created_at": CREATED_AT,
        }
        self.messages.append(source)
        self.transcript = {
            "transcript_id": TRANSCRIPT_ID,
            "session_id": SESSION_ID,
            "language": self.language,
            "text": source["text"],
            "status": "completed",
            "created_at": CREATED_AT,
        }
        request["status"] = "completed"
        return httpx.Response(200, json=[deepcopy(self.transcript)])

    def _get_turn(self, payload: dict[str, Any]) -> httpx.Response:
        key = payload["p_idempotency_key"]
        existing = self.turns.get(key)
        if existing is None:
            return self._json_null()
        if payload != self.turn_inputs[key]:
            return self._sql_error("23505")
        return httpx.Response(200, json=deepcopy(existing))

    def _append_turn(self, payload: dict[str, Any]) -> httpx.Response:
        assert payload["p_session_id"] == SESSION_ID
        assert payload["p_language"] == self.language
        assert payload["p_expected_sequence"] == len(self.messages)
        expected_versions = sorted(
            (
                {"id": row["id"], "version": row["version"]}
                for row in self.memories
                if row["status"] != "rejected"
            ),
            key=lambda item: item["id"],
        )
        assert payload["p_context_versions"] == expected_versions

        source_id = payload["p_source_message_id"]
        if source_id is None:
            sequence = len(self.messages) + 1
            user_message = {
                "id": MESSAGE_IDS[sequence],
                "session_id": SESSION_ID,
                "sequence": sequence,
                "role": "user",
                "text": payload["p_text"],
                "language": self.language,
                "created_at": UPDATED_AT,
            }
            self.messages.append(user_message)
        else:
            matches = [row for row in self.messages if row["id"] == source_id]
            assert len(matches) == 1
            user_message = matches[0]
            assert user_message["role"] == "user"
            assert user_message["text"] == payload["p_text"]
            assert not any(
                inputs["p_source_message_id"] == source_id
                for inputs in self.turn_inputs.values()
            )

        assistant_sequence = len(self.messages) + 1
        assistant_message = {
            "id": MESSAGE_IDS[assistant_sequence],
            "session_id": SESSION_ID,
            "sequence": assistant_sequence,
            "role": "assistant",
            "text": payload["p_assistant_text"],
            "language": self.language,
            "created_at": UPDATED_AT,
        }
        self.messages.append(assistant_message)

        new_memories: list[dict[str, Any]] = []
        new_clarifications: list[dict[str, Any]] = []
        for candidate in payload["p_facts"]:
            memory = {
                "id": MEMORY_IDS[len(self.memories)],
                "project_id": PROJECT_ID,
                "session_id": SESSION_ID,
                "source_message_id": user_message["id"],
                "fact_type": candidate["fact_type"],
                "value": candidate["value"],
                "evidence": candidate["evidence"],
                "year": candidate["year"],
                "slot": candidate["slot"],
                "uncertain": candidate["uncertain"],
                "status": "pending",
                "corrected_value": None,
                "version": 1,
                "created_at": UPDATED_AT,
                "updated_at": UPDATED_AT,
            }
            self.memories.append(memory)
            new_memories.append(memory)
            if candidate["clarification_question"] is not None:
                clarification = {
                    "id": CLARIFICATION_ID,
                    "fact_id": memory["id"],
                    "session_id": SESSION_ID,
                    "conflicts_with_fact_id": candidate["conflicts_with_fact_id"],
                    "question": candidate["clarification_question"],
                    "status": "open",
                    "resolution": None,
                    "created_at": UPDATED_AT,
                    "resolved_at": None,
                }
                self.clarifications.append(clarification)
                new_clarifications.append(clarification)

        turn = {
            "user_message": deepcopy(user_message),
            "message": deepcopy(assistant_message),
            "memories": deepcopy(new_memories),
            "clarifications": deepcopy(new_clarifications),
            "requires_clarification": bool(new_clarifications),
            "mode": "mock",
        }
        key = payload["p_idempotency_key"]
        self.turns[key] = turn
        self.turn_inputs[key] = {
            key: payload[key]
            for key in (
                "p_session_id", "p_idempotency_key", "p_text", "p_language",
                "p_source_message_id",
            )
        }
        return httpx.Response(200, json=deepcopy(turn))

    def _resolve_memory(self, payload: dict[str, Any]) -> httpx.Response:
        memory = next(
            (row for row in self.memories if row["id"] == payload["p_fact_id"]),
            None,
        )
        if memory is None:
            return self._sql_error("P0002")
        expected = payload["p_expected_version"]
        same_replay = (
            memory["version"] == expected + 1
            and memory["status"] == payload["p_status"]
            and memory["corrected_value"] == payload["p_corrected_value"]
        )
        if memory["version"] != expected:
            return (
                httpx.Response(200, json=deepcopy(memory))
                if same_replay
                else self._sql_error("55000", 409)
            )
        if (
            memory["status"] != payload["p_status"]
            or memory["corrected_value"] != payload["p_corrected_value"]
        ):
            memory.update(
                status=payload["p_status"],
                corrected_value=payload["p_corrected_value"],
                version=memory["version"] + 1,
                updated_at=UPDATED_AT,
            )
        for clarification in self.clarifications:
            if clarification["fact_id"] == memory["id"] and clarification["status"] == "open":
                clarification.update(
                    status="resolved",
                    resolution=(
                        "rejected"
                        if memory["status"] == "rejected"
                        else (
                            f'corrected: {memory["corrected_value"]}'
                            if memory["corrected_value"] is not None
                            else "confirmed"
                        )
                    ),
                    resolved_at=UPDATED_AT,
                )
        return httpx.Response(200, json=deepcopy(memory))

    def _rpc(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.removeprefix("/rest/v1/rpc/")
        payload = request_body(request)
        self.events.append(name)
        if name == "claim_audio_transcription":
            return self._claim_audio(payload)
        if name == "complete_audio_transcription":
            return self._complete_audio(payload)
        if name == "fail_audio_transcription":
            pytest.fail("the successful simulation must not fail its durable claim")
        if name == "get_conversation_turn":
            return self._get_turn(payload)
        if name == "append_conversation_turn":
            return self._append_turn(payload)
        if name == "resolve_memory_fact":
            return self._resolve_memory(payload)
        pytest.fail(f"unexpected offline RPC: {name}")

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self._assert_credentials(request)
        path = request.url.path
        if path == "/auth/v1/user":
            assert request.method == "GET"
            self.events.append("auth")
            return httpx.Response(
                200, json={"id": USER_ID, "email": "fictional@example.test"}
            )
        if path == "/rest/v1/conversation_sessions":
            self.events.append("sessions")
            return self._session_relation(request)
        if path == "/rest/v1/story_projects":
            self.events.append("projects")
            return self._project_relation(request)
        if path == "/rest/v1/conversation_message_history":
            self.events.append("messages")
            return self._message_relation(request)
        if path == "/rest/v1/memory_facts":
            self.events.append("memories")
            return self._memory_relation(request)
        if path == "/rest/v1/memory_clarifications":
            self.events.append("clarifications")
            return self._clarification_relation(request)
        if path == "/rest/v1/audio_transcripts":
            self.events.append("transcripts")
            return httpx.Response(
                200, json=[] if self.transcript is None else [deepcopy(self.transcript)]
            )
        if path.startswith("/rest/v1/rpc/"):
            assert request.method == "POST"
            return self._rpc(request)
        pytest.fail(f"unexpected offline upstream request: {request.method} {path}")


def make_app(store: VoiceStore, provider: SimulatedTranscriptionProvider | None = None):
    return create_app(
        configured_settings(),
        transport=httpx.MockTransport(store),
        transcription_provider=provider or SimulatedTranscriptionProvider(),
        conversation_provider=MockConversationProvider(),
    )


def audio_headers(
    *, key: str = AUDIO_KEY, include_auth: bool = True
) -> dict[str, str]:
    result = {"Idempotency-Key": key}
    if include_auth:
        result["Authorization"] = f"Bearer {ACCESS_TOKEN}"
    return result


def post_audio(
    client: TestClient,
    content: bytes,
    *,
    session_id: str = SESSION_ID,
    key: str = AUDIO_KEY,
    language: str = "en",
    consent: str = "true",
    filename: str = "recording.m4a",
    mime_type: str = "audio/mp4",
    include_auth: bool = True,
):
    return client.post(
        f"/api/v1/story-sessions/{session_id}/transcribe",
        headers=audio_headers(key=key, include_auth=include_auth),
        files=[
            ("file", (filename, content, mime_type)),
            ("language", (None, language)),
            ("consent", (None, consent)),
        ],
    )


def auth_headers(*, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    if key is not None:
        result["Idempotency-Key"] = key
    return result


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.headers["cache-control"] == "no-store"
    assert ACCESS_TOKEN not in response.text
    assert "private offline database detail" not in response.text


@pytest.mark.parametrize(
    ("language", "sample_rate", "correction_text"),
    [
        ("en", 44_100, "Actually, it was 1975."),
        ("sv", 48_000, "Egentligen var det 1975."),
    ],
)
def test_real_stereo_m4a_flows_through_simulated_transcript_and_source_conversation(
    monkeypatch, short_m4a, language, sample_rate, correction_text
):
    content = short_m4a[language]
    with av.open(BytesIO(content), mode="r") as container:
        stream = container.streams.audio[0]
        assert stream.codec_context.name == "aac"
        assert stream.codec_context.sample_rate == sample_rate
        assert stream.codec_context.layout.name == "stereo"

    temporary_paths = track_temporary_directories(monkeypatch)
    store = VoiceStore(language)
    provider = ObservedSimulatedProvider()
    app = make_app(store, provider)

    with TestClient(app) as client:
        uploaded = post_audio(client, content, language=language)
        assert uploaded.status_code == 200, uploaded.text
        transcript = uploaded.json()
        assert transcript == {
            "transcript_id": TRANSCRIPT_ID,
            "session_id": SESSION_ID,
            "language": language,
            "text": SIMULATED_TRANSCRIPTS[language],
            "status": "completed",
            "created_at": CREATED_AT,
        }
        assert transcript["text"].startswith(SIMULATED_TRANSCRIPT_NOTICE)
        assert "Not derived from uploaded audio" in transcript["text"]
        assert provider.calls == [(provider.calls[0][0], True, len(content), language)]

        source_turn = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(key=SOURCE_TURN_KEY),
            json={"source_message_id": TRANSCRIPT_ID, "language": language},
        )
        assert source_turn.status_code == 201, source_turn.text
        turn = source_turn.json()
        assert turn["user_message"]["id"] == TRANSCRIPT_ID
        assert turn["user_message"]["text"] == transcript["text"]
        assert turn["message"]["role"] == "assistant"
        assert turn["mode"] == "mock"
        assert turn["requires_clarification"] is False
        assert len(turn["memories"]) == 2
        assert {memory["slot"] for memory in turn["memories"]} == {
            "move", "occupation"
        }
        assert all(
            memory["source_message_id"] == TRANSCRIPT_ID
            and memory["status"] == "pending"
            for memory in turn["memories"]
        )
        # The audio completion inserted one immutable user original. Processing
        # that source adds only the assistant row, not a phantom second user.
        assert [row["role"] for row in store.messages] == ["user", "assistant"]

        replay_upload = post_audio(client, content, language=language)
        assert replay_upload.status_code == 200
        assert replay_upload.json() == transcript
        assert len(provider.calls) == 1
        assert [row["role"] for row in store.messages] == ["user", "assistant"]

        replay_turn = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(key=SOURCE_TURN_KEY),
            json={"source_message_id": TRANSCRIPT_ID, "language": language},
        )
        assert replay_turn.status_code == 201
        assert replay_turn.json() == turn
        assert len(store.messages) == 2
        assert len(store.memories) == 2

        different_bytes = post_audio(
            client, short_m4a["different"], language=language
        )
        assert_error(different_bytes, 409, "TRANSCRIPTION_CONFLICT")
        assert len(provider.calls) == 1
        assert len(store.messages) == 2

        move = next(memory for memory in turn["memories"] if memory["slot"] == "move")
        occupation = next(
            memory for memory in turn["memories"] if memory["slot"] == "occupation"
        )
        confirmed = client.patch(
            f'/api/v1/memories/{move["id"]}',
            headers=auth_headers(),
            json={"status": "confirmed", "expected_version": 1},
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["status"] == "confirmed"
        assert confirmed.json()["version"] == 2

        rejected = client.patch(
            f'/api/v1/memories/{occupation["id"]}',
            headers=auth_headers(),
            json={"status": "rejected", "expected_version": 1},
        )
        assert rejected.status_code == 200, rejected.text
        assert rejected.json()["status"] == "rejected"
        assert rejected.json()["version"] == 2

        correction_turn = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(key=CORRECTION_TURN_KEY),
            json={"text": correction_text, "language": language},
        )
        assert correction_turn.status_code == 201, correction_turn.text
        correction = correction_turn.json()
        assert correction["requires_clarification"] is True
        assert len(correction["memories"]) == 1
        assert len(correction["clarifications"]) == 1
        proposed = correction["memories"][0]
        question = correction["clarifications"][0]
        assert proposed["year"] == 1975
        assert proposed["value"] == "1975"
        assert proposed["status"] == "pending"
        assert proposed["source_message_id"] == correction["user_message"]["id"]
        assert question["fact_id"] == proposed["id"]
        assert question["conflicts_with_fact_id"] == move["id"]
        assert question["status"] == "open"

        # A 1975 conflict is a new pending fact. It must never overwrite the
        # earlier 1974 source or memory automatically.
        original_move = next(row for row in store.memories if row["id"] == move["id"])
        assert original_move["year"] == 1974
        assert original_move["value"] == "Malmö"
        assert original_move["status"] == "confirmed"
        assert original_move["source_message_id"] == TRANSCRIPT_ID

        open_questions = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/clarifications",
            headers=auth_headers(),
        )
        assert open_questions.status_code == 200
        assert [item["id"] for item in open_questions.json()] == [CLARIFICATION_ID]

        corrected = client.patch(
            f'/api/v1/memories/{proposed["id"]}',
            headers=auth_headers(),
            json={
                "status": "confirmed",
                "corrected_value": "1975",
                "expected_version": 1,
            },
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["status"] == "confirmed"
        assert corrected.json()["corrected_value"] == "1975"
        assert corrected.json()["version"] == 2

        stale = client.patch(
            f'/api/v1/memories/{proposed["id"]}',
            headers=auth_headers(),
            json={"status": "rejected", "expected_version": 1},
        )
        assert_error(stale, 409, "CONVERSATION_CHANGED")

        history = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/messages",
            headers=auth_headers(),
        )
        assert history.status_code == 200, history.text
        assert [row["sequence"] for row in history.json()] == [1, 2, 3, 4]
        assert history.json()[0] == turn["user_message"]
        assert history.json()[0]["text"] == SIMULATED_TRANSCRIPTS[language]
        assert history.json()[0]["id"] == TRANSCRIPT_ID

        memories = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/memories",
            headers=auth_headers(),
        )
        assert memories.status_code == 200, memories.text
        assert [row["status"] for row in memories.json()] == [
            "confirmed", "rejected", "confirmed"
        ]
        assert next(row for row in memories.json() if row["id"] == move["id"])[
            "year"
        ] == 1974

        resolved_questions = client.get(
            f"/api/v1/story-sessions/{SESSION_ID}/clarifications",
            headers=auth_headers(),
        )
        assert resolved_questions.status_code == 200
        assert resolved_questions.json() == []

    assert temporary_paths
    assert all(not path.exists() for path in temporary_paths)
    assert provider.calls[0][0].name == "recording.m4a"
    assert not provider.calls[0][0].exists()
    assert store.audio_requests[AUDIO_KEY]["digest"] == hashlib.sha256(content).hexdigest()


@pytest.mark.parametrize(
    ("session_id", "expected_code"),
    [
        (MISSING_SESSION_ID, "SESSION_NOT_FOUND"),
        (FOREIGN_SESSION_ID, "PROJECT_NOT_FOUND"),
    ],
)
def test_missing_and_defense_in_depth_foreign_sessions_are_rejected_before_audio_read(
    session_id, expected_code
):
    store = VoiceStore("en")
    provider = ObservedSimulatedProvider()
    with TestClient(make_app(store, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{session_id}/transcribe",
            headers=audio_headers(),
            content=b"not multipart and must remain unread",
        )
    assert_error(response, 404, expected_code)
    assert provider.calls == []
    assert store.audio_requests == {}


def test_missing_authentication_is_rejected_before_audio_read():
    store = VoiceStore("en")
    provider = ObservedSimulatedProvider()
    with TestClient(make_app(store, provider)) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers=audio_headers(include_auth=False),
            content=b"not multipart and must remain unread",
        )
    assert_error(response, 401, "AUTHORIZATION_REQUIRED")
    assert provider.calls == []
    assert store.events == []


@pytest.mark.parametrize(
    ("case", "expected_status", "expected_code"),
    [
        ("language", 422, "LANGUAGE_MISMATCH"),
        ("consent", 422, "CONSENT_REQUIRED"),
        ("mime", 415, "UNSUPPORTED_AUDIO_FORMAT"),
        ("empty", 422, "INVALID_RECORDING"),
        ("uri-bytes", 422, "INVALID_RECORDING"),
    ],
)
def test_recording_contract_rejects_invalid_mobile_payloads_and_cleans_temporary_files(
    monkeypatch, short_m4a, case, expected_status, expected_code
):
    paths = track_temporary_directories(monkeypatch)
    store = VoiceStore("en")
    provider = ObservedSimulatedProvider()
    kwargs: dict[str, Any] = {"language": "en"}
    content = short_m4a["en"]
    if case == "language":
        kwargs["language"] = "sv"
    elif case == "consent":
        kwargs["consent"] = "false"
    elif case == "mime":
        kwargs["mime_type"] = "audio/wav"
    elif case == "empty":
        content = b""
    elif case == "uri-bytes":
        # React Native must upload file bytes, never the local file URI text.
        content = b"file:///private/var/mobile/recording.m4a"

    with TestClient(make_app(store, provider)) as client:
        response = post_audio(client, content, **kwargs)
    assert_error(response, expected_status, expected_code)
    assert provider.calls == []
    assert store.audio_requests == {}
    assert paths
    assert all(not path.exists() for path in paths)


def test_recording_byte_and_duration_bounds_fail_before_simulation(
    monkeypatch, short_m4a, too_long_m4a
):
    paths = track_temporary_directories(monkeypatch)
    store = VoiceStore("en")
    provider = ObservedSimulatedProvider()
    with TestClient(make_app(store, provider)) as client:
        with monkeypatch.context() as bounds:
            bounds.setattr(audio_upload, "MAX_AUDIO_BYTES", len(short_m4a["en"]) - 1)
            oversized = post_audio(client, short_m4a["en"], language="en")
        too_long = post_audio(client, too_long_m4a, language="en")

    assert_error(oversized, 413, "RECORDING_TOO_LARGE")
    assert_error(too_long, 422, "RECORDING_TOO_LONG")
    assert provider.calls == []
    assert store.audio_requests == {}
    assert len(paths) == 2
    assert all(not path.exists() for path in paths)
