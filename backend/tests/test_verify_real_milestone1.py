"""Offline synthetic HTTPX contracts; never provider or phone acceptance proof."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
import hashlib
import json
from pathlib import Path
from uuid import uuid4
import wave

import httpx
from pydantic import SecretStr
from pypdf import PdfWriter
import pytest

from scripts.verify_real_milestone1 import _Journal, _origin, VerificationFailure, run_acceptance

P,S,T,A,M,D,E,SP = (str(uuid4()) for _ in range(8))
NOW = datetime.now(timezone.utc).isoformat()
PROV = {"mode":"real","provider":"openai","model":"synthetic-offline-model","version":1}
TOKEN_A,TOKEN_B = SecretStr("synthetic-user-a"),SecretStr("synthetic-user-b")


class Server:
    def __init__(self):
        self.calls=[]
        self.paid_posts=0
        self.operations={}
        self.fail_transcription=False
        self.mock_provenance=False
        self.capabilities_enabled=True
        self.project={"id":P,"title":"","description":None,"language":"en","status":"draft","created_at":NOW,"updated_at":NOW}
        self.session={"id":S,"project_id":P,"language":"en","status":"active","created_at":NOW,"updated_at":NOW,"ended_at":None}
        self.transcript={"transcript_id":T,"project_id":P,"session_id":S,"language":"en","text":"I grew up in Bristol.","status":"completed","created_at":NOW,"provenance":PROV}
        def message(role,sequence):
            return {"id":T if role=="user" else A,"project_id":P,"session_id":S,"role":role,"language":"en",
                "text":self.transcript["text"] if role=="user" else "What do you remember about Bristol?","sequence":sequence,
                "source_transcript_id":T,"created_at":NOW,"provenance":PROV}
        self.memory={"id":M,"project_id":P,"session_id":S,"source_message_id":T,"fact_type":"location","value":"Bristol",
            "evidence":"I grew up in Bristol.","year":None,"slot":"grew_up_location","uncertain":False,"status":"pending",
            "corrected_value":None,"version":1,"created_at":NOW,"updated_at":NOW,"clarification_question":None}
        self.turn={"user_message":message("user",1),"message":message("assistant",2),"memories":[deepcopy(self.memory)],"mode":"real"}
        source={"memory_id":M,"memory_version":2,"source_message_id":T,"fact_type":"location","value":"Bristol",
            "evidence":"I grew up in Bristol.","corrected_value":None,"year":None,"slot":"grew_up_location","sentence":"Bristol"}
        self.draft={"draft_id":D,"project_id":P,"language":"en","style":"warm","status":"needs_review","version":1,"revision":1,
            "content":"I grew up in Bristol.","original_content":"I grew up in Bristol.","source_memories":[source],
            "verification":{"status":"needs_review","method":"model_review_v1","unsupported_claims":[],"checked_revision":1,
                "checked_at":NOW,"sources_current":True,"reason":"Human review required"},"mode":"real","provenance":PROV,
            "created_at":NOW,"updated_at":NOW}
        self.history=[]
        stream=BytesIO(); writer=PdfWriter(); writer.add_blank_page(width=100,height=100); writer.write(stream); self.pdf=stream.getvalue()
        stream=BytesIO()
        with wave.open(stream,"wb") as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(b"\0\0"*100)
        self.wav=stream.getvalue()
        self.speech={"speech_id":SP,"assistant_message_id":A,"language":"en","media_type":"audio/wav",
            "audio_sha256":hashlib.sha256(self.wav).hexdigest(),"audio_size":len(self.wav),
            "expires_at":(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat(),"status":"ready"}
        self.export={"export_id":E,"project_id":P,"draft_id":D,"draft_version":1,"draft_revision":2,"language":"en","title":"My life",
            "format":"pdf","include_title_page":True,"include_page_numbers":True,"renderer_version":"memy_real_pdf_v1",
            "filename":"memy-life-v1-r2.pdf","content_sha256":"a"*64,"byte_size":len(self.pdf),"page_count":1,"created_at":NOW}

    def __call__(self,request):
        method,path=request.method,request.url.path
        self.calls.append((method,path))
        if path=="/api/v2/capabilities":
            return httpx.Response(200,json={"contract":"real-v2","mode":"real","enabled":self.capabilities_enabled})
        if request.headers.get("authorization")=="Bearer synthetic-user-b":
            return httpx.Response(404,json={"error":{"code":"RESOURCE_NOT_FOUND","message":"Hidden"}})
        if path=="/api/v1/story-projects" and method=="GET":
            return httpx.Response(200,json=[] if not self.project["title"] else [self.project])
        if path=="/api/v1/story-projects" and method=="POST":
            self.project.update(json.loads(request.content));return httpx.Response(201,json=self.project)
        if path==f"/api/v1/story-projects/{P}":return httpx.Response(200,json=self.project)
        if path.endswith("/continue"):return httpx.Response(200,json={"session":self.session})
        if "/operations/by-key/" in path:
            kind,key=path.split("/")[-2:]
            operation=self.operations.get((kind,key))
            if operation is None:return httpx.Response(404,json={"error":{"code":"RESOURCE_NOT_FOUND"}})
            return httpx.Response(200,json=operation)
        paid={f"/api/v2/story-sessions/{S}/transcribe":("transcription",self.transcript),
              f"/api/v2/story-sessions/{S}/messages":("conversation",self.turn),
              f"/api/v2/story-projects/{P}/generate":("generation",self.draft),
              f"/api/v2/conversation-messages/{A}/speech":("speech",self.speech)}
        if method=="POST" and path in paid:
            kind,value=paid[path]
            if kind=="transcription" and self.fail_transcription:
                self.paid_posts+=1
                raise httpx.ReadError("synthetic disconnect")
            key=request.headers["idempotency-key"]
            if (kind,key) not in self.operations:
                self.paid_posts+=1
                result=deepcopy(value)
                if kind=="transcription" and self.mock_provenance:result["provenance"]["mode"]="mock"
                self.operations[(kind,key)]={"operation_id":str(uuid4()),"kind":kind,"status":"completed","project_id":P,
                    "session_id":None if kind=="generation" else S,"created_at":NOW,"updated_at":NOW,"error_code":None,"result":result}
            return httpx.Response(201 if kind=="generation" else 200,json=self.operations[(kind,key)]["result"])
        if path.endswith("/transcripts"):return httpx.Response(200,json=[self.transcript])
        if path.endswith("/messages"):return httpx.Response(200,json=[self.turn["user_message"],self.turn["message"]])
        if path.endswith("/memories"):return httpx.Response(200,json=[self.memory])
        if path==f"/api/v2/memories/{M}" and method=="PATCH":
            payload=json.loads(request.content);self.memory.update(status=payload["status"],version=self.memory["version"]+1)
            return httpx.Response(200,json=self.memory)
        if path==f"/api/v2/story-drafts/{D}" and method=="PATCH":
            previous=self.draft["content"];payload=json.loads(request.content)
            self.draft.update(content=payload["content"],revision=self.draft["revision"]+1,status="edited")
            self.draft["verification"].update(method="manual_unverified",checked_revision=self.draft["revision"])
            self.history.append({"id":str(uuid4()),"draft_id":D,"revision":self.draft["revision"],"previous_content":previous,
                "content":self.draft["content"],"created_at":NOW})
            return httpx.Response(200,json=self.draft)
        if path==f"/api/v2/story-drafts/{D}":return httpx.Response(200,json=self.draft)
        if path.endswith("/history"):return httpx.Response(200,json=self.history)
        if path.endswith("/export"):
            return httpx.Response(201,content=self.pdf,headers={"content-type":"application/pdf","X-Memy-Export-Id":E,"X-Memy-Draft-Revision":str(self.draft["revision"])})
        if path.endswith("/exports"):return httpx.Response(200,json=[self.export])
        if path.endswith("/download"):return httpx.Response(200,content=self.pdf,headers={"content-type":"application/pdf"})
        if path.endswith("/audio"):return httpx.Response(200,content=self.wav,headers={"content-type":"audio/wav"})
        raise AssertionError((method,path))


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def inputs(tmp_path):
    private=tmp_path/".private";private.mkdir(mode=0o700)
    audio=tmp_path/"recording.wav";audio.write_bytes(b"synthetic-offline-audio")
    return {"base_url":"http://127.0.0.1:8001","token_a":TOKEN_A,"token_b":TOKEN_B,"recordings":{"en":audio},
        "manifest_path":private/"journal.json","languages":("en",)}


@pytest.mark.anyio
async def test_transcription_records_durable_keys_replays_and_sanitized_report(inputs):
    server=Server()
    result=await run_acceptance(**inputs,stage="transcription",transport=httpx.MockTransport(server),expected_terms={"en":["Bristol"]})
    assert result["result"]=="PASS" and result["saved_result_replays_checked"]==1
    assert result["languages"]["en"]["reference_accuracy"]=="TERMS_MATCHED"
    assert server.paid_posts==1
    report=json.dumps(result);journal=inputs["manifest_path"].read_text()
    for sensitive in ("I grew up in Bristol.","synthetic-user-a","synthetic-user-b"):
        assert sensitive not in report+journal
    repeated=await run_acceptance(**inputs,stage="transcription",transport=httpx.MockTransport(server))
    assert repeated["result"]=="PASS" and server.paid_posts==1


@pytest.mark.anyio
async def test_full_offline_workflow_explicit_review_pdf_and_speech(inputs):
    server=Server()
    result=await run_acceptance(**inputs,stage="full",transport=httpx.MockTransport(server),
        review_plan={"en":{M:{"expected_version":1,"status":"confirmed"}}})
    assert result["result"]=="PASS" and server.paid_posts==4
    assert result["saved_result_replays_checked"]==4
    assert result["cross_user_denials_checked"]>=9
    assert result["languages"]["en"]["draft_revision"]==3
    assert result["languages"]["en"]["exported_revision"]==2
    assert result["languages"]["en"]["human_voice_quality"]=="LISTENING_REVIEW_REQUIRED"
    assert server.draft["original_content"]=="I grew up in Bristol."


@pytest.mark.anyio
async def test_unknown_paid_result_is_not_resubmitted_on_next_run(inputs):
    server=Server();server.fail_transcription=True
    with pytest.raises(VerificationFailure) as first:
        await run_acceptance(**inputs,transport=httpx.MockTransport(server))
    assert first.value.code=="NETWORK_RESULT_UNCERTAIN"
    assert server.paid_posts==1
    server.fail_transcription=False
    with pytest.raises(VerificationFailure):
        await run_acceptance(**inputs,transport=httpx.MockTransport(server))
    assert server.paid_posts==1


@pytest.mark.anyio
async def test_memory_is_not_confirmed_without_explicit_plan(inputs):
    server=Server()
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,stage="full",transport=httpx.MockTransport(server))
    assert result.value.code=="MEMORY_REVIEW_REQUIRED"
    assert server.memory["status"]=="pending" and server.paid_posts==2


@pytest.mark.anyio
async def test_mock_provenance_never_passes_as_real(inputs):
    server=Server();server.mock_provenance=True
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,transport=httpx.MockTransport(server))
    assert result.value.code=="INVALID_RESPONSE_CONTRACT"


@pytest.mark.anyio
async def test_closed_gate_stops_before_project_or_paid_requests(inputs):
    server=Server();server.capabilities_enabled=False
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,transport=httpx.MockTransport(server))
    assert result.value.code=="REAL_AI_NOT_ENABLED"
    assert server.calls==[("GET","/api/v2/capabilities")]


@pytest.mark.anyio
async def test_reference_term_mismatch_stops_before_interviewer(inputs):
    server=Server()
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,stage="full",transport=httpx.MockTransport(server),expected_terms={"en":["Malmö"]})
    assert result.value.code=="REFERENCE_TERMS_MISMATCH" and server.paid_posts==1


@pytest.mark.anyio
async def test_swedish_uses_second_owner_and_preserves_unicode_reference(inputs):
    server=Server()
    server.project["language"]=server.session["language"]=server.transcript["language"]="sv"
    server.transcript["text"]="Jag växte upp i Malmö."
    authorizations=[]
    def swedish(request):
        if request.url.path!="/api/v2/capabilities":
            authorizations.append(request.headers.get("authorization"))
            if request.headers.get("authorization")=="Bearer synthetic-user-a":
                return httpx.Response(404,json={"error":{"code":"RESOURCE_NOT_FOUND"}})
            assert request.headers.get("authorization")=="Bearer synthetic-user-b"
            request.headers["authorization"]="Bearer synthetic-user-a"
        return server(request)
    inputs["languages"]=("sv",)
    inputs["recordings"]={"sv":inputs["recordings"]["en"]}
    result=await run_acceptance(**inputs,transport=httpx.MockTransport(swedish),expected_terms={"sv":["MALMÖ"]})
    assert result["result"]=="PASS" and result["languages"]["sv"]["owner_label"]=="B"
    assert result["languages"]["sv"]["reference_accuracy"]=="TERMS_MATCHED"
    assert "Bearer synthetic-user-a" in authorizations and "Bearer synthetic-user-b" in authorizations


@pytest.mark.anyio
async def test_paid_error_response_does_not_echo_upstream_private_content(inputs):
    server=Server()
    def rejected(request):
        if request.url.path.endswith("/transcribe") and request.method=="POST":
            return httpx.Response(504,json={"error":{"code":"AI_PROVIDER_TIMEOUT","message":"synthetic-user-a private story text"}})
        return server(request)
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,transport=httpx.MockTransport(rejected))
    assert result.value.code=="AI_PROVIDER_TIMEOUT"
    assert "synthetic-user-a" not in json.dumps(result.value.report)
    assert "private story text" not in json.dumps(result.value.report)


@pytest.mark.anyio
async def test_identical_tokens_refused_before_network(inputs):
    inputs["token_b"]=TOKEN_A
    with pytest.raises(VerificationFailure) as result:
        await run_acceptance(**inputs,transport=httpx.MockTransport(lambda _:pytest.fail("network")))
    assert result.value.code=="TWO_DISTINCT_TOKENS_REQUIRED"


@pytest.mark.parametrize("url",["http://example.com","https://user:password@example.com","https://example.com/path","file:///tmp/test"])
def test_unsafe_origins_refused(url):
    with pytest.raises(VerificationFailure):_origin(url)


def test_journal_refuses_shared_directory_and_symlinks(tmp_path):
    shared=tmp_path/"shared";shared.mkdir(mode=0o755)
    with pytest.raises(VerificationFailure):
        with _Journal(shared/"journal.json"):pass
    private=tmp_path/".private";private.mkdir(mode=0o700)
    path=private/"journal.json";target=private/"target";target.write_text("{}")
    path.symlink_to(target)
    with pytest.raises(VerificationFailure):
        with _Journal(path):pass
