"""Disabled by default; an explicit development launcher can inject simulation.

Simulation is a fixed fictional fixture, not speech recognition. This module has
no external provider, network client, audio retention or provider-key handling.
"""

from pathlib import Path
from types import MappingProxyType
from typing import Protocol

from app.core.errors import APIError


class TranscriptionProvider(Protocol):
    enabled: bool

    async def transcribe(self, path: Path, language: str) -> str: ...


class DisabledTranscriptionProvider:
    enabled = False

    async def transcribe(self, path: Path, language: str) -> str:
        raise APIError(503, "TRANSCRIPTION_DISABLED", "Live speech transcription is not enabled.")


SIMULATED_TRANSCRIPT_NOTICE = (
    "[SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — FICTIONAL / FIKTIVT. "
    "Not derived from uploaded audio / Inte baserat på uppladdat ljud.]\n"
)
SIMULATED_TRANSCRIPTS = MappingProxyType({
    "en": SIMULATED_TRANSCRIPT_NOTICE + "I moved to Malmö in 1974. I worked as a teacher.",
    "sv": SIMULATED_TRANSCRIPT_NOTICE + "Jag flyttade till Malmö 1974. Jag arbetade som lärare.",
})


class SimulatedTranscriptionProvider:
    """Return a permanently labelled fixture after the route validates audio.

    The upload endpoint still authenticates, checks ownership and consent, and
    decodes/bounds the recording before invoking this adapter. The adapter itself
    deliberately never opens or interprets ``path``. The bilingual notice remains
    part of immutable stored text, including subsequent GETs and completed retries.
    Only the dedicated development launcher explicitly opts into this provider.
    """

    enabled = True
    mode = "simulated"

    async def transcribe(self, path: Path, language: str) -> str:
        if language not in SIMULATED_TRANSCRIPTS:
            raise ValueError("Simulated transcription requires English or Swedish.")
        return SIMULATED_TRANSCRIPTS[language]
