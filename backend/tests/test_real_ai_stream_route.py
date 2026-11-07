"""Opt-in early reply UI transport, never a replacement for atomic completion."""
import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.real_ai import get_real_gateway
from app.core.errors import APIError
from app.services.real_ai_progress import emit_progress, turn_progress
from app.services.real_ai_streaming import stream_turn_response
from tests.test_real_ai_api import harness, PROJECT, SESSION, TRANSCRIPT, OTHER
from tests.test_real_text_chat import text_harness, send, ORIGINAL


def enable(app):
    app.state.settings.real_ai_stream_turn_enabled = True
    app.state.settings.real_ai_combined_turn_enabled = True


def streamed(client, key=None, text="I remember the garden."):
    return client.post(f"/api/v2/story-sessions/{SESSION}/text-messages",
        json={"text": text, "language": "en"},
        headers={"Accept": "text/event-stream", "Idempotency-Key": str(key or uuid4())})


def frames(response):
    assert response.headers['content-type'].startswith('text/event-stream')
    assert response.headers['cache-control']=='no-store'
    return [json.loads(frame.removeprefix('data: ')) for frame in response.text.strip().split('\n\n')]


def test_preview_precedes_atomic_save_and_final_preserves_original(text_harness):
    app, gateway, provider = text_harness(); enable(app)
    respond=provider.respond
    async def preview(*args, **kwargs):
        result=await respond(*args, **kwargs)
        assert not gateway.saved_messages
        await emit_progress({'type':'reply','text':result.text})
        return result
    provider.respond=preview
    with TestClient(app) as client:
        response=streamed(client,text='  My exact words.\n')
    events=frames(response)
    assert [e['type'] for e in events]==['operation','reply','saving','completed']
    operation=events[0]
    assert operation['operation_id']==response.headers['x-memy-operation-id']
    assert operation['project_id']==str(PROJECT) and operation['session_id']==str(SESSION)
    final=events[-1]['result']
    assert final['message']['text']==events[1]['text']
    assert final['user_message']['text']=='  My exact words.\n' and final['user_message']['provenance']==ORIGINAL
    assert provider.calls==gateway.claim_count==1 and len(gateway.original_inputs)==1


def test_old_json_clients_and_feature_disabled_remain_unchanged(text_harness):
    for stream_setting, accept in [(False,'text/event-stream'),(True,'application/json')]:
        app,gateway,provider=text_harness();enable(app);app.state.settings.real_ai_stream_turn_enabled=stream_setting
        with TestClient(app) as client:
            response=client.post(f'/api/v2/story-sessions/{SESSION}/text-messages',json={'text':'Hello','language':'en'},
                headers={'Accept':accept,'Idempotency-Key':str(uuid4())})
        assert response.status_code==200 and response.headers['content-type']=='application/json'
        assert response.json()['mode']=='real' and provider.calls==1


def test_replay_is_free_json_and_never_starts_a_second_stream(text_harness):
    app,gateway,provider=text_harness();enable(app);key=uuid4()
    with TestClient(app) as client:
        first=streamed(client,key);again=streamed(client,key)
    assert frames(first)[-1]['result']==again.json()
    assert again.headers['content-type']=='application/json' and provider.calls==1


@pytest.mark.parametrize('failure,status,code', [('owner',404,'SESSION_NOT_FOUND'),('closed',503,'LIVE_AI_DISABLED'),('scope',503,'TEXT_CHAT_NOT_READY')])
def test_preclaim_failures_keep_normal_http_status_and_never_start_stream(failure,status,code,text_harness):
    app,gateway,provider=text_harness();enable(app)
    if failure=='owner':gateway.owned=False
    elif failure=='closed':app.state.settings.real_ai_conversation_enabled=False
    else:gateway.scope_error=APIError(503,'SUPABASE_UNAVAILABLE','private')
    with TestClient(app) as client:response=streamed(client)
    assert response.status_code==status and response.json()['error']['code']==code
    assert response.headers['content-type']=='application/json' and provider.calls==gateway.claim_count==0


