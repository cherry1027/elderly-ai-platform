"""Day 4 input safety and explicit mock feature selection."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.conversations import MemoryPatch, MessageCreate


def test_conversation_is_disabled_unless_explicitly_selected():
    assert Settings(_env_file=None).conversation_mode == "disabled"
    assert Settings(_env_file=None, conversation_mode="mock").conversation_mode == "mock"


@pytest.mark.parametrize("mode", ["openai", "live", "MOCK", "", True])
def test_unknown_or_external_provider_modes_are_rejected(mode):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, conversation_mode=mode)


@pytest.mark.parametrize("payload", [
    {"language": "en"},
    {"text": "", "language": "en"},
    {"text": " \n ", "language": "sv"},
    {"text": "x" * 4001, "language": "en"},
    {"text": "a\0b", "language": "en"},
    {"text": "\ud800", "language": "en"},
    {"text": "A memory", "language": "de"},
    {"text": "A memory", "language": "en", "user_id": "untrusted"},
    {"text": "A memory", "language": "en", "source_message_id": "11111111-1111-4111-8111-111111111111"},
    {"source_message_id": "bad-id", "language": "en"},
    {"text": 42, "language": "en"},
])
def test_invalid_message_contracts_fail_closed(payload):
    with pytest.raises(ValidationError):
        MessageCreate.model_validate(payload)


def test_typed_message_trims_only_input_and_accepts_swedish():
    message = MessageCreate.model_validate({"text": " Jag växte upp i Göteborg. ", "language": "sv"})
    assert message.text == "Jag växte upp i Göteborg."


def test_existing_source_requires_no_rewritten_text():
    message = MessageCreate.model_validate({
        "source_message_id": "11111111-1111-4111-8111-111111111111", "language": "en",
    })
    assert message.text is None
    assert str(message.source_message_id) == "11111111-1111-4111-8111-111111111111"


@pytest.mark.parametrize("payload", [
    {"status": "pending", "expected_version": 1},
    {"status": "confirmed"},
    {"status": "confirmed", "expected_version": 0},
    {"status": "confirmed", "expected_version": True},
    {"status": "confirmed", "expected_version": 1, "corrected_value": None},
    {"status": "rejected", "expected_version": 1, "corrected_value": "1975"},
    {"status": "confirmed", "expected_version": 1, "corrected_value": "  "},
    {"status": "confirmed", "expected_version": 1, "corrected_value": "\ud800"},
    {"status": "confirmed", "expected_version": 1, "value": "overwrite source"},
])
def test_invalid_memory_corrections_are_rejected(payload):
    with pytest.raises(ValidationError):
        MemoryPatch.model_validate(payload)


def test_correction_is_separate_from_original_evidence():
    patch = MemoryPatch.model_validate({"status": "confirmed", "expected_version": 1, "corrected_value": " 1975 "})
    assert patch.corrected_value == "1975"
    assert "evidence" not in patch.model_dump()
