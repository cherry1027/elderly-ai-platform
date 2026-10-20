"""Offline validation for the explicitly fictional bilingual investor demo."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from pathlib import Path
from uuid import UUID

from app.schemas.story_projects import StoryProjectCreate
from app.schemas.conversations import MessageCreate
from app.services.conversation_provider import FactCandidate, MockConversationProvider


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "fixtures"
    / "investor-demo.json"
)
SUPPORTED_FACT_TYPES = {"person", "date", "location", "relationship", "event", "emotion"}
FORBIDDEN_IDENTITY_OR_SECRET_KEYS = {
    "account_id",
    "api_key",
    "apikey",
    "access_token",
    "credential",
    "email",
    "password",
    "refresh_token",
    "token",
    "user_id",
}


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _mapping_keys(value: object) -> set[str]:
    if isinstance(value, Mapping):
        keys = {str(key).casefold() for key in value}
        for child in value.values():
            keys.update(_mapping_keys(child))
        return keys
    if isinstance(value, list):
        keys: set[str] = set()
        for child in value:
            keys.update(_mapping_keys(child))
        return keys
    return set()


def _assert_expected_fact(candidate: FactCandidate, expected: dict, source_text: str) -> None:
    assert expected["status"] == "pending"
    assert expected["fact_type"] in SUPPORTED_FACT_TYPES
    assert candidate.fact_type == expected["fact_type"]
    assert candidate.value == expected["value"]
    assert candidate.slot == expected["slot"]
    assert candidate.year == expected.get("year")
    assert candidate.evidence in source_text
    assert candidate.uncertain is False
    assert candidate.clarification_question is None
    assert candidate.conflicts_with_fact_id is None


def _prior_fact(candidate: FactCandidate, sequence: int) -> dict:
    """Represent a local pending candidate as prior context; no account identity is used."""

    return {
        "id": str(UUID(int=sequence)),
        "fact_type": candidate.fact_type,
        "value": candidate.value,
        "corrected_value": None,
        "year": candidate.year,
        "slot": candidate.slot,
        "status": "pending",
        "version": 1,
    }


def test_fixture_is_explicitly_fictional_bilingual_and_credential_free() -> None:
    fixture = _load_fixture()

    assert fixture["fictional"] is True
    assert fixture["simulation_label"] == "AI simulation"
    assert "fictional" in fixture["notice"].casefold()
    assert FORBIDDEN_IDENTITY_OR_SECRET_KEYS.isdisjoint(_mapping_keys(fixture))

    scenarios = fixture["scenarios"]
    assert len(scenarios) == 2
    projects = [StoryProjectCreate.model_validate(item["project"]) for item in scenarios]
    assert {project.language for project in projects} == {"en", "sv"}

    for scenario, project in zip(scenarios, projects, strict=True):
        assert scenario["fictional"] is True
        assert scenario["simulation_label"] == "AI simulation"
        assert scenario["project"]["language"] == project.language
        assert len(scenario["initial_messages"]) == 5
        assert scenario["continued_message"]["text"] not in {
            item["text"] for item in scenario["initial_messages"]
        }

    assert projects[0].title == "Investor demo - My Childhood (fictional)"
    assert "fiktiv" in projects[1].title.casefold()


def test_mock_provider_recognizes_each_message_as_one_supported_pending_fact() -> None:
    fixture = _load_fixture()
    provider = MockConversationProvider()

    async def verify() -> None:
        for scenario in fixture["scenarios"]:
            language = scenario["project"]["language"]
            prior_facts: list[dict] = []
            initial_slots: set[str] = set()

            for sequence, message in enumerate(scenario["initial_messages"], start=1):
                MessageCreate.model_validate({"text": message["text"], "language": language})
                result = await provider.respond(message["text"], language, prior_facts)
                assert len(result.facts) == 1
                candidate = result.facts[0]
                _assert_expected_fact(candidate, message["expected_fact"], message["text"])
                assert candidate.slot is not None
                initial_slots.add(candidate.slot)
                prior_facts.append(_prior_fact(candidate, sequence))

            assert "emotion" not in initial_slots
            continued = scenario["continued_message"]
            MessageCreate.model_validate({"text": continued["text"], "language": language})
            result = await provider.respond(continued["text"], language, prior_facts)
            assert len(result.facts) == 1
            candidate = result.facts[0]
            _assert_expected_fact(candidate, continued["expected_fact"], continued["text"])
            assert candidate.slot not in initial_slots

    asyncio.run(verify())
