"""Offline API integration. Synthetic gateways/providers are never live proof."""

from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4
import hashlib
import json
import wave

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest

from app.api.real_ai import get_real_gateway
from app.api.dependencies import get_current_user
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.schemas.real_ai import RealTranscript, RealMessage, RealDraft, RealTurn
from app.services.auth import AuthenticatedUser
from app.services.conversation_provider import ProviderResult
from app.services.real_ai_resources import validated
from app.services.real_ai_runtime import SpeechCache
from app.services.real_ai_provider import SpeechAudio
from app.services.openai_client import mark_ai_dispatched

OWNER, PROJECT, SESSION, TRANSCRIPT, OTHER = (uuid4() for _ in range(5))
NOW = datetime.now(timezone.utc).isoformat()
PROV = {"mode":"real","provider":"openai","model":"gpt-test","version":1}


class Provider:
    calls = 0
    fail = False

    async def respond(self, text, language, prior, recent_messages=None):
        self.calls += 1
        mark_ai_dispatched()
        if self.fail:
            raise APIError(504,"AI_PROVIDER_TIMEOUT","The AI provider timed out.")
        return ProviderResult("What do you remember about that place?" if language == "en" else "Vad minns du om den platsen?", [])

    async def transcribe(self, path, language):
        self.calls += 1
        mark_ai_dispatched()
        return "I grew up in Bristol." if language == "en" else "Jag växte upp i Malmö."


class FakeGateway:
    """In-memory operation model; SQL invariants have their separate PGlite tests."""
    def __init__(self, language="en"):
        self.language = language
        self.user = AuthenticatedUser(OWNER, SecretStr("synthetic-test-user-token"))
        self.claims, self.results = {}, {}
        self.failures, self.claim_count = 0, 0
        self.owned = True
        self.transcript = {"transcript_id":str(TRANSCRIPT),"project_id":str(PROJECT),"session_id":str(SESSION),
            "language":language,"text":"I grew up in Bristol." if language == "en" else "Jag växte upp i Malmö.",
            "status":"completed","created_at":NOW,"provenance":PROV}

    async def get_owned_session(self, resource_id, active=False):
        if not self.owned or resource_id != SESSION:
            raise APIError(404,"SESSION_NOT_FOUND","Conversation session was not found.")
        return {"id":str(SESSION),"project_id":str(PROJECT),"language":self.language,"status":"active"}

    async def get_project(self, project_id):
        if project_id != PROJECT or not self.owned:
            raise APIError(404,"PROJECT_NOT_FOUND","Story project was not found.")
        return {"id":str(PROJECT),"language":self.language,"title":"My life"}

    async def one(self, table, field, resource_id):
        if table == "real_transcripts" and resource_id == TRANSCRIPT:
            return self.transcript.copy()
        raise APIError(404,"RESOURCE_NOT_FOUND","The requested resource was not found.")

    async def project_memories(self, project_id):
        return []

    async def messages(self, *args, **kwargs):
        return []

    async def claim(self, project_id, session_id, kind, key, fingerprint):
        self.claim_count += 1
        identity = (kind,key)
        if identity in self.claims:
            row = self.claims[identity]
            if row["digest"] != fingerprint:
                raise APIError(409,"REAL_AI_CONFLICT","State changed.")
            return {k:v for k,v in {**row,"claimed":False}.items() if k not in {"claim_token","digest"}}
        row = {"operation_id":str(uuid4()),"kind":kind,"status":"in_progress","claimed":True,
               "claim_token":str(uuid4()),"result":None,"error_code":None,"digest":fingerprint}
        self.claims[identity] = row
        return row.copy()

    async def complete(self, claim, payload, provenance):
        if claim["kind"] == "transcription":
            result = {**self.transcript,"text":payload["text"]}
        else:
            def message(role, sequence):
                return {"id":str(TRANSCRIPT) if role == "user" else str(uuid4()),
                    "project_id":str(PROJECT),"session_id":str(SESSION),"role":role,"language":self.language,
                    "text":self.transcript["text"] if role == "user" else payload["assistant_text"],"sequence":sequence,
                    "source_transcript_id":str(TRANSCRIPT),"created_at":NOW,"provenance":PROV}
            result = {"user_message":message("user",1),"message":message("assistant",2),"memories":[],"mode":"real"}
        for row in self.claims.values():
            if row["operation_id"] == claim["operation_id"]:
                row.update(status="completed",result=result)
        return result

    async def normalize_result(self, kind, row):
        return validated({"transcription":RealTranscript,"conversation":RealTurn,"generation":RealDraft}[kind],row)

    async def fail(self, claim, code, *, uncertain=True):
        self.failures += 1
        for row in self.claims.values():
            if row["operation_id"] == claim["operation_id"] and row["status"] == "in_progress":
                row.update(status="uncertain" if uncertain else "failed",error_code=code)

    async def context(self, project_id):
        return {"source_memories":[],"blocking_clarifications":[],"context_token":"a"*64}


