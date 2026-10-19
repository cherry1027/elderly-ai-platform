"""Strict user consent and fail-closed verification response invariants."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.story_drafts import StoryDraftPatch, StoryGenerationRequest, StoryVerificationReport


@pytest.mark.parametrize("confirmation", [None, False, 0, 1, "true", "false", [], {}])
def test_generation_requires_boolean_user_confirmation(confirmation):
    with pytest.raises(ValidationError):
        StoryGenerationRequest(language="sv", confirm_generation=confirmation)


def test_generation_defaults_to_disabled_and_never_accepts_live_provider():
    assert Settings(_env_file=None).story_generation_mode == "disabled"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, story_generation_mode="openai")


@pytest.mark.parametrize("revision", [True, "1", 0, -1, 1.5])
def test_edit_revision_rejects_coercion(revision):
    with pytest.raises(ValidationError):
        StoryDraftPatch(content="Jag växte upp i Malmö.", expected_revision=revision)


@pytest.mark.parametrize("override", [
    {"unsupported_claims": ["Invented childhood event"]},
    {"method": "manual_unverified"},
    {"sources_current": False},
    {"checked_revision": None},
    {"checked_at": None},
])
def test_passed_report_requires_current_checked_supported_content(override):
    value = {
        "status": "passed", "unsupported_claims": [],
        "method": "deterministic_mock_v1", "checked_revision": 1,
        "checked_at": "2026-10-19T10:00:00Z", "sources_current": True,
        "reason": None,
    }
    with pytest.raises(ValidationError):
        StoryVerificationReport.model_validate({**value, **override})
