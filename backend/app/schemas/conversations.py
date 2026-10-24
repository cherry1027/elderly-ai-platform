"""Source-grounded, explicitly simulated conversation contracts."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.schemas.story_projects import LanguageCode, StrictRequest, StrictResponse


class MessageCreate(StrictRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"text": "Jag flyttade till Malmö 1975.", "language": "sv"},
        {"source_message_id": "11111111-1111-4111-8111-111111111111", "language": "en"},
    ]})

    text: str | None = Field(default=None, min_length=1, max_length=4000)
    source_message_id: UUID | None = None
    language: LanguageCode

    @field_validator("source_message_id", mode="before")
    @classmethod
    def parse_uuid(cls, value):
        return UUID(value) if isinstance(value, str) else value

    @field_validator("text", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("text")
    @classmethod
    def valid_text(cls, value):
        if value is not None:
            if "\0" in value:
                raise ValueError("NUL is not valid source text")
            value.encode("utf-8")
        return value

    @model_validator(mode="after")
    def exactly_one_source(self):
        if (self.text is None) == (self.source_message_id is None):
            raise ValueError("Provide text or an existing source message, not both")
        return self


class MessageResponse(StrictResponse):
    id: UUID
    session_id: UUID
    sequence: int = Field(gt=0)
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=32_000)
    language: LanguageCode
    created_at: datetime


class MemoryResponse(StrictResponse):
    id: UUID
    project_id: UUID
    session_id: UUID
    source_message_id: UUID
    fact_type: Literal["person", "relationship", "date", "location", "event", "emotion"]
    value: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(min_length=1, max_length=1000)
    year: int | None = Field(ge=1, le=2100)
    slot: str | None = Field(max_length=80)
    uncertain: bool
    status: Literal["pending", "confirmed", "rejected"]
    corrected_value: str | None = Field(max_length=1000)
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


class ClarificationResponse(StrictResponse):
    id: UUID
    fact_id: UUID
    session_id: UUID
    conflicts_with_fact_id: UUID | None
    question: str = Field(min_length=1, max_length=1000)
    status: Literal["open", "resolved"]
    resolution: str | None
    created_at: datetime
    resolved_at: datetime | None


class ConversationTurnResponse(StrictResponse):
    user_message: MessageResponse
    message: MessageResponse
    memories: list[MemoryResponse] = Field(max_length=8)
    clarifications: list[ClarificationResponse] = Field(max_length=8)
    requires_clarification: bool
    mode: Literal["mock"]


class MemoryPatch(StrictRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"status": "confirmed", "expected_version": 1},
        {"status": "rejected", "expected_version": 1},
        {"status": "confirmed", "corrected_value": "1976", "expected_version": 1},
    ]})

    status: Literal["confirmed", "rejected"]
    corrected_value: str | None = Field(default=None, min_length=1, max_length=1000)
    expected_version: int = Field(ge=1)

    @field_validator("corrected_value", mode="before")
    @classmethod
    def trim_correction(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def valid_correction(self):
        if "corrected_value" in self.model_fields_set:
            if self.corrected_value is None or self.status != "confirmed":
                raise ValueError("A correction requires a confirmed non-null value")
            if "\0" in self.corrected_value:
                raise ValueError("NUL is not valid correction text")
            self.corrected_value.encode("utf-8")
        return self
