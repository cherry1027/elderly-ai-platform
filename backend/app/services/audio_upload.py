"""Bounded authenticated upload parsing and temporary recording lifecycle."""

import asyncio
import hashlib
import json
import math
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request
from python_multipart.multipart import parse_options_header
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect

from app.core.errors import APIError

MAX_AUDIO_BYTES = 25_000_000
MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 16_384
PROBE_TIMEOUT_SECONDS = 12
WINDOWS_PROBE_POLL_SECONDS = 0.05
MIME_TYPES = {
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    ".mp3": {"audio/mpeg", "audio/mp3"},
    ".m4a": {"audio/mp4", "audio/m4a", "audio/x-m4a"},
    ".webm": {"audio/webm"},
}


def invalid_upload() -> APIError:
    return APIError(422, "INVALID_RECORDING", "A valid, nonempty audio recording is required.")


async def close_multipart_form(form: FormData) -> None:
    """Finish spool cleanup before a cancelled request removes its temp directory."""
    closer = asyncio.create_task(form.close())
    cancelled = False
    while not closer.done():
        try:
            await asyncio.shield(closer)
        except asyncio.CancelledError:
            # A rolled spool closes through a worker thread. Repeated request
            # cancellation must not interrupt that cleanup (especially on
            # Windows, where an open handle can prevent directory removal).
            cancelled = True
    closer.result()
    if cancelled:
        raise asyncio.CancelledError


