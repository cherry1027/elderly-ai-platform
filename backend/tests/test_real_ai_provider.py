"""Offline real-adapter contracts; scripted output is not live AI quality proof."""

from __future__ import annotations

import asyncio
import base64
from copy import deepcopy
from hashlib import sha256
import io
import json
from pathlib import Path
import ssl
import wave

from pydantic import SecretStr
import pytest

from app.core.errors import APIError
from app.services.real_ai_provider import (
    MAX_HISTORY_CHARACTERS,
    MAX_HISTORY_MESSAGES,
    MAX_SPEECH_EVENT_BYTES,
    MAX_SPEECH_PCM_BYTES,
    RealAIProvider,
    RealtimeSpeechProvider,
)


CONFIRMED_ID = "11111111-1111-4111-8111-111111111111"
PENDING_ID = "22222222-2222-4222-8222-222222222222"
SPEECH_MODEL = "gpt-realtime-2.1-mini"
SYNTHETIC_KEY = "synthetic-server-only-test-secret"


class ScriptedClient:
    text_model = "configured-text-model"

    def __init__(self, responses=()):
        self.responses = list(responses)
        self.calls = []
        self.transcription_calls = []

    async def structured(self, operation, instructions, payload, schema, max_output_tokens):
        self.calls.append({
            "operation": operation, "instructions": instructions,
            "payload": deepcopy(payload), "schema": deepcopy(schema),
            "max_output_tokens": max_output_tokens,
        })
        value = self.responses.pop(0)
        if isinstance(value, BaseException):
            raise value
        return deepcopy(value)

    async def transcribe(self, path, language, model):
        self.transcription_calls.append((path, language, model))
        return "Jag bodde i Malmö."


def provider(client=None, **kwargs):
    return RealAIProvider(client or ScriptedClient(), transcription_model="gpt-transcribe", **kwargs)


def fact(identifier=CONFIRMED_ID, status="confirmed", **kwargs):
    return {
        "id": identifier, "status": status, "fact_type": "location", "value": "Malmö",
        "corrected_value": None, "year": None, "slot": "home", **kwargs,
    }


def extracted(language="sv", **kwargs):
    return {"language": language, "facts": [{
        "fact_type": "location", "value": "Lund", "evidence": "Lund",
        "year": None, "slot": "home", "uncertain": False,
        "clarification_question": None, **kwargs,
    }]}


@pytest.mark.parametrize("language,question", [
    ("sv", "Hur var det att bo där?"), ("en", "What was it like to live there?"),
])
def test_interviewer_receives_owned_ordered_context_and_pending_questions_not_ids(language, question):
    client = ScriptedClient([extracted(language), {"language": language, "text": question}])
    history = [
        {"role": "user", "text": "I remember the garden.", "sequence": 2, "id": "private-id"},
        {"role": "assistant", "text": "Who was there?", "sequence": 3, "token": "never-forward"},
    ]
    prior = [fact(), fact(PENDING_ID, "pending", value="Anna", fact_type="person", slot="friend",
                         uncertain=True, clarification_question="Var Anna din vän?")]
    result = asyncio.run(provider(client).respond("Lund", language, prior, history))
    assert result.text == question
    assert result.facts[0].value == "Lund"
    assert result.facts[0].conflicts_with_fact_id == CONFIRMED_ID
    assert result.facts[0].uncertain
    assert [call["operation"] for call in client.calls] == ["memory_extraction", "conversation"]
    reply = client.calls[1]
    assert reply["payload"]["language"] == language
    assert reply["payload"]["recent_messages"] == [
        {"role": row["role"], "text": row["text"]} for row in history
    ]
    assert reply["payload"]["confirmed_context"][0]["value"] == "Malmö"
    assert "Var Anna din vän?" in reply["payload"]["unresolved_questions"]
    boundary = json.dumps([call["payload"] for call in client.calls])
    for private in [CONFIRMED_ID, PENDING_ID, "private-id", "never-forward"]:
        assert private not in boundary
    assert "Anna" not in json.dumps(reply["payload"]["confirmed_context"])
    assert "at most ONE" in reply["instructions"]
    assert "untrusted quoted" in reply["instructions"]
    assert client.calls[0]["max_output_tokens"] == 2_400
    assert reply["max_output_tokens"] == 500
    assert history[0]["id"] == "private-id"  # Caller-owned snapshots are not mutated.


