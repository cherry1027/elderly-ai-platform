"""Offline contract tests for authenticated, bounded Day 3 audio uploads."""

from __future__ import annotations

import asyncio
import io
import os
import tempfile
import threading
from fractions import Fraction
from pathlib import Path
from typing import Any

import av
import httpx
import pytest
import starlette.formparsers as starlette_formparsers
from fastapi.testclient import TestClient

import app.api.audio as audio_api
import app.services.audio_upload as audio_upload
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app


SUPABASE_URL = "https://test-project.supabase.co"
PUBLISHABLE_KEY = "test-publishable-key"
ACCESS_TOKEN = "test-user-access-token"

USER_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
IDEMPOTENCY_KEY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

PROJECT_ROW = {
    "id": PROJECT_ID,
    "user_id": USER_ID,
    "title": "Minnen",
    "description": None,
    "language": "sv",
    "status": "draft",
    "created_at": "2026-10-18T08:00:00Z",
    "updated_at": "2026-10-18T08:00:00Z",
}
SESSION_ROW = {
    "id": SESSION_ID,
    "project_id": PROJECT_ID,
    "language": "sv",
    "status": "active",
    "created_at": "2026-10-18T08:05:00Z",
    "updated_at": "2026-10-18T08:05:00Z",
    "ended_at": None,
}

MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
}

# container, encoder, input sample format, sample rate, encoder-friendly chunk
ENCODERS = {
    ".wav": ("wav", "pcm_s16le", "s16", 8_000, 8_000),
    ".mp3": ("mp3", "libmp3lame", "s16p", 8_000, 1_152),
    ".m4a": ("mp4", "aac", "fltp", 8_000, 1_024),
    ".webm": ("webm", "libopus", "s16", 48_000, 960),
}


def configured_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        supabase_publishable_key=PUBLISHABLE_KEY,
    )


def make_audio(suffix: str, seconds: float) -> bytes:
    """Encode silence in memory with the same real codecs accepted by the probe."""
    container_name, codec, sample_format, rate, chunk_size = ENCODERS[suffix]
    output = io.BytesIO()
    with av.open(output, mode="w", format=container_name) as container:
        stream = container.add_stream(codec, rate=rate)
        stream.layout = "mono"
        remaining = round(seconds * rate)
        pts = 0
        while remaining:
            samples = min(chunk_size, remaining)
            frame = av.AudioFrame(
                format=sample_format, layout="mono", samples=samples
            )
            frame.sample_rate = rate
            frame.pts = pts
            frame.time_base = Fraction(1, rate)
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            for packet in stream.encode(frame):
                container.mux(packet)
            remaining -= samples
            pts += samples
        for packet in stream.encode(None):
            container.mux(packet)
    return output.getvalue()


@pytest.fixture(scope="module")
def short_audio() -> dict[str, bytes]:
    return {suffix: make_audio(suffix, 1.0) for suffix in ENCODERS}


@pytest.fixture(scope="module")
def duration_boundary_audio() -> tuple[bytes, bytes]:
    return make_audio(".wav", 90.0), make_audio(".wav", 90.01)


def data_handler(
    *,
    session_rows: list[dict[str, Any]] | None = None,
    events: list[str] | None = None,
):
    rows = [SESSION_ROW] if session_rows is None else session_rows

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "test-project.supabase.co"
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        if request.url.path == "/auth/v1/user":
            if events is not None:
                events.append("auth")
            return httpx.Response(
                200, json={"id": USER_ID, "email": "owner@example.test"}
            )
        if request.url.path == "/rest/v1/conversation_sessions":
            if events is not None:
                events.append("session")
            assert request.method == "GET"
            assert request.url.params.get("id") == f"eq.{SESSION_ID}"
            assert request.url.params.get("limit") == "1"
            return httpx.Response(200, json=rows)
        if request.url.path == "/rest/v1/story_projects":
            if events is not None:
                events.append("project")
            assert request.method == "GET"
            assert request.url.params.get("id") == f"eq.{PROJECT_ID}"
            assert request.url.params.get("user_id") == f"eq.{USER_ID}"
            return httpx.Response(200, json=[PROJECT_ROW])
        pytest.fail(f"unexpected upstream request: {request.method} {request.url}")

    return handler


