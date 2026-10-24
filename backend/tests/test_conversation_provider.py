"""Deterministic, offline checks for the Day 4 conversation provider."""

from __future__ import annotations

import asyncio

import pytest

from app.core.errors import APIError
from app.services.conversation_provider import (
    DisabledConversationProvider,
    FactCandidate,
    MockConversationProvider,
    ProviderResult,
)


def respond(
    text: str,
    *,
    language: str = "en",
    prior_facts: list[dict] | None = None,
) -> ProviderResult:
    return asyncio.run(
        MockConversationProvider().respond(text, language, prior_facts or [])
    )


def test_disabled_provider_is_explicit_and_stable() -> None:
    provider = DisabledConversationProvider()

    assert provider.mode == "disabled"
    with pytest.raises(APIError) as raised:
        asyncio.run(provider.respond("A memory", "en", []))

    assert raised.value.status_code == 503
    assert raised.value.code == "CONVERSATION_DISABLED"


def test_mock_provider_extracts_move_without_rewriting_source() -> None:
    source = "I moved to Malmö in 1974."

    first = respond(source)
    second = respond(source)

    assert first == second
    assert first.text == (
        "Thank you for sharing that memory. "
        "What do you remember most about that time?"
    )
    assert first.facts == [
        FactCandidate(
            fact_type="event",
            value="Malmö",
            evidence=source.removesuffix("."),
            year=1974,
            slot="move",
        )
    ]
    assert first.facts[0].evidence in source
    assert first.facts[0].value in source


def test_uncertain_date_and_explicit_correction_use_only_source_and_prior_fact() -> None:
    uncertain_source = "I think we moved in 1974."
    uncertain = respond(uncertain_source)

    assert uncertain.facts == [
        FactCandidate(
            fact_type="event",
            value="1974",
            evidence=uncertain_source.removesuffix("."),
            year=1974,
            slot="move",
            uncertain=True,
            clarification_question="Was 1974 the year you moved?",
        )
    ]
    assert uncertain.text.endswith("Was 1974 the year you moved?")

    correction_source = "Actually, it was 1975."
    corrected = respond(
        correction_source,
        prior_facts=[
            {
                "id": "fact-1974",
                "fact_type": "event",
                "value": "1974",
                "evidence": uncertain_source.removesuffix("."),
                "year": 1974,
                "slot": "move",
                "status": "pending",
                "corrected_value": None,
            }
        ],
    )

    assert corrected.facts == [
        FactCandidate(
            fact_type="event",
            value="1975",
            evidence=correction_source,
            year=1975,
            slot="move",
            uncertain=True,
            clarification_question=(
                "You previously said 1974. Should I use 1975 instead?"
            ),
            conflicts_with_fact_id="fact-1974",
        )
    ]
    assert corrected.facts[0].evidence in correction_source
    assert corrected.facts[0].value in correction_source
    assert "1974" not in corrected.facts[0].evidence


def test_correction_uses_latest_nonrejected_dated_fact() -> None:
    result = respond(
        "Actually, it was 1978.",
        prior_facts=[
            {
                "id": "old",
                "fact_type": "event",
                "value": "1972",
                "evidence": "in 1972",
                "year": 1972,
                "slot": "move",
                "status": "pending",
                "corrected_value": None,
            },
            {
                "id": "rejected",
                "fact_type": "event",
                "value": "1976",
                "evidence": "in 1976",
                "year": 1976,
                "slot": "move",
                "status": "rejected",
                "corrected_value": None,
            },
            {
                "id": "latest",
                "fact_type": "event",
                "value": "1977",
                "evidence": "in 1977",
                "year": 1977,
                "slot": "move",
                "status": "confirmed",
                "corrected_value": None,
            },
        ],
    )

    assert result.facts[0].conflicts_with_fact_id == "latest"
    assert result.facts[0].slot == "move"
    assert result.facts[0].clarification_question == (
        "You previously said 1977. Should I use 1978 instead?"
    )


def test_correction_uses_clear_corrected_value_and_skips_ambiguous_target() -> None:
    prior = {
        "id": "corrected",
        "fact_type": "event",
        "value": "1974",
        "evidence": "in 1974",
        "year": 1974,
        "slot": "move",
        "status": "confirmed",
        "corrected_value": "1976",
    }
    clear = respond("Actually, it was 1978.", prior_facts=[prior])
    assert clear.facts[0].clarification_question == (
        "You previously said 1976. Should I use 1978 instead?"
    )

    prior["corrected_value"] = "around 1976 or 1977"
    ambiguous = respond("Actually, it was 1978.", prior_facts=[prior])
    assert ambiguous.facts == []
    assert "1974" not in ambiguous.text


