"""Explicit generation, immutable source snapshots and audited manual revisions."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.story_projects import LanguageCode, StrictRequest, StrictResponse


class StoryGenerationRequest(StrictRequest):
    language: LanguageCode
    style: Literal["warm"] = "warm"
    confirm_generation: Literal[True]

    @field_validator("confirm_generation", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if type(value) is not bool or not value:
            raise ValueError("Explicit generation confirmation is required")
        return value


class StoryDraftPatch(StrictRequest):
    content: str = Field(min_length=1, max_length=20_000)
    expected_revision: int = Field(ge=1)

    @field_validator("content", mode="before")
    @classmethod
    def trim_content(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("content")
    @classmethod
    def safe_text(cls, value):
        if "\0" in value:
            raise ValueError("NUL is not valid story text")
        value.encode("utf-8")
        return value


class StorySourceMemory(StrictResponse):
    memory_id: UUID
    memory_version: int = Field(ge=1)
    source_message_id: UUID
    fact_type: Literal["person", "relationship", "date", "location", "event", "emotion"]
    value: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(min_length=1, max_length=1000)
    corrected_value: str | None = Field(max_length=1000)
    year: int | None = Field(ge=1, le=2100)
    slot: str | None = Field(max_length=80)
    sentence: str = Field(min_length=1, max_length=2000)


class ExcludedStoryMemory(StrictResponse):
    memory_id: UUID
    reason: Literal["pending", "rejected", "unresolved", "unsupported"]


class StoryGenerationContext(StrictResponse):
    project_id: UUID
    language: LanguageCode
    context_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed_count: int = Field(ge=0, le=200)
    source_memories: list[StorySourceMemory] = Field(max_length=200)
    excluded_memories: list[ExcludedStoryMemory] = Field(max_length=200)
    blocking_clarifications: list[UUID] = Field(max_length=200)
    canonical_content: str = Field(max_length=20_000)

    @model_validator(mode="after")
    def source_set_is_coherent(self):
        source_ids = [source.memory_id for source in self.source_memories]
        excluded_ids = [source.memory_id for source in self.excluded_memories]
        if len(set(source_ids)) != len(source_ids) or len(set(excluded_ids)) != len(excluded_ids):
            raise ValueError("Duplicate memory reference")
        if set(source_ids).intersection(excluded_ids) or len(source_ids) > self.confirmed_count:
            raise ValueError("Invalid eligible memory set")
        return self


class StoryVerificationReport(StrictResponse):
    status: Literal["passed", "needs_review", "stale_sources", "not_generated"]
    unsupported_claims: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(max_length=20)
    method: Literal["deterministic_mock_v1", "manual_unverified", "none"]
    checked_revision: int | None = Field(ge=1)
    checked_at: datetime | None
    sources_current: bool
    reason: str | None

    @model_validator(mode="after")
    def never_pass_unsupported_or_unchecked_content(self):
        if self.status == "passed" and (
            self.unsupported_claims or self.method != "deterministic_mock_v1"
            or not self.sources_current or self.checked_revision is None or self.checked_at is None
        ):
            raise ValueError("Unsupported or unchecked story cannot pass verification")
        if self.status == "not_generated" and (
            self.method != "none" or self.checked_revision is not None or self.checked_at is not None
        ):
            raise ValueError("An absent draft cannot have verification evidence")
        return self


class StoryDraftResponse(StrictResponse):
    draft_id: UUID
    project_id: UUID
    status: Literal["ready_for_review", "edited"]
    language: LanguageCode
    style: Literal["warm"]
    version: int = Field(ge=1)
    revision: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=20_000)
    original_content: str = Field(min_length=1, max_length=20_000)
    mode: Literal["mock"]
    source_memories: list[StorySourceMemory] = Field(min_length=1, max_length=200)
    verification: StoryVerificationReport
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def manual_edits_cannot_be_automatically_verified(self):
        if self.verification.checked_revision != self.revision:
            raise ValueError("Verification does not describe the current revision")
        if self.status == "edited" and (
            self.revision < 2 or self.verification.status != "needs_review"
            or self.verification.method != "manual_unverified"
        ):
            raise ValueError("Manual changes require review, not an automatic pass")
        if self.status == "ready_for_review" and self.revision != 1:
            raise ValueError("A generated draft cannot hide a manual revision")
        if self.revision == 1 and (self.content != self.original_content or self.status != "ready_for_review"):
            raise ValueError("Initial content must match its immutable original")
        if self.verification.status == "not_generated":
            raise ValueError("A persisted draft must have a report")
        if len({source.memory_id for source in self.source_memories}) != len(self.source_memories):
            raise ValueError("Duplicate draft source")
        return self


class StoryProjectVerification(StrictResponse):
    project_id: UUID
    draft_id: UUID | None
    version: int | None = Field(ge=1)
    revision: int | None = Field(ge=1)
    verification: StoryVerificationReport

    @model_validator(mode="after")
    def empty_state_is_explicit(self):
        if self.draft_id is None:
            if self.version is not None or self.revision is not None or self.verification.status != "not_generated":
                raise ValueError("Invalid empty verification state")
        elif (self.version is None or self.revision is None
              or self.verification.status == "not_generated"
              or self.verification.checked_revision != self.revision):
            raise ValueError("Missing draft revision")
        return self


class StoryEditResponse(StrictResponse):
    id: UUID
    draft_id: UUID
    revision: int = Field(ge=2)
    previous_content: str = Field(min_length=1, max_length=20_000)
    content: str = Field(min_length=1, max_length=20_000)
    created_at: datetime
