"""Owned PDF metadata and explicit, non-generating story continuation."""

from datetime import datetime
import hashlib
import re
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.schemas.story_drafts import StoryDraftResponse
from app.schemas.story_projects import (
    ConversationSessionResponse, LanguageCode, StrictRequest, StrictResponse,
)

SAFE_PDF_FILENAME = r"memy-[a-z0-9]+(?:-[a-z0-9]+)*\.pdf"


class StoryExportRequest(StrictRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"format": "pdf", "include_title_page": True, "include_page_numbers": True},
    ]})

    format: Literal["pdf"] = "pdf"
    include_title_page: bool = True
    include_page_numbers: bool = True


class ContinueStoryRequest(StrictRequest):
    model_config = ConfigDict(json_schema_extra={"examples": [{}]})


class StoryExportMetadata(StrictResponse):
    export_id: UUID
    project_id: UUID
    draft_id: UUID
    draft_version: int = Field(ge=1)
    draft_revision: int = Field(ge=1)
    language: LanguageCode
    title: str = Field(min_length=1, max_length=120)
    format: Literal["pdf"]
    include_title_page: bool
    include_page_numbers: bool
    renderer_version: Literal["memy_pdf_v1"]
    filename: str = Field(min_length=1, max_length=100)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: int = Field(ge=1, le=2_000_000)
    page_count: int = Field(ge=1, le=100)
    created_at: datetime

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value):
        if not re.fullmatch(SAFE_PDF_FILENAME, value):
            raise ValueError("Unsafe PDF filename")
        return value


class StoryExportContext(StrictResponse):
    draft: StoryDraftResponse
    project_title: str = Field(min_length=1, max_length=120)


class SavedStoryExport(StrictResponse):
    export: StoryExportMetadata
    content: str = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def saved_revision_matches_audit(self):
        if hashlib.sha256(self.content.encode("utf-8")).hexdigest() != self.export.content_sha256:
            raise ValueError("Saved export content does not match its audit")
        return self


class ContinueStoryResponse(StrictResponse):
    project_id: UUID
    language: LanguageCode
    session: ConversationSessionResponse
    session_created: bool
    latest_draft: StoryDraftResponse | None
    generation_triggered: Literal[False]

    @field_validator("generation_triggered", mode="before")
    @classmethod
    def never_generate_implicitly(cls, value):
        if type(value) is not bool or value:
            raise ValueError("Continuation must not generate a draft")
        return value

    @model_validator(mode="after")
    def resources_match_parent(self):
        if (self.session.project_id != self.project_id
            or self.session.language != self.language or self.session.status != "active"):
            raise ValueError("The resumed session does not match its project")
        if self.latest_draft is not None and (
            self.latest_draft.project_id != self.project_id
            or self.latest_draft.language != self.language
        ):
            raise ValueError("The latest draft does not match its project")
        return self
