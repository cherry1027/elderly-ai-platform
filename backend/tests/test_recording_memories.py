import re
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.services.conversation_provider import FactCandidate
from app.services.recording_memories import MAX_RECORDED_MEMORIES, recording_memories
from tests.test_real_ai_api import SESSION, TRANSCRIPT, harness
from tests.test_live_talk import PATH, PCM, PREVIEW, SPOKEN, mounted_live


@pytest.mark.parametrize('language', ['en', 'sv'])
@pytest.mark.parametrize('length', [700, 2400, 32000])
def test_the_entire_original_survives_even_when_the_model_finds_no_facts(language, length):
    phrase = ('I carried the blue suitcase to the station. ' if language == 'en'
              else 'Jag bar den blå väskan till stationen. ')
    text = (phrase * (length // len(phrase) + 1))[:length]
    memories = recording_memories(text, [])
    assert 1 <= len(memories) <= 40
    assert all(0 < len(memory.value) <= 1000 and memory.value == memory.evidence
               and memory.value in text and not memory.uncertain for memory in memories)
    assert re.sub(r'\s', '', ''.join(memory.value for memory in memories)) == re.sub(r'\s', '', text)


def test_full_length_source_and_eight_model_facts_fit_without_dropping_uncertainty():
    text = ('A long remembered afternoon in the garden. ' * 1000)[:32000]
    facts = [FactCandidate('event', 'garden', 'garden', uncertain=True,
                           clarification_question='Which garden do you remember?') for _ in range(8)]
    memories = recording_memories(text, facts)
    assert len(memories) <= MAX_RECORDED_MEMORIES
    assert memories[-8:] == facts
    assert all(memory.clarification_question for memory in memories[-8:])
    assert re.sub(r'\s', '', ''.join(memory.value for memory in memories[:-8])) == re.sub(r'\s', '', text)


def test_an_exact_full_passage_reuses_its_existing_model_fact_and_clarification():
    text = 'I think we moved in 1975.'
    memory = FactCandidate('event', text, text, uncertain=True, clarification_question='Was it in 1975?')
    assert recording_memories(text, [memory]) == [memory]


@pytest.mark.parametrize('language', ['en', 'sv'])
def test_the_recording_message_entry_point_saves_full_passages_with_the_normal_turn(language, harness):
    app, gateway, _ = harness(language)
    text = ('We repaired the green bicycle. Then we ate plum cake. ' if language == 'en'
            else 'Vi lagade den gröna cykeln. Sedan åt vi plommonkaka. ') * 35
    gateway.transcript['text'] = text
    complete = gateway.complete
    payloads = []

    async def capture(claim, payload, provenance):
        if claim['kind'] == 'conversation':
            payloads.append(payload)
        return await complete(claim, payload, provenance)

    gateway.complete = capture
    with TestClient(app) as client:
        response = client.post(f'/api/v2/story-sessions/{SESSION}/messages',
            headers={'Idempotency-Key': str(uuid4())},
            json={'source_transcript_id': str(TRANSCRIPT), 'language': language})
    assert response.status_code == 200
    passages = [memory['value'] for memory in payloads[0]['memories'] if memory['value'] == memory['evidence']]
    assert re.sub(r'\s', '', ''.join(passages)) == re.sub(r'\s', '', text)
    assert all(passage in text for passage in passages)


def test_live_extraction_timeout_still_persists_the_whole_recorded_passage(mounted_live):
    app, gateway, _ = mounted_live
    captured = []
    complete = gateway.complete

    async def timeout(*_):
        raise TimeoutError()

    async def capture(claim, payload, provenance):
        if claim['kind'] == 'conversation':
            captured.extend(payload['memories'])
        return await complete(claim, payload, provenance)

    app.state.real_ai.require_preview_talk = lambda: SimpleNamespace(extract_live_memories=timeout)
    gateway.complete = capture
    with TestClient(app) as client, client.websocket_connect(PATH, headers={'Origin': PREVIEW}) as ws:
        ws.send_json({'token': 'test', 'key': str(uuid4())})
        ws.receive_json()
        ws.receive_json()
        ws.send_bytes(PCM)
        ws.send_text('stop')
        ws.receive_bytes()
        ws.receive_json()
        saved = ws.receive_json()
    assert saved['type'] == 'saved'
    assert saved['memories_checked'] is False
    assert captured[0]['value'] == SPOKEN['sv'].transcript
    assert captured[0]['evidence'] == SPOKEN['sv'].transcript
