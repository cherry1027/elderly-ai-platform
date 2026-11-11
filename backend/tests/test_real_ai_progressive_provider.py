"""Offline progressive provider transport; no usable credentials or live calls."""
import asyncio
from copy import deepcopy
import json

import httpx
from pydantic import SecretStr
import pytest

from app.core.errors import APIError
from app.services.openai_client import OpenAIClient, structured_body, MAX_RESPONSE_BYTES
from app.services.real_ai_provider import RealAIProvider, STREAMED_TURN_SCHEMA, _STREAMED_INSTRUCTIONS, _provisional_reply
from app.services.real_ai_progress import turn_progress
from tests.test_real_ai_provider import ScriptedClient, extracted


class Budget:
    budget_policy_path = 'synthetic-policy'
    def __init__(self):self.reserved=[];self.settled=[];self.groups=[];self.error=None
    def reserve_request(self,operation,model,**details):
        if self.error:raise self.error
        self.reserved.append((operation,model,details));return 'synthetic-reservation'
    def settle(self,*args,**kwargs):self.settled.append((args,kwargs))
    def check_request_group(self,calls):self.groups.append(calls)

class Observer:
    def __init__(self):self.calls=[]
    def record(self,*args,**kwargs):self.calls.append((args,kwargs))

class Chunks(httpx.AsyncByteStream):
    def __init__(self,chunks,after=None):self.chunks=chunks;self.after=after;self.closed=False
    async def __aiter__(self):
        for chunk in self.chunks:yield chunk
        if self.after:await self.after()
    async def aclose(self):self.closed=True

def envelope(raw):
    return {'status':'completed','error':None,'service_tier':'default',
      'usage':{'input_tokens':20,'output_tokens':30,'total_tokens':50},
      'output':[{'id':'msg_synthetic','type':'message','role':'assistant','status':'completed',
        'content':[{'type':'output_text','text':raw}]}]}

