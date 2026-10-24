"""Opt-in simulation is deterministic and never recognizes or modifies audio."""

import asyncio
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from app.services.transcription import (
    DisabledTranscriptionProvider,
    SIMULATED_TRANSCRIPT_NOTICE,
    SIMULATED_TRANSCRIPTS,
    SimulatedTranscriptionProvider,
)


@pytest.mark.parametrize("language", ["en", "sv"])
@pytest.mark.parametrize("content", [b"", b"fictional recording one", b"different bytes\x00\xff"])
def test_simulation_returns_fixed_notice_and_language_fixture_without_mutating_file(tmp_path, language, content):
    path = tmp_path / "recording.m4a"
    path.write_bytes(content)
    original_modified_time = path.stat().st_mtime_ns
    provider = SimulatedTranscriptionProvider()

    result = asyncio.run(provider.transcribe(path, language))

    assert provider.enabled is True
    assert provider.mode == "simulated"
    assert result == SIMULATED_TRANSCRIPTS[language]
    assert result.startswith(SIMULATED_TRANSCRIPT_NOTICE)
    assert "SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION" in result
    assert "FICTIONAL / FIKTIVT" in result
    assert "Not derived from uploaded audio / Inte baserat på uppladdat ljud." in result
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == original_modified_time
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("language", ["en", "sv"])
def test_adapter_does_not_open_audio_or_contact_any_http_provider(monkeypatch, tmp_path, language):
    def forbidden_file_open(*_args, **_kwargs):
        pytest.fail("simulation must not read or write audio")

    async def forbidden_request(*_args, **_kwargs):
        pytest.fail("simulation must not contact any HTTP provider")

    monkeypatch.setattr(Path, "open", forbidden_file_open)
    monkeypatch.setattr(httpx.AsyncClient, "request", forbidden_request)
    # The HTTP upload route, not this fixture adapter, validates real bytes.
    result = asyncio.run(SimulatedTranscriptionProvider().transcribe(tmp_path / "not-opened.m4a", language))
    assert result == SIMULATED_TRANSCRIPTS[language]


@pytest.mark.parametrize("language", ["", "de", "EN", "SV", "en ", "sv\n"])
def test_simulation_rejects_unsupported_language(language, tmp_path):
    with pytest.raises(ValueError, match="English or Swedish"):
        asyncio.run(SimulatedTranscriptionProvider().transcribe(tmp_path / "unused.m4a", language))


def test_fixture_bodies_are_exact_and_notice_cannot_be_removed_by_mutating_constants():
    assert SIMULATED_TRANSCRIPTS["en"] == (
        SIMULATED_TRANSCRIPT_NOTICE + "I moved to Malmö in 1974. I worked as a teacher."
    )
    assert SIMULATED_TRANSCRIPTS["sv"] == (
        SIMULATED_TRANSCRIPT_NOTICE + "Jag flyttade till Malmö 1974. Jag arbetade som lärare."
    )
    with pytest.raises(TypeError):
        SIMULATED_TRANSCRIPTS["en"] = "Unlabelled replacement"


def test_ordinary_app_remains_disabled_even_with_simulation_environment_values(monkeypatch):
    monkeypatch.setenv("TRANSCRIPTION_MODE", "simulated")
    monkeypatch.setenv("MEMY_SIMULATE_TRANSCRIPTION", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-unused-provider-key")
    app = create_app(Settings(_env_file=None))
    assert isinstance(app.state.transcription_provider, DisabledTranscriptionProvider)
    assert app.state.transcription_provider.enabled is False
