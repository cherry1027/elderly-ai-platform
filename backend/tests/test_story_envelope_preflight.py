"""Both model stages must fit before any writer request can spend."""

import asyncio
from copy import deepcopy
import json
from uuid import UUID

import pytest

from app.core.errors import APIError
from app.services.openai_client import MAX_JSON_BYTES, structured_body
from app.services.openai_story import (
    MAX_CANDIDATE_CHARACTERS, MAX_CANDIDATE_PARAGRAPHS, OpenAIStoryWriter,
    VERIFIER_INSTRUCTIONS, Verification, _request_size, _worst_case_paragraphs,
)
from app.services.real_ai_provider import _RealStoryClient


def sources(count=1, *, language="en", long=False):
    sentence = "Jag minns Malmö." if language == "sv" else "I remember Malmö."
    return [{"memory_id": str(UUID(int=100 + index)), "memory_version": 1,
        "source_message_id": str(UUID(int=500 + index)), "fact_type": "location",
        "value": "A" * 1000 if long else "Malmö", "evidence": "B" * 500 if long else "Malmö",
        "corrected_value": None, "year": None, "slot": None, "sentence": sentence}
        for index in range(count)]


class Client:
    text_model = "gpt-6.1-terra"

    def __init__(self, *, language="en", content=None):
        self.language = language
        self.content = content or ("Jag minns Malmö." if language == "sv" else "I remember Malmö.")
        self.calls = []

    async def structured(self, operation, instructions, payload, schema, max_output_tokens):
        # Mirror the real transport's before-dispatch limit, without a network,
        # credential, reservation or claim of factual/model correctness.
        body = structured_body(self.text_model, operation, instructions, payload, schema, max_output_tokens)
        assert len(json.dumps(body, ensure_ascii=False, allow_nan=False).encode()) <= MAX_JSON_BYTES
        self.calls.append(operation)
        if operation == "story_writer":
            return {"language": self.language, "content": self.content}
        return {"language": self.language, "passed": True, "unsupported_claims": [], "paragraphs": [
            {"number": part["number"], "source_ids": [payload["confirmed_sources"][0]["memory_id"]], "supported": True}
            for part in payload["candidate_paragraphs"]]}


@pytest.mark.parametrize("language", ["en", "sv"])
def test_normal_bilingual_story_retains_both_passes_and_original_sources(language):
    rows = sources(language=language)
    original = deepcopy(rows)
    client = Client(language=language)
    result = asyncio.run(OpenAIStoryWriter(_RealStoryClient(client)).write(language, "warm", rows))
    assert result == rows[0]["sentence"]
    assert client.calls == ["story_writer", "story_verifier"]
    assert rows == original


@pytest.mark.parametrize("count", [59, 100])
def test_context_that_cannot_fit_both_stages_is_rejected_before_writer(count):
    client = Client(content="I remember" + " word" * 3900)
    rows = sources(count, long=True)
    with pytest.raises(APIError) as error:
        asyncio.run(OpenAIStoryWriter(_RealStoryClient(client)).write("en", "warm", rows))
    assert error.value.code == "STORY_CONTEXT_LIMIT"
    assert client.calls == []


def test_direct_verifier_entry_rejects_oversized_actual_input_without_any_call():
    client = Client(content="I remember" + " word" * 3900)
    with pytest.raises(APIError) as error:
        asyncio.run(OpenAIStoryWriter(client).verify_candidate(client.content, "en", sources(59, long=True)))
    assert error.value.code == "STORY_CONTEXT_LIMIT" and client.calls == []


@pytest.mark.parametrize("control", ["\0", "\x01", "\x08", "\x0b", "\x0c", "\x1f"])
def test_unusual_control_output_cannot_consume_a_verifier_call(control):
    client = Client(content="I remember " + control + " Malmö.")
    with pytest.raises(APIError) as error:
        asyncio.run(OpenAIStoryWriter(client).write("en", "warm", sources()))
    assert error.value.code == "AI_INVALID_RESPONSE"
    assert client.calls == ["story_writer"]


def test_printable_unicode_quotes_slashes_and_normal_whitespace_remain_supported():
    content = 'I remember "Malmö" and a path \\ home. 🌷\n\nMy memory\tcontinues.\r\n'
    client = Client(content=content)
    assert asyncio.run(OpenAIStoryWriter(client).write("en", "warm", sources())) == content
    assert client.calls == ["story_writer", "story_verifier"]


def test_too_many_candidate_paragraphs_cannot_consume_a_verifier_call():
    client = Client(content="\n\n".join(["I remember Malmö."] * (MAX_CANDIDATE_PARAGRAPHS + 1)))
    with pytest.raises(APIError) as error:
        asyncio.run(OpenAIStoryWriter(client).write("en", "warm", sources()))
    assert error.value.code == "AI_INVALID_RESPONSE"
    assert client.calls == ["story_writer"]


@pytest.mark.parametrize("character", ['"', "\\", "\n", "\t", "\r", "å", "中", "🌷", "\u2028"])
def test_quote_placeholder_bounds_every_accepted_character_in_nested_transport(character):
    client = Client()
    def size(paragraphs):
        return _request_size(client, "story_verifier", VERIFIER_INSTRUCTIONS,
            {"language": "en", "candidate_paragraphs": paragraphs, "confirmed_sources": sources()}, Verification.model_json_schema())
    paragraphs = [{"number": number, "text": character * (MAX_CANDIDATE_CHARACTERS // MAX_CANDIDATE_PARAGRAPHS)}
                  for number in range(1, MAX_CANDIDATE_PARAGRAPHS + 1)]
    assert size(paragraphs) <= size(_worst_case_paragraphs())


def test_real_wrapper_size_hook_accounts_for_authoritative_correction_instructions():
    client = Client()
    wrapper = _RealStoryClient(client)
    arguments = ("story_verifier", VERIFIER_INSTRUCTIONS,
                 {"language": "en", "candidate_paragraphs": [{"number": 1, "text": "I remember."}], "confirmed_sources": sources()},
                 Verification.model_json_schema())
    assert _request_size(wrapper, *arguments) > _request_size(client, *arguments)
    assert client.calls == []