def test_repeated_move_date_asks_whether_it_is_separate_or_a_correction() -> None:
    result = respond(
        "We moved to Lund in 1978.",
        prior_facts=[
            {
                "id": "malmo-move",
                "fact_type": "event",
                "value": "Malmö",
                "evidence": "We moved to Malmö in 1974",
                "year": 1974,
                "slot": "move",
                "status": "confirmed",
                "corrected_value": None,
            }
        ],
    )

    assert len(result.facts) == 1
    fact = result.facts[0]
    assert fact.value == "Lund"
    assert fact.year == 1978
    assert fact.uncertain is True
    assert fact.conflicts_with_fact_id == "malmo-move"
    assert fact.clarification_question == (
        "You previously said 1974. Is 1978 a separate move, or a correction to 1974?"
    )
    assert result.text.count("?") == 1


def test_same_move_year_is_not_reported_as_a_conflict() -> None:
    result = respond(
        "We moved to Lund in 1974.",
        prior_facts=[
            {
                "id": "earlier-wording",
                "fact_type": "event",
                "value": "Malmö",
                "evidence": "We moved to Malmö in 1974",
                "year": 1974,
                "slot": "move",
                "status": "confirmed",
                "corrected_value": None,
            }
        ],
    )

    assert result.facts[0].conflicts_with_fact_id is None
    assert result.facts[0].uncertain is False


def test_same_year_correction_does_not_create_a_false_conflict() -> None:
    result = respond(
        "Actually, it was 1974.",
        prior_facts=[
            {
                "id": "same-year",
                "fact_type": "event",
                "value": "1974",
                "evidence": "in 1974",
                "year": 1974,
                "slot": "move",
                "status": "confirmed",
                "corrected_value": None,
            }
        ],
    )

    assert result.facts[0].year == 1974
    assert result.facts[0].uncertain is False
    assert result.facts[0].conflicts_with_fact_id is None
    assert "?" not in result.text


def test_grew_up_does_not_invent_a_relationship() -> None:
    source = "I grew up in Stockholm."
    result = respond(source)

    assert result.facts == [
        FactCandidate(
            fact_type="location",
            value="Stockholm",
            evidence=source.removesuffix("."),
            slot="grew_up_location",
        )
    ]
    combined = " ".join([result.text, *(fact.value for fact in result.facts)]).casefold()
    for invented_relationship in ("mother", "father", "parent", "wife", "child"):
        assert invented_relationship not in combined


def test_emotion_keeps_the_users_literal_intensity() -> None:
    source = "I felt a little nervous."
    result = respond(source)

    assert result.facts == [
        FactCandidate(
            fact_type="emotion",
            value="a little nervous",
            evidence=source.removesuffix("."),
            slot="emotion",
        )
    ]
    rendered = " ".join([result.text, result.facts[0].value]).casefold()
    assert "terrified" not in rendered
    assert "cried" not in rendered


def test_swedish_language_is_preserved() -> None:
    source = "Jag växte upp i Göteborg."
    result = respond(source, language="sv")

    assert result.text == "Tack för att du delar det minnet."
    assert result.facts == [
        FactCandidate(
            fact_type="location",
            value="Göteborg",
            evidence=source.removesuffix("."),
            slot="grew_up_location",
        )
    ]
    assert result.facts[0].evidence in source


@pytest.mark.parametrize(
    ("source", "language", "value", "slot"),
    [
        ("My wife's name is Anna.", "en", "Anna", "relationship:wife"),
        ("Min fru heter Anna.", "sv", "Anna", "relationship:fru"),
    ],
)
def test_explicit_relationships_are_extracted_literally(
    source: str, language: str, value: str, slot: str
) -> None:
    result = respond(source, language=language)

    assert result.facts == [
        FactCandidate(
            fact_type="relationship",
            value=value,
            evidence=source.removesuffix("."),
            slot=slot,
        )
    ]


@pytest.mark.parametrize(
    ("source", "language"),
    [("My name is Anna.", "en"), ("Jag heter Anna.", "sv")],
)
def test_explicit_self_name_is_a_person_without_inventing_relationship(
    source: str, language: str
) -> None:
    result = respond(source, language=language)

    assert result.facts == [
        FactCandidate(
            fact_type="person",
            value="Anna",
            evidence=source.removesuffix("."),
            slot="person:self_name",
        )
    ]
    assert "relationship" not in result.facts[0].fact_type


def test_apostrophe_in_relationship_does_not_hide_a_later_fact() -> None:
    source = "My wife's name is Anna. I moved to Malmö in 1974."
    result = respond(source)

    assert [(fact.fact_type, fact.value) for fact in result.facts] == [
        ("relationship", "Anna"),
        ("event", "Malmö"),
    ]