def events(raw,*,final_raw=None):
    middle=max(1,len(raw)//2)
    return [
      {'type':'response.created','sequence_number':0,'response':{'id':'resp_synthetic'}},
      *[{'type':'response.output_text.delta','sequence_number':i+1,'item_id':'msg_synthetic','output_index':0,'content_index':0,'delta':part}
        for i,part in enumerate((raw[:middle],raw[middle:]))],
      {'type':'response.output_text.done','sequence_number':3,'item_id':'msg_synthetic','output_index':0,'content_index':0,'text':raw},
      {'type':'response.completed','sequence_number':4,'response':envelope(final_raw if final_raw is not None else raw)},
    ]

def sse(values,*,crlf=False):
    newline='\r\n' if crlf else '\n'
    return ''.join(f'event: {v["type"]}{newline}data: {json.dumps(v,ensure_ascii=False)}{newline}{newline}' for v in values).encode()

def adapter(stream,budget=None,observer=None,handler=None,timeout=30):
    budget=budget or Budget();observer=observer or Observer();seen=[]
    def route(request):
        assert budget.reserved and len(budget.reserved)==1
        seen.append(request)
        return handler(request) if handler else httpx.Response(200,headers={'content-type':'text/event-stream; charset=utf-8'},stream=stream)
    return OpenAIClient(SecretStr('synthetic-not-a-real-key'),'gpt-test',budget,
      transport=httpx.MockTransport(route),usage_observer=observer,timeout_seconds=timeout),budget,observer,seen

def invoke(client,on_text=None):
    async def noop(text):pass
    return asyncio.run(client.structured_streamed('conversation','Quoted data only.',{'language':'sv'},
      {'type':'object','properties':{'answer':{'type':'string'}},'required':['answer'],'additionalProperties':False},2048,on_text=on_text or noop))

@pytest.mark.parametrize('size',[1,2,7,31,8192])
def test_split_utf8_crlf_frames_reserve_exact_stream_request_and_settle_once(size):
    raw=json.dumps({'answer':'Malmö 🙂'},ensure_ascii=False)
    wire=sse(events(raw),crlf=True);stream=Chunks([wire[i:i+size] for i in range(0,len(wire),size)])
    client,budget,observer,seen=adapter(stream);prefixes=[]
    async def on_text(text):prefixes.append(text)
    assert invoke(client,on_text)=={'answer':'Malmö 🙂'}
    body=json.loads(seen[0].content)
    assert body['stream'] is True and body['store'] is False and body['service_tier']=='default'
    assert 'synthetic-not-a-real-key' not in seen[0].content.decode()
    assert budget.reserved[0][2]['input_bytes']==len(json.dumps(body,ensure_ascii=False,allow_nan=False).encode())
    assert len(seen)==len(budget.reserved)==len(budget.settled)==len(observer.calls)==1
    assert budget.settled[0][1]['status']=='completed' and observer.calls[0][1]['status']=='completed'
    assert budget.settled[0][0][3]==envelope(raw)['usage']
    assert prefixes[-1]==raw and stream.closed

@pytest.mark.parametrize('failure',['eof','sequence','identity','index','after-done','final-mismatch','tool','refusal','unknown','duplicate-json','bad-utf8','oversized'])
def test_corrupt_or_truncated_stream_never_falls_back_or_returns_a_final_result(failure):
    raw=json.dumps({'answer':'Hello'})
    rows=events(raw)
    if failure=='eof':rows=rows[:-1]
    elif failure=='sequence':rows[2]['sequence_number']=1
    elif failure=='identity':rows[2]['item_id']='another-message'
    elif failure=='index':rows[1]['content_index']=1
    elif failure=='after-done':rows.insert(4,deepcopy(rows[2])|{'sequence_number':4});rows[-1]['sequence_number']=5
    elif failure=='final-mismatch':rows=events(raw,final_raw=json.dumps({'answer':'Changed'}))
    elif failure=='tool':rows[-1]['response']['output'].append({'type':'function_call','name':'not-allowed'})
    elif failure=='refusal':rows[1]['type']='response.refusal.delta'
    elif failure=='unknown':rows[1]['type']='response.future.unknown'
    wire=sse(rows)
    if failure=='duplicate-json':wire=b'data: {"type":"response.created","type":"response.completed","sequence_number":0}\n\n'
    elif failure=='bad-utf8':wire=b'data: {"type":"response.created","sequence_number":0,"value":"\xff"}\n\n'
    elif failure=='oversized':wire=b'data: '+b'x'*(MAX_RESPONSE_BYTES+1)+b'\n\n'
    stream=Chunks([wire]);client,budget,observer,seen=adapter(stream)
    with pytest.raises(APIError) as error:invoke(client)
    assert error.value.code=='AI_INVALID_RESPONSE'
    assert len(seen)==len(budget.reserved)==len(budget.settled)==len(observer.calls)==1
    assert budget.settled[0][1]['status']=='failed' and budget.settled[0][0][3] is None
    assert stream.closed

@pytest.mark.parametrize('content_type',['application/json','text/plain'])
def test_wrong_response_type_does_not_retry_json(content_type):
    client,budget,observer,seen=adapter(None,handler=lambda request:httpx.Response(200,headers={'content-type':content_type},content=b'{}'))
    with pytest.raises(APIError):invoke(client)
    assert len(seen)==len(budget.reserved)==len(budget.settled)==1
    assert budget.settled[0][1]['status']=='failed'


def test_quota_rejection_keeps_safe_classification_and_one_attempt():
    client,budget,observer,seen=adapter(None,handler=lambda request:httpx.Response(429,json={'error':{'code':'insufficient_quota','message':'private payload'}}))
    with pytest.raises(APIError) as error:invoke(client)
    assert error.value.code=='AI_PROVIDER_QUOTA_EXHAUSTED' and 'private' not in error.value.message
    assert len(seen)==len(budget.reserved)==len(budget.settled)==1


def test_explicit_cancellation_closes_stream_and_retains_unknown_usage():
    raw=json.dumps({'answer':'Hello'});stream=Chunks([sse(events(raw)[:2])])
    client,budget,observer,seen=adapter(stream)
    async def cancel(_):raise asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):invoke(client,cancel)
    assert len(seen)==len(budget.reserved)==len(budget.settled)==1
    assert budget.settled[0][1]['status']=='failed' and budget.settled[0][0][3] is None and stream.closed


