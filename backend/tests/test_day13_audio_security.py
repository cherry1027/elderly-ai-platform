"""Offline raw-audio cleanup, isolation and cancellation security checks."""

import asyncio
import os
import stat
import tempfile
from pathlib import Path

import pytest
import starlette.formparsers as starlette_formparsers
from starlette.datastructures import FormData, Headers, UploadFile
from starlette.requests import ClientDisconnect, Request

from app.core.errors import APIError
from app.services import audio_upload


BOUNDARY = "memy-day13-boundary"


def multipart(content=b"fictional-audio", filename="recording.wav"):
    return (
        f"--{BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="language"\r\n\r\n'
        "en\r\n"
        f"--{BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="consent"\r\n\r\n'
        "true\r\n"
        f"--{BOUNDARY}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + content + f"\r\n--{BOUNDARY}--\r\n".encode()


def make_request(body):
    sent = False

    async def receive():
        nonlocal sent
        assert not sent
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({
        "type": "http", "method": "POST", "path": "/", "headers": [
            (b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode()),
        ],
    }, receive)


@pytest.mark.parametrize("failure", [
    RuntimeError("request failed"),
    APIError(413, "RECORDING_TOO_LARGE", "Too large."),
    ClientDisconnect(),
    asyncio.CancelledError(),
])
def test_partial_rolled_upload_is_closed_on_every_stream_failure(monkeypatch, failure):
    spools = []
    real_spool = tempfile.SpooledTemporaryFile

    def tracked_spool(*args, **kwargs):
        result = real_spool(*args, **kwargs)
        spools.append(result)
        return result

    monkeypatch.setattr(starlette_formparsers, "SpooledTemporaryFile", tracked_spool)

    async def stream():
        # Omit the closing boundary to leave a partial upload on disk.
        yield multipart(b"a" * 1_100_000).rsplit(f"\r\n--{BOUNDARY}--".encode(), 1)[0]
        raise failure

    parser = audio_upload.BoundedMultipartParser(
        Headers({"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}),
        stream(), max_files=1, max_fields=2, max_part_size=256,
    )
    with pytest.raises(type(failure)):
        asyncio.run(parser.parse())
    assert len(spools) == 1
    assert spools[0]._rolled
    assert spools[0].closed


def test_repeated_cancellation_waits_for_multipart_file_close(monkeypatch, tmp_path):
    original_close = FormData.close
    probe_started = asyncio.Event()
    close_started = asyncio.Event()
    allow_close = asyncio.Event()
    closed_uploads = []

    async def probe(*_args):
        probe_started.set()
        await asyncio.Event().wait()

    async def gated_close(form):
        close_started.set()
        await allow_close.wait()
        await original_close(form)
        closed_uploads.extend(value for _, value in form.multi_items() if isinstance(value, UploadFile))

    monkeypatch.setattr(audio_upload, "probe_duration", probe)
    monkeypatch.setattr(FormData, "close", gated_close)

    async def exercise():
        task = asyncio.create_task(audio_upload.read_recording(make_request(multipart()), tmp_path, "en"))
        await probe_started.wait()
        task.cancel()
        await close_started.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done(), "request escaped while multipart spool cleanup was still running"
        allow_close.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    assert len(closed_uploads) == 1
    assert closed_uploads[0].file.closed


def test_cancelled_truncated_upload_also_closes_incomplete_part(monkeypatch):
    spools = []
    real_spool = tempfile.SpooledTemporaryFile
    close_started = asyncio.Event()
    allow_close = asyncio.Event()

    def tracked_spool(*args, **kwargs):
        result = real_spool(*args, **kwargs)
        spools.append(result)
        return result

    async def gated_close(_form):
        # The incomplete file is not in FormData yet, but is still tracked by
        # the parser and must close even when normal form cleanup is cancelled.
        close_started.set()
        await allow_close.wait()

    async def stream():
        yield multipart().rsplit(f"\r\n--{BOUNDARY}--".encode(), 1)[0]

    monkeypatch.setattr(starlette_formparsers, "SpooledTemporaryFile", tracked_spool)
    monkeypatch.setattr(FormData, "close", gated_close)
    parser = audio_upload.BoundedMultipartParser(
        Headers({"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}), stream(),
    )

    async def exercise():
        task = asyncio.create_task(parser.parse())
        await close_started.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        allow_close.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    assert len(spools) == 1
    assert spools[0].closed


def test_concurrent_recordings_are_private_and_isolated(monkeypatch):
    async def probe(path, suffix):
        await asyncio.sleep(0)
        assert suffix == ".wav"
        return 1.0

    monkeypatch.setattr(audio_upload, "probe_duration", probe)

    async def exercise():
        with tempfile.TemporaryDirectory(prefix="memy-security-a-") as first:
            with tempfile.TemporaryDirectory(prefix="memy-security-b-") as second:
                first_path, second_path = Path(first), Path(second)
                recordings = await asyncio.gather(
                    audio_upload.read_recording(make_request(multipart(b"first")), first_path, "en"),
                    audio_upload.read_recording(make_request(multipart(b"second")), second_path, "en"),
                )
                assert [item.path.read_bytes() for item in recordings] == [b"first", b"second"]
                assert recordings[0].path != recordings[1].path
                assert recordings[0].content_sha256 != recordings[1].content_sha256
                if os.name != "nt":
                    assert all(stat.S_IMODE(item.path.parent.stat().st_mode) == 0o700 for item in recordings)
                    assert all(stat.S_IMODE(item.path.stat().st_mode) == 0o600 for item in recordings)
                paths = [item.path for item in recordings]
        assert all(not path.exists() for path in paths)

    # A permissive process umask must not make a raw recording world-readable.
    previous = os.umask(0)
    try:
        asyncio.run(exercise())
    finally:
        os.umask(previous)


@pytest.mark.parametrize("filename", ["../recording.wav", "folder/recording.wav", "a" * 129 + ".wav"])
def test_client_filename_never_controls_server_path(monkeypatch, tmp_path, filename):
    async def forbidden_probe(*_args):
        pytest.fail("invalid client path reached the decoder")

    monkeypatch.setattr(audio_upload, "probe_duration", forbidden_probe)
    with pytest.raises(APIError) as result:
        asyncio.run(audio_upload.read_recording(make_request(multipart(filename=filename)), tmp_path, "en"))
    assert result.value.code == "INVALID_RECORDING"
    assert list(tmp_path.iterdir()) == []