@pytest.mark.parametrize(
    ("source", "language", "value", "year"),
    [
        ("I was born on 12 May 1950.", "en", "12 May 1950", 1950),
        ("Jag föddes den 12 maj 1950.", "sv", "12 maj 1950", 1950),
        ("The ceremony was on 1950-05-12.", "en", "1950-05-12", 1950),
    ],
)
def test_explicit_dates_are_grounded(
    source: str, language: str, value: str, year: int
) -> None:
    result = respond(source, language=language)

    assert len(result.facts) == 1
    fact = result.facts[0]
    assert fact.fact_type == "date"
    assert fact.value == value
    assert fact.year == year
    assert fact.evidence in source
    assert fact.value in source


@pytest.mark.parametrize(
    "source",
    [
        "The date was 1974-99-99.",
        "The date was 31 February 1974.",
        "The date was February 29, 1975.",
    ],
)
def test_impossible_calendar_dates_are_not_extracted(source: str) -> None:
    assert respond(source).facts == []


def test_valid_leap_day_is_extracted() -> None:
    result = respond("The date was 29 February 1976.")
    assert result.facts[0].value == "29 February 1976"
    assert result.facts[0].year == 1976


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("en", "Thank you for sharing. I’m listening."),
        ("sv", "Tack för att du delar med dig. Jag lyssnar."),
    ],
)
def test_unrecognized_text_has_a_warm_fact_free_fallback(
    language: str, expected: str
) -> None:
    result = respond("The garden was quiet after lunch.", language=language)

    assert result == ProviderResult(text=expected, facts=[])


def test_candidates_are_source_ordered_capped_and_all_grounded() -> None:
    source = " ".join(
        [
            "I felt calm.",
            "I felt proud.",
            "I felt happy.",
            "I felt nervous.",
            "I felt excited.",
            "I felt worried.",
            "I felt lonely.",
            "I felt sad.",
            "I felt afraid.",
        ]
    )
    result = respond(source)

    assert len(result.facts) == 8
    assert [fact.value for fact in result.facts] == [
        "calm",
        "proud",
        "happy",
        "nervous",
        "excited",
        "worried",
        "lonely",
        "sad",
    ]
    assert all(fact.evidence in source and fact.value in source for fact in result.facts)


@pytest.mark.parametrize(
    "source",
    [
        "I did not move to Malmö in 1974.",
        "If I moved to Malmö in 1974, I would tell you.",
        'My father said, "I moved to Malmö in 1974."',
        "My father said, 'I moved to Malmö in 1974.'",
        "Jag flyttade inte till Malmö 1974.",
        "Om jag flyttade till Malmö 1974 skulle jag minnas det.",
        'Hon sa: “Jag växte upp i Göteborg.”',
    ],
)
def test_negated_hypothetical_and_quoted_statements_are_not_facts(source: str) -> None:
    language = "sv" if any(word in source for word in ("Jag", "Om", "Hon")) else "en"
    assert respond(source, language=language).facts == []


def test_only_one_clarification_is_placed_in_assistant_reply() -> None:
    result = respond("Maybe I felt nervous. Maybe I felt worried.")

    assert len(result.facts) == 2
    assert all(fact.clarification_question for fact in result.facts)
    assert result.text.count("Is that detail correct?") == 1


def test_provider_rejects_unsupported_language_and_oversized_input() -> None:
    with pytest.raises(ValueError, match="language"):
        respond("A memory", language="de")

    # Typed messages are capped at 4,000 by the API schema; the provider also
    # accepts immutable Day 3 transcript sources, which can be up to 32,000.
    assert respond("x" * 32_000).facts == []
    with pytest.raises(ValueError, match="32000"):
        respond("x" * 32_001)


@pytest.mark.parametrize(
    ("language", "source", "value"),
    [
        ("en", "I worked as a teacher.", "teacher"),
        ("sv", "Jag arbetade som lärare.", "lärare"),
        ("en", "  I worked as a Teacher  ", "Teacher"),
        ("sv", "Jag arbetade som LÄRARE!", "LÄRARE"),
    ],
)
def test_demo_occupation_is_narrow_source_grounded_and_preserves_case(language, source, value):
    result = respond(source, language=language)
    assert result.facts == [FactCandidate(
        fact_type="event", value=value,
        evidence=source.strip().removesuffix(".").removesuffix("!"),
        slot="occupation",
    )]
    fact = result.facts[0]
    assert fact.year is None
    assert fact.value in source and fact.evidence in source
    assert fact.uncertain is False


@pytest.mark.parametrize(
    ("language", "source", "occupation"),
    [
        ("en", "I moved to Malmö in 1974. I worked as a teacher.", "teacher"),
        ("sv", "Jag flyttade till Malmö 1974. Jag arbetade som lärare.", "lärare"),
    ],
)
def test_move_and_occupation_are_distinct_source_ordered_candidates(language, source, occupation):
    facts = respond(source, language=language).facts
    assert [(fact.slot, fact.value, fact.year) for fact in facts] == [
        ("move", "Malmö", 1974), ("occupation", occupation, None),
    ]
    assert all(fact.value in source and fact.evidence in source for fact in facts)


