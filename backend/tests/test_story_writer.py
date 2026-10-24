"""Offline accuracy tests for the deterministic Day 5 story writer."""

from __future__ import annotations

import asyncio
import inspect

import pytest

from app.core.errors import APIError
import app.services.story_writer as story_writer
from app.services.story_writer import (
    DisabledStoryWriter,
    MockStoryWriter,
    StoryVerification,
    verify_story,
)


MEMORY_ID_1 = "11111111-1111-4111-8111-111111111111"
MEMORY_ID_2 = "22222222-2222-4222-8222-222222222222"
MESSAGE_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
MESSAGE_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def source(
    sentence: str,
    *,
    memory_id: str = MEMORY_ID_1,
    source_message_id: str = MESSAGE_ID_1,
    memory_version: int = 1,
    fact_type: str = "location",
    value: str = "Malmö",
    evidence: str = "I moved to Malmö",
    corrected_value: str | None = None,
    year: int | None = None,
    slot: str | None = "move",
) -> dict:
    return {
        "memory_id": memory_id,
        "memory_version": memory_version,
        "source_message_id": source_message_id,
        "fact_type": fact_type,
        "value": value,
        "evidence": evidence,
        "corrected_value": corrected_value,
        "year": year,
        "slot": slot,
        "sentence": sentence,
    }


def write(
    memories: list[dict], *, language: str = "en", style: str = "warm"
) -> str:
    return asyncio.run(MockStoryWriter().write(language, style, memories))


def test_disabled_writer_has_a_stable_safe_error() -> None:
    provider = DisabledStoryWriter()

    assert provider.mode == "disabled"
    with pytest.raises(APIError) as raised:
        asyncio.run(provider.write("en", "warm", [source("I moved to Malmö.")]))

    assert raised.value.status_code == 503
    assert raised.value.code == "STORY_GENERATION_DISABLED"


def test_english_writer_uses_only_canonical_confirmed_source_sentences() -> None:
    memories = [
        source("I moved to Malmö.", year=None),
        source(
            "My wife is Anna.",
            memory_id=MEMORY_ID_2,
            source_message_id=MESSAGE_ID_2,
            fact_type="relationship",
            value="Anna",
            evidence="My wife is Anna",
            slot="relationship:wife",
        ),
    ]

    result = write(memories)

    assert result == "I moved to Malmö.\n\nMy wife is Anna."
    assert "1974" not in result  # an unconfirmed year was not in the context
    assert result.count("Malmö") == 1


def test_swedish_writer_preserves_canonical_language_and_wording() -> None:
    memories = [
        source(
            "Jag flyttade till Malmö.",
            evidence="Jag flyttade till Malmö",
        ),
        source(
            "Min fru heter Anna.",
            memory_id=MEMORY_ID_2,
            source_message_id=MESSAGE_ID_2,
            fact_type="relationship",
            value="Anna",
            evidence="Min fru heter Anna",
            slot="relationship:fru",
        ),
    ]

    assert write(memories, language="sv") == (
        "Jag flyttade till Malmö.\n\nMin fru heter Anna."
    )


def test_writer_deduplicates_exact_sentences_in_source_order() -> None:
    memories = [
        source("I moved to Malmö."),
        source(
            "I moved to Malmö.",
            memory_id=MEMORY_ID_2,
            source_message_id=MESSAGE_ID_2,
        ),
        source(
            "I felt a little nervous.",
            memory_id="33333333-3333-4333-8333-333333333333",
            source_message_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            fact_type="emotion",
            value="a little nervous",
            evidence="I felt a little nervous",
            slot="emotion",
        ),
    ]

    expected = "I moved to Malmö.\n\nI felt a little nervous."
    assert write(memories) == expected
    assert write(memories) == expected


def test_writer_accepts_a_bounded_long_canonical_sentence() -> None:
    sentence = "I " + ("remember " * 180)
    sentence = sentence.strip()

    assert 1_000 < len(sentence) <= 2_000
    assert write([source(sentence)]) == sentence


@pytest.mark.parametrize(
    "fact_type",
    ["person", "relationship", "date", "location", "event", "emotion"],
)
def test_writer_accepts_each_story_source_fact_type(fact_type: str) -> None:
    memory = source("I remember this.", fact_type=fact_type)

    assert write([memory]) == "I remember this."


@pytest.mark.parametrize("year", [1, 2100])
def test_writer_accepts_story_source_year_boundaries(year: int) -> None:
    memory = source("I remember this.", year=year)

    assert write([memory]) == "I remember this."


