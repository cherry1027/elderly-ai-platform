"""Explicitly authorized real-AI path. Reading never invokes a paid provider."""

import asyncio
from contextlib import nullcontext
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.api.audio import UPLOAD_SCHEMA
from app.api.dependencies import get_current_user
from app.api.exports import render_document, pdf_response, PDFResponse
from app.core.errors import APIError, unavailable
from app.schemas.conversations import MemoryPatch
from app.schemas.real_ai import (
    RealTranscript, RealMessage, RealMemory, RealTurn, RealDraft, RealSpeech,
    RealMessageCreate, RealTextMessageCreate, RealSpeechRequest, RealOperation, RealExportRequest,
    RealExportMetadata, RealSavedExport,
)
from app.schemas.story_drafts import StoryDraftPatch, StoryEditResponse, StoryGenerationRequest
from app.schemas.errors import ErrorResponse
from app.services.audio_upload import read_recording
from app.services.auth import AuthenticatedUser
from app.services.real_ai_resources import RealAIGateway, validated, read_together
from app.services.openai_client import DispatchTrace, ai_dispatch_trace
from app.services.ai_controls import ai_budget_subject

router = APIRouter(prefix="/api/v2", tags=["Real AI (explicit opt-in)"], responses={
    code: {"content":{"application/json":{"schema":{"$ref":"#/components/schemas/ErrorResponse"}}}}
    for code in (401,403,404,409,410,413,415,422,429,503,504)
})


class WAVResponse(Response):
    media_type = "audio/wav"


