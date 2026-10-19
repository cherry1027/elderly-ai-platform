"""Deterministic, source-grounded conversation providers for Day 4.

The mock is deliberately a small pattern matcher, not a general natural-language
parser.  A phrase it cannot recognize with high confidence produces no facts.
That conservative failure mode is safer for autobiographical source material.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re
from typing import Protocol

from app.core.errors import APIError


MAX_SOURCE_TEXT_LENGTH = 32_000
MAX_FACTS = 8
MAX_FACT_TEXT_LENGTH = 1_000


@dataclass
class FactCandidate:
    fact_type: str
    value: str
    evidence: str
    year: int | None = None
    slot: str | None = None
    uncertain: bool = False
    clarification_question: str | None = None
    conflicts_with_fact_id: str | None = None


@dataclass
class ProviderResult:
    text: str
    facts: list[FactCandidate]


class ConversationProvider(Protocol):
    mode: str

    async def respond(
        self, text: str, language: str, prior_facts: list[dict]
    ) -> ProviderResult: ...


class DisabledConversationProvider:
    mode = "disabled"

    async def respond(
        self, text: str, language: str, prior_facts: list[dict]
    ) -> ProviderResult:
        raise APIError(
            503,
            "CONVERSATION_DISABLED",
            "Live conversation generation is not enabled.",
        )


_YEAR = r"(?:18|19|20)\d{2}"
_PROPER_WORD = r"[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’]*"
_PROPER_NAME = rf"{_PROPER_WORD}(?:[ -]{_PROPER_WORD}){{0,3}}"

_CORRECTION_PATTERNS = {
    "en": re.compile(
        rf"\b(?:Actually|In fact),?\s+(?:it|that)\s+was\s+"
        rf"(?P<year>{_YEAR})\b[.!?]?",
        re.IGNORECASE,
    ),
    "sv": re.compile(
        rf"\b(?:Egentligen|Faktiskt),?\s+var\s+det\s+"
        rf"(?P<year>{_YEAR})\b[.!?]?",
        re.IGNORECASE,
    ),
}

_MOVE_PATTERNS = {
    "en": (
        re.compile(
            rf"(?i:\b(?:I|we)(?:\s+(?:think|believe)(?:\s+that)?)?"
            rf"(?:\s+we)?\s+moved\s+to\s+)"
            rf"(?P<city>{_PROPER_NAME})(?i:\s+in\s+)"
            rf"(?P<year>{_YEAR})\b"
        ),
        re.compile(
            rf"(?i:\b(?:I|we)(?:\s+(?:think|believe)(?:\s+that)?)?"
            rf"(?:\s+we)?\s+moved\s+in\s+)(?P<year>{_YEAR})\b"
        ),
        re.compile(
            rf"(?i:\b(?:I|we)(?:\s+(?:think|believe)(?:\s+that)?)?"
            rf"(?:\s+we)?\s+moved\s+to\s+)(?P<city>{_PROPER_NAME})"
        ),
    ),
    "sv": (
        re.compile(
            rf"(?i:\b(?:jag|vi)(?:\s+tror(?:\s+att)?)?"
            rf"(?:\s+vi)?\s+flyttade\s+till\s+)"
            rf"(?P<city>{_PROPER_NAME})(?i:\s+(?:år\s+)?)"
            rf"(?P<year>{_YEAR})\b"
        ),
        re.compile(
            rf"(?i:\b(?:jag|vi)(?:\s+tror(?:\s+att)?)?"
            rf"(?:\s+vi)?\s+flyttade\s+(?:år\s+)?)(?P<year>{_YEAR})\b"
        ),
        re.compile(
            rf"(?i:\b(?:jag|vi)(?:\s+tror(?:\s+att)?)?"
            rf"(?:\s+vi)?\s+flyttade\s+till\s+)(?P<city>{_PROPER_NAME})"
        ),
    ),
}

_GREW_UP_PATTERNS = {
    "en": re.compile(rf"(?i:\bI\s+grew\s+up\s+in\s+)(?P<city>{_PROPER_NAME})"),
    "sv": re.compile(rf"(?i:\bJag\s+växte\s+upp\s+i\s+)(?P<city>{_PROPER_NAME})"),
}

_RELATIONSHIPS_EN = (
    "wife|husband|mother|father|sister|brother|daughter|son|partner|"
    "grandmother|grandfather"
)
_RELATIONSHIPS_SV = (
    "fru|make|man|mamma|mor|pappa|far|syster|bror|dotter|son|partner|"
    "mormor|morfar|farmor|farfar"
)
_RELATIONSHIP_PATTERNS = {
    "en": (
        re.compile(
            rf"(?i:\bMy\s+(?P<relationship>{_RELATIONSHIPS_EN})"
            rf"(?:'s|’s)\s+name\s+is\s+)(?P<name>{_PROPER_NAME})"
        ),
        re.compile(
            rf"(?i:\bMy\s+(?P<relationship>{_RELATIONSHIPS_EN})\s+is\s+)"
            rf"(?P<name>{_PROPER_NAME})"
        ),
    ),
    "sv": (
        re.compile(
            rf"(?i:\bMin\s+(?P<relationship>{_RELATIONSHIPS_SV})\s+heter\s+)"
            rf"(?P<name>{_PROPER_NAME})"
        ),
        re.compile(
            rf"(?i:\bMin\s+(?P<relationship>{_RELATIONSHIPS_SV})\s+är\s+)"
            rf"(?P<name>{_PROPER_NAME})"
        ),
    ),
}

_PERSON_PATTERNS = {
    "en": re.compile(rf"(?i:\bMy\s+name\s+is\s+)(?P<name>{_PROPER_NAME})"),
    "sv": re.compile(rf"(?i:\bJag\s+heter\s+)(?P<name>{_PROPER_NAME})"),
}

_EMOTIONS_EN = "nervous|happy|sad|afraid|scared|excited|lonely|calm|proud|worried"
_EMOTIONS_SV = "nervös|glad|ledsen|rädd|orolig|ensam|lugn|stolt|upprymd"
_EMOTION_PATTERNS = {
    "en": re.compile(
        rf"(?i:\bI\s+(?:felt|was)\s+)"
        rf"(?P<emotion>(?:(?i:a little|slightly|very|quite|really)\s+)?"
        rf"(?i:{_EMOTIONS_EN}))\b"
    ),
    "sv": re.compile(
        rf"(?i:\bJag\s+(?:kände\s+mig|var)\s+)"
        rf"(?P<emotion>(?:(?i:lite|något|mycket|väldigt|ganska|verkligen)\s+)?"
        rf"(?i:{_EMOTIONS_SV}))\b"
    ),
}

_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|"
    "November|December|januari|februari|mars|april|maj|juni|juli|augusti|"
    "september|oktober|november|december"
)
_DATE_PATTERNS = (
    re.compile(
        rf"\b(?P<value>\d{{1,2}}\s+(?i:{_MONTHS})\s+"
        rf"(?P<year>{_YEAR}))\b"
    ),
    re.compile(
        rf"\b(?P<value>(?i:{_MONTHS})\s+\d{{1,2}},\s+"
        rf"(?P<year>{_YEAR}))\b"
    ),
    re.compile(rf"\b(?P<value>(?P<year>{_YEAR})-\d{{2}}-\d{{2}})\b"),
    re.compile(
        rf"(?i:\bI\s+was\s+born\s+in\s+)(?P<value>(?P<year>{_YEAR}))\b"
    ),
    re.compile(
        rf"(?i:\bJag\s+föddes\s+(?:år\s+)?)(?P<value>(?P<year>{_YEAR}))\b"
    ),
)

_UNCERTAINTY = re.compile(
    r"\b(?:I\s+think|I\s+believe|maybe|perhaps|Jag\s+tror(?:\s+att)?|kanske)\b",
    re.IGNORECASE,
)
_HYPOTHETICAL_PREFIX = re.compile(
    r"(?:\bif|\bsuppose|\bimagine|\bom|\btänk\s+om)\s*$", re.IGNORECASE
)

_MONTH_NUMBERS = {
    "january": 1,
    "januari": 1,
    "february": 2,
    "februari": 2,
    "march": 3,
    "mars": 3,
    "april": 4,
    "may": 5,
    "maj": 5,
    "june": 6,
    "juni": 6,
    "july": 7,
    "juli": 7,
    "august": 8,
    "augusti": 8,
    "september": 9,
    "october": 10,
    "oktober": 10,
    "november": 11,
    "december": 12,
}


def _inside_quotation(text: str, start: int) -> bool:
    """Return true when a match starts inside a simple quoted passage."""

    prefix = text[:start]
    if prefix.count('"') % 2:
        return True
    # Do not mistake the apostrophe in e.g. "wife's" for an opening quote.
    straight_single_quotes = 0
    for index, character in enumerate(prefix):
        if character != "'":
            continue
        previous = text[index - 1] if index else ""
        following = text[index + 1] if index + 1 < len(text) else ""
        if previous.isalnum() and following.isalnum():
            continue
        straight_single_quotes += 1
    if straight_single_quotes % 2:
        return True
    if prefix.rfind("“") > prefix.rfind("”") or prefix.rfind("‘") > prefix.rfind("’"):
        return True
    return False


def _is_hypothetical(text: str, start: int) -> bool:
    boundary = max(text.rfind(mark, 0, start) for mark in ".!?;\n")
    return bool(_HYPOTHETICAL_PREFIX.search(text[boundary + 1 : start]))


def _is_uncertain(text: str, start: int, end: int) -> bool:
    boundary = max(text.rfind(mark, 0, start) for mark in ".!?;\n")
    return bool(_UNCERTAINTY.search(text[boundary + 1 : end]))


def _overlaps(span: tuple[int, int], occupied: list[tuple[int, int]]) -> bool:
    return any(span[0] < end and start < span[1] for start, end in occupied)


def _is_safe_match(text: str, match: re.Match[str]) -> bool:
    return not _inside_quotation(text, match.start()) and not _is_hypothetical(
        text, match.start()
    )


def _question_for(
    candidate: FactCandidate, language: str
) -> str:
    if candidate.slot == "move" and candidate.year is not None:
        if language == "sv":
            return f"Var {candidate.year} året då du flyttade?"
        return f"Was {candidate.year} the year you moved?"
    if language == "sv":
        return f'Du sa "{candidate.value}". Stämmer den uppgiften?'
    return f'You said "{candidate.value}". Is that detail correct?'


def _effective_prior_year(fact: dict) -> int | None:
    corrected = fact.get("corrected_value")
    if corrected is not None:
        years = re.findall(rf"\b{_YEAR}\b", str(corrected))
        if len(years) != 1:
            return None
        return int(years[0])

    year = fact.get("year")
    if isinstance(year, int) and re.fullmatch(_YEAR, str(year)):
        return year
    if isinstance(year, str) and re.fullmatch(_YEAR, year):
        return int(year)
    return None


def _latest_dated_prior(prior_facts: list[dict]) -> tuple[dict, int] | None:
    for fact in reversed(prior_facts):
        if str(fact.get("status", "")).casefold() == "rejected":
            continue
        if not fact.get("slot") or not fact.get("id"):
            continue
        year = _effective_prior_year(fact)
        # A correction supersedes the original value. If it is not a single,
        # explicit year, falling back to the old year would target the wrong
        # memory; stop instead of guessing or walking farther back in history.
        if fact.get("corrected_value") is not None and year is None:
            return None
        if year is not None:
            return fact, year
    return None


def _latest_dated_prior_for_slot(
    prior_facts: list[dict], slot: str
) -> tuple[dict, int] | None:
    for fact in reversed(prior_facts):
        if str(fact.get("status", "")).casefold() == "rejected":
            continue
        if fact.get("slot") != slot or not fact.get("id"):
            continue
        year = _effective_prior_year(fact)
        if fact.get("corrected_value") is not None and year is None:
            return None
        if year is not None:
            return fact, year
    return None


def _valid_explicit_date(value: str) -> bool:
    """Validate supported calendar dates without accepting normalized overflow."""

    if re.fullmatch(rf"{_YEAR}", value):
        return True
    if re.fullmatch(rf"{_YEAR}-\d{{2}}-\d{{2}}", value):
        try:
            date.fromisoformat(value)
        except ValueError:
            return False
        return True

    cleaned = value.replace(",", "")
    parts = cleaned.split()
    if len(parts) != 3:
        return False
    if parts[0].isdigit():
        day_text, month_text, year_text = parts
    else:
        month_text, day_text, year_text = parts
    month = _MONTH_NUMBERS.get(month_text.casefold())
    if month is None or not day_text.isdigit() or not year_text.isdigit():
        return False
    try:
        date(int(year_text), month, int(day_text))
    except ValueError:
        return False
    return True


def _base_reply(language: str, has_facts: bool) -> str:
    if language == "sv":
        return (
            "Tack för att du delar det minnet."
            if has_facts
            else "Tack för att du delar med dig. Jag lyssnar."
        )
    return (
        "Thank you for sharing that memory."
        if has_facts
        else "Thank you for sharing. I’m listening."
    )


class MockConversationProvider:
    """Small, deterministic bilingual matcher with no external dependencies."""

    mode = "mock"

    async def respond(
        self, text: str, language: str, prior_facts: list[dict]
    ) -> ProviderResult:
        if language not in {"en", "sv"}:
            raise ValueError("language must be 'en' or 'sv'")
        if len(text) > MAX_SOURCE_TEXT_LENGTH:
            raise ValueError(
                f"conversation source text must not exceed {MAX_SOURCE_TEXT_LENGTH} characters"
            )

        correction = _CORRECTION_PATTERNS[language].search(text)
        if correction and _is_safe_match(text, correction):
            prior = _latest_dated_prior(prior_facts)
            if prior is not None:
                prior_fact, previous_year = prior
                year_text = correction.group("year")
                year = int(year_text)
                if year == previous_year:
                    return ProviderResult(
                        text=_base_reply(language, True),
                        facts=[
                            FactCandidate(
                                fact_type=str(prior_fact.get("fact_type") or "date"),
                                value=year_text,
                                evidence=correction.group(0),
                                year=year,
                                slot=str(prior_fact["slot"]),
                            )
                        ],
                    )
                if language == "sv":
                    question = (
                        f"Du sa tidigare {previous_year}. "
                        f"Ska jag använda {year} i stället?"
                    )
                else:
                    question = (
                        f"You previously said {previous_year}. "
                        f"Should I use {year} instead?"
                    )
                candidate = FactCandidate(
                    fact_type=str(prior_fact.get("fact_type") or "date"),
                    value=year_text,
                    evidence=correction.group(0),
                    year=year,
                    slot=str(prior_fact["slot"]),
                    uncertain=True,
                    clarification_question=question,
                    conflicts_with_fact_id=str(prior_fact["id"]),
                )
                return ProviderResult(
                    text=f"{_base_reply(language, True)} {question}",
                    facts=[candidate],
                )

            # "It" has no safe referent. Do not manufacture one from the year.
            return ProviderResult(text=_base_reply(language, False), facts=[])

        matches: list[tuple[int, int, FactCandidate]] = []
        occupied: list[tuple[int, int]] = []

        def add(match: re.Match[str], candidate: FactCandidate) -> None:
            span = match.span()
            if (
                _overlaps(span, occupied)
                or not _is_safe_match(text, match)
                or candidate.value not in text
                or candidate.evidence not in text
                or len(candidate.value) > MAX_FACT_TEXT_LENGTH
                or len(candidate.evidence) > MAX_FACT_TEXT_LENGTH
                or (
                    candidate.year is not None
                    and str(candidate.year) not in candidate.evidence
                )
            ):
                return
            if _is_uncertain(text, *span):
                candidate.uncertain = True
                candidate.clarification_question = _question_for(candidate, language)
            occupied.append(span)
            matches.append((span[0], span[1], candidate))

        for pattern in _MOVE_PATTERNS[language]:
            for match in pattern.finditer(text):
                city = match.groupdict().get("city")
                year_text = match.groupdict().get("year")
                add(
                    match,
                    FactCandidate(
                        fact_type="event",
                        value=city or year_text or "",
                        evidence=match.group(0),
                        year=int(year_text) if year_text else None,
                        slot="move",
                    ),
                )

        for match in _GREW_UP_PATTERNS[language].finditer(text):
            add(
                match,
                FactCandidate(
                    fact_type="location",
                    value=match.group("city"),
                    evidence=match.group(0),
                    slot="grew_up_location",
                ),
            )

        for pattern in _RELATIONSHIP_PATTERNS[language]:
            for match in pattern.finditer(text):
                relationship = match.group("relationship")
                add(
                    match,
                    FactCandidate(
                        fact_type="relationship",
                        value=match.group("name"),
                        evidence=match.group(0),
                        slot=f"relationship:{relationship.casefold()}",
                    ),
                )

        for match in _PERSON_PATTERNS[language].finditer(text):
            add(
                match,
                FactCandidate(
                    fact_type="person",
                    value=match.group("name"),
                    evidence=match.group(0),
                    slot="person:self_name",
                ),
            )

        for match in _EMOTION_PATTERNS[language].finditer(text):
            add(
                match,
                FactCandidate(
                    fact_type="emotion",
                    value=match.group("emotion"),
                    evidence=match.group(0),
                    slot="emotion",
                ),
            )

        for pattern in _DATE_PATTERNS:
            for match in pattern.finditer(text):
                if not _valid_explicit_date(match.group("value")):
                    continue
                add(
                    match,
                    FactCandidate(
                        fact_type="date",
                        value=match.group("value"),
                        evidence=match.group(0),
                        year=int(match.group("year")),
                        slot="date",
                    ),
                )

        facts = [item[2] for item in sorted(matches, key=lambda item: item[0])[:MAX_FACTS]]
        for fact in facts:
            if fact.slot != "move" or fact.year is None:
                continue
            prior = _latest_dated_prior_for_slot(prior_facts, fact.slot)
            if prior is None:
                continue
            prior_fact, previous_year = prior
            if previous_year == fact.year:
                continue
            if language == "sv":
                question = (
                    f"Du sa tidigare {previous_year}. Är {fact.year} en separat flytt, "
                    f"eller en rättelse av {previous_year}?"
                )
            else:
                question = (
                    f"You previously said {previous_year}. Is {fact.year} a separate "
                    f"move, or a correction to {previous_year}?"
                )
            fact.uncertain = True
            fact.clarification_question = question
            fact.conflicts_with_fact_id = str(prior_fact["id"])

        reply = _base_reply(language, bool(facts))
        clarification = next(
            (fact.clarification_question for fact in facts if fact.clarification_question),
            None,
        )
        if clarification:
            reply = f"{reply} {clarification}"
        elif any(fact.slot == "move" for fact in facts):
            if language == "sv":
                reply = f"{reply} Vad minns du mest från den tiden?"
            else:
                reply = f"{reply} What do you remember most about that time?"
        return ProviderResult(text=reply, facts=facts)


__all__ = [
    "ConversationProvider",
    "DisabledConversationProvider",
    "FactCandidate",
    "MockConversationProvider",
    "ProviderResult",
]