@pytest.fixture
def harness():
    def build(language="en", enabled=True):
        gateway, provider = FakeGateway(language), Provider()
        settings = Settings(_env_file=None, supabase_url="https://synthetic.supabase.co", supabase_publishable_key="synthetic-public",
            real_ai_transcription_model="gpt-test",openai_text_model="gpt-test",real_ai_speech_model="gpt-test")
        app = create_app(settings)
        if enabled:
            app.state.real_ai = SimpleNamespace(require=lambda:provider,cache=SpeechCache())
        app.dependency_overrides[get_current_user] = lambda:gateway.user
        app.dependency_overrides[get_real_gateway] = lambda:gateway
        return app,gateway,provider
    return build


@pytest.mark.parametrize("language",["en","sv"])
def test_real_interviewer_replay_is_saved_once_and_preserves_original(language,harness):
    app,gateway,provider = harness(language)
    key = str(uuid4())
    with TestClient(app) as client:
        path = f"/api/v2/story-sessions/{SESSION}/messages"
        first = client.post(path,json={"source_transcript_id":str(TRANSCRIPT),"language":language},headers={"Idempotency-Key":key})
        repeat = client.post(path,json={"source_transcript_id":str(TRANSCRIPT),"language":language},headers={"Idempotency-Key":key})
    assert first.status_code == repeat.status_code == 200
    assert first.json() == repeat.json()
    assert provider.calls == 1
    assert first.json()["mode"] == "real"
    assert first.json()["user_message"]["text"] == gateway.transcript["text"]
    assert first.json()["message"]["language"] == language
    assert first.headers["cache-control"] == "no-store"


def test_ambiguous_failure_is_not_retried_and_returns_reconciliation_id(harness):
    app,gateway,provider = harness()
    provider.fail = True
    with TestClient(app) as client:
        kwargs={"json":{"source_transcript_id":str(TRANSCRIPT),"language":"en"},"headers":{"Idempotency-Key":str(uuid4())}}
        first=client.post(f"/api/v2/story-sessions/{SESSION}/messages",**kwargs)
        second=client.post(f"/api/v2/story-sessions/{SESSION}/messages",**kwargs)
    assert first.status_code == 504 and second.status_code == 409
    assert second.json()["error"]["code"] == "AI_OPERATION_UNCERTAIN"
    assert UUID(first.headers["x-memy-operation-id"]) == UUID(second.headers["x-memy-operation-id"])
    assert provider.calls == gateway.failures == 1


def test_proven_local_rejection_is_failed_instead_of_uncertain(harness):
    app,gateway,provider=harness()
    async def denied(*args,**kwargs):
        raise APIError(429,"AI_RATE_LIMIT","The approved AI request rate was reached.")
    provider.respond=denied
    with TestClient(app) as client:
        response=client.post(f"/api/v2/story-sessions/{SESSION}/messages",
            json={"source_transcript_id":str(TRANSCRIPT),"language":"en"},headers={"Idempotency-Key":str(uuid4())})
    assert response.status_code==429
    assert next(iter(gateway.claims.values()))["status"]=="failed"
    assert gateway.failures==1


def test_replayed_valid_shape_cannot_return_another_project(harness):
    app,gateway,provider=harness()
    key=uuid4()
    with TestClient(app) as client:
        kwargs={"json":{"source_transcript_id":str(TRANSCRIPT),"language":"en"},"headers":{"Idempotency-Key":str(key)}}
        assert client.post(f"/api/v2/story-sessions/{SESSION}/messages",**kwargs).status_code==200
        result=gateway.claims[("conversation",key)]["result"]
        result["user_message"]["project_id"]=result["message"]["project_id"]=str(OTHER)
        response=client.post(f"/api/v2/story-sessions/{SESSION}/messages",**kwargs)
    assert response.status_code==503
    assert str(OTHER) not in response.text and provider.calls==1


def test_disabled_live_path_does_not_claim_or_call_provider(harness):
    app,gateway,provider=harness(enabled=False)
    with TestClient(app) as client:
        response=client.post(f"/api/v2/story-sessions/{SESSION}/messages",json={"source_transcript_id":str(TRANSCRIPT),"language":"en"},headers={"Idempotency-Key":str(uuid4())})
        status=client.get("/api/v2/capabilities")
    assert response.status_code==503 and response.json()["error"]["code"]=="LIVE_AI_DISABLED"
    assert gateway.claim_count==provider.calls==0
    assert status.json()["enabled"] is False


@pytest.mark.parametrize("payload",[
    {"source_transcript_id":str(TRANSCRIPT),"language":"sv"},
    {"source_transcript_id":str(TRANSCRIPT),"language":"en","user_id":str(OTHER)},
    {"text":"An unsupported typed message","language":"en"},
    {"source_transcript_id":"invalid","language":"en"},
])
def test_invalid_turn_never_reaches_paid_provider(payload,harness):
    app,gateway,provider=harness()
    with TestClient(app) as client:
        response=client.post(f"/api/v2/story-sessions/{SESSION}/messages",json=payload,headers={"Idempotency-Key":str(uuid4())})
    assert response.status_code==422
    assert gateway.claim_count==provider.calls==0


