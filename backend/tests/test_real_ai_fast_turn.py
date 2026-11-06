"""Offline single-turn latency contracts; these are not live quality proof."""

import asyncio
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
from pydantic import SecretStr
import pytest

from app.core.errors import APIError
from app.services.openai_client import OpenAIClient
from app.services.real_ai_provider import COMBINED_TURN_SCHEMA, RealAIProvider
from tests.test_real_ai_api import harness
from tests.test_real_ai_provider import ScriptedClient, extracted, fact, CONFIRMED_ID, PENDING_ID
from tests.test_real_text_chat import text_harness, send
from tests.test_real_text_only import install


def fast(client):
    return RealAIProvider(client, transcription_model="gpt-transcribe", combined_turn=True)


def combined(language="en", text="What do you remember about that place?"):
    return {"extraction": extracted(language), "reply": {"language": language, "text": text}}


@pytest.mark.parametrize("language,reply", [("en", "What do you remember?"), ("sv", "Vad minns du?")])
def test_one_bounded_request_preserves_exact_sources_owned_conflicts_and_context(language, reply):
    client = ScriptedClient([combined(language, reply)])
    history = [{"role": "assistant", "text": "Tell me about your home.", "sequence": 1, "token": "never-forward"}]
    pending = fact(PENDING_ID, "pending", value="Anna", fact_type="person", slot="friend",
                   uncertain=True, clarification_question="Was Anna your friend?")
    result = asyncio.run(fast(client).respond("Lund", language, [fact(), pending], history))
    assert result.text == reply and result.facts[0].value == "Lund"
    assert result.facts[0].uncertain and result.facts[0].conflicts_with_fact_id == CONFIRMED_ID
    assert result.facts[0].clarification_question
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["operation"] == "conversation" and call["max_output_tokens"] == 2900
    assert call["schema"] == COMBINED_TURN_SCHEMA
    assert call["payload"]["source_text"] == "Lund"
    assert call["payload"]["recent_messages"] == [{"role": "assistant", "text": "Tell me about your home."}]
    assert "Was Anna your friend?" in call["payload"]["unresolved_questions"]
    encoded = json.dumps(call["payload"])
    for private in (CONFIRMED_ID, PENDING_ID, "never-forward"):
        assert private not in encoded
    assert "Anna" not in json.dumps(call["payload"]["confirmed_context"])
    assert history[0]["token"] == "never-forward"


@pytest.mark.parametrize("change", [
    lambda body: {**body, "extra": True},
    lambda body: {"reply": body["reply"]},
    lambda body: {**body, "extraction": {"language": "sv", "facts": []}},
    lambda body: {**body, "reply": {"language": "sv", "text": "Vad minns du?"}},
    lambda body: {**body, "reply": {"language": "en", "text": ""}},
    lambda body: {**body, "reply": {"language": "en", "text": "x" * 1001}},
    lambda body: {**body, "reply": {"language": "en", "text": "Who? Where?"}},
    lambda body: {**body, "extraction": extracted("en", evidence="Invented place")},
    lambda body: {**body, "extraction": extracted("en", year=1974)},
    lambda body: {**body, "extraction": extracted("en", status="confirmed")},
    lambda body: {**body, "extraction": extracted("en", uncertain=True, clarification_question=None)},
])
def test_invalid_either_half_rejects_whole_turn_without_second_paid_request(change):
    client = ScriptedClient([change(combined())])
    with pytest.raises(APIError) as rejected:
        asyncio.run(fast(client).respond("Lund", "en", []))
    assert rejected.value.code == "CONVERSATION_INVALID_RESPONSE" and len(client.calls) == 1


def test_history_never_supplies_extraction_evidence():
    client = ScriptedClient([combined()])
    with pytest.raises(APIError):
        asyncio.run(fast(client).respond("I do not remember.", "en", [], [{"role": "user", "text": "Lund"}]))
    assert len(client.calls) == 1