@pytest.mark.parametrize("messages", [
    [{"role": "system", "text": "untrusted"}],
    [{"role": "tool", "text": "untrusted"}],
    [{"role": "user", "text": ""}],
    [{"role": "user", "text": "bad\0text"}],
    [{"role": "user", "text": "bad\ud800text"}],
    [{"role": "user", "text": "x", "sequence": True}],
    [{"role": "user", "text": "x", "sequence": 2}, {"role": "assistant", "text": "y", "sequence": 1}],
    [{"role": "user", "text": "x", "sequence": 2}, {"role": "assistant", "text": "y", "sequence": 2}],
    [{"role": "user", "text": "x", "sequence": 2}, {"role": "assistant", "text": "y"}],
    [{"role": "user", "text": "x"}] * (MAX_HISTORY_MESSAGES + 1),
    [{"role": "user", "text": "x" * MAX_HISTORY_CHARACTERS}, {"role": "assistant", "text": "y"}],
    "not-a-list",
])
def test_invalid_history_rejected_before_any_provider_call(messages):
    client = ScriptedClient()
    with pytest.raises(APIError) as raised:
        asyncio.run(provider(client).respond("Lund", "sv", [], messages))
    assert raised.value.code == "AI_INPUT_LIMIT"
    assert not client.calls


def test_turn_preflight_is_synchronous_and_has_no_provider_or_spending_side_effects():
    client = ScriptedClient()
    instance = provider(client)
    assert instance.validate_turn_input("Jag bodde i Lund.", "sv", [fact()], [
        {"role": "assistant", "text": "Hur var det där?", "sequence": 1},
    ]) is None
    assert not client.calls and not client.transcription_calls
    with pytest.raises(APIError) as raised:
        instance.validate_turn_input("Lund", "sv", [], [{"role": "system", "text": "bad"}])
    assert raised.value.code == "AI_INPUT_LIMIT" and not client.calls


def test_oversized_extraction_payload_fails_preflight_before_claim_or_provider_calls():
    client = ScriptedClient()
    # Individually bounded, valid fields still exceed the total encoded envelope.
    facts = [fact(value="å" * 1000) for _ in range(100)]
    with pytest.raises(APIError) as raised:
        provider(client).validate_turn_input("Lund", "sv", facts)
    assert raised.value.code == "AI_INPUT_LIMIT" and not client.calls


def test_preflight_reserves_worst_case_question_bytes_before_first_paid_stage():
    client = ScriptedClient()
    # Extraction itself fits, but the maximum possible interviewer question
    # envelope does not. Rejecting now avoids paying to discover that later.
    history = [{"role": "user", "text": "x" * 32_000}]
    facts = [fact(value="x" * 1000) for _ in range(12)]
    with pytest.raises(APIError) as raised:
        provider(client).validate_turn_input("x" * 32_000, "en", facts, history)
    assert raised.value.code == "AI_INPUT_LIMIT" and not client.calls


@pytest.mark.parametrize("text,language,prior", [
    ("", "en", []), ("x", "de", []), ("x\0", "en", []),
    ("x", "en", [fact(id="not-a-uuid")]),
    ("x", "en", [fact(status="pending", uncertain=True, clarification_question="bad\0")]),
])
def test_invalid_current_source_or_memory_context_cannot_transmit(text, language, prior):
    client = ScriptedClient()
    with pytest.raises(APIError):
        asyncio.run(provider(client).respond(text, language, prior))
    assert not client.calls


