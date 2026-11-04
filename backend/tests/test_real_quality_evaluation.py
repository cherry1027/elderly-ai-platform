"""Evaluation wiring/scoring tests are not evidence of real model quality."""

import argparse
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.core.errors import APIError
from app.services.ai_controls import ai_budget_subject
from scripts import evaluate_real_ai as evaluation


def arguments(tmp_path, **changes):
    return argparse.Namespace(**{"live": False, "consent_to_provider_upload": False,
        "include_speech": False, "audio_directory": tmp_path, **changes})


def test_offline_report_never_constructs_provider_and_cannot_claim_quality_pass(tmp_path):
    def forbidden(*args):
        pytest.fail("Offline evaluation must never construct a paid adapter")
    report = asyncio.run(evaluation.evaluate(arguments(tmp_path), runtime_factory=forbidden))
    assert report["paid_calls"] == 0 and report["quality_status"] == "NOT_RUN"
    assert report["languages"] == ["en", "sv"]
    assert "actual device acceptance" in report["does_not_certify"]


@pytest.mark.parametrize("consent,enabled,text_only", [(False, True, False), (True, False, False), (True, True, True)])
def test_live_preconditions_fail_before_provider_or_file_upload(tmp_path, consent, enabled, text_only):
    settings = Settings(_env_file=None, real_ai_enabled=enabled, real_ai_text_only=text_only)
    def forbidden(*args):
        pytest.fail("Rejected evaluation must never construct a paid adapter")
    with pytest.raises(APIError):
        asyncio.run(evaluation.evaluate(arguments(tmp_path, live=True, consent_to_provider_upload=consent),
            settings=settings, runtime_factory=forbidden))


def test_entity_scoring_does_not_hide_missing_names_or_spoken_number_mismatch():
    result = evaluation.score_transcription("My name is Ada. I grew up in Malmö in 1974.",
        "My name is Anna. I grew up in Malmo in nineteen seventy four.")
    assert result["word_error_rate"] > 0
    assert not any(result["fixture_entity_matches"].values())
    assert result["human_accuracy_review"] == "PENDING"


def test_all_audio_is_validated_before_provider_construction(tmp_path, monkeypatch):
    (tmp_path / "fictional-en.wav").write_bytes(b"a" * 44)
    probes = []
    async def probe(path, suffix):
        probes.append(path.name)
    monkeypatch.setattr(evaluation, "probe_duration", probe)
    def forbidden(*args):
        pytest.fail("Missing second fixture must prevent all provider work")
    with pytest.raises(APIError) as failure:
        asyncio.run(evaluation.evaluate(arguments(tmp_path, live=True, consent_to_provider_upload=True),
            settings=Settings(_env_file=None, real_ai_enabled=True), runtime_factory=forbidden))
    assert failure.value.code == "INVALID_RECORDING" and probes == ["fictional-en.wav"]


def test_partial_live_failure_stops_next_language_and_preserves_subject_cleanup(tmp_path, monkeypatch):
    for language in ("en", "sv"):
        (tmp_path / f"fictional-{language}.wav").write_bytes(b"a" * 44)
    async def probe(*args):
        return 1.0
    monkeypatch.setattr(evaluation, "probe_duration", probe)
    calls, closed, preflight = [], [], []
    class Provider:
        async def transcribe(self, path, language):
            calls.append(("transcribe", language, ai_budget_subject.get()))
            return evaluation.REFERENCES[language]
        async def respond(self, *args):
            raise APIError(503, "AI_PROVIDER_TIMEOUT", "Private upstream text must not leak")
    runtime = SimpleNamespace(require=lambda: Provider(),
        governor=SimpleNamespace(check_budget=lambda **kwargs: preflight.append(kwargs)),
        cache=SimpleNamespace(close=lambda: closed.append(True)))
    report = asyncio.run(evaluation.evaluate(arguments(tmp_path, live=True, consent_to_provider_upload=True),
        settings=Settings(_env_file=None, real_ai_enabled=True), runtime_factory=lambda _: runtime))
    assert report["quality_status"] == "INCOMPLETE"
    assert report["results"][0]["completed_stages"] == ["transcription"]
    assert report["results"][0]["error_code"] == "AI_PROVIDER_TIMEOUT"
    assert calls == [("transcribe", "en", str(evaluation.EVALUATION_SUBJECT))]
    assert preflight == [{"required_calls": 18}] and closed == [True]
    assert ai_budget_subject.get() is None
    assert "Private upstream" not in json.dumps(report)
    assert evaluation.REFERENCES["en"] not in json.dumps(report)
