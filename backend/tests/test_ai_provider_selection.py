"""Closed defaults and evaluation CLI fences, never real provider I/O."""

import asyncio
from argparse import Namespace
import json

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.services.ai_providers import evaluation_providers
from scripts import evaluate_ai


def test_key_presence_never_enables_public_ai_or_evaluation():
    settings = Settings(_env_file=None, openai_api_key="synthetic-not-a-real-key")
    assert "synthetic-not-a-real-key" not in repr(settings)
    providers = evaluation_providers(settings)
    assert providers.mode == "disabled" and not providers.transcription.enabled
    assert providers.conversation.mode == providers.story.mode == "disabled"
    app = create_app(settings)
    assert app.state.story_writer.mode == app.state.conversation_provider.mode == "disabled"
    assert not app.state.transcription_provider.enabled


def test_explicit_mock_evaluation_retains_permanent_simulation_notice():
    providers = evaluation_providers(Settings(_env_file=None, ai_provider_mode="mock"))
    from pathlib import Path
    text = asyncio.run(providers.transcription.transcribe(Path("never-read.wav"), "sv"))
    assert "SIMULATED TRANSCRIPT" in text
    assert providers.conversation.mode == providers.story.mode == "mock"


def test_openai_mode_without_written_approval_remains_closed_even_with_key():
    with pytest.raises(APIError) as error:
        evaluation_providers(Settings(_env_file=None, ai_provider_mode="openai",
                                      openai_api_key="synthetic-key", openai_text_model="test-model"))
    assert error.value.code == "AI_SPENDING_NOT_APPROVED"


def test_openai_evaluation_cannot_be_started_as_mock_labelled_public_api():
    with pytest.raises(ValueError, match="cannot start the mock-only public API"):
        create_app(Settings(_env_file=None, ai_provider_mode="openai"))


@pytest.mark.parametrize("argument", ["transcription_provider", "conversation_provider", "story_writer"])
def test_injected_openai_adapter_cannot_bypass_public_release_gate(argument):
    class OpenAIAdapter:
        mode = "openai"
        enabled = True
    with pytest.raises(ValueError, match="cannot start the mock-only public API"):
        create_app(Settings(_env_file=None), **{argument: OpenAIAdapter()})


def test_offline_evaluation_does_not_load_credentials_or_build_live_providers(monkeypatch, capsys):
    def forbidden(*args, **kwargs):
        pytest.fail("offline evaluation loaded live configuration")
    monkeypatch.setattr(evaluate_ai, "Settings", forbidden)
    monkeypatch.setattr(evaluate_ai, "evaluation_providers", forbidden)
    assert evaluate_ai.main([]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["paid_calls"] == 0 and result["quality_status"] == "NOT_RUN"


def test_live_evaluation_requires_separate_upload_consent_before_config(monkeypatch, capsys):
    monkeypatch.setattr(evaluate_ai, "Settings", lambda: pytest.fail("no consent"))
    assert evaluate_ai.main(["--live"]) == 2
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "AI_EVALUATION_CONSENT_REQUIRED"


def test_provisioning_a_key_does_not_authorize_evaluation(monkeypatch, capsys):
    monkeypatch.setattr(evaluate_ai, "Settings", lambda: Settings(_env_file=None,
        openai_api_key=SecretStr("synthetic-key"), ai_provider_mode="disabled"))
    assert evaluate_ai.main(["--live", "--consent-to-provider-upload", "--audio-directory", "/never-read"]) == 2
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "AI_SPENDING_NOT_APPROVED"


@pytest.mark.parametrize("reference,actual,expected", [
    ("Jag växte upp i Malmö.", "jag växte upp i Malmö!", 0),
    ("My name is Ada", "My name was Ada", .25),
    ("Ada Malmö", "Ada", .5),
    ("Ada", "Ada in Malmö", 2),
])
def test_word_error_metric_is_bounded_per_reference_not_a_quality_pass(reference, actual, expected):
    assert evaluate_ai.word_error_rate(reference, actual) == expected


def test_prepared_dataset_and_local_builder_use_identical_fictional_references():
    from pathlib import Path
    from scripts.prepare_ai_evaluation import REFERENCES
    data = json.loads((Path(__file__).resolve().parents[2] / "docs/fixtures/day12-ai-evaluation.json").read_text())
    assert data["quality_status"] == "NOT_RUN" and data["fictional_only"] is True
    assert {record["language"]: record["reference"] for record in data["recordings"]} == REFERENCES


def test_complete_evaluation_harness_uses_explicit_fake_providers_and_prints_no_prose(tmp_path, monkeypatch, capsys):
    from types import SimpleNamespace
    from app.services.conversation_provider import FactCandidate, ProviderResult
    from scripts.prepare_ai_evaluation import REFERENCES
    calls = []
    for language in REFERENCES:
        (tmp_path / f"fictional-{language}.wav").write_bytes(b"offline placeholder, probe replaced")

    async def probe(path, suffix):
        calls.append("probe")
        return .1

    class FakeTranscription:
        async def transcribe(self, path, language):
            assert calls[:2] == ["probe", "probe"]
            return REFERENCES[language]

    class FakeConversation:
        async def respond(self, text, language, prior):
            facts = []
            if prior:
                facts = [FactCandidate("event", "1975", "1975", 1975, "move", True,
                                       "A fictional clarification?", prior[0]["id"])]
            return ProviderResult("synthetic-private-reply-not-for-output", facts)

    class FakeStory:
        async def write(self, language, style, sources):
            return "synthetic-private-story-not-for-output"

        async def verify_candidate(self, content, language, sources):
            raise APIError(422, "DRAFT_VERIFICATION_FAILED", "Unsupported content.")

    monkeypatch.setattr(evaluate_ai, "probe_duration", probe)
    monkeypatch.setattr(evaluate_ai, "Settings", lambda: SimpleNamespace(ai_provider_mode="openai"))
    monkeypatch.setattr(evaluate_ai, "evaluation_providers", lambda _: SimpleNamespace(
        transcription=FakeTranscription(), conversation=FakeConversation(), story=FakeStory()))
    assert evaluate_ai.main(["--live", "--consent-to-provider-upload", "--audio-directory", str(tmp_path)]) == 0
    output = capsys.readouterr().out
    report = json.loads(output)
    assert "synthetic-private" not in output
    assert report["quality_status"] == "HUMAN_REVIEW_REQUIRED"
    assert len(report["results"]) == 2
    assert all(row["word_error_rate"] == 0 and row["unsupported_story_rejected"]
               and row["contradiction_flagged"] for row in report["results"])