def test_cross_user_recording_denied_before_multipart_read(harness,monkeypatch):
    app,gateway,provider=harness()
    gateway.owned=False
    async def forbidden(*args):
        pytest.fail("Unauthorized audio was read")
    monkeypatch.setattr("app.api.real_ai.read_recording",forbidden)
    with TestClient(app) as client:
        response=client.post(f"/api/v2/story-sessions/{SESSION}/transcribe",content=b"not-a-body",headers={"Idempotency-Key":str(uuid4())})
    assert response.status_code==404 and provider.calls==0


def test_transcription_completes_real_original_and_replays_without_provider(harness,monkeypatch,tmp_path):
    app,gateway,provider=harness()
    async def read(*args):
        return SimpleNamespace(path=tmp_path/"audio.wav",content_sha256="b"*64,language="en")
    monkeypatch.setattr("app.api.real_ai.read_recording",read)
    headers={"Idempotency-Key":str(uuid4())}
    with TestClient(app) as client:
        first=client.post(f"/api/v2/story-sessions/{SESSION}/transcribe",headers=headers)
        repeat=client.post(f"/api/v2/story-sessions/{SESSION}/transcribe",headers=headers)
    assert first.status_code==repeat.status_code==200
    assert first.json()==repeat.json()
    assert first.json()["provenance"]["mode"]=="real" and provider.calls==1


def test_draft_generation_requires_reviewed_memories_before_any_cost(harness):
    app,gateway,provider=harness()
    with TestClient(app) as client:
        response=client.post(f"/api/v2/story-projects/{PROJECT}/generate",json={"language":"en","style":"warm","confirm_generation":True},headers={"Idempotency-Key":str(uuid4())})
    assert response.status_code==409 and response.json()["error"]["code"]=="NO_CONFIRMED_MEMORIES"
    assert gateway.claim_count==provider.calls==0


def test_all_eighteen_private_v2_routes_require_authentication():
    app=create_app(Settings(_env_file=None))
    protected=[]
    for path,item in app.openapi()["paths"].items():
        for method,operation in item.items():
            if path.startswith("/api/v2/") and path!="/api/v2/capabilities":
                assert operation["security"]==[{"SupabaseBearer":[]}]
                protected.append((method,path))
    assert len(protected)==18
    with TestClient(app) as client:
        for method,path in protected:
            path=path.replace("{kind}","conversation")
            for name in ("operation_id","session_id","memory_id","project_id","draft_id","message_id","speech_id","export_id","action_key"):
                path=path.replace("{"+name+"}",str(PROJECT))
            response=client.request(method,path)
            assert response.status_code==401,(method,path,response.text)


def test_v2_binary_docs_keep_errors_json_and_wav_pdf_success_types():
    paths=create_app(Settings(_env_file=None)).openapi()["paths"]
    for path,method,status,media in (
        ("/api/v2/story-drafts/{draft_id}/export","post","201","application/pdf"),
        ("/api/v2/story-exports/{export_id}/download","get","200","application/pdf"),
        ("/api/v2/spoken-replies/{speech_id}/audio","get","200","audio/wav"),
    ):
        responses=paths[path][method]["responses"]
        assert media in responses[status]["content"]
        assert "application/json" in responses["503"]["content"]
        assert media not in responses["503"]["content"]


def test_naive_speech_expiry_is_rejected():
    from app.schemas.real_ai import RealSpeech
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        RealSpeech.model_validate({"speech_id":str(uuid4()),"assistant_message_id":str(uuid4()),"language":"en",
            "media_type":"audio/wav","audio_sha256":"a"*64,"audio_size":100,"expires_at":"2026-12-01T00:00:00","status":"ready"})


def test_transient_audio_cache_checks_owner_hash_size_expiry_and_clear():
    clock=[0.0]
    cache=SpeechCache(ttl=5,max_bytes=150,clock=lambda:clock[0])
    data=b"RIFF"+b"x"*60
    sha=hashlib.sha256(data).hexdigest()
    one,two=uuid4(),uuid4()
    cache.put(OWNER,one,data,sha)
    assert cache.get(OWNER,one,sha)==data
    with pytest.raises(APIError) as denied:cache.get(OTHER,one,sha)
    assert denied.value.status_code==410
    cache.put(OWNER,two,data,sha)
    clock[0]=6
    with pytest.raises(APIError):cache.get(OWNER,one,sha)
    assert cache._size==0
    cache.put(OWNER,one,data,sha)
    cache.clear()
    with pytest.raises(APIError):cache.get(OWNER,one,sha)


def test_real_pdf_has_review_notice_and_preserves_legacy_renderer():
    from app.services.pdf_export import RealPdfRenderer,PdfRenderer
    from pypdf import PdfReader
    options=dict(title="Min berättelse",content="Jag växte upp i Malmö.",language="sv",draft_version=1,draft_revision=1)
    real=RealPdfRenderer().render(**options)
    legacy=PdfRenderer().render(**options)
    actual="\n".join(page.extract_text() for page in PdfReader(BytesIO(real.data)).pages)
    old="\n".join(page.extract_text() for page in PdfReader(BytesIO(legacy.data)).pages)
    assert "AI-assisterad" in actual and "simulerad" not in actual
    assert "simulerad" in old
    assert "Malmö" in actual