def make_app(*, session_rows=None, events=None, provider=None):
    return create_app(
        configured_settings(),
        transport=httpx.MockTransport(
            data_handler(session_rows=session_rows, events=events)
        ),
        transcription_provider=provider,
    )


def request_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Idempotency-Key": IDEMPOTENCY_KEY,
    }


def post_recording(
    client: TestClient,
    content: bytes,
    *,
    suffix: str = ".wav",
    mime_type: str | None = None,
    language: str = "sv",
    consent: str = "true",
    filename: str | None = None,
):
    return client.post(
        f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
        headers=request_headers(),
        files=[
            (
                "file",
                (
                    filename or f"recording{suffix}",
                    content,
                    mime_type or MIME_TYPES.get(suffix, "application/octet-stream"),
                ),
            ),
            ("language", (None, language)),
            ("consent", (None, consent)),
        ],
    )


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert set(response.json()) == {"error"}
    assert set(response.json()["error"]) == {"code", "message"}
    assert response.headers["cache-control"] == "no-store"


class NeverProvider:
    enabled = False

    def __init__(self):
        self.calls = 0

    async def transcribe(self, path: Path, language: str) -> str:
        self.calls += 1
        pytest.fail("the disabled provider must never be called")


def track_temporary_directories(monkeypatch) -> list[Path]:
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


def test_limits_are_decimal_25_mb_and_bounded_overhead():
    assert audio_upload.MAX_AUDIO_BYTES == 25_000_000
    assert audio_upload.MAX_REQUEST_BYTES == 25_000_000 + 16_384


def test_missing_authentication_is_rejected_before_body_decode(monkeypatch):
    async def body_must_not_be_read(*args, **kwargs):
        pytest.fail("unauthenticated request reached multipart decoding")

    monkeypatch.setattr(audio_api, "read_recording", body_must_not_be_read)
    app = make_app()
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers={"Idempotency-Key": IDEMPOTENCY_KEY},
            content=b"must remain unread",
        )
    assert_error(response, 401, "AUTHORIZATION_REQUIRED")


def test_missing_or_cross_user_session_is_rejected_before_body_decode(monkeypatch):
    async def body_must_not_be_read(*args, **kwargs):
        pytest.fail("unowned request reached multipart decoding")

    monkeypatch.setattr(audio_api, "read_recording", body_must_not_be_read)
    app = make_app(session_rows=[])
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers=request_headers(),
            content=b"must remain unread",
        )
    assert_error(response, 404, "SESSION_NOT_FOUND")


def test_owned_session_is_checked_before_body_decode(monkeypatch):
    events: list[str] = []

    async def stop_at_body(*args, **kwargs):
        events.append("body")
        raise APIError(422, "TEST_BODY", "Stopped after authorization.")

    monkeypatch.setattr(audio_api, "read_recording", stop_at_body)
    app = make_app(events=events)
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers=request_headers(),
            content=b"body",
        )
    assert_error(response, 422, "TEST_BODY")
    assert events == ["auth", "session", "project", "body"]


@pytest.mark.parametrize("suffix", list(ENCODERS))
def test_real_wav_mp3_m4a_and_webm_are_fully_decoded_but_provider_stays_disabled(
    short_audio, suffix
):
    provider = NeverProvider()
    app = make_app(provider=provider)
    with TestClient(app) as client:
        response = post_recording(client, short_audio[suffix], suffix=suffix)
    assert_error(response, 503, "TRANSCRIPTION_DISABLED")
    assert provider.calls == 0
    assert "transcript_id" not in response.text


