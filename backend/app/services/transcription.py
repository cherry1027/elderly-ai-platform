"""No paid provider is configured. Test doubles are injected only in tests."""

from pathlib import Path
from typing import Protocol

from app.core.errors import APIError


class TranscriptionProvider(Protocol):
    enabled: bool

    async def transcribe(self, path: Path, language: str) -> str: ...


class DisabledTranscriptionProvider:
    enabled = False

    async def transcribe(self, path: Path, language: str) -> str:
        raise APIError(503, "TRANSCRIPTION_DISABLED", "Live speech transcription is not enabled.")