class BoundedMultipartParser(MultiPartParser):
    """Also limit headers and reject truncated multipart documents."""

    ended = False
    header_bytes = 0

    def on_part_begin(self):
        self.header_bytes = 0
        super().on_part_begin()

    def _header_limit(self, size):
        self.header_bytes += size
        if self.header_bytes > 8192:
            raise MultiPartException("Multipart headers are too large.")

    def on_header_field(self, data, start, end):
        self._header_limit(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self._header_limit(end - start)
        super().on_header_value(data, start, end)

    def on_end(self):
        self.ended = True

    async def parse(self):
        form = await super().parse()
        if not self.ended:
            # python-multipart.finalize() does not reject a truncated last
            # part. Such a spool is not yet present in FormData, so close the
            # parser's tracked spools as well (Starlette 1.8 parser contract).
            try:
                await close_multipart_form(form)
            finally:
                for spool in self._files_to_close_on_error:
                    spool.close()
            raise MultiPartException("Incomplete multipart document.")
        return form


@dataclass(frozen=True)
class Recording:
    path: Path
    language: str
    content_sha256: str
    duration_seconds: float


@dataclass(frozen=True)
class ProbeProcessResult:
    returncode: int
    output: bytes
    timed_out: bool = False


def decoder_environment() -> dict[str, str]:
    """Return the decoder's intentionally minimal, credential-free environment."""
    environment = {
        key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR") if key in os.environ
    }
    environment.update({
        "PATH": os.defpath,
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    return environment


def probe_command(path: Path, suffix: str) -> tuple[str, str, str, str]:
    # Keep a virtualenv's interpreter symlink intact; resolving it can bypass
    # that environment and lose the PyAV dependency installed beside the app.
    executable = os.path.abspath(sys.executable)
    script = str(Path(__file__).with_name("audio_probe.py").resolve())
    return executable, script, str(path.resolve()), suffix


def windows_threaded_probe_required() -> bool:
    """Windows selector loops used by reload/workers cannot spawn asyncio children."""
    return sys.platform == "win32"


def _kill_and_reap(process: subprocess.Popen[bytes]) -> bytes:
    if process.poll() is None:
        process.kill()
    output, _ = process.communicate()
    return output


def run_windows_probe(
    command: tuple[str, str, str, str],
    *,
    cwd: str,
    env: dict[str, str],
    stop_requested: threading.Event,
) -> ProbeProcessResult:
    """Run one decoder without relying on the event loop's subprocess support."""
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=cwd,
        env=env,
        close_fds=True,
    )
    deadline = time.monotonic() + PROBE_TIMEOUT_SECONDS
    try:
        while True:
            if stop_requested.is_set():
                output = _kill_and_reap(process)
                return ProbeProcessResult(process.returncode or -1, output)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                output = _kill_and_reap(process)
                return ProbeProcessResult(
                    process.returncode or -1, output, timed_out=True
                )
            try:
                output, _ = process.communicate(
                    timeout=min(WINDOWS_PROBE_POLL_SECONDS, remaining)
                )
                return ProbeProcessResult(process.returncode or 0, output)
            except subprocess.TimeoutExpired:
                continue
    finally:
        if process.poll() is None:
            _kill_and_reap(process)


async def run_windows_probe_async(
    command: tuple[str, str, str, str], *, cwd: str, env: dict[str, str]
) -> ProbeProcessResult:
    stop_requested = threading.Event()
    worker = asyncio.create_task(asyncio.to_thread(
        run_windows_probe,
        command,
        cwd=cwd,
        env=env,
        stop_requested=stop_requested,
    ))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        stop_requested.set()
        # Keep the temporary recording alive until the child is reaped. Repeated
        # cancellation must not strand the worker or a locked file on Windows.
        while not worker.done():
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        try:
            worker.result()
        except Exception:
            pass
        raise


async def kill_and_reap_asyncio_process(process) -> None:
    """Kill and reap a decoder even when request cancellation is repeated."""
    if process.returncode is not None:
        return
    try:
        process.kill()
    except ProcessLookupError:
        # The child may exit between the return-code check and the signal. It
        # still needs wait() below so the transport/process is fully reaped.
        pass

    waiter = asyncio.create_task(process.wait())
    cancelled = False
    while not waiter.done():
        try:
            await asyncio.shield(waiter)
        except asyncio.CancelledError:
            # Keep the cleanup alive, but restore cancellation once the child
            # has been reaped. This also handles a second shutdown/disconnect
            # cancellation while an earlier cancellation is already unwinding.
            cancelled = True
            continue
    waiter.result()
    if cancelled:
        raise asyncio.CancelledError


async def probe_duration(path: Path, suffix: str) -> float:
    command = probe_command(path, suffix)
    cwd = str(path.parent.resolve())
    env = decoder_environment()
    try:
        if windows_threaded_probe_required():
            result = await run_windows_probe_async(command, cwd=cwd, env=env)
            if result.timed_out:
                raise APIError(
                    422,
                    "AUDIO_PROCESSING_LIMIT",
                    "Recording could not be processed within safe limits.",
                )
            returncode, output = result.returncode, result.output
            process = None
        else:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
    except (OSError, NotImplementedError):
        raise APIError(503, "AUDIO_PROCESSING_UNAVAILABLE", "Audio processing is temporarily unavailable.") from None
    if process is not None:
        try:
            output, _ = await asyncio.wait_for(
                process.communicate(), timeout=PROBE_TIMEOUT_SECONDS
            )
        except TimeoutError:
            raise APIError(422, "AUDIO_PROCESSING_LIMIT", "Recording could not be processed within safe limits.") from None
        finally:
            if process.returncode is None:
                await kill_and_reap_asyncio_process(process)
        returncode = process.returncode
    if returncode == 3:
        raise APIError(422, "RECORDING_TOO_LONG", "Recordings must not exceed 90 seconds.")
    if returncode != 0:
        raise invalid_upload()
    try:
        duration = float(json.loads(output)["duration_seconds"])
        if not math.isfinite(duration) or not 0 < duration <= 90:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise invalid_upload() from None
    return duration


async def read_recording(request: Request, directory: Path, session_language: str) -> Recording:
    content_type, params = parse_options_header(request.headers.get("content-type", ""))
    if content_type != b"multipart/form-data":
        raise APIError(415, "UNSUPPORTED_MEDIA_TYPE", "Use multipart/form-data with an audio file.")
    boundary = params.get(b"boundary", b"")
    if not boundary or len(boundary) > 200:
        raise invalid_upload()
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
            if size < 0:
                raise ValueError
        except ValueError:
            raise invalid_upload() from None
        if size > MAX_REQUEST_BYTES:
            raise APIError(413, "RECORDING_TOO_LARGE", "Recordings must not exceed 25 MB.")

    async def bounded_stream():
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > MAX_REQUEST_BYTES:
                raise APIError(413, "RECORDING_TOO_LARGE", "Recordings must not exceed 25 MB.")
            yield chunk

    parser = BoundedMultipartParser(
        request.headers, bounded_stream(), max_files=1, max_fields=2, max_part_size=256,
    )
    form = None
    try:
        async with asyncio.timeout(30):
            form = await parser.parse()
        if not parser.ended:
            raise invalid_upload()
        parts = form.multi_items()
        if len(parts) != 3 or sorted(key for key, _ in parts) != ["consent", "file", "language"]:
            raise invalid_upload()
        if form["consent"] != "true":
            raise APIError(422, "CONSENT_REQUIRED", "Explicit transcription consent is required.")
        language = form["language"]
        if language not in ("en", "sv"):
            raise invalid_upload()
        if language != session_language:
            raise APIError(422, "LANGUAGE_MISMATCH", "Recording language must match the session language.")
        upload = form["file"]
        if not isinstance(upload, UploadFile):
            raise invalid_upload()
        name = upload.filename or ""
        suffix = Path(name).suffix.lower()
        if len(name) > 128 or "/" in name or "\\" in name or "\0" in name:
            raise invalid_upload()
        if suffix not in MIME_TYPES or upload.content_type not in MIME_TYPES[suffix]:
            raise APIError(415, "UNSUPPORTED_AUDIO_FORMAT", "Use WAV, MP3, M4A or audio-only WebM.")
        if not upload.size:
            raise invalid_upload()
        if upload.size > MAX_AUDIO_BYTES:
            raise APIError(413, "RECORDING_TOO_LARGE", "Recordings must not exceed 25 MB.")
        path = directory / ("recording" + suffix)
        digest = hashlib.sha256()
        # The directory is server-created (0700); never use a client path/name.
        with open(path, "xb", opener=lambda name, flags: os.open(name, flags, 0o600)) as destination:
            while chunk := await upload.read(64 * 1024):
                digest.update(chunk)
                destination.write(chunk)
        duration = await probe_duration(path, suffix)
        return Recording(path, language, digest.hexdigest(), duration)
    except TimeoutError:
        raise APIError(408, "UPLOAD_TIMEOUT", "Recording upload timed out.") from None
    except (MultiPartException, ClientDisconnect, ValueError):
        raise invalid_upload() from None
    finally:
        if form is not None:
            await close_multipart_form(form)
