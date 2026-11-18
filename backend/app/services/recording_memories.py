"""Keep complete recorded wording available for human memory review."""

from app.services.conversation_provider import (
    MAX_FACTS, MAX_FACT_TEXT_LENGTH, MAX_SOURCE_TEXT_LENGTH, FactCandidate,
)

MAX_RECORDED_MEMORIES = 48  # Eight extracted details plus at most forty passages.


def recording_memories(text: str, candidates: list[FactCandidate]) -> list[FactCandidate]:
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_SOURCE_TEXT_LENGTH or len(candidates) > MAX_FACTS:
        raise ValueError("Invalid recorded memory source")
    remaining = text.strip()
    passages = []
    while remaining:
        end = min(MAX_FACT_TEXT_LENGTH, len(remaining))
        if end < len(remaining):
            boundary = max(remaining.rfind(' ', 800, end), remaining.rfind('\n', 800, end))
            if boundary >= 800:
                end = boundary
        passage = remaining[:end].strip()
        if passage:
            passages.append(passage)
        remaining = remaining[end:].lstrip()

    result = []
    used = set()
    for passage in passages:
        match = next((index for index, candidate in enumerate(candidates) if candidate.value == passage), None)
        if match is None:
            result.append(FactCandidate(fact_type='event', value=passage, evidence=passage))
        else:
            result.append(candidates[match])
            used.add(match)
    result.extend(candidate for index, candidate in enumerate(candidates) if index not in used)
    if len(result) > MAX_RECORDED_MEMORIES:
        raise ValueError("Recorded memory source exceeds its review limit")
    return result