def test_memory_extraction_uses_exact_current_source_not_prior_history_as_evidence():
    client = ScriptedClient([extracted(evidence="Malmö", value="Malmö")])
    with pytest.raises(APIError) as raised:
        asyncio.run(provider(client).respond("Lund", "sv", [fact()], [
            {"role": "user", "text": "I lived in Malmö."},
        ]))
    assert raised.value.code == "CONVERSATION_INVALID_RESPONSE"
    assert len(client.calls) == 1


@pytest.mark.parametrize("reply", [
    {"language": "en", "text": "Wrong language?"},
    {"language": "sv", "text": "Först? Sedan?"},
    {"language": "sv", "text": "x" * 1001},
    {"language": "sv", "text": "Bra?", "tool": "unsafe"},
])
def test_invalid_interviewer_output_is_not_returned_as_a_saved_reply(reply):
    client = ScriptedClient([{"language": "sv", "facts": []}, reply])
    with pytest.raises(APIError) as raised:
        asyncio.run(provider(client).respond("Jag minns inte.", "sv", []))
    assert raised.value.code == "CONVERSATION_INVALID_RESPONSE"


def test_provider_failure_does_not_leak_private_payload_or_retry():
    client = ScriptedClient([RuntimeError("synthetic-private-token-and-story")])
    with pytest.raises(APIError) as raised:
        asyncio.run(provider(client).respond("Lund", "sv", []))
    assert raised.value.code == "CONVERSATION_PROVIDER_FAILED"
    assert "synthetic-private" not in raised.value.message
    assert len(client.calls) == 1


def test_transcription_reuses_snapshot_client_with_current_languages_aware_model():
    client = ScriptedClient()
    result = asyncio.run(provider(client).transcribe(Path("/synthetic/upload.m4a"), "sv"))
    assert result == "Jag bodde i Malmö."
    assert client.transcription_calls == [(Path("/synthetic/upload.m4a"), "sv", "gpt-transcribe")]


def test_story_uses_confirmed_snapshots_and_separate_verifier_but_requires_human_review():
    source = {
        "memory_id": CONFIRMED_ID, "memory_version": 1,
        "source_message_id": PENDING_ID, "fact_type": "location", "value": "Malmö",
        "evidence": "Jag bodde i Malmö år 1974.", "corrected_value": None,
        "year": 1974, "slot": "home", "sentence": "Jag bodde i Malmö år 1974.",
    }
    writer = ScriptedClient([{"language": "sv", "content": source["sentence"]}])
    reviewer = ScriptedClient([{
        "language": "sv", "passed": True, "unsupported_claims": [], "paragraphs": [{
            "text": source["sentence"], "source_ids": [CONFIRMED_ID], "supported": True,
        }],
    }])
    reviewer.text_model = "separate-verifier-model"
    instance = provider(writer, verifier_client=reviewer)
    assert asyncio.run(instance.write("sv", "warm", [source])) == source["sentence"]
    assert writer.calls[0]["operation"] == "story_writer"
    assert reviewer.calls[0]["operation"] == "story_verifier"
    assert instance.human_review_required
    assert instance.mode == "openai"
    assert instance.text_model == writer.text_model
    assert instance.verifier_model == reviewer.text_model


