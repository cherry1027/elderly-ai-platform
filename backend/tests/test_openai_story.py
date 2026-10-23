"""Scripted writer/verifier responses; no model quality or paid-call claim."""

import asyncio
from copy import deepcopy

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
        {"text": source["sentence"], "source_ids": [source["memory_id"]], "supported": True},
    ]}
    return source, candidate, review


@pytest.mark.parametrize("language", ["en", "sv"])
def test_story_requires_a_separate_complete_source_bound_verification_pass(language):
    source, candidate, review = scenario(language)
    writer, verifier = ScriptedClient([candidate]), ScriptedClient([review])
    result = asyncio.run(OpenAIStoryWriter(writer, verifier).write(language, "warm", [source]))
    assert result == source["sentence"]
    assert writer.calls[0][0] == "story_writer" and verifier.calls[0][0] == "story_verifier"
    assert verifier.calls[0][2]["candidate"] == candidate["content"]
    assert verifier.calls[0][2]["confirmed_sources"] == [source]
    assert "untrusted data" in writer.calls[0][1] and "untrusted data" in verifier.calls[0][1]


@pytest.mark.parametrize("change", ["failed", "unsupported", "missing", "foreign", "language", "unreviewed-paragraph"])
def test_unsafe_or_incomplete_verification_blocks_the_candidate(change):
    source, candidate, review = scenario()
    if change == "failed": review["passed"] = False
    if change == "unsupported": review["unsupported_claims"] = ["Unfounded event"]
    if change == "missing": review["paragraphs"][0]["text"] = "Different paragraph"
    if change == "foreign": review["paragraphs"][0]["source_ids"] = ["other-memory"]
    if change == "language": review["language"] = "en"
    if change == "unreviewed-paragraph": candidate["content"] += "\n\nJag vann ett pris."
    client = ScriptedClient([candidate, review])
    with pytest.raises(APIError) as raised:
        asyncio.run(OpenAIStoryWriter(client).write("sv", "warm", [source]))
    assert raised.value.code == "DRAFT_VERIFICATION_FAILED"


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
