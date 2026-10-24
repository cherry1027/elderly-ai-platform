"""Authenticate and authorize before reading any multipart upload bytes."""

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated
from uuid import UUID
import asyncio

from fastapi import APIRouter, Depends, Header, Query, Request

from app.api.dependencies import get_current_user
from app.core.errors import APIError
from app.schemas.audio import TranscriptResponse
from app.schemas.errors import ErrorResponse
from app.services.audio_resources import AudioGateway
from app.services.audio_upload import read_recording
from app.services.auth import AuthenticatedUser

router = APIRouter(prefix="/api/v1/story-sessions", tags=["Audio transcripts"], responses={
    code: {"model": ErrorResponse} for code in (401, 403, 404, 408, 409, 413, 415, 422, 429, 503, 504)
})


def get_audio_gateway(request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)]) -> AudioGateway:
    return AudioGateway(request.app.state.settings, request.app.state.http_client, user)


Gateway = Annotated[AudioGateway, Depends(get_audio_gateway)]

UPLOAD_SCHEMA = {"requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
    "type": "object", "additionalProperties": False,
    "required": ["file", "language", "consent"], "properties": {
        "file": {"type": "string", "format": "binary", "description": "Audio-only WAV, MP3, M4A or WebM; <=25 MB, <=90 seconds."},
        "language": {"type": "string", "enum": ["en", "sv"]},
        "consent": {"type": "string", "enum": ["true"], "description": "User explicitly agrees to temporary audio processing for transcription."},
    },
}}}}}


@router.post("/{session_id}/transcribe", response_model=TranscriptResponse, openapi_extra=UPLOAD_SCHEMA)
async def transcribe_recording(
    session_id: UUID, request: Request, gateway: Gateway,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
) -> dict:
    session = await gateway.get_owned_session(session_id, active=True)
    slots = request.app.state.audio_slots
    if slots.locked():
        raise APIError(429, "AUDIO_BUSY", "Audio processing is busy; retry later.")
    await slots.acquire()
    try:
        with TemporaryDirectory(prefix="memy-audio-") as directory:
            recording = await read_recording(request, Path(directory), session["language"])
            # Ordinary startup stays disabled. The explicit development launcher
            # can inject permanently labelled fictional fixtures, not recognition.
            provider = request.app.state.transcription_provider
            if getattr(provider, "mode", None) == "openai":
                raise APIError(503, "LIVE_AI_RELEASE_BLOCKED", "Live AI is evaluation-only pending release review.")
            if not provider.enabled:
                raise APIError(503, "TRANSCRIPTION_DISABLED", "Live speech transcription is not enabled.")
            claim = await gateway.claim_transcription(
                session, idempotency_key, recording.content_sha256, recording.language,
            )
            if claim.outcome == "completed":
                return gateway.completed_transcript(claim)
            if claim.outcome == "in_progress":
                raise APIError(409, "TRANSCRIPTION_IN_PROGRESS", "This recording is already being processed.")
            failure_code = "TRANSCRIPTION_UNAVAILABLE"
            try:
                try:
                    text = await asyncio.wait_for(
                        provider.transcribe(recording.path, recording.language), timeout=60,
                    )
                except TimeoutError:
                    failure_code = "TRANSCRIPTION_TIMEOUT"
                    raise APIError(504, failure_code, "Speech transcription timed out.") from None
                except Exception:
                    raise APIError(503, failure_code, "Speech transcription is temporarily unavailable.") from None
                if not isinstance(text, str) or not text.strip() or len(text) > 32_000 or "\0" in text:
                    failure_code = "TRANSCRIPTION_INVALID_RESPONSE"
                    raise APIError(503, failure_code, "Speech transcription returned an unusable result.")
                try:
                    text.encode("utf-8")
                except UnicodeError:
                    failure_code = "TRANSCRIPTION_INVALID_RESPONSE"
                    raise APIError(503, failure_code, "Speech transcription returned an unusable result.") from None
                return await gateway.complete_transcription(claim, text)
            except APIError:
                # A completion can have committed despite an interrupted HTTP
                # response. The failure RPC never changes a completed result.
                try:
                    await gateway.fail_transcription(claim, failure_code)
                except APIError:
                    pass  # A lease lets the same key recover after DB outages.
                raise
    finally:
        slots.release()


@router.get("/{session_id}/transcripts", response_model=list[TranscriptResponse])
async def list_session_transcripts(
    session_id: UUID, gateway: Gateway,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> list[dict]:
    """Read only immutable audio originals from an owned session."""
    return await gateway.list_transcripts(session_id, limit, offset)
