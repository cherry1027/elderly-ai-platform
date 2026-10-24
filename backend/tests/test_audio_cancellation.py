"""Decoder cancellation must not strand a Unix subprocess or temp-file user."""

import asyncio

import pytest

from app.services import audio_upload


def test_unix_repeated_cancellation_waits_until_decoder_is_reaped(
    monkeypatch, tmp_path
):
    class BlockingProcess:
        def __init__(self):
            self.returncode = None
            self.communicate_started = asyncio.Event()
            self.wait_started = asyncio.Event()
            self.allow_reap = asyncio.Event()
            self.killed = False
            self.waited = False

        async def communicate(self):
            self.communicate_started.set()
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True

        async def wait(self):
            self.wait_started.set()
            await self.allow_reap.wait()
            self.waited = True
            self.returncode = -9
            return self.returncode

    process = BlockingProcess()

    async def create_process(*_args, **_kwargs):
        return process

    monkeypatch.setattr(audio_upload, "windows_threaded_probe_required", lambda: False)
    monkeypatch.setattr(audio_upload.asyncio, "create_subprocess_exec", create_process)
    path = tmp_path / "recording.wav"
    path.write_bytes(b"placeholder")

    async def exercise():
        task = asyncio.create_task(audio_upload.probe_duration(path, ".wav"))
        await process.communicate_started.wait()
        task.cancel()
        await process.wait_started.wait()

        # A second cancellation used to interrupt process.wait(), allowing the
        # request task to finish before the child had actually been reaped.
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        process.allow_reap.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    assert process.killed
    assert process.waited
    assert process.returncode == -9
