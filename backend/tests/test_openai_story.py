"""Scripted writer/verifier responses; no model quality or paid-call claim."""

import asyncio
from uuid import UUID

import pytest

from app.core.errors import APIError
from app.services.openai_story import OpenAIStoryWriter
from tests.test_story_drafts import source_memory


class ScriptedClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    async def structured(self, operation, instructions, payload, schema, max_output_tokens):
        self.calls.append((operation, instructions, payload, schema, max_output_tokens))
        return self.responses.pop(0)


def scenario(language="sv"):
    source = source_memory()
    if language == "en":
        source["sentence"] = "I grew up in Malmö."
        source["evidence"] = "I grew up in Malmö"
    candidate = {"language": language, "content": source["sentence"]}
    review = {"language": language, "passed": True, "unsupported_claims": [], "paragraphs": [
        {"number": 1, "source_ids": [source["memory_id"]], "supported": True},
    ]}
    return source, candidate, review


@pytest.mark.parametrize("language", ["en", "sv"])
def test_story_requires_a_separate_complete_source_bound_verification_pass(language):
    source, candidate, review = scenario(language)
    writer, verifier = ScriptedClient([candidate]), ScriptedClient([review])
    result = asyncio.run(OpenAIStoryWriter(writer, verifier).write(language, "warm", [source]))
    assert result == source["sentence"]
    assert writer.calls[0][0] == "story_writer" and verifier.calls[0][0] == "story_verifier"
    assert verifier.calls[0][2]["candidate_paragraphs"] == [{"number": 1, "text": candidate["content"]}]
    assert verifier.calls[0][2]["confirmed_sources"] == [source]
    assert "untrusted data" in writer.calls[0][1] and "untrusted data" in verifier.calls[0][1]


@pytest.mark.parametrize("change", ["failed", "unsupported", "wrong-number", "foreign-source", "missing-source",
                                    "duplicate-source", "language", "unreviewed-paragraph", "negative-paragraph"])
def test_unsafe_or_incomplete_verification_blocks_the_candidate(change):
    source, candidate, review = scenario()
    if change == "failed": review["passed"] = False
    if change == "unsupported": review["unsupported_claims"] = ["Unfounded event"]
    if change == "wrong-number": review["paragraphs"][0]["number"] = 2
    if change == "foreign-source": review["paragraphs"][0]["source_ids"] = ["other-memory"]
    if change == "missing-source": review["paragraphs"][0]["source_ids"] = []
    if change == "duplicate-source": review["paragraphs"][0]["source_ids"] *= 2
    if change == "language": review["language"] = "en"
    if change == "unreviewed-paragraph": candidate["content"] += "\n\nJag vann ett pris."
    if change == "negative-paragraph": review["paragraphs"][0].update(supported=False, source_ids=[])
    client = ScriptedClient([candidate, review])
    with pytest.raises(APIError) as raised:
        asyncio.run(OpenAIStoryWriter(client).write("sv", "warm", [source]))
    assert raised.value.code == "DRAFT_VERIFICATION_FAILED"


@pytest.mark.parametrize("numbers", [[1, 2], [2, 1], [1, 1], [1, 3], [0, 1], [1, 201], [1, 2, 3]])
def test_numbered_review_requires_every_paragraph_once_in_order(numbers):
    source, candidate, review = scenario()
    paragraphs = [source["sentence"], 'Jag minns ”Malmö”.']
    candidate["content"] = "\r\n  \r\n".join(paragraphs)
    review["paragraphs"] = [{**review["paragraphs"][0], "number": number} for number in numbers]
    writer, verifier = ScriptedClient([candidate]), ScriptedClient([review])
    operation = OpenAIStoryWriter(writer, verifier).write("sv", "warm", [source])
    if numbers == [1, 2]:
        assert asyncio.run(operation) == candidate["content"]
    else:
        with pytest.raises(APIError) as raised:
            asyncio.run(operation)
        assert raised.value.code == "DRAFT_VERIFICATION_FAILED"
    assert len(writer.calls) == len(verifier.calls) == 1
    assert verifier.calls[0][2]["candidate_paragraphs"] == [
        {"number": number, "text": part} for number, part in enumerate(paragraphs, 1)
    ]


def test_multisection_swedish_draft_keeps_grounded_paragraphs_and_confirmed_sources():
    source, _, _ = scenario()
    rows = []
    for index in range(32):
        value = f"promenad nummer {index + 1}"
        sentence = f"Jag minns {value}."
        rows.append({**source, "memory_id": str(UUID(int=index + 1)), "fact_type": "event",
                     "value": value, "evidence": sentence, "sentence": sentence, "year": None, "slot": None})
    groups = [rows[offset:offset + 4] for offset in range(0, len(rows), 4)]
    paragraphs = [" ".join(row["sentence"] for row in group) for group in groups]
    content = "\n\n".join(paragraphs)
    candidate = {"language": "sv", "content": content}
    verdicts = [{"number": number, "source_ids": [row["memory_id"] for row in group], "supported": True}
                for number, group in enumerate(groups, 1)]
    review = {"language": "sv", "passed": True, "unsupported_claims": [], "paragraphs": verdicts}
    client = ScriptedClient([candidate, review])

    assert asyncio.run(OpenAIStoryWriter(client).write("sv", "warm", rows)) == content
    assert [call[0] for call in client.calls] == ["story_writer", "story_verifier"]
    assert client.calls[1][2] == {"language": "sv", "confirmed_sources": rows, "candidate_paragraphs": [
        {"number": number, "text": part} for number, part in enumerate(paragraphs, 1)
    ]}


def test_malformed_writer_never_triggers_verifier_and_no_sources_never_call_any_model():
    source, candidate, _ = scenario()
    client = ScriptedClient([{**candidate, "extra": "unsupported"}])
    with pytest.raises(APIError) as raised:
        asyncio.run(OpenAIStoryWriter(client).write("sv", "warm", [source]))
    assert raised.value.code == "AI_INVALID_RESPONSE" and len(client.calls) == 1
    client = ScriptedClient([])
    with pytest.raises(APIError):
        asyncio.run(OpenAIStoryWriter(client).write("sv", "warm", []))
    assert not client.calls


@pytest.mark.parametrize("stage", ["writer", "verifier"])
def test_unexpected_client_failure_is_sanitized_at_each_stage(stage):
    source, candidate, review = scenario()

    class FailingClient(ScriptedClient):
        async def structured(self, *args, **kwargs):
            raise RuntimeError("synthetic-private-source-and-token")

    writer = FailingClient([]) if stage == "writer" else ScriptedClient([candidate])
    verifier = FailingClient([]) if stage == "verifier" else ScriptedClient([review])
    with pytest.raises(APIError) as raised:
        asyncio.run(OpenAIStoryWriter(writer, verifier).write("sv", "warm", [source]))
    assert raised.value.code == "AI_PROVIDER_UNAVAILABLE"
    assert "synthetic-private" not in raised.value.message


def test_adversarial_verifier_evaluation_does_not_require_or_invoke_a_writer():
    source, candidate, review = scenario()
    candidate["content"] += "\n\nJag vann ett internationellt pris."
    review.update(passed=False, unsupported_claims=["Unsupported award"])
    verifier = ScriptedClient([review])
    provider = OpenAIStoryWriter(ScriptedClient([]), verifier)
    with pytest.raises(APIError) as raised:
        asyncio.run(provider.verify_candidate(candidate["content"], "sv", [source]))
    assert raised.value.code == "DRAFT_VERIFICATION_FAILED"
    assert len(verifier.calls) == 1 and verifier.calls[0][0] == "story_verifier"
