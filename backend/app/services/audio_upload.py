"""Bounded authenticated upload parsing and temporary recording lifecycle."""

import asyncio
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request
from python_multipart.multipart import parse_options_header
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect

from app.core.errors import APIError

MAX_AUDIO_BYTES = 25_000_000
MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 16_384
MIME_TYPES = {
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    ".mp3": {"audio/mpeg", "audio/mp3"},
    ".m4a": {"audio/mp4", "audio/m4a", "audio/x-m4a"},
    ".webm": {"audio/webm"},
}


def invalid_upload() -> APIError:
    return APIError(422, "INVALID_RECORDING", "A valid, nonempty audio recording is required.")


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
            await form.close()
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


async def probe_duration(path: Path, suffix: str) -> float:
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.services.audio_probe", str(path), suffix,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            cwd=str(Path(__file__).resolve().parents[2]),
        )
    except (OSError, NotImplementedError):
        raise APIError(503, "AUDIO_PROCESSING_UNAVAILABLE", "Audio processing is temporarily unavailable.") from None
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=12)
    except TimeoutError:
        raise APIError(422, "AUDIO_PROCESSING_LIMIT", "Recording could not be processed within safe limits.") from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode == 3:
        raise APIError(422, "RECORDING_TOO_LONG", "Recordings must not exceed 90 seconds.")
    if process.returncode != 0:
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
        with path.open("xb") as destination:
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
            await form.close()