def test_writer_accepts_eighty_character_slot_boundary() -> None:
    memory = source("I remember this.", slot="s" * 80)

    assert write([memory]) == "I remember this."


def test_writer_rejects_empty_invalid_or_oversized_context() -> None:
    with pytest.raises(APIError) as empty:
        write([])
    assert empty.value.status_code == 409
    assert empty.value.code == "NO_CONFIRMED_MEMORIES"

    with pytest.raises(APIError) as too_many:
        write([source("I remember Malmö.")] * 201)
    assert too_many.value.status_code == 409
    assert too_many.value.code == "STORY_CONTEXT_LIMIT"

    oversized = [source("I " + ("remember " * 2_501))]
    with pytest.raises(APIError) as too_long:
        write(oversized)
    assert too_long.value.status_code in {409, 503}

    with pytest.raises(APIError) as language:
        write([source("I moved to Malmö.")], language="de")
    assert language.value.status_code == 422

    with pytest.raises(APIError) as style:
        write([source("I moved to Malmö.")], style="dramatic")
    assert style.value.status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        {"memory_id": "not-a-uuid"},
        {"source_message_id": "not-a-uuid"},
        {"memory_version": 0},
        {"memory_version": True},
        {"fact_type": "unsupported"},
        {"year": 0},
        {"year": 2101},
        {"slot": "s" * 81},
        {"sentence": "Malmö was my home."},
        {"sentence": "Jag flyttade till Malmö."},
        {"sentence": " I moved to Malmö."},
        {"language": "sv"},
    ],
)
def test_writer_rejects_malformed_or_cross_language_source(change: dict) -> None:
    malformed = source("I moved to Malmö.")
    malformed.update(change)

    with pytest.raises(APIError) as raised:
        write([malformed])

    assert raised.value.status_code == 503
    assert raised.value.code == "STORY_CONTEXT_INVALID"
    assert "not-a-uuid" not in raised.value.message


def test_writer_rejects_duplicate_memory_ids_even_when_sentences_differ() -> None:
    memories = [
        source("I moved to Malmö."),
        source(
            "I felt calm.",
            source_message_id=MESSAGE_ID_2,
            fact_type="emotion",
            value="calm",
            evidence="I felt calm",
            slot="emotion",
        ),
    ]

    with pytest.raises(APIError) as raised:
        write(memories)

    assert raised.value.status_code == 503
    assert raised.value.code == "STORY_CONTEXT_INVALID"


def test_independent_verifier_passes_only_exact_canonical_content() -> None:
    memories = [source("I moved to Malmö.")]
    canonical = "I moved to Malmö."

    assert verify_story(canonical, "en", "warm", memories, canonical) == (
        StoryVerification(status="passed", unsupported_claims=[])
    )


@pytest.mark.parametrize(
    "candidate",
    [
        "I moved to Stockholm.",
        "I moved to Malmö in 1974.",
        "I happily moved to Malmö.",
        "I moved to Malmö. My wife Anna came with me.",
        "I moved to Malmö. I was terrified.",
    ],
)
def test_verifier_blocks_changed_or_unsupported_claims(candidate: str) -> None:
    memories = [source("I moved to Malmö.")]
    result = verify_story(
        candidate,
        "en",
        "warm",
        memories,
        "I moved to Malmö.",
    )

    assert result.status == "blocked"
    assert result.unsupported_claims
    assert len(result.unsupported_claims) <= 20
    assert all(0 < len(item) <= 1_000 for item in result.unsupported_claims)


def test_verifier_recalculates_and_rejects_altered_canonical_argument() -> None:
    memories = [source("I moved to Malmö.")]
    result = verify_story(
        "I moved to Malmö.",
        "en",
        "warm",
        memories,
        "I moved to Stockholm.",
    )

    assert result.status == "blocked"
    assert result.unsupported_claims


def test_verifier_does_not_dump_a_large_unsupported_story() -> None:
    memories = [source("I moved to Malmö.")]
    candidate = "I invented this sentence. " * 900
    result = verify_story(
        candidate,
        "en",
        "warm",
        memories,
        "I moved to Malmö.",
    )

    assert result.status == "blocked"
    assert len(result.unsupported_claims) <= 20
    assert sum(map(len, result.unsupported_claims)) < len(candidate)
    assert all(len(item) <= 1_000 for item in result.unsupported_claims)


def test_module_has_no_paid_or_network_provider_dependency() -> None:
    module_source = inspect.getsource(story_writer).casefold()

    assert "openai" not in module_source
    assert "anthropic" not in module_source
    assert "httpx" not in module_source
    assert "requests" not in module_source