@pytest.mark.parametrize("language,value,fact_type", [
    ("en", "Malmö", "location"), ("sv", "1974", "date"),
])
def test_raw_confirmed_value_is_quoted_for_writer_without_inference_or_mutating_snapshots(language, value, fact_type):
    source = {
        "memory_id": CONFIRMED_ID, "memory_version": 1,
        "source_message_id": PENDING_ID, "fact_type": fact_type, "value": value,
        "evidence": value, "corrected_value": None, "year": 1974 if fact_type == "date" else None,
        "slot": "home" if fact_type == "location" else "date", "sentence": value,
    }
    original = deepcopy(source)
    prefix = "I remember" if language == "en" else "Jag minns"
    sentence = f'{prefix}: "{value}".'
    client = ScriptedClient([
        {"language": language, "content": sentence},
        {"language": language, "passed": True, "unsupported_claims": [], "paragraphs": [{
            "text": sentence, "source_ids": [CONFIRMED_ID], "supported": True,
        }]},
    ])
    assert asyncio.run(provider(client).write(language, "warm", [source])) == sentence
    assert source == original
    assert client.calls[0]["payload"]["confirmed_sources"][0]["sentence"] == sentence
    assert client.calls[1]["payload"]["confirmed_sources"][0]["sentence"] == sentence
    for call in client.calls:
        snapshot = call["payload"]["confirmed_sources"][0]
        assert snapshot["value"] == value and snapshot["evidence"] == value
        assert {**snapshot, "sentence": value} == original


def test_raw_corrected_value_is_quoted_instead_of_promoting_old_value():
    source = {
        "memory_id": CONFIRMED_ID, "memory_version": 2, "source_message_id": PENDING_ID,
        "fact_type": "date", "value": "1974", "evidence": "1974", "corrected_value": "1975",
        "year": 1974, "slot": "date", "sentence": "1975",
    }
    sentence = 'Jag minns: "1975".'
    client = ScriptedClient([
        {"language": "sv", "content": sentence},
        {"language": "sv", "passed": True, "unsupported_claims": [], "paragraphs": [{
            "text": sentence, "source_ids": [CONFIRMED_ID], "supported": True,
        }]},
    ])
    assert asyncio.run(provider(client).write("sv", "warm", [source])) == sentence
    assert client.calls[0]["payload"]["confirmed_sources"][0]["sentence"] == sentence
    for call in client.calls:
        assert "authoritative user-confirmed" in call["instructions"]
        assert "Never infer a biographical relationship" in call["instructions"]


@pytest.mark.parametrize("change", ["invented-sentence", "nul", "extra-key", "duplicate-id"])
def test_writer_snapshot_adapter_preserves_strict_validation_before_transmission(change):
    source = {
        "memory_id": CONFIRMED_ID, "memory_version": 1, "source_message_id": PENDING_ID,
        "fact_type": "location", "value": "Malmö", "evidence": "Malmö", "corrected_value": None,
        "year": None, "slot": "home", "sentence": "Malmö",
    }
    rows = [source]
    if change == "invented-sentence": source["sentence"] = "Became an astronaut."
    if change == "nul": source["value"] = source["sentence"] = "Malmö\0"
    if change == "extra-key": source["unknown"] = "unsafe"
    if change == "duplicate-id": rows.append(deepcopy(source))
    client = ScriptedClient()
    with pytest.raises(APIError) as raised:
        asyncio.run(provider(client).write("sv", "warm", rows))
    assert raised.value.code == "STORY_CONTEXT_INVALID"
    assert not client.calls


def test_missing_speech_fails_closed_without_hidden_native_or_mock_fallback():
    with pytest.raises(APIError) as raised:
        asyncio.run(provider().synthesize("Hello.", "en"))
    assert raised.value.code == "AI_SPEECH_NOT_CONFIGURED"


class Governor:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def reserve(self, operation, model):
        self.calls.append((operation, model))
        if self.error:
            raise self.error
        return "synthetic-reservation"


class FakeSocket:
    def __init__(self, events):
        self.events = list(events)
        self.sent = []
        self.closed = False

    async def recv(self):
        event = self.events.pop(0)
        if isinstance(event, BaseException):
            raise event
        return json.dumps(event) if isinstance(event, dict) else event

    async def send(self, message):
        self.sent.append(json.loads(message))


class FakeConnector:
    def __init__(self, socket, governor):
        self.socket = socket
        self.calls = []
        self.governor = governor

    def __call__(self, uri, **kwargs):
        assert self.governor.calls == [("speech_synthesis", SPEECH_MODEL)]
        self.calls.append((uri, kwargs))
        return self

    async def __aenter__(self):
        return self.socket

    async def __aexit__(self, *args):
        self.socket.closed = True