def test_exactly_90_seconds_is_accepted_and_longer_is_rejected(
    duration_boundary_audio,
):
    exact, too_long = duration_boundary_audio
    app = make_app()
    with TestClient(app) as client:
        exact_response = post_recording(client, exact)
        long_response = post_recording(client, too_long)
    assert_error(exact_response, 503, "TRANSCRIPTION_DISABLED")
    assert_error(long_response, 422, "RECORDING_TOO_LONG")


def test_empty_and_corrupt_recordings_are_rejected():
    app = make_app()
    with TestClient(app) as client:
        empty = post_recording(client, b"")
        corrupt = post_recording(client, b"RIFF-this-is-not-a-wave-file")
    assert_error(empty, 422, "INVALID_RECORDING")
    assert_error(corrupt, 422, "INVALID_RECORDING")


@pytest.mark.parametrize(
    "filename,mime_type",
    [
        ("recording.wav", "audio/mpeg"),
        ("recording.txt", "audio/wav"),
        ("recording.webm", "video/webm"),
    ],
)
def test_extension_and_mime_must_be_an_allowed_pair(
    short_audio, filename, mime_type
):
    app = make_app()
    with TestClient(app) as client:
        response = post_recording(
            client,
            short_audio[".wav"],
            filename=filename,
            mime_type=mime_type,
        )
    assert_error(response, 415, "UNSUPPORTED_AUDIO_FORMAT")


def test_file_size_is_checked_independently_of_multipart_overhead(
    monkeypatch, short_audio
):
    monkeypatch.setattr(audio_upload, "MAX_AUDIO_BYTES", 3)
    app = make_app()
    with TestClient(app) as client:
        response = post_recording(client, short_audio[".wav"][:4])
    assert_error(response, 413, "RECORDING_TOO_LARGE")


@pytest.mark.parametrize(
    "language,consent,code",
    [
        ("en", "true", "LANGUAGE_MISMATCH"),
        ("de", "true", "INVALID_RECORDING"),
        ("sv", "false", "CONSENT_REQUIRED"),
        ("sv", "TRUE", "CONSENT_REQUIRED"),
    ],
)
def test_language_and_explicit_consent_are_enforced(
    short_audio, language, consent, code
):
    app = make_app()
    with TestClient(app) as client:
        response = post_recording(
            client, short_audio[".wav"], language=language, consent=consent
        )
    assert_error(response, 422, code)


def test_truncated_multipart_is_rejected_and_closes_its_spool(monkeypatch):
    real_spooled_file = tempfile.SpooledTemporaryFile
    spools = []

    def tracking_spool(*args, **kwargs):
        spool = real_spooled_file(*args, **kwargs)
        spools.append(spool)
        return spool

    monkeypatch.setattr(starlette_formparsers, "SpooledTemporaryFile", tracking_spool)
    boundary = "memy-truncated"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="language"\r\n\r\n'
        "sv\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="consent"\r\n\r\n'
        "true\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="recording.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + b"RIFF-incomplete"
    app = make_app()
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers={
                **request_headers(),
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            content=body,
        )
    assert_error(response, 422, "INVALID_RECORDING")
    assert spools
    assert all(spool.closed for spool in spools)


@pytest.mark.parametrize(
    "scenario,expected_code",
    [
        ("valid", "TRANSCRIPTION_DISABLED"),
        ("corrupt", "INVALID_RECORDING"),
        ("probe_timeout", "AUDIO_PROCESSING_LIMIT"),
    ],
)
def test_server_temporary_directory_is_deleted_on_every_exit(
    monkeypatch, short_audio, scenario, expected_code
):
    paths = track_temporary_directories(monkeypatch)
    content = short_audio[".wav"] if scenario != "corrupt" else b"bad-wave"
    if scenario == "probe_timeout":
        seen_probe_paths = []

        async def timed_out_probe(path: Path, suffix: str):
            assert path.exists()
            seen_probe_paths.append(path)
            raise APIError(
                422,
                "AUDIO_PROCESSING_LIMIT",
                "Recording could not be processed within safe limits.",
            )

        monkeypatch.setattr(audio_upload, "probe_duration", timed_out_probe)
    app = make_app()
    with TestClient(app) as client:
        response = post_recording(client, content)
    expected_status = 503 if scenario == "valid" else 422
    assert_error(response, expected_status, expected_code)
    assert paths and all(not path.exists() for path in paths)
    if scenario == "probe_timeout":
        assert seen_probe_paths and all(not path.exists() for path in seen_probe_paths)


