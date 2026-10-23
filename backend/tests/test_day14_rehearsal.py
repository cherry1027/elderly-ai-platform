"""Day 14 integrated rehearsal is offline evidence, never a device/RLS sign-off."""

import asyncio
import json

import httpx
import pytest

from scripts import verify_day14 as rehearsal


@pytest.fixture(scope="module")
def bilingual_report():
    return rehearsal.run_rehearsal()


@pytest.mark.parametrize("language", ["en", "sv"])
def test_bilingual_real_routes_cover_the_complete_mock_lifecycle(bilingual_report, language):
    offline = bilingual_report["backend_offline"]
    assert offline["status"] == "PASS", offline["failed_check"]
    assert offline["paid_calls"] == 0
    checks = {item["check"]: item["status"] for item in offline["checks"]}
    for name in (
        "exact_validated_m4a_fingerprint", "exact_persistent_simulation_notice",
        "recover_committed_upload_same_key", "no_duplicate_upload_or_provider_call",
        "temporary_audio_removed", "immutable_transcript_round_trip",
        "source_and_mock_provenance_preserved", "no_duplicate_conversation_turn",
        "extraction_pending_not_auto_confirmed", "correct_and_confirm_memory",
        "correction_preserves_original_evidence", "reject_memory",
        "review_does_not_generate_story", "explicit_generation_consent_required",
        "only_confirmed_corrected_sources_generate", "no_duplicate_draft",
        "same_context_no_extra_story_version", "manual_edit_marks_unverified",
        "edit_replay_no_extra_revision", "stale_different_edit_denied",
        "exact_edit_history_preserved", "private_pdf_export", "historical_pdf_exact_bytes",
        "notice_survives_reconnect", "continue_no_duplicate_session_or_generation",
        "confirm_without_correction", "new_confirmation_does_not_regenerate",
        "new_version_keeps_old_draft", "historical_draft_is_unchanged_and_stale",
        "foreign_audio_denied", "foreign_memory_edit_denied", "foreign_read_denied",
        "foreign_continue_denied", "invalid_auth_denied", "missing_auth_denied",
        "request_language_mismatch_denied", "brief_language_switch_keeps_selection",
        "project_session_draft_language_stable", "original_audio_source_never_overwritten",
    ):
        assert checks[f"{language}:{name}"] == "PASS"
    assert offline["checks_passed"] >= 140


def test_offline_success_cannot_claim_hosted_or_real_iphone_acceptance(bilingual_report):
    assert bilingual_report["backend_offline"]["status"] == "PASS"
    assert bilingual_report["hosted_supabase"]["status"] == "NOT_RUN"
    assert bilingual_report["real_iphone"]["status"] == "PENDING"
    assert bilingual_report["overall"] == "PENDING_HOSTED_AND_DEVICE_ACCEPTANCE"
    assert "not_SQL_or_RLS" in bilingual_report["backend_offline"]["auth_and_persistence"]
    assert "not_speech_recognition" in bilingual_report["backend_offline"]["transcription"]


def test_report_exposes_neither_fixture_credentials_identifiers_nor_story_content(bilingual_report):
    serialized = json.dumps(bilingual_report)
    for value in (
        "Bearer", "test-publishable-key", "test-user-access-token", "fictional-other-user-token",
        "71000000-", "72000000-", "73000000-", "Malmö", "Lund", "1974",
        "SIMULATED TRANSCRIPT", "Jag flyttade", "I moved", "Fictional manual review sentence",
        "Synthetic lost completion response",
    ):
        assert value not in serialized


def test_encoded_m4a_decodes_as_audio_not_a_renamed_wav(tmp_path):
    from app.services.audio_upload import probe_duration

    content = rehearsal.silent_m4a()
    assert b"ftyp" in content[:32]
    assert not content.startswith(b"RIFF")
    path = tmp_path / "fictional-silence.m4a"
    path.write_bytes(content)
    duration = asyncio.run(probe_duration(path, ".m4a"))
    assert 0.5 <= duration < 2.0