def speech_events(text="Hello.", pcm=b"\x00\x00" * 2400):
    part = {"response_id": "resp_1", "item_id": "msg_1", "output_index": 0, "content_index": 0}
    events = [
        {"type": "session.created", "session": {"id": "session_1"}},
        {"type": "response.created", "response": {"id": "resp_1", "status": "in_progress"}},
        {"type": "response.output_item.added", "response_id": "resp_1", "output_index": 0,
         "item": {"id": "msg_1", "type": "message", "role": "assistant", "content": []}},
        {"type": "response.content_part.added", **part, "part": {"type": "audio", "transcript": ""}},
        {"type": "response.output_audio.delta", **part, "delta": base64.b64encode(pcm).decode()},
        {"type": "response.output_audio_transcript.delta", **part, "delta": text},
        {"type": "response.output_audio.done", **part},
        {"type": "response.output_audio_transcript.done", **part, "transcript": text},
        {"type": "response.done", "response": {
            "id": "resp_1", "status": "completed", "status_details": None,
            "output_modalities": ["audio"],
            "audio": {"output": {"format": {"type": "audio/pcm", "rate": 24000}, "voice": "marin"}},
            "output": [{"id": "msg_1", "type": "message", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_audio", "transcript": text}]}],
        }},
    ]
    for index, event in enumerate(events):
        event["event_id"] = f"event_{index}"
    return events


def speech_setup(events=None, governor=None, **kwargs):
    governor = governor or Governor()
    socket = FakeSocket(speech_events() if events is None else events)
    connector = FakeConnector(socket, governor)
    speech = RealtimeSpeechProvider(
        SecretStr(SYNTHETIC_KEY), governor, model=SPEECH_MODEL, connector=connector, **kwargs,
    )
    return speech, socket, connector, governor


@pytest.mark.parametrize("text,language", [("Hello.", "en"), ("Hur minns du Malmö?", "sv")])
def test_current_realtime_speech_buffers_exact_transcript_then_returns_valid_private_wav(text, language):
    speech, socket, connector, governor = speech_setup(speech_events(text))
    audio = asyncio.run(speech.synthesize(text, language))
    assert socket.closed and len(connector.calls) == 1
    assert governor.calls == [("speech_synthesis", SPEECH_MODEL)]
    uri, options = connector.calls[0]
    assert uri == "wss://api.openai.com/v1/realtime?model=" + SPEECH_MODEL
    assert SYNTHETIC_KEY not in uri
    assert options["additional_headers"] == {"Authorization": "Bearer " + SYNTHETIC_KEY}
    assert options["proxy"] is None and options["compression"] is None
    assert isinstance(options["ssl"], ssl.SSLContext)
    assert options["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert options["ssl"].check_hostname is True
    assert options["ssl"].keylog_filename is None
    assert options["ssl"].cert_store_stats()["x509_ca"] > 0
    assert options["max_size"] == MAX_SPEECH_EVENT_BYTES
    assert options["max_queue"] == 16
    request = socket.sent[0]["response"]
    assert request["conversation"] == "none" and request["tools"] == []
    assert request["tool_choice"] == "none"
    assert request["output_modalities"] == ["audio"]
    assert request["max_output_tokens"] == 1536
    payload = json.loads(request["input"][0]["content"][0]["text"])
    assert payload == {"language": language, "saved_assistant_text": text}
    assert "EXACTLY" in request["instructions"]
    with wave.open(io.BytesIO(audio.data), "rb") as stream:
        assert stream.getnchannels() == 1 and stream.getsampwidth() == 2
        assert stream.getframerate() == 24_000 and stream.getnframes() == 2_400
        assert stream.readframes(2_400) == b"\x00\x00" * 2400
    assert audio.media_type == "audio/wav"
    assert audio.duration_seconds == 0.1
    assert audio.sha256 == sha256(audio.data).hexdigest()
    assert audio.size_bytes == len(audio.data)
    assert audio.model == SPEECH_MODEL and audio.provider == "openai"
    assert "data=" not in repr(audio)


@pytest.mark.parametrize("failure", [
    "transcript-paraphrase", "final-transcript-mismatch", "partial-transcript", "invalid-base64",
    "cross-response", "cross-item", "extra-content", "duplicate-event", "odd-pcm",
    "no-audio", "audio-after-done", "duplicate-audio-done", "cancelled", "incomplete",
    "tool", "refusal", "wrong-codec", "wrong-rate", "wrong-voice", "missing-codec",
    "wrong-modality", "provider-error", "binary-event", "duplicate-json", "large-event",
])
def test_unverified_speech_never_releases_audio_and_never_retries(failure):
    events = speech_events()
    if failure == "transcript-paraphrase": events[5]["delta"] = "An extra greeting."
    if failure == "final-transcript-mismatch": events[-1]["response"]["output"][0]["content"][0]["transcript"] = "Changed."
    if failure == "partial-transcript": events[5]["delta"] = "Hell"
    if failure == "invalid-base64": events[4]["delta"] = "not base64!"
    if failure == "cross-response": events[4]["response_id"] = "other_response"
    if failure == "cross-item": events[5]["item_id"] = "other_item"
    if failure == "extra-content": events[-1]["response"]["output"][0]["content"].append({"type": "output_text", "text": "extra"})
    if failure == "duplicate-event": events.insert(5, deepcopy(events[4]))
    if failure == "odd-pcm": events[4]["delta"] = base64.b64encode(b"\0").decode()
    if failure == "no-audio": events.pop(4)
    if failure == "audio-after-done": events[4], events[6] = events[6], events[4]
    if failure == "duplicate-audio-done":
        repeated = deepcopy(events[6]); repeated["event_id"] = "another-event"
        events.insert(7, repeated)
    if failure in {"cancelled", "incomplete"}: events[-1]["response"]["status"] = failure
    if failure == "tool": events[-1]["response"]["output"][0]["type"] = "function_call"
    if failure == "refusal": events[3]["part"]["type"] = "refusal"
    if failure == "wrong-codec": events[-1]["response"]["audio"]["output"]["format"] = {"type": "audio/pcmu"}
    if failure == "wrong-rate": events[-1]["response"]["audio"]["output"]["format"]["rate"] = 16_000
    if failure == "wrong-voice": events[-1]["response"]["audio"]["output"]["voice"] = "another-voice"
    if failure == "missing-codec": events[-1]["response"].pop("audio")
    if failure == "wrong-modality": events[-1]["response"]["output_modalities"] = ["text", "audio"]
    if failure == "provider-error": events[1] = {"type": "error", "error": {"message": SYNTHETIC_KEY}}
    if failure == "binary-event": events[1] = b"binary-unsupported"
    if failure == "duplicate-json": events[1] = '{"type":"response.created","type":"error"}'
    if failure == "large-event": events[1] = "x" * (MAX_SPEECH_EVENT_BYTES + 1)
    speech, socket, connector, governor = speech_setup(events)
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value.code == "AI_SPEECH_INVALID_RESPONSE"
    assert SYNTHETIC_KEY not in raised.value.message
    assert socket.closed and len(connector.calls) == 1
    assert len(governor.calls) == 1


def test_speech_aggregate_pcm_limit_applies_across_small_valid_chunks():
    events = speech_events()
    chunk = b"\0\0" * 50_000
    repeated = []
    for index in range(MAX_SPEECH_PCM_BYTES // len(chunk) + 1):
        event = deepcopy(events[4])
        event["delta"] = base64.b64encode(chunk).decode()
        event["event_id"] = f"audio-chunk-{index}"
        repeated.append(event)
    events[4:5] = repeated
    speech, socket, connector, _ = speech_setup(events)
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value.code == "AI_SPEECH_INVALID_RESPONSE"
    assert socket.closed and len(connector.calls) == 1


@pytest.mark.parametrize("failure", [None, "foreign-item", "tool", "wrong-role", "changed-transcript",
                                      "extra-content", "early", "duplicate", "unfinished",
                                      "final-mismatch", "lifecycle-audio-spelling"])
def test_current_conversation_item_done_is_correlated_without_bypassing_final_verification(failure):
    events = speech_events()
    event = {"type": "conversation.item.done", "event_id": "conversation-done", "previous_item_id": None,
             "item": deepcopy(events[-1]["response"]["output"][0])}
    if failure == "foreign-item": event["item"]["id"] = "unrelated-item"
    if failure == "tool": event["item"]["type"] = "function_call"
    if failure == "wrong-role": event["item"]["role"] = "user"
    if failure == "changed-transcript": event["item"]["content"][0]["transcript"] = "Changed."
    if failure == "extra-content": event["item"]["content"].append({"type": "output_text", "text": "extra"})
    if failure == "unfinished": event["item"]["status"] = "in_progress"
    if failure == "lifecycle-audio-spelling": event["item"]["content"][0]["type"] = "audio"
    if failure == "final-mismatch": events[-1]["response"]["output"][0]["content"][0]["transcript"] = "Changed."
    events.insert(4 if failure == "early" else -1, event)
    if failure == "duplicate":
        repeated = deepcopy(event); repeated["event_id"] = "conversation-done-again"
        events.insert(-1, repeated)
    speech, socket, connector, governor = speech_setup(events)
    if failure in (None, "lifecycle-audio-spelling"):
        assert asyncio.run(speech.synthesize("Hello.", "en")).media_type == "audio/wav"
    else:
        with pytest.raises(APIError) as raised:
            asyncio.run(speech.synthesize("Hello.", "en"))
        assert raised.value.code == "AI_SPEECH_INVALID_RESPONSE"
    assert socket.closed and len(connector.calls) == len(governor.calls) == 1


@pytest.mark.parametrize("text,language", [("", "en"), ("x" * 1001, "en"), ("Hi\0", "en"), ("Hej", "de")])
def test_invalid_speech_input_is_neither_reserved_nor_transmitted(text, language):
    speech, _, connector, governor = speech_setup()
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize(text, language))
    assert raised.value.code == "AI_INPUT_LIMIT"
    assert not connector.calls and not governor.calls


def test_speech_approval_denial_stops_before_connection():
    error = APIError(503, "AI_SPENDING_NOT_APPROVED", "AI spending is not approved.")
    speech, _, connector, governor = speech_setup(governor=Governor(error))
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value is error
    assert governor.calls == [("speech_synthesis", SPEECH_MODEL)] and not connector.calls


@pytest.mark.parametrize("approved", [False, True])
def test_speech_dispatch_trace_distinguishes_local_denial_from_provider_attempt(approved):
    from app.services.openai_client import DispatchTrace, ai_dispatch_trace
    error = None if approved else APIError(503, "AI_SPENDING_NOT_APPROVED", "AI spending is not approved.")
    speech, _, _, _ = speech_setup(governor=Governor(error))
    trace = DispatchTrace()
    token = ai_dispatch_trace.set(trace)
    try:
        if approved:
            asyncio.run(speech.synthesize("Hello.", "en"))
        else:
            with pytest.raises(APIError):
                asyncio.run(speech.synthesize("Hello.", "en"))
        assert trace.dispatched is approved
    finally:
        ai_dispatch_trace.reset(token)


@pytest.mark.parametrize("error,code", [
    (TimeoutError("synthetic-private-source"), "AI_PROVIDER_TIMEOUT"),
    (ssl.SSLCertVerificationError(1, SYNTHETIC_KEY), "AI_PROVIDER_UNAVAILABLE"),
    (RuntimeError(SYNTHETIC_KEY), "AI_PROVIDER_UNAVAILABLE"),
])
def test_speech_transport_failures_are_sanitized_without_retry(error, code):
    speech, socket, connector, governor = speech_setup([{"type": "session.created"}, error])
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value.code == code
    assert SYNTHETIC_KEY not in raised.value.message
    assert socket.closed and len(connector.calls) == len(governor.calls) == 1


def test_speech_task_cancellation_propagates_and_closes_without_refund_or_retry():
    speech, socket, connector, governor = speech_setup([{"type": "session.created"}, asyncio.CancelledError()])
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert socket.closed and len(connector.calls) == len(governor.calls) == 1


def test_speech_wall_clock_deadline_closes_socket_without_retry():
    speech, socket, connector, governor = speech_setup(timeout_seconds=0.01)
    original_receive = socket.recv
    first = True

    async def stalls_after_session_created():
        nonlocal first
        if first:
            first = False
            return await original_receive()
        await asyncio.Event().wait()

    socket.recv = stalls_after_session_created
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value.code == "AI_PROVIDER_TIMEOUT"
    assert socket.closed and len(connector.calls) == len(governor.calls) == 1


def test_default_websocket_factory_blocks_handshake_redirects_without_network(monkeypatch):
    import websockets.asyncio.client

    governor = Governor()
    socket = FakeSocket(speech_events())
    recorded = []
    redirect_error = RuntimeError("synthetic redirect to untrusted origin")

    class Factory:
        def __init__(self, uri, **options):
            recorded.append((uri, options))

        def process_redirect(self, exception):
            raise AssertionError("The unsafe default redirect hook must be overridden")

        async def __aenter__(self):
            assert self.process_redirect(redirect_error) is redirect_error
            return socket

        async def __aexit__(self, *args):
            socket.closed = True

    monkeypatch.setattr(websockets.asyncio.client, "connect", Factory)
    speech = RealtimeSpeechProvider(SecretStr(SYNTHETIC_KEY), governor, model=SPEECH_MODEL)
    assert asyncio.run(speech.synthesize("Hello.", "en")).media_type == "audio/wav"
    assert socket.closed and len(recorded) == 1
    assert recorded[0][1]["proxy"] is None


def test_speech_event_count_bound_prevents_unlimited_no_audio_streams():
    from app.services.real_ai_provider import MAX_SPEECH_EVENTS
    events = [{"type": "session.created"}]
    events.extend({"type": "rate_limits.updated", "event_id": f"limit-{index}"}
                  for index in range(MAX_SPEECH_EVENTS + 1))
    speech, socket, connector, _ = speech_setup(events)
    with pytest.raises(APIError) as raised:
        asyncio.run(speech.synthesize("Hello.", "en"))
    assert raised.value.code == "AI_SPEECH_INVALID_RESPONSE"
    assert socket.closed and len(connector.calls) == 1


@pytest.mark.parametrize("kwargs", [
    {"model": "gpt-4o-mini-tts"}, {"model": "gpt-realtime-2.1-mini?other=host"},
    {"voice": "unapproved-cloned-voice"}, {"voice": []}, {"timeout_seconds": 0},
    {"timeout_seconds": 61}, {"timeout_seconds": True}, {"timeout_seconds": "30"},
])
def test_speech_configuration_is_explicit_current_and_bounded(kwargs):
    options = {"model": SPEECH_MODEL, **kwargs}
    with pytest.raises(APIError) as raised:
        RealtimeSpeechProvider(SecretStr(SYNTHETIC_KEY), Governor(), **options)
    assert raised.value.code == "AI_NOT_CONFIGURED"


def test_real_facade_does_not_accept_legacy_transcription_or_blank_text_model():
    with pytest.raises(APIError):
        RealAIProvider(ScriptedClient(), transcription_model="whisper-1")
    client = ScriptedClient()
    client.text_model = ""
    with pytest.raises(APIError):
        provider(client)
