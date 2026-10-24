"""User-scoped session and audio transcript access through Supabase RLS."""

from uuid import UUID
from datetime import datetime
from typing import Literal

import httpx
from pydantic import Field, ValidationError

from app.core.errors import APIError, invalid_token, unavailable
from app.schemas.audio import TranscriptResponse
from app.schemas.story_projects import LanguageCode, StrictResponse
from app.services.resources import SESSION_COLUMNS, SupabaseGateway


class TranscriptionClaim(StrictResponse):
    outcome: Literal["claimed", "in_progress", "completed"]
    request_id: UUID
    claim_token: UUID | None
    status: Literal["processing", "completed"]
    transcript_id: UUID | None
    session_id: UUID
    language: LanguageCode
    text: str | None
    created_at: datetime | None
    attempt_count: int = Field(ge=1)


class AudioGateway(SupabaseGateway):
    async def get_owned_session(self, session_id: UUID, *, active: bool = False) -> dict:
        rows = await self._request(
            "GET", "conversation_sessions",
            params={"select": SESSION_COLUMNS, "id": f"eq.{session_id}", "limit": "1"},
        )
        if not rows:
            raise APIError(404, "SESSION_NOT_FOUND", "Conversation session was not found.")
        if len(rows) != 1:
            raise unavailable()
        try:
            project_id = UUID(str(rows[0].get("project_id")))
        except (ValueError, TypeError):
            raise unavailable() from None
        await self.get_project(project_id)
        session = self._session(rows[0], project_id)
        if UUID(session["id"]) != session_id:
            raise unavailable()
        if active and session["status"] != "active":
            raise APIError(409, "SESSION_COMPLETED", "This conversation session is completed.")
        return session

    async def _rpc(self, name: str, payload: dict) -> dict:
        try:
            response = await self.client.post(
                f"{self.base_url}/rest/v1/rpc/{name}", json=payload, headers=self.headers,
            )
        except httpx.HTTPError:
            raise unavailable() from None
        if response.status_code == 401:
            raise invalid_token()
        if not 200 <= response.status_code < 300:
            try:
                body = response.json()
                code = body.get("code") if isinstance(body, dict) else None
            except ValueError:
                code = None
            # Interpret only known SQLSTATEs, never expose messages/details.
            if code == "P0002":
                raise APIError(404, "SESSION_NOT_FOUND", "Conversation session was not found.")
            if code in ("23505", "55000") or response.status_code == 409:
                raise APIError(409, "TRANSCRIPTION_CONFLICT", "This transcription request conflicts with its current state.")
            if response.status_code == 403 or code == "42501":
                raise APIError(403, "ACCESS_DENIED", "Access is denied.")
            if code in ("22023", "22001"):
                raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")
            raise unavailable()
        try:
            rows = response.json()
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
                raise ValueError
        except ValueError:
            raise unavailable() from None
        return rows[0]

    @staticmethod
    def _transcript(row: dict, session_id: UUID, language: str | None = None) -> dict:
        try:
            transcript = TranscriptResponse.model_validate(row)
            if transcript.session_id != session_id or (language is not None and transcript.language != language):
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return transcript.model_dump(mode="json")

    async def claim_transcription(self, session: dict, key: UUID, digest: str, language: str) -> TranscriptionClaim:
        row = await self._rpc("claim_audio_transcription", {
            "p_project_id": session["project_id"], "p_session_id": session["id"],
            "p_idempotency_key": str(key), "p_content_sha256": digest, "p_language": language,
        })
        try:
            claim = TranscriptionClaim.model_validate(row)
            if str(claim.session_id) != session["id"] or claim.language != language:
                raise ValueError
            if claim.outcome == "completed":
                if claim.status != "completed" or claim.claim_token is not None:
                    raise ValueError
                self.completed_transcript(claim)
            else:
                if claim.status != "processing" or any(value is not None for value in (
                    claim.transcript_id, claim.text, claim.created_at,
                )):
                    raise ValueError
                if (claim.outcome == "claimed") != (claim.claim_token is not None):
                    raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return claim

    def completed_transcript(self, claim: TranscriptionClaim) -> dict:
        fields = ("transcript_id", "session_id", "language", "text", "status", "created_at")
        return self._transcript({field: getattr(claim, field) for field in fields}, claim.session_id, claim.language)

    async def complete_transcription(self, claim: TranscriptionClaim, text: str) -> dict:
        row = await self._rpc("complete_audio_transcription", {
            "p_request_id": str(claim.request_id), "p_claim_token": str(claim.claim_token),
            "p_original_text": text,
        })
        result = self._transcript(row, claim.session_id, claim.language)
        if result["text"] != text:
            raise unavailable()
        return result

    async def fail_transcription(self, claim: TranscriptionClaim, code: str) -> None:
        await self._rpc("fail_audio_transcription", {
            "p_request_id": str(claim.request_id), "p_claim_token": str(claim.claim_token),
            "p_failure_code": code,
        })

    async def list_transcripts(self, session_id: UUID, limit: int, offset: int) -> list[dict]:
        session = await self.get_owned_session(session_id)
        rows = await self._request("GET", "audio_transcripts", params={
            "select": "transcript_id,session_id,language,text,status,created_at",
            "session_id": f"eq.{session_id}", "order": "created_at.asc,transcript_id.asc",
            "limit": str(limit), "offset": str(offset),
        })
        if len(rows) > limit:
            raise unavailable()
        return [self._transcript(row, session_id, session["language"]) for row in rows]