def test_upload_timeout_is_stable_and_cleans_temporary_directory(
    monkeypatch, short_audio
):
    paths = track_temporary_directories(monkeypatch)

    async def timeout_parse(self):
        raise TimeoutError

    monkeypatch.setattr(audio_upload.BoundedMultipartParser, "parse", timeout_parse)
    app = make_app()
    with TestClient(app) as client:
        response = post_recording(client, short_audio[".wav"])
    assert_error(response, 408, "UPLOAD_TIMEOUT")
    assert paths and all(not path.exists() for path in paths)


def test_decoder_timeout_kills_and_reaps_subprocess(monkeypatch, tmp_path):
    class HungProcess:
        def __init__(self):
            self.returncode = None
            self.killed = False
            self.waited = False

        async def communicate(self):
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True

        async def wait(self):
            self.waited = True
            self.returncode = -9
            return self.returncode

    process = HungProcess()

    async def create_process(*args, **kwargs):
        return process

    async def immediate_timeout(awaitable, *, timeout):
        awaitable.close()
        raise TimeoutError

    monkeypatch.setattr(audio_upload.asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(audio_upload.asyncio, "wait_for", immediate_timeout)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")
    with pytest.raises(APIError) as caught:
        asyncio.run(audio_upload.probe_duration(path, ".wav"))
    assert caught.value.status_code == 422
    assert caught.value.code == "AUDIO_PROCESSING_LIMIT"
    assert process.killed
    assert process.waited


def test_decoder_launch_uses_venv_executable_safe_paths_and_scrubbed_environment(
    monkeypatch, tmp_path
):
    captured = {}

    class CompletedProcess:
        returncode = 0

        async def communicate(self):
            return b'{"duration_seconds": 1.25}', b""

    async def create_process(*command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return CompletedProcess()

    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "must-not-reach-decoder")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-reach-decoder")
    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")
    monkeypatch.setenv("WINDIR", r"C:\Windows")
    monkeypatch.setattr(audio_upload, "windows_threaded_probe_required", lambda: False)
    monkeypatch.setattr(
        audio_upload.asyncio, "create_subprocess_exec", create_process
    )
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")

    duration = asyncio.run(audio_upload.probe_duration(path, ".wav"))

    assert duration == 1.25
    command = captured["command"]
    assert command[0] == os.path.abspath(audio_upload.sys.executable)
    assert command[0] == audio_upload.sys.executable
    assert Path(command[1]).is_absolute()
    assert Path(command[1]).name == "audio_probe.py"
    assert command[2] == str(path.resolve())
    assert command[3] == ".wav"
    assert captured["kwargs"]["cwd"] == str(tmp_path.resolve())
    assert captured["kwargs"]["env"] == {
        "SYSTEMROOT": r"C:\Windows",
        "WINDIR": r"C:\Windows",
        "PATH": os.defpath,
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    assert captured["kwargs"]["stdin"] == asyncio.subprocess.DEVNULL


def test_windows_decoder_timeout_kills_and_reaps_subprocess(monkeypatch, tmp_path):
    captured = {}

    class HungProcess:
        returncode = None

        def __init__(self, command, **kwargs):
            captured["command"] = command
            captured["kwargs"] = kwargs
            captured["process"] = self
            self.killed = False
            self.reaped = False

        def poll(self):
            return self.returncode

        def kill(self):
            self.killed = True

        def communicate(self, timeout=None):
            assert timeout is None
            self.reaped = True
            self.returncode = -9
            return b"", b""

    monkeypatch.setattr(audio_upload.subprocess, "Popen", HungProcess)
    monkeypatch.setattr(audio_upload, "PROBE_TIMEOUT_SECONDS", 0)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")
    stop_requested = threading.Event()

    result = audio_upload.run_windows_probe(
        audio_upload.probe_command(path, ".wav"),
        cwd=str(tmp_path),
        env=audio_upload.decoder_environment(),
        stop_requested=stop_requested,
    )

    assert result.timed_out
    assert captured["command"][2] == str(path.resolve())
    assert captured["kwargs"]["cwd"] == str(tmp_path)
    assert captured["kwargs"]["close_fds"] is True
    assert captured["process"].killed
    assert captured["process"].reaped


def test_windows_decoder_success_uses_threaded_runner(monkeypatch, tmp_path):
    captured = {}

    def completed(command, *, cwd, env, stop_requested):
        captured.update(command=command, cwd=cwd, env=env)
        assert not stop_requested.is_set()
        return audio_upload.ProbeProcessResult(
            0, b'{"duration_seconds": 1.5}'
        )

    monkeypatch.setattr(audio_upload, "windows_threaded_probe_required", lambda: True)
    monkeypatch.setattr(audio_upload, "run_windows_probe", completed)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")

    duration = asyncio.run(audio_upload.probe_duration(path, ".wav"))

    assert duration == 1.5
    assert captured["command"][2] == str(path.resolve())
    assert captured["cwd"] == str(tmp_path.resolve())
    assert "SUPABASE_PUBLISHABLE_KEY" not in captured["env"]


def test_windows_decoder_cancellation_waits_for_worker_cleanup(monkeypatch, tmp_path):
    started = threading.Event()
    stopped = threading.Event()

    def controlled_probe(command, *, cwd, env, stop_requested):
        started.set()
        assert stop_requested.wait(timeout=2)
        stopped.set()
        return audio_upload.ProbeProcessResult(-9, b"")

    monkeypatch.setattr(audio_upload, "windows_threaded_probe_required", lambda: True)
    monkeypatch.setattr(audio_upload, "run_windows_probe", controlled_probe)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")

    async def cancel_probe():
        task = asyncio.create_task(audio_upload.probe_duration(path, ".wav"))
        assert await asyncio.to_thread(started.wait, 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_probe())
    assert stopped.is_set()


def test_windows_decoder_launch_failure_is_stable_503(monkeypatch, tmp_path):
    def unavailable(*args, **kwargs):
        raise OSError("private process detail")

    monkeypatch.setattr(audio_upload, "windows_threaded_probe_required", lambda: True)
    monkeypatch.setattr(audio_upload, "run_windows_probe", unavailable)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")

    with pytest.raises(APIError) as caught:
        asyncio.run(audio_upload.probe_duration(path, ".wav"))

    assert caught.value.status_code == 503
    assert caught.value.code == "AUDIO_PROCESSING_UNAVAILABLE"
    assert "private process detail" not in caught.value.message


def test_busy_limit_rejects_before_body_decode(monkeypatch):
    async def body_must_not_be_read(*args, **kwargs):
        pytest.fail("busy request reached multipart decoding")

    class BusySlots:
        def locked(self):
            return True

        async def acquire(self):
            pytest.fail("locked semaphore must not be acquired")

        def release(self):
            pytest.fail("unacquired semaphore must not be released")

    monkeypatch.setattr(audio_api, "read_recording", body_must_not_be_read)
    app = make_app()
    with TestClient(app) as client:
        app.state.audio_slots = BusySlots()
        response = client.post(
            f"/api/v1/story-sessions/{SESSION_ID}/transcribe",
            headers=request_headers(),
            content=b"must remain unread",
        )
    assert_error(response, 429, "AUDIO_BUSY")