def test_timeout_closes_stream_without_automatic_provider_retry():
    async def stall():await asyncio.Future()
    stream=Chunks([sse(events(json.dumps({'answer':'Hello'}))[:1])],after=stall)
    client,budget,observer,seen=adapter(stream,timeout=.01)
    with pytest.raises(APIError) as error:invoke(client)
    assert error.value.code=='AI_PROVIDER_TIMEOUT' and len(seen)==len(budget.reserved)==1
    assert budget.settled[0][1]['status']=='failed' and stream.closed


def test_refused_reservation_never_connects_or_records_fake_usage():
    budget=Budget();budget.error=APIError(429,'AI_USAGE_LIMIT','Closed')
    client,budget,observer,seen=adapter(None,budget=budget)
    with pytest.raises(APIError):invoke(client)
    assert seen==budget.settled==observer.calls==[]

class ProgressiveScript(ScriptedClient):
    def __init__(self,body,prefix=None):super().__init__([body]);self.stream_calls=[];self.prefix=prefix
    async def structured_streamed(self,**kwargs):
        self.stream_calls.append(kwargs)
        body=self.responses.pop(0)
        if isinstance(body,BaseException):raise body
        raw=self.prefix if self.prefix is not None else json.dumps(body,ensure_ascii=True)
        for end in range(len(raw)+1):await kwargs['on_text'](raw[:end])
        return deepcopy(body)

def combined(language='en',reply='What do you remember?'):
    return {'reply':{'language':language,'text':reply},'extraction':extracted(language)}

def progressive(client,language='en',source='Lund',history=None):
    emitted=[]
    async def run():
        async def sink(event):emitted.append(event)
        token=turn_progress.set(sink)
        try:return await RealAIProvider(client,transcription_model='gpt-transcribe',combined_turn=True).respond(source,language,[],history)
        finally:turn_progress.reset(token)
    return run,emitted

@pytest.mark.parametrize('language,reply',[('en','What do you remember about "Lund"?'),('sv','Vad minns du från Malmö?')])
def test_provider_emits_only_one_complete_language_checked_reply_and_keeps_final_facts(language,reply):
    script=ProgressiveScript(combined(language,reply));run,emitted=progressive(script,language)
    result=asyncio.run(run())
    assert emitted==[{'type':'reply','text':reply}] and result.text==reply and len(result.facts)==1
    assert not script.calls and len(script.stream_calls)==1
    assert list(script.stream_calls[0]['schema']['properties'])==['reply','extraction']
    assert turn_progress.get() is None

@pytest.mark.parametrize('bad_reply',[{'language':'sv','text':'Wrong language?'},{'language':'en','text':''},
    {'language':'en','text':'x'*1001},{'language':'en','text':'Who? Where?'},
    {'language':'en','text':'bad\ud800'},{'language':'en','text':'bad\0'},{'language':'en','text':'Okay?','extra':True}])
def test_bad_preview_never_leaks_partial_text_and_no_second_attempt(bad_reply):
    body=combined();body['reply']=bad_reply;script=ProgressiveScript(body);run,emitted=progressive(script)
    with pytest.raises(APIError):asyncio.run(run())
    assert emitted==[] and len(script.stream_calls)==1 and not script.calls



def test_stream_preview_and_final_result_omit_the_same_fragment_question():
    script = ProgressiveScript(combined("sv", "Tack för minnet. Var?"))
    run, emitted = progressive(script, "sv")

    result = asyncio.run(run())

    assert result.text == "Tack för minnet."
    assert emitted == [{"type": "reply", "text": result.text}]
    assert result.facts and len(script.stream_calls) == 1


def test_stream_preview_and_final_honor_pause_with_the_same_reply_and_grounded_memory():
    script = ProgressiveScript(combined("sv", "Vad minns du mer om Lund?"))
    run, emitted = progressive(script, "sv", "Lund. Jag vill pausa nu.")

    result = asyncio.run(run())

    assert result.text == "Självklart. Vi kan pausa här."
    assert emitted == [{"type": "reply", "text": result.text}]
    assert [item.value for item in result.facts] == ["Lund"]
    assert not script.calls and len(script.stream_calls) == 1