def get_real_gateway(request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    return RealAIGateway(request.app.state.settings, request.app.state.http_client, user)


Gateway = Annotated[RealAIGateway, Depends(get_real_gateway)]
Key = Annotated[UUID, Header(alias="Idempotency-Key")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


def language_matches(language, scope):
    if language != scope["language"]:
        raise APIError(422, "LANGUAGE_MISMATCH", "Use the language selected for this story.")


def digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def result_scope(kind, result, project_id, session_id, operation_id=None):
    scoped = result["message"] if kind == "conversation" else result
    if kind != "speech" and (scoped["project_id"] != str(project_id)
        or (session_id is not None and scoped.get("session_id") != str(session_id))):
        raise unavailable()
    if (kind == "conversation" and result["user_message"].get("source_text_input_id") is not None
        and operation_id is not None
        and result["user_message"]["source_text_input_id"] != str(operation_id)):
        raise unavailable()
    return result


def check_operation_policy(request, *, kind, typed=False):
    """Server-side policy, including direct requests that ignore capabilities."""
    settings = request.app.state.settings
    feature = {"transcription": "transcription", "conversation": "conversation", "generation": "writing", "speech": "speech"}[kind]
    if (not getattr(settings, f"real_ai_{feature}_enabled", True)
        or (settings.real_ai_text_only and not (kind == "conversation" and typed))):
        raise APIError(503, "LIVE_AI_DISABLED", "This AI action is paused. No paid request was made.")


def require_provider(request, *, kind, typed=False):
    check_operation_policy(request, kind=kind, typed=typed)
    return request.app.state.real_ai.require()


async def execute(request, gateway, *, project_id, session_id, kind, key, fingerprint, produce, model,
                  typed=False):
    # Bind only the validated Supabase identity, never a caller-supplied user_id.
    subject = ai_budget_subject.set(str(gateway.user.id))
    try:
        governor = getattr(request.app.state.real_ai, "governor", None)
        with governor.workflow() if governor is not None else nullcontext():
            return await _execute(request, gateway, project_id=project_id, session_id=session_id,
                kind=kind, key=key, fingerprint=fingerprint, produce=produce, model=model, typed=typed)
    finally:
        ai_budget_subject.reset(subject)


async def _execute(request, gateway, *, project_id, session_id, kind, key, fingerprint, produce, model,
                   typed=False):
    provider = require_provider(request, kind=kind, typed=typed)
    slots = request.app.state.real_ai_slots
    if slots.locked():
        raise APIError(429, "AI_BUSY", "AI processing is busy. Try again shortly.")
    async with slots:
        claim = await gateway.claim(project_id, session_id, kind, key, fingerprint)
        if not claim["claimed"]:
            if claim["status"] == "completed":
                return result_scope(kind, await gateway.normalize_result(kind, claim["result"]), project_id, session_id,
                                    claim["operation_id"])
            error = APIError(409, "AI_OPERATION_" + claim["status"].upper(),
                             "This action has already been submitted. Reload its saved result before retrying.")
            error.operation_id = claim["operation_id"]
            raise error
        trace = DispatchTrace()
        token = ai_dispatch_trace.set(trace)
        try:
            governor = getattr(request.app.state.real_ai, "governor", None)
            if governor is not None:
                # Completed idempotent results above remain free to recover.
                # A new turn/writer needs two stages; avoid a known call-count
                # failure after paying for only the first stage.
                governor.check_budget(required_calls=2 if kind in {"conversation", "generation"} else 1)
            async with asyncio.timeout(120):
                payload = await produce(provider)
                row = await gateway.complete(claim, payload, {
                    "mode": "real", "provider": "openai", "model": model, "version": 1,
                })
                return result_scope(kind, await gateway.normalize_result(kind, row), project_id, session_id,
                                    claim["operation_id"])
        except BaseException as cause:
            code = cause.code if isinstance(cause, APIError) else "REAL_AI_UNCERTAIN"
            try:
                await asyncio.shield(gateway.fail(claim, code, uncertain=trace.dispatched))
            except (Exception, asyncio.CancelledError):
                pass  # Remains non-reclaimable even if recording failure is unavailable.
            if isinstance(cause, asyncio.CancelledError):
                raise
            error = cause if isinstance(cause, APIError) else APIError(
                503, "REAL_AI_UNCERTAIN", "The action may have been processed. Reload before starting a new action.")
            error.operation_id = claim["operation_id"]
            raise error from None
        finally:
            ai_dispatch_trace.reset(token)


@router.get("/capabilities")
async def capabilities(request: Request):
    return request.app.state.real_ai.capabilities()


async def operation_result(row, gateway, operation_id=None):
    result = validated(RealOperation, row)
    if operation_id is not None and result["operation_id"] != str(operation_id):
        raise unavailable()
    await gateway.get_project(UUID(result["project_id"]))
    if result["result"] is not None:
        normalized = await gateway.normalize_result(result["kind"], result["result"])
        result["result"] = (await gateway.draft(UUID(normalized["draft_id"]))
                            if result["kind"] == "generation" else normalized)
        result_scope(result["kind"], result["result"], result["project_id"], result["session_id"], result["operation_id"])
    return result


@router.get("/operations/by-key/{kind}/{action_key}", response_model=RealOperation)
async def operation_by_key(kind: Literal["transcription","conversation","generation","speech"],
                           action_key: UUID, gateway: Gateway):
    row = await gateway.rpc("get_real_ai_operation_by_key", {"p_kind":kind,"p_action_key":str(action_key)})
    result = await operation_result(row, gateway)
    if result["kind"] != kind:
        raise unavailable()
    return result


@router.get("/operations/{operation_id}", response_model=RealOperation)
async def operation(operation_id: UUID, gateway: Gateway):
    row = await gateway.rpc("get_real_ai_operation", {"p_operation_id": str(operation_id)})
    return await operation_result(row, gateway, operation_id)


@router.post("/story-sessions/{session_id}/transcribe", response_model=RealTranscript, openapi_extra=UPLOAD_SCHEMA)
async def transcribe(session_id: UUID, request: Request, gateway: Gateway, idempotency_key: Key):
    session = await gateway.get_owned_session(session_id, active=True)
    require_provider(request, kind="transcription")  # Fail before capturing/uploading any audio.
    slots = request.app.state.audio_slots
    if slots.locked():
        raise APIError(429, "AUDIO_BUSY", "Audio processing is busy. Try again shortly.")
    async with slots:
        with TemporaryDirectory(prefix="memy-real-audio-") as directory:
            recording = await read_recording(request, Path(directory), session["language"])

            async def produce(provider):
                return {"text": await provider.transcribe(recording.path, session["language"])}

            result = await execute(request, gateway, project_id=UUID(session["project_id"]),
                session_id=session_id, kind="transcription", key=idempotency_key,
                fingerprint=digest({"audio":recording.content_sha256,"language":session["language"]}),
                produce=produce, model=request.app.state.settings.real_ai_transcription_model)
            if result["language"] != session["language"]:
                raise unavailable()
            return result


@router.get("/story-sessions/{session_id}/transcripts", response_model=list[RealTranscript])
async def transcripts(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.transcripts(session_id, limit, offset)


@router.post("/story-sessions/{session_id}/messages", response_model=RealTurn)
async def send_message(session_id: UUID, payload: RealMessageCreate, request: Request, gateway: Gateway, idempotency_key: Key):
    session = await gateway.get_owned_session(session_id, active=True)
    language_matches(payload.language, session)
    check_operation_policy(request, kind="conversation")
    transcript = validated(RealTranscript, await gateway.one("real_transcripts", "transcript_id", payload.source_transcript_id))
    if transcript["session_id"] != str(session_id) or transcript["project_id"] != session["project_id"]:
        raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
    language_matches(transcript["language"], session)
    prior, recent = await read_together(
        gateway.project_memories(UUID(session["project_id"])),
        gateway.messages(session_id, limit=12, recent=True),
    )
    while recent and sum(len(m["text"]) for m in recent) > 32_000:
        recent.pop(0)
    provider = require_provider(request, kind="conversation")
    if hasattr(provider, "validate_turn_input"):
        provider.validate_turn_input(transcript["text"], payload.language, prior, recent_messages=recent)

    async def produce(provider):
        reply = await provider.respond(transcript["text"], payload.language, prior, recent_messages=recent)
        return {"source_transcript_id": str(payload.source_transcript_id),
                "assistant_text": reply.text, "memories": [asdict(f) for f in reply.facts]}

    result = await execute(request, gateway, project_id=UUID(session["project_id"]), session_id=session_id,
        kind="conversation", key=idempotency_key, fingerprint=digest(payload.model_dump(mode="json")),
        produce=produce, model=request.app.state.settings.openai_text_model)
    if (result["user_message"]["source_transcript_id"] != str(payload.source_transcript_id)
        or result["message"]["language"] != payload.language):
        raise unavailable()
    return result


@router.get("/story-sessions/{session_id}/messages", response_model=list[RealMessage])
async def messages(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.messages(session_id, limit, offset)


@router.post("/story-sessions/{session_id}/text-messages", response_model=RealTurn)
async def send_text_message(session_id: UUID, payload: RealTextMessageCreate, request: Request,
                            gateway: Gateway, idempotency_key: Key):
    """One explicit typed turn; original wording persists with the completed reply."""
    session = await gateway.get_owned_session(session_id, active=True)
    language_matches(payload.language, session)
    # An unapplied migration must fail before a provider claim or reservation.
    try:
        scope = await gateway.rpc("check_real_text_chat_scope", {"p_session_id": str(session_id)})
    except APIError as error:
        if error.status_code == 503:
            raise APIError(503, "TEXT_CHAT_NOT_READY", "Text chat setup is not available yet. No AI request was made.") from None
        raise
    if (not isinstance(scope, dict) or set(scope) != {"project_id", "session_id", "language", "input_limit"}
        or scope["project_id"] != session["project_id"] or scope["session_id"] != str(session_id)
        or scope["language"] != session["language"] or type(scope["input_limit"]) is not int
        or scope["input_limit"] != 4000):
        raise APIError(503, "TEXT_CHAT_NOT_READY", "Text chat setup could not be verified. No AI request was made.")
    prior, recent = await read_together(
        gateway.project_memories(UUID(session["project_id"])),
        gateway.messages(session_id, limit=12, recent=True),
    )
    while recent and sum(len(message["text"]) for message in recent) > 32_000:
        recent.pop(0)
    provider = require_provider(request, kind="conversation", typed=True)
    if hasattr(provider, "validate_turn_input"):
        provider.validate_turn_input(payload.text, payload.language, prior, recent_messages=recent)

    async def produce(provider):
        reply = await provider.respond(payload.text, payload.language, prior, recent_messages=recent)
        return {"input_text": payload.text, "assistant_text": reply.text,
                "memories": [asdict(fact) for fact in reply.facts]}

    result = await execute(request, gateway, project_id=UUID(session["project_id"]), session_id=session_id,
        kind="conversation", key=idempotency_key,
        fingerprint=digest({"input_type": "typed", "action_key": str(idempotency_key),
                            **payload.model_dump(mode="json")}),
        produce=produce, model=request.app.state.settings.openai_text_model, typed=True)
    if (result["user_message"]["text"] != payload.text
        or result["user_message"]["source_transcript_id"] is not None
        or result["user_message"]["source_text_input_id"] is None
        or result["message"]["language"] != payload.language):
        raise unavailable()
    return result


@router.get("/story-sessions/{session_id}/memories", response_model=list[RealMemory])
async def memories(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.memories(session_id, limit, offset)


@router.patch("/memories/{memory_id}", response_model=RealMemory)
async def review_memory(memory_id: UUID, payload: MemoryPatch, gateway: Gateway):
    original = await gateway.one("real_memories", "id", memory_id)
    await gateway.rpc("review_real_memory", {
        "p_memory_id": str(memory_id), "p_expected_version": payload.expected_version,
        "p_status": payload.status, "p_corrected_value": payload.corrected_value,
    })
    # Scope read includes resolved question state; original evidence remains immutable.
    row = await gateway.one("real_memories", "id", memory_id)
    questions = await gateway.rows("real_memory_clarifications",
        filters={"fact_id":f"eq.{memory_id}","status":"eq.open"}, limit=1)
    return validated(RealMemory, {**row,"clarification_question":questions[0]["question"] if questions else None})


@router.post("/story-projects/{project_id}/generate", response_model=RealDraft, status_code=201)
async def generate(project_id: UUID, payload: StoryGenerationRequest, request: Request, gateway: Gateway, idempotency_key: Key):
    project = await gateway.get_project(project_id)
    language_matches(payload.language, project)
    check_operation_policy(request, kind="generation")
    context = await gateway.context(project_id)
    if not context["source_memories"]:
        raise APIError(409, "NO_CONFIRMED_MEMORIES", "Review and confirm memories before writing your story.")
    if context["blocking_clarifications"]:
        raise APIError(409, "CLARIFICATION_REQUIRED", "Resolve memory questions before writing your story.")

    async def produce(provider):
        content = await provider.write(payload.language, payload.style, context["source_memories"])
        return {"content": content, "source_memories": context["source_memories"],
                "model_review": {"unsupported_claims": []}}

    result = await execute(request, gateway, project_id=project_id, session_id=None, kind="generation",
        key=idempotency_key, fingerprint=digest({**payload.model_dump(mode="json"),"context":context["context_token"]}),
        produce=produce, model=request.app.state.settings.openai_text_model)
    return await gateway.draft(UUID(result["draft_id"]))


@router.get("/story-projects/{project_id}/drafts", response_model=list[RealDraft])
async def drafts(project_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.drafts(project_id, limit, offset)


@router.get("/story-drafts/{draft_id}", response_model=RealDraft)
async def draft(draft_id: UUID, gateway: Gateway):
    return await gateway.draft(draft_id)


@router.patch("/story-drafts/{draft_id}", response_model=RealDraft)
async def edit(draft_id: UUID, payload: StoryDraftPatch, gateway: Gateway):
    await gateway.draft(draft_id)
    await gateway.rpc("edit_real_story_draft", {"p_draft_id": str(draft_id),
        "p_expected_revision": payload.expected_revision, "p_content": payload.content})
    return await gateway.draft(draft_id)


@router.get("/story-drafts/{draft_id}/history", response_model=list[StoryEditResponse])
async def history(draft_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    await gateway.draft(draft_id)
    rows = await gateway.rows("real_story_edits", filters={"draft_id": f"eq.{draft_id}"},
                              limit=limit, offset=offset, order="revision.desc")
    return [validated(StoryEditResponse, {k:v for k,v in r.items() if k != "project_id"}) for r in rows]


@router.get("/conversation-messages/{message_id}/speech", response_model=RealSpeech)
async def prepared_speech(message_id: UUID, request: Request, gateway: Gateway):
    """Recover an owned prepared reply without paying to synthesize it again."""
    message = validated(RealMessage, await gateway.one("real_conversation_messages", "id", message_id))
    if message["role"] != "assistant":
        raise APIError(422, "ASSISTANT_MESSAGE_REQUIRED", "Choose an interviewer reply.")
    rows = await gateway.rows("real_speech", filters={
        "assistant_message_id": f"eq.{message_id}",
        "project_id": f"eq.{message['project_id']}",
        "session_id": f"eq.{message['session_id']}",
    }, limit=1, order="created_at.desc,speech_id.desc")
    if not rows:
        raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
    row = rows[0]
    if (not isinstance(row, dict) or row.get("assistant_message_id") != str(message_id)
        or row.get("project_id") != message["project_id"] or row.get("session_id") != message["session_id"]):
        raise unavailable()
    metadata = await gateway.normalize_result("speech", row)
    if metadata["assistant_message_id"] != str(message_id) or metadata["language"] != message["language"]:
        raise unavailable()
    if datetime.fromisoformat(metadata["expires_at"]) <= datetime.now(timezone.utc):
        raise APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")
    # Gate-free owned read: an exhausted budget must not block existing audio.
    request.app.state.real_ai.cache.get(gateway.user.id, UUID(metadata["speech_id"]), metadata["audio_sha256"])
    return metadata


@router.post("/conversation-messages/{message_id}/speech", response_model=RealSpeech)
async def speak(message_id: UUID, payload: RealSpeechRequest, request: Request, gateway: Gateway, idempotency_key: Key):
    message = validated(RealMessage, await gateway.one("real_conversation_messages", "id", message_id))
    if message["role"] != "assistant":
        raise APIError(422, "ASSISTANT_MESSAGE_REQUIRED", "Choose an interviewer reply.")
    language_matches(payload.language, message)
    check_operation_policy(request, kind="speech")
    audio = None

    async def produce(provider):
        nonlocal audio
        audio = await provider.synthesize(message["text"], message["language"])
        return {"assistant_message_id": str(message_id), "media_type": audio.media_type,
            "audio_sha256": audio.sha256, "audio_size": len(audio.data),
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=request.app.state.real_ai.cache.ttl)).isoformat()}

    result = await execute(request, gateway, project_id=UUID(message["project_id"]),
        session_id=UUID(message["session_id"]), kind="speech", key=idempotency_key,
        fingerprint=digest({"assistant_id":str(message_id),"text_sha256":hashlib.sha256(message["text"].encode()).hexdigest(),"language":payload.language}),
        produce=produce, model=request.app.state.settings.real_ai_speech_model)
    cache = request.app.state.real_ai.cache
    if result["assistant_message_id"] != str(message_id) or result["language"] != payload.language:
        raise unavailable()
    if audio is not None:
        cache.put(gateway.user.id, UUID(result["speech_id"]), audio.data, result["audio_sha256"],
                  expires_at=datetime.fromisoformat(result["expires_at"]).timestamp())
    if datetime.fromisoformat(result["expires_at"]) <= datetime.now(timezone.utc):
        raise APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")
    cache.get(gateway.user.id, UUID(result["speech_id"]), result["audio_sha256"])
    return result


@router.get("/spoken-replies/{speech_id}/audio", response_class=WAVResponse)
async def audio(speech_id: UUID, request: Request, gateway: Gateway):
    row = await gateway.one("real_speech", "speech_id", speech_id)
    metadata = await gateway.normalize_result("speech", row)
    if datetime.fromisoformat(metadata["expires_at"]) <= datetime.now(timezone.utc):
        raise APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")
    data = request.app.state.real_ai.cache.get(gateway.user.id, speech_id, metadata["audio_sha256"])
    return Response(data, media_type="audio/wav", headers={"Cache-Control":"private, no-store",
        "X-Memy-Speech-Id":str(speech_id),"X-Memy-Audio-Sha256":metadata["audio_sha256"]})


@router.post("/story-drafts/{draft_id}/export", status_code=201, response_class=PDFResponse)
async def export(draft_id: UUID, payload: RealExportRequest, request: Request, gateway: Gateway):
    saved = await gateway.draft(draft_id)
    if saved["revision"] != payload.expected_revision:
        raise APIError(409, "DRAFT_REVISION_CONFLICT", "The draft changed. Reload before exporting.")
    project = await gateway.get_project(UUID(saved["project_id"]))
    renderer = request.app.state.real_pdf_renderer
    document = await render_document(request, renderer=renderer, title=project["title"], content=saved["content"],
        language=saved["language"], draft_version=saved["version"], draft_revision=saved["revision"],
        include_title_page=payload.include_title_page, include_page_numbers=payload.include_page_numbers)
    metadata = validated(RealExportMetadata, await gateway.rpc("record_real_story_export", {
        "p_draft_id":str(draft_id), "p_expected_revision":payload.expected_revision, "p_project_title":project["title"],
        "p_include_title_page":payload.include_title_page, "p_include_page_numbers":payload.include_page_numbers,
        "p_page_count":document.page_count, "p_byte_size":len(document.data), "p_filename":document.filename,
        "p_renderer_version":renderer.renderer_version,
    }))
    return pdf_response(document, RealExportMetadata.model_validate(metadata), status_code=201)


@router.get("/story-projects/{project_id}/exports", response_model=list[RealExportMetadata])
async def exports(project_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    await gateway.get_project(project_id)
    rows = await gateway.rows("real_story_exports", filters={"project_id":f"eq.{project_id}"},
                              limit=limit,offset=offset,order="created_at.desc,export_id.desc")
    return [validated(RealExportMetadata,{k:v for k,v in r.items() if k != "content"}) for r in rows]


@router.get("/story-exports/{export_id}/download", response_class=PDFResponse)
async def download(export_id: UUID, request: Request, gateway: Gateway):
    saved = RealSavedExport.model_validate(await gateway.rpc("get_real_story_export", {"p_export_id":str(export_id)}))
    metadata = saved.export
    await gateway.get_project(metadata.project_id)
    if metadata.export_id != export_id:
        raise unavailable()
    renderer = request.app.state.real_pdf_renderer
    if metadata.renderer_version != renderer.renderer_version:
        raise unavailable()
    document = await render_document(request, renderer=renderer, title=metadata.title, content=saved.content,
        language=metadata.language, draft_version=metadata.draft_version, draft_revision=metadata.draft_revision,
        include_title_page=metadata.include_title_page, include_page_numbers=metadata.include_page_numbers)
    if document.filename != metadata.filename or len(document.data) != metadata.byte_size or document.page_count != metadata.page_count:
        raise unavailable()
    return pdf_response(document, metadata)
