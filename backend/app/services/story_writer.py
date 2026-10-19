"""Deterministic Day 5 story writing and independent factual verification.

The mock writer does not paraphrase. It joins database-produced, canonical
first-person sentences so that every word in a draft remains attributable to
confirmed source context.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Protocol
from uuid import UUID

from app.core.errors import APIError


MAX_SOURCES = 200
MAX_CONTENT_LENGTH = 20_000
MAX_SOURCE_FIELD_LENGTH = 1_000
MAX_SOURCE_SENTENCE_LENGTH = 2_000
MAX_UNSUPPORTED_CLAIMS = 20
MAX_UNSUPPORTED_CLAIM_LENGTH = 1_000

_FACT_TYPES = {"person", "relationship", "date", "location", "event", "emotion"}

_SOURCE_FIELDS = {
    "memory_id",
    "memory_version",
    "source_message_id",
    "fact_type",
    "value",
    "evidence",
    "corrected_value",
    "year",
    "slot",
    "sentence",
}


class StoryWriter(Protocol):
    mode: str

    async def write(
        self, language: str, style: str, source_memories: list[dict]
    ) -> str: ...


@dataclass
class StoryVerification:
    status: str
    unsupported_claims: list[str]


def _invalid_request() -> APIError:
    return APIError(422, "VALIDATION_ERROR", "Request validation failed.")


def _invalid_context() -> APIError:
    return APIError(
        503,
        "STORY_CONTEXT_INVALID",
        "The confirmed story context is invalid.",
    )


def _context_limit() -> APIError:
    return APIError(
        409,
        "STORY_CONTEXT_LIMIT",
        "The confirmed story context is too large to generate safely.",
    )


def _validate_options(language: str, style: str) -> None:
    if language not in {"en", "sv"} or style != "warm":
        raise _invalid_request()


def _is_canonical_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = UUID(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return str(parsed) == value


def _valid_required_text(value: object, *, maximum: int) -> bool:
    return (
        isinstance(value, str)
        and value == value.strip()
        and 0 < len(value) <= maximum
    )


def _valid_optional_text(value: object, *, maximum: int) -> bool:
    return value is None or _valid_required_text(value, maximum=maximum)


def _is_first_person(sentence: str, language: str) -> bool:
    prefixes = ("I ", "My ") if language == "en" else ("Jag ", "Min ")
    return sentence.startswith(prefixes)


def _validated_sentences(
    language: str, style: str, source_memories: list[dict]
) -> list[str]:
    _validate_options(language, style)
    if not isinstance(source_memories, list):
        raise _invalid_context()
    if not source_memories:
        raise APIError(
            409,
            "NO_CONFIRMED_MEMORIES",
            "No confirmed memories are available for story generation.",
        )
    if len(source_memories) > MAX_SOURCES:
        raise _context_limit()

    sentences: list[str] = []
    seen: set[str] = set()
    memory_ids: set[str] = set()
    for source in source_memories:
        if type(source) is not dict or set(source) != _SOURCE_FIELDS:
            raise _invalid_context()
        if not _is_canonical_uuid(source["memory_id"]):
            raise _invalid_context()
        if source["memory_id"] in memory_ids:
            raise _invalid_context()
        memory_ids.add(source["memory_id"])
        if not _is_canonical_uuid(source["source_message_id"]):
            raise _invalid_context()

        version = source["memory_version"]
        if (
            isinstance(version, bool)
            or not isinstance(version, int)
            or not 1 <= version <= 2_147_483_647
        ):
            raise _invalid_context()

        for field in ("value", "evidence"):
            if not _valid_required_text(
                source[field], maximum=MAX_SOURCE_FIELD_LENGTH
            ):
                raise _invalid_context()
        if source["fact_type"] not in _FACT_TYPES:
            raise _invalid_context()
        if not _valid_optional_text(
            source["corrected_value"], maximum=MAX_SOURCE_FIELD_LENGTH
        ):
            raise _invalid_context()
        if not _valid_optional_text(source["slot"], maximum=80):
            raise _invalid_context()

        year = source["year"]
        if year is not None and (
            isinstance(year, bool)
            or not isinstance(year, int)
            or not 1 <= year <= 2100
        ):
            raise _invalid_context()

        sentence = source["sentence"]
        if (
            not _valid_required_text(sentence, maximum=MAX_SOURCE_SENTENCE_LENGTH)
            or "\n" in sentence
            or "\r" in sentence
            or not _is_first_person(sentence, language)
        ):
            raise _invalid_context()
        if sentence not in seen:
            seen.add(sentence)
            sentences.append(sentence)

    content = "\n\n".join(sentences)
    if not content:
        raise _invalid_context()
    if len(content) > MAX_CONTENT_LENGTH:
        raise _context_limit()
    return sentences


def _canonical_content(
    language: str, style: str, source_memories: list[dict]
) -> str:
    return "\n\n".join(_validated_sentences(language, style, source_memories))


def _clip_claim(value: str) -> str:
    compact = value.strip()
    if not compact:
        compact = "Unsupported story difference."
    return compact[:MAX_UNSUPPORTED_CLAIM_LENGTH]


def _unsupported_differences(expected: str, actual: str) -> list[str]:
    """Return bounded changed fragments, never a full large candidate draft."""

    matcher = SequenceMatcher(None, expected, actual, autojunk=True)
    results: list[str] = []
    seen: set[str] = set()
    for operation, expected_start, expected_end, actual_start, actual_end in matcher.get_opcodes():
        if operation == "equal":
            continue
        if operation == "delete":
            fragment = "Missing canonical text: " + expected[
                expected_start:expected_end
            ]
        else:
            fragment = actual[actual_start:actual_end]
        fragment = _clip_claim(fragment)
        if fragment not in seen:
            seen.add(fragment)
            results.append(fragment)
        if len(results) >= MAX_UNSUPPORTED_CLAIMS:
            break
    return results or ["Story content did not match its confirmed sources."]


class DisabledStoryWriter:
    mode = "disabled"

    async def write(
        self, language: str, style: str, source_memories: list[dict]
    ) -> str:
        raise APIError(
            503,
            "STORY_GENERATION_DISABLED",
            "Story generation is not enabled.",
        )


class MockStoryWriter:
    mode = "mock"

    async def write(
        self, language: str, style: str, source_memories: list[dict]
    ) -> str:
        return _canonical_content(language, style, source_memories)


def verify_story(
    content: str,
    language: str,
    style: str,
    source_memories: list[dict],
    canonical_content: str,
) -> StoryVerification:
    """Independently recompute source text and require byte-for-byte equality."""

    expected = _canonical_content(language, style, source_memories)
    unsupported: list[str] = []

    if (
        not isinstance(canonical_content, str)
        or not canonical_content
        or len(canonical_content) > MAX_CONTENT_LENGTH
        or canonical_content != expected
    ):
        unsupported.append(
            "Canonical story content did not match the validated memories."
        )

    if not isinstance(content, str) or not content:
        unsupported.append("Generated story content was empty or invalid.")
    elif len(content) > MAX_CONTENT_LENGTH:
        unsupported.append("Generated story content exceeded the safe length limit.")
    elif content != expected:
        unsupported.extend(_unsupported_differences(expected, content))

    bounded: list[str] = []
    seen: set[str] = set()
    for claim in unsupported:
        claim = _clip_claim(claim)
        if claim not in seen:
            seen.add(claim)
            bounded.append(claim)
        if len(bounded) >= MAX_UNSUPPORTED_CLAIMS:
            break

    if bounded:
        return StoryVerification(status="blocked", unsupported_claims=bounded)
    return StoryVerification(status="passed", unsupported_claims=[])


__all__ = [
    "DisabledStoryWriter",
    "MockStoryWriter",
    "StoryVerification",
    "StoryWriter",
    "verify_story",
]