def test_only_injected_mock_transport_is_permitted_and_live_credentials_are_unused(monkeypatch):
    # Import app.main before poisoning configuration because its ordinary global
    # startup intentionally validates ambient settings. The measured app below
    # overrides every credential/live-provider setting with fictional values.
    import app.main  # noqa: F401
    from app.services.openai_client import OpenAIClient

    monkeypatch.setenv("SUPABASE_URL", "https://do-not-contact.example.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "unused-environment-key")
    monkeypatch.setenv("OPENAI_API_KEY", "unused-environment-provider-key")
    monkeypatch.setenv("AI_PROVIDER_MODE", "openai")
    monkeypatch.setenv("OPENAI_TEXT_MODEL", "unused-environment-model")
    monkeypatch.setenv("LIVE_AI_APPROVAL_PATH", "/do-not-read-approval.json")

    real_client_init = httpx.AsyncClient.__init__
    transports = []

    def guarded_client_init(self, *args, **kwargs):
        assert isinstance(kwargs.get("transport"), httpx.MockTransport)
        assert kwargs.get("trust_env") is False
        transports.append(kwargs["transport"])
        real_client_init(self, *args, **kwargs)

    async def forbidden_provider(*_args, **_kwargs):
        pytest.fail("A real provider must never be called by offline rehearsal")

    monkeypatch.setattr(httpx.AsyncClient, "__init__", guarded_client_init)
    monkeypatch.setattr(OpenAIClient, "_request", forbidden_provider)
    report = rehearsal.run_rehearsal(("en",))
    assert report["backend_offline"]["status"] == "PASS"
    assert len(transports) == 2  # One app before disconnect; one after reconnect.
    assert "unused-environment" not in json.dumps(report)


def test_removed_notice_cannot_produce_a_false_pass(monkeypatch):
    from app.services.transcription import SimulatedTranscriptionProvider

    async def missing_notice(*_args):
        return "Fictional fixture without its permanent simulation notice."

    monkeypatch.setattr(SimulatedTranscriptionProvider, "transcribe", missing_notice)
    report = rehearsal.run_rehearsal(("sv",))
    assert report["backend_offline"]["status"] == "FAIL"
    assert report["backend_offline"]["failed_check"] == "sv:exact_persistent_simulation_notice"
    assert report["overall"] == "FAIL"
    assert report["real_iphone"]["status"] == "PENDING"
    assert "Fictional fixture" not in json.dumps(report)


@pytest.mark.parametrize("languages", [(), ("de",), ("en", "de")])
def test_invalid_programmatic_language_selection_fails_before_requests(monkeypatch, languages):
    def forbidden_journey(*_args):
        pytest.fail("Invalid selection must not run a journey")

    monkeypatch.setattr(rehearsal, "rehearse_language", forbidden_journey)
    report = rehearsal.run_rehearsal(languages)
    assert report["backend_offline"]["status"] == "FAIL"
    assert report["backend_offline"]["failed_check"] == "invalid_language_selection"
    assert report["backend_offline"]["checks"] == []


@pytest.mark.parametrize("error", [ValueError("private sensitive failure"), RuntimeError("Bearer private-token")])
def test_unexpected_failures_are_sanitized_and_do_not_claim_success(monkeypatch, error):
    def broken_journey(*_args):
        raise error

    monkeypatch.setattr(rehearsal, "rehearse_language", broken_journey)
    report = rehearsal.run_rehearsal()
    assert report["backend_offline"]["failed_check"] == "unexpected_rehearsal_failure"
    assert report["overall"] == "FAIL"
    assert str(error) not in json.dumps(report)


@pytest.mark.parametrize("success", [True, False])
def test_cli_returns_backend_offline_result_without_fabricating_device_status(monkeypatch, capsys, success):
    expected = {"backend_offline": {"status": "PASS" if success else "FAIL"},
                "hosted_supabase": {"status": "NOT_RUN"}, "real_iphone": {"status": "PENDING"}}
    selected = []

    def fake_rehearsal(languages):
        selected.append(languages)
        return expected

    monkeypatch.setattr(rehearsal, "run_rehearsal", fake_rehearsal)
    assert rehearsal.main(["--language", "sv"]) == (0 if success else 1)
    assert selected == [("sv",)]
    assert json.loads(capsys.readouterr().out) == expected
