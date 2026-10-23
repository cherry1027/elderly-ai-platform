"""Keep Tarun's fictional Day 10 text fixtures aligned with the real mock.

No cloud requests, accounts or retained demo data are created by these checks.
SQL persistence/story assertions live in the separate Day 10 database suite.
"""

import asyncio
from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.schemas.conversations import MemoryPatch, MessageCreate
from app.schemas.story_projects import StoryProjectCreate
from app.services.conversation_provider import MockConversationProvider

FIXTURE = json.loads((Path(__file__).resolve().parents[2] /
                     "docs/fixtures/day10-memory-review.json").read_text(encoding="utf-8"))
SCENARIOS = FIXTURE["scenarios"]


def respond(text, language, prior):
    return asyncio.run(MockConversationProvider().respond(text, language, prior))


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda item: item["project"]["language"])
def test_fictional_review_fixture_preserves_uncertain_source_and_correction(scenario):
    assert FIXTURE["fictional"] is True
    assert "simulation" in FIXTURE["simulation_label"].lower()
    project = StoryProjectCreate.model_validate(scenario["project"])
    language = project.language
    first = respond(scenario["initial_text"], language, [])
    assert len(first.facts) == 1
    initial = first.facts[0]
    assert initial.value == "1974" and initial.year == 1974
    assert initial.slot == "move" and initial.uncertain is True
    assert initial.clarification_question
    assert initial.evidence in scenario["initial_text"]
    prior = [{"id": "11111111-1111-4111-8111-111111111111", "fact_type": "event",
              "value": "1974", "year": 1974, "slot": "move", "status": "pending",
              "corrected_value": None}]
    original_prior = deepcopy(prior)
    correction = respond(scenario["correction_text"], language, prior)
    assert len(correction.facts) == 1
    fact = correction.facts[0]
    assert fact.value == "1975" and fact.year == 1975 and fact.uncertain is True
    assert fact.conflicts_with_fact_id == prior[0]["id"]
    assert fact.evidence in scenario["correction_text"]
    assert prior == original_prior  # The provider proposes; it never mutates sources.
    assert initial.year == 1974
    steps = scenario["review_steps"]
    assert [step["target"] for step in steps] == [
        "original_move", "correction_candidate", "rejected_person",
    ]
    assert MemoryPatch.model_validate(steps[0]["patch"]).corrected_value == "1975"
    assert "1975" in scenario["expected_story"]
    assert "1974" not in scenario["expected_story"] and "Ada" not in scenario["expected_story"]


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda item: item["project"]["language"])
def test_yes_no_use_explicit_memory_actions_not_bare_chat_or_language_switch(scenario):
    language = scenario["project"]["language"]
    for name in ("bare_confirmation_text", "code_switch_text"):
        MessageCreate.model_validate({"text": scenario[name], "language": language})
        response = respond(scenario[name], language, [])
        assert response.facts == []
        assert response.text.startswith("Tack" if language == "sv" else "Thank you")
    rejected = respond(scenario["rejected_text"], language, [])
    assert len(rejected.facts) == 1 and rejected.facts[0].value == "Ada"
    rejected_targets = set()
    for step in scenario["review_steps"][1:]:
        patch = MemoryPatch.model_validate(step["patch"])
        assert patch.status == "rejected" and patch.corrected_value is None
        rejected_targets.add(step["target"])
    assert rejected_targets == {"correction_candidate", "rejected_person"}