@pytest.mark.parametrize("language,source,reply", [
    ("en", "Lund. Please stop now.", "Of course. We can stop here."),
    ("sv", "Lund. Jag vill pausa nu.", "Självklart. Vi kan pausa här."),
])
def test_locally_detected_conflict_does_not_append_question_to_stop_reply(language, source, reply):
    client = ScriptedClient([combined(language, reply)])
    result = asyncio.run(fast(client).respond(source, language, [fact()]))
    assert result.text == reply and "?" not in result.text
    assert result.facts[0].uncertain and result.facts[0].clarification_question
    instructions = client.calls[0]["instructions"]
    assert "not extractable biography" in instructions and "never support an assertion" in instructions


def test_budget_preflight_counts_exact_combined_envelope_once_and_fails_before_dispatch():
    class Governor:
        budget_policy_path = "synthetic-policy"
        groups = []

        def check_request_group(self, calls):
            self.groups.append(calls)
            raise APIError(429, "AI_GLOBAL_BUDGET_EXHAUSTED", "Closed")

    client = ScriptedClient([combined()]); client.governor = Governor()
    with pytest.raises(APIError) as rejected:
        asyncio.run(fast(client).respond("Lund", "en", []))
    assert rejected.value.code == "AI_GLOBAL_BUDGET_EXHAUSTED" and client.calls == []
    assert len(client.governor.groups) == 1 and len(client.governor.groups[0]) == 1
    assert client.governor.groups[0][0][0] == client.text_model
    assert client.governor.groups[0][0][1] > 0 and client.governor.groups[0][0][2] == 2900


def test_provider_failure_or_cancel_never_falls_back_to_two_stage():
    for cause in (APIError(504, "AI_PROVIDER_TIMEOUT", "Timeout"), asyncio.CancelledError()):
        client = ScriptedClient([cause])
        with pytest.raises(type(cause)):
            asyncio.run(fast(client).respond("Lund", "en", []))
        assert len(client.calls) == 1


def test_exactly_one_attempt_and_original_input_on_api_replay_and_one_call_admission(tmp_path, text_harness):
    app, gateway, _ = text_harness()
    runtime = install(app, tmp_path, object(), real_ai_combined_turn_enabled=True, real_ai_text_only=False)
    approval = runtime.settings.live_ai_approval_path
    data = json.loads(approval.read_text()); data["max_calls"] = 1
    approval.write_text(json.dumps(data))
    seen = []
    def transport(request):
        body = json.loads(request.content); seen.append(body["text"]["format"]["name"])
        result = {"extraction": {"language": "en", "facts": []}, "reply": {"language": "en", "text": "What would you like to remember?"}}
        return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": json.dumps(result)}]}]})
    adapter = OpenAIClient(SecretStr("synthetic-only"), "gpt-test", runtime.governor, transport=httpx.MockTransport(transport))
    runtime.provider = fast(adapter)
    assert runtime.capabilities()["conversation"] and not runtime.capabilities()["writing"]
    key = uuid4()
    with TestClient(app) as client:
        first = send(client, "  Keep my exact words.\n", key=key)
        replay = send(client, "  Keep my exact words.\n", key=key)
        closed = send(client, "Another explicit turn.")
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json() and first.json()["user_message"]["text"] == "  Keep my exact words.\n"
    assert seen == ["conversation"] and len(gateway.original_inputs) == 1
    assert closed.status_code == 429
    with sqlite3.connect(runtime.settings.ai_usage_ledger_path) as con:
        assert con.execute("SELECT operation FROM reservations").fetchall() == [("conversation",)]
        assert con.execute("SELECT reserved_calls FROM approvals").fetchall() == [(1,)]


def test_default_provider_keeps_two_stage_contract():
    client = ScriptedClient([extracted("en"), {"language": "en", "text": "What do you remember?"}])
    regular = RealAIProvider(client, transcription_model="gpt-transcribe")
    asyncio.run(regular.respond("Lund", "en", []))
    assert regular.conversation_calls == 2 and [c["operation"] for c in client.calls] == ["memory_extraction", "conversation"]