def test_provider_failure_after_preview_keeps_original_operation_and_recovery(text_harness):
    app,gateway,provider=text_harness();enable(app);respond=provider.respond
    async def uncertain(*args,**kwargs):
        result=await respond(*args,**kwargs)
        await emit_progress({'type':'reply','text':result.text})
        raise APIError(504,'AI_PROVIDER_TIMEOUT','never expose upstream secret')
    provider.respond=uncertain
    with TestClient(app) as client:response=streamed(client)
    events=frames(response)
    assert [e['type'] for e in events]==['operation','reply','error']
    error=events[-1]
    assert error['status']==504 and error['recovery']=='check-saved' and error['operation_id']==events[0]['operation_id']
    assert error['retry_after'] is None and 'upstream secret' not in response.text
    assert next(iter(gateway.claims.values()))['status']=='uncertain'
    assert provider.calls==1 and not gateway.original_inputs


def test_voice_route_uses_same_stream_and_source_contract(harness):
    app,gateway,provider=harness();enable(app)
    with TestClient(app) as client:
        response=client.post(f'/api/v2/story-sessions/{SESSION}/messages',
            json={'source_transcript_id':str(TRANSCRIPT),'language':'en'},
            headers={'Accept':'text/event-stream','Idempotency-Key':str(uuid4())})
    events=frames(response)
    assert events[-1]['result']['user_message']['source_transcript_id']==str(TRANSCRIPT)
    assert provider.calls==gateway.claim_count==1


def test_response_cancellation_joins_worker_and_clears_progress_context():
    async def scenario():
        cleaned=asyncio.Event()
        request=Request({'type':'http','method':'POST','headers':[],'path':'/','app':SimpleNamespace()})
        async def action():
            try:
                await emit_progress({'type':'operation','operation_id':str(uuid4()),'project_id':str(PROJECT),'session_id':str(SESSION)})
                await asyncio.Future()
            finally:cleaned.set()
        response=await stream_turn_response(request,action)
        assert turn_progress.get() is None
        async def receive():return {'type':'http.disconnect'}
        async def send_message(_):pass
        await response({'type':'http','asgi':{'spec_version':'2.0'},'method':'POST'},receive,send_message)
        assert cleaned.is_set() and turn_progress.get() is None
    asyncio.run(scenario())


@pytest.mark.parametrize('spec', ['2.0','2.4'])
def test_disconnect_after_operation_cancels_waiting_provider_without_another_write(spec):
    async def scenario():
        cleaned, sent = asyncio.Event(), asyncio.Event()
        request=Request({'type':'http','method':'POST','headers':[],'path':'/','app':SimpleNamespace()})
        async def action():
            try:
                await emit_progress({'type':'operation','operation_id':str(uuid4()),'project_id':str(PROJECT),'session_id':str(SESSION)})
                await asyncio.Future()
            finally:cleaned.set()
        response=await stream_turn_response(request,action)
        async def receive():
            await sent.wait()
            return {'type':'http.disconnect'}
        async def send_message(event):
            if event['type']=='http.response.body':sent.set()
        await asyncio.wait_for(response({'type':'http','asgi':{'spec_version':spec},'method':'POST'},receive,send_message),1)
        assert cleaned.is_set() and turn_progress.get() is None
    asyncio.run(scenario())


def test_worker_self_cancellation_before_first_event_does_not_hang_request():
    async def scenario():
        cleaned=asyncio.Event()
        request=Request({'type':'http','method':'POST','headers':[],'path':'/','app':SimpleNamespace()})
        async def action():
            try:raise asyncio.CancelledError()
            finally:cleaned.set()
        with pytest.raises(APIError) as error:
            await asyncio.wait_for(stream_turn_response(request,action),1)
        assert error.value.code=='REAL_AI_UNCERTAIN' and cleaned.is_set()
    asyncio.run(scenario())


def test_stream_preflight_falls_back_to_existing_provider_validation(text_harness):
    app,gateway,provider=text_harness();enable(app)
    def deny(*args,**kwargs):raise APIError(422,'AI_INPUT_LIMIT','Too large')
    provider.validate_turn_input=deny
    with TestClient(app) as client:response=streamed(client)
    assert response.status_code==422 and provider.calls==gateway.claim_count==0