def test_final_extraction_rejection_never_turns_preview_into_a_verified_result():
    body=combined();body['extraction']=extracted('en',evidence='Not in source')
    script=ProgressiveScript(body);run,emitted=progressive(script)
    with pytest.raises(APIError) as error:asyncio.run(run())
    assert error.value.code=='CONVERSATION_INVALID_RESPONSE'
    assert emitted==[{'type':'reply','text':body['reply']['text']}] and len(script.stream_calls)==1


def test_preview_and_final_reply_must_match_exactly():
    early=combined(reply='Original?');final=combined(reply='Changed?')
    script=ProgressiveScript(final,prefix=json.dumps(early));run,emitted=progressive(script)
    with pytest.raises(APIError):asyncio.run(run())
    # Both fragments render the same fallback, but a changed wire reply still fails.
    assert emitted==[{'type':'reply','text':'We can go at your pace.'}] and len(script.stream_calls)==1


def test_normal_json_request_still_uses_unchanged_schema_and_never_streams():
    script=ProgressiveScript(combined())
    result=asyncio.run(RealAIProvider(script,transcription_model='gpt-transcribe',combined_turn=True).respond('Lund','en',[]))
    assert result.text=='What do you remember?' and len(script.calls)==1 and not script.stream_calls
    assert list(script.calls[0]['schema']['properties'])==['extraction','reply']


def test_stream_failure_never_falls_back_to_another_paid_request():
    script=ProgressiveScript(APIError(504,'AI_PROVIDER_TIMEOUT','Timeout'));run,emitted=progressive(script)
    with pytest.raises(APIError):asyncio.run(run())
    assert not script.calls and len(script.stream_calls)==1 and emitted==[]


def test_stream_preflight_reserves_exact_stream_flag_schema_and_instructions_once():
    script=ProgressiveScript(combined());script.governor=Budget();run,emitted=progressive(script)
    asyncio.run(run());call=script.stream_calls[0]
    body=structured_body(script.text_model,'conversation',call['instructions'],call['payload'],call['schema'],2900);body['stream']=True
    assert script.governor.groups==[[(script.text_model,len(json.dumps(body,ensure_ascii=False,allow_nan=False).encode()),2900)]]



def test_pure_stream_validation_counts_stream_envelope_before_any_reservation(monkeypatch):
    import app.services.real_ai_provider as module
    script=ProgressiveScript(combined())
    instance=RealAIProvider(script,transcription_model='gpt-transcribe',combined_turn=True)
    seen=[];original=module._structured_body_fits
    def sizes(*args,**kwargs):
        seen.append(kwargs.get('streamed',False))
        return original(*args,**kwargs)
    monkeypatch.setattr(module,'_structured_body_fits',sizes)
    instance.validate_stream_turn_input('Lund','en',[])
    assert seen==[False,True] and not script.calls and not script.stream_calls


@pytest.mark.parametrize('wire',[
    b'event: response.created\ndata: {"type":"response.in_progress","sequence_number":0}\n\n',
    b'data: {"type":"response.created","sequence_number":true}\n\n',
    b'data: {"type":"response.created","sequence_number":0}',
    b'event: response.created\n\n',
])
def test_bad_framing_name_sequence_or_unterminated_event_retains_full_unknown_hold(wire):
    stream=Chunks([wire]);client,budget,observer,seen=adapter(stream)
    with pytest.raises(APIError):invoke(client)
    assert len(budget.reserved)==len(budget.settled)==len(seen)==1
    assert budget.settled[0][0][3] is None and budget.settled[0][1]['status']=='failed'


def test_stream_event_count_and_total_bounds_are_enforced(monkeypatch):
    import app.services.openai_client as module
    for setting,value,wire in [('MAX_STREAM_EVENTS',1,sse(events('{}'))),
        ('MAX_STREAM_BYTES',32,b':'+b'x'*40+b'\n\n')]:
        with monkeypatch.context() as changes:
            changes.setattr(module,setting,value)
            client,budget,_,seen=adapter(Chunks([wire]))
            with pytest.raises(APIError):invoke(client)
            assert len(seen)==len(budget.reserved)==len(budget.settled)==1
            assert budget.settled[0][1]['status']=='failed'


