"""Typed request and response contracts for story projects and sessions."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


LanguageCode = Literal["en", "sv"]


class StrictRequest(BaseModel):
    """Reject unknown fields and scalar coercion at the API boundary."""

    model_config = ConfigDict(extra="forbid", strict=True)


class StrictResponse(BaseModel):
    """Reject unexpected upstream fields while allowing JSON type parsing."""

    model_config = ConfigDict(extra="forbid")


class StoryProjectCreate(StrictRequest):
    """Fields accepted when a user creates a story project."""

    model_config = ConfigDict(json_schema_extra={"examples": [
        {"title": "Min barndom i Malmö", "language": "sv"},
        {"title": "My Childhood", "language": "en", "description": "Fictional development story"},
    ]})

    title: str = Field(min_length=1, max_length=120)
    language: LanguageCode
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class StoryProjectPatch(StrictRequest):
    """Mutable Day 2 metadata; project language is intentionally fixed."""

    model_config = ConfigDict(json_schema_extra={"examples": [
        {"title": "My Early Years"}, {"description": "A fictional development story"},
    ]})

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("title", mode="before")
    @classmethod
    def trim_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_patch(self) -> "StoryProjectPatch":
        if not self.model_fields_set:
            raise ValueError("At least one supported field must be provided.")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("Title cannot be null.")
        return self


class SessionCreate(StrictRequest):
    """Sessions inherit language from their project and accept no fields."""

    model_config = ConfigDict(json_schema_extra={"examples": [{}]})


class StoryProjectResponse(StrictResponse):
    """Public representation; ownership identifiers are deliberately omitted."""

    id: UUID
    title: str
    description: str | None
    language: LanguageCode
    status: str
    created_at: datetime
    updated_at: datetime


class ConversationSessionResponse(StrictResponse):
    """Public conversation-session representation."""

    id: UUID
    project_id: UUID
    language: LanguageCode
    status: Literal["active", "completed"]
    created_at: datetime
    updated_at: datetime
    ended_at: datetime | None
