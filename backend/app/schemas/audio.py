"""Public audio-transcript contracts; no raw recording or provider metadata."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.story_projects import LanguageCode, StrictResponse


class TranscriptResponse(StrictResponse):
    transcript_id: UUID
    session_id: UUID
    language: LanguageCode
    text: str = Field(min_length=1, max_length=32_000)
    status: Literal["completed"]
    created_at: datetime

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Original text must not be blank")
        return value