def test_oversized_stream_envelope_never_reserves_or_connects():
    client,budget,observer,seen=adapter(None)
    async def noop(_):pass
    with pytest.raises(APIError) as error:
        asyncio.run(client.structured_streamed('conversation','x'*128_001,{}, {},2048,on_text=noop))
    assert error.value.code=='AI_INPUT_LIMIT'
    assert seen==budget.reserved==budget.settled==observer.calls==[]


def test_concurrent_preview_contexts_do_not_mix_reply_sinks():
    async def scenario():
        async def one(name):
            emitted=[]
            async def sink(event):
                await asyncio.sleep(0)
                emitted.append(event)
            token=turn_progress.set(sink)
            try:
                client=ProgressiveScript(combined(reply=name))
                await RealAIProvider(client,transcription_model='gpt-transcribe',combined_turn=True).respond('Lund','en',[])
                return emitted
            finally:turn_progress.reset(token)
        result=await asyncio.gather(one('First owner?'),one('Second owner?'))
        assert result==[[{'type':'reply','text':'First owner?'}],[{'type':'reply','text':'Second owner?'}]]
        assert turn_progress.get() is None
    asyncio.run(scenario())


def test_verified_complete_reply_preview_arrives_before_extraction_or_final_result_is_available():
    async def scenario():
        observed, release = asyncio.Event(), asyncio.Event()
        emitted=[]
        class DelayedExtraction(ProgressiveScript):
            async def structured_streamed(self, **kwargs):
                self.stream_calls.append(kwargs)
                prefix=json.dumps({'reply':{'language':'en','text':'What do you remember?'}},separators=(',',':'))[:-1]+',"extraction":'
                await kwargs['on_text'](prefix)
                await release.wait()
                return combined()
        async def sink(event):
            emitted.append(event);observed.set()
        token=turn_progress.set(sink)
        try:
            client=DelayedExtraction(combined())
            task=asyncio.create_task(RealAIProvider(client,transcription_model='gpt-transcribe',combined_turn=True).respond('Lund','en',[]))
            await asyncio.wait_for(observed.wait(),1)
            assert not task.done() and emitted==[{'type':'reply','text':'What do you remember?'}]
            release.set()
            result=await task
            assert result.text=='What do you remember?' and len(result.facts)==1
            assert len(client.stream_calls)==1
        finally:turn_progress.reset(token)
    asyncio.run(scenario())



def test_authoritative_completed_response_returns_and_closes_socket_without_waiting_for_eof():
    async def scenario():
        attempted_idle_read = asyncio.Event()
        async def never_close():
            attempted_idle_read.set()
            await asyncio.Future()
        raw=json.dumps({'answer':'Ready before socket EOF'})
        stream=Chunks([sse(events(raw))],after=never_close)
        client,budget,observer,seen=adapter(stream,timeout=.2)
        async def noop(_):pass
        result=await asyncio.wait_for(client.structured_streamed('conversation','Quoted data only.',{},
            {'type':'object'},2048,on_text=noop),.5)
        assert result=={'answer':'Ready before socket EOF'}
        assert not attempted_idle_read.is_set() and stream.closed
        assert len(seen)==len(budget.reserved)==len(budget.settled)==len(observer.calls)==1
        assert budget.settled[0][1]['status']=='completed'
        assert budget.settled[0][0][3]==envelope(raw)['usage']
    asyncio.run(scenario())


@pytest.mark.parametrize('trailer',[b'data: not-json\n\n',b'\xff\n',
    sse([{'type':'response.completed','sequence_number':5,'response':envelope('{}')}])])
def test_bytes_after_a_valid_authoritative_terminal_are_not_read_or_interpreted(trailer):
    raw=json.dumps({'answer':'A completed reply'})
    # Include trailing data in the same network chunk: stopping the SSE event
    # iterator at its authoritative terminal must still avoid parsing it.
    stream=Chunks([sse(events(raw))+trailer])
    client,budget,observer,seen=adapter(stream)
    assert invoke(client)=={'answer':'A completed reply'}
    assert len(seen)==len(budget.reserved)==len(budget.settled)==len(observer.calls)==1
    assert budget.settled[0][1]['status']=='completed' and stream.closed