@pytest.mark.parametrize(
    ("language", "correction"),
    [("en", "Actually, it was 1975."), ("sv", "Egentligen var det 1975.")],
)
def test_later_occupation_does_not_redirect_explicit_year_correction(language, correction):
    facts = respond(correction, language=language, prior_facts=[
        {"id": "move-fact", "fact_type": "event", "value": "Malmö", "year": 1974,
         "slot": "move", "status": "pending", "corrected_value": None},
        {"id": "occupation-fact", "fact_type": "event", "value": "teacher", "year": None,
         "slot": "occupation", "status": "pending", "corrected_value": None},
    ]).facts
    assert len(facts) == 1
    assert facts[0].slot == "move"
    assert facts[0].year == 1975
    assert facts[0].conflicts_with_fact_id == "move-fact"
    assert facts[0].uncertain is True


@pytest.mark.parametrize(
    ("language", "source"),
    [
        ("en", "I did not work as a teacher."),
        ("en", "I never worked as a teacher."),
        ("en", "Maybe I worked as a teacher."),
        ("en", "I think I worked as a teacher."),
        ("en", "If I worked as a teacher, I would remember."),
        ("en", "Imagine I worked as a teacher."),
        ("en", 'My father said, "I worked as a teacher."'),
        ("en", "'I worked as a teacher.'"),
        ("en", "I will work as a teacher."),
        ("en", "I wish I worked as a teacher."),
        ("en", "I worked as a teacher?"),
        ("en", "I worked as a teacher and a doctor."),
        ("en", "I worked as a teacher in Malmö."),
        ("en", "I worked as a teacher, maybe."),
        ("en", "I worked as a teacher—not really."),
        ("en", "I worked as a teacher's assistant."),
        ("en", "I worked as a doctor."),
        ("en", "I worked as a teachertrainer."),
        ("sv", "Jag arbetade inte som lärare."),
        ("sv", "Jag arbetade aldrig som lärare."),
        ("sv", "Kanske jag arbetade som lärare."),
        ("sv", "Jag tror att jag arbetade som lärare."),
        ("sv", "Om jag arbetade som lärare skulle jag minnas det."),
        ("sv", "Tänk om jag arbetade som lärare."),
        ("sv", 'Hon sa: “Jag arbetade som lärare.”'),
        ("sv", "Jag kommer att arbeta som lärare."),
        ("sv", "Jag önskar att jag arbetade som lärare."),
        ("sv", "Jag arbetade som lärare?"),
        ("sv", "Jag arbetade som lärare och läkare."),
        ("sv", "Jag arbetade som lärare i Malmö."),
        ("sv", "Jag arbetade som lärare, kanske."),
        ("sv", "Jag arbetade som läkare."),
        ("sv", "Jag arbetade som lärarassistent."),
    ],
)
def test_unqualified_occupation_is_not_guessed_from_unsupported_claims(language, source):
    assert respond(source, language=language).facts == []


@pytest.mark.parametrize(("language", "source"), [("en", "1975"), ("sv", "1975"),
                                                   ("en", "Yes"), ("en", "No"),
                                                   ("sv", "Ja"), ("sv", "Nej")])
def test_bare_year_or_review_answer_does_not_guess_an_occupation_or_resolve_memory(language, source):
    assert respond(source, language=language, prior_facts=[
        {"id": "occupation-fact", "fact_type": "event", "value": "teacher", "year": None,
         "slot": "occupation", "status": "pending", "corrected_value": None},
    ]).facts == []


@pytest.mark.parametrize(
    ("language", "source"),
    [
        ("en", "Imagine:\nI worked as a teacher."),
        ("en", "My father said:\nI worked as a teacher."),
        ("en", "My father said:  \r\n\n  I worked as a teacher."),
        ("en", "Suppose:\nI worked as a teacher."),
        ("sv", "Tänk dig:\nJag arbetade som lärare."),
        ("sv", "Min pappa sa:\nJag arbetade som lärare."),
        ("sv", "Min pappa sa:  \r\n\n  Jag arbetade som lärare."),
        ("sv", "Tänk om:\nJag arbetade som lärare."),
    ],
)
def test_adjacent_multiline_introduction_does_not_assert_occupation(language, source):
    assert respond(source, language=language).facts == []


@pytest.mark.parametrize("language", ["en", "sv"])
def test_fictional_fixture_notice_is_not_mistaken_for_quoted_occupation(language):
    from app.services.transcription import SIMULATED_TRANSCRIPTS

    facts = respond(SIMULATED_TRANSCRIPTS[language], language=language).facts
    assert [(fact.slot, fact.year) for fact in facts] == [("move", 1974), ("occupation", None)]
