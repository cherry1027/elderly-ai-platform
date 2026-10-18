"""Authenticate and authorize before reading any multipart upload bytes."""

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request

from app.api.dependencies import get_current_user
from app.core.errors import APIError
from app.schemas.audio import TranscriptResponse
from app.schemas.errors import ErrorResponse
from app.services.audio_resources import AudioGateway
from app.services.audio_upload import read_recording
from app.services.auth import AuthenticatedUser

router = APIRouter(prefix="/api/v1/story-sessions", tags=["Audio transcripts"], responses={
    code: {"model": ErrorResponse} for code in (401, 403, 404, 408, 409, 413, 415, 422, 429, 503)
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
            # Never return a fabricated successful transcript from the real app.
            provider = request.app.state.transcription_provider
            if not provider.enabled:
                raise APIError(503, "TRANSCRIPTION_DISABLED", "Live speech transcription is not enabled.")
            raise APIError(503, "TRANSCRIPTION_DISABLED", "Live speech transcription is not enabled.")
    finally:
        slots.release()
