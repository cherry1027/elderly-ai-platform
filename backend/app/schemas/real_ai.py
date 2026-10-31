"""Real-provider contracts: never reuse the explicitly simulated v1 labels."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.schemas.story_projects import StrictRequest, StrictResponse, LanguageCode
from app.schemas.conversations import MemoryResponse, ClarificationResponse
from app.schemas.story_drafts import StorySourceMemory, StoryEditResponse
from app.schemas.exports import StoryExportMetadata


class Provenance(StrictResponse):
    mode: Literal["real"]
    provider: Literal["openai"]
    model: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
    version: Literal[1]


class RealTranscript(StrictResponse):
    transcript_id: UUID
    project_id: UUID
    session_id: UUID
    language: LanguageCode
    text: str = Field(min_length=1, max_length=32_000)
    status: Literal["completed"]
    created_at: AwareDatetime
    provenance: Provenance


class RealMessage(StrictResponse):
    id: UUID
    project_id: UUID
    session_id: UUID
    role: Literal["user", "assistant"]
    language: LanguageCode
    text: str = Field(min_length=1, max_length=32_000)
    sequence: int = Field(ge=1)
    source_transcript_id: UUID
    created_at: AwareDatetime
    provenance: Provenance


class RealMessageCreate(StrictRequest):
    source_transcript_id: UUID
    language: LanguageCode

    @field_validator("source_transcript_id", mode="before")
    @classmethod
    def uuid_text(cls, value):
        return UUID(value) if isinstance(value, str) else value


class RealMemory(MemoryResponse):
    clarification_question: str | None = Field(max_length=1000)


class RealTurn(StrictResponse):
    user_message: RealMessage
    message: RealMessage
    memories: list[RealMemory] = Field(max_length=8)
    mode: Literal["real"]

    @model_validator(mode="after")
    def matching_turn(self):
        u, a = self.user_message, self.message
        if (u.role != "user" or a.role != "assistant" or u.session_id != a.session_id
            or u.project_id != a.project_id or u.language != a.language
            or a.sequence != u.sequence + 1 or u.source_transcript_id != a.source_transcript_id
            or u.id != u.source_transcript_id
            or any(m.project_id != u.project_id or m.session_id != u.session_id
                   or m.source_message_id != u.id for m in self.memories)):
            raise ValueError("Incoherent conversation turn")
        return self


class RealVerification(StrictResponse):
    status: Literal["needs_review", "stale_sources"]
    method: Literal["model_review_v1", "manual_unverified"]
    unsupported_claims: list[str] = Field(max_length=20)
    checked_revision: int = Field(ge=1)
    checked_at: AwareDatetime
    sources_current: bool
    reason: str | None


class RealDraft(StrictResponse):
    draft_id: UUID
    project_id: UUID
    language: LanguageCode
    style: Literal["warm"]
    status: Literal["needs_review", "edited"]
    version: int = Field(ge=1)
    revision: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=20_000)
    original_content: str = Field(min_length=1, max_length=20_000)
    source_memories: list[StorySourceMemory] = Field(min_length=1, max_length=200)
    verification: RealVerification
    mode: Literal["real"]
    provenance: Provenance
    created_at: AwareDatetime
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def safe_review_state(self):
        if (self.verification.checked_revision != self.revision
            or (self.revision == 1 and (self.status != "needs_review" or self.content != self.original_content))
            or (self.status == "edited" and (self.revision < 2 or self.verification.method != "manual_unverified"))
            or len({m.memory_id for m in self.source_memories}) != len(self.source_memories)):
            raise ValueError("Invalid review state")
        return self


class RealSpeechRequest(StrictRequest):
    language: LanguageCode


class RealSpeech(StrictResponse):
    speech_id: UUID
    assistant_message_id: UUID
    language: LanguageCode
    media_type: Literal["audio/wav"]
    audio_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    audio_size: int = Field(ge=1, le=8_000_000)
    expires_at: AwareDatetime
    status: Literal["ready"]


class RealOperation(StrictResponse):
    operation_id: UUID
    kind: Literal["transcription", "conversation", "generation", "speech"]
    status: Literal["in_progress", "completed", "failed", "uncertain"]
    project_id: UUID
    session_id: UUID | None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    error_code: str | None
    result: dict | None


class RealExportRequest(StrictRequest):
    expected_revision: int = Field(ge=1)
    include_title_page: bool = True
    include_page_numbers: bool = True


class RealExportMetadata(StoryExportMetadata):
    renderer_version: Literal["memy_real_pdf_v1"]


class RealSavedExport(StrictResponse):
    export: RealExportMetadata
    content: str = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def matching_hash(self):
        import hashlib
        if hashlib.sha256(self.content.encode()).hexdigest() != self.export.content_sha256:
            raise ValueError("Invalid export snapshot")
        return self
