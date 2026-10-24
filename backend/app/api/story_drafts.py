"""Explicit, source-verified mock autobiography generation and manual review."""

import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status

from app.api.dependencies import get_current_user
from app.core.errors import APIError
from app.schemas.errors import ErrorResponse
from app.schemas.story_drafts import (
    StoryDraftPatch, StoryDraftResponse, StoryEditResponse,
    StoryGenerationRequest, StoryProjectVerification,
)
from app.services.auth import AuthenticatedUser
from app.services.story_draft_resources import StoryDraftGateway
from app.services.story_writer import verify_story

router = APIRouter(prefix="/api/v1", tags=["Story drafts"], responses={
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 503, 504)
})


def get_story_draft_gateway(
    request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> StoryDraftGateway:
    return StoryDraftGateway(request.app.state.settings, request.app.state.http_client, user)


Gateway = Annotated[StoryDraftGateway, Depends(get_story_draft_gateway)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


@router.post("/story-projects/{project_id}/generate", response_model=StoryDraftResponse, status_code=status.HTTP_201_CREATED)
async def generate_story(
    project_id: UUID, payload: StoryGenerationRequest, request: Request, gateway: Gateway,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
):
    """Generate only after an explicit user request; never contact a paid AI API."""
    project = await gateway.get_project(project_id)
    if payload.language != project["language"]:
        raise APIError(422, "LANGUAGE_MISMATCH", "Story language must match the saved project language.")
    binding = {
        "p_project_id": str(project_id), "p_idempotency_key": str(idempotency_key),
        "p_language": payload.language, "p_style": payload.style,
    }
    existing = await gateway.story_rpc("get_story_generation", binding)
    if existing is not None:
        return gateway.draft(existing, project_id)
    writer = request.app.state.story_writer
    if writer.mode != "mock":
        raise APIError(503, "STORY_GENERATION_DISABLED", "Simulated story generation is not enabled.")
    context = await gateway.generation_context(project)
    if context.blocking_clarifications:
        raise APIError(409, "CLARIFICATION_REQUIRED", "Resolve conflicting memories before generating a story.")
    if context.confirmed_count == 0:
        raise APIError(409, "NO_CONFIRMED_MEMORIES", "Confirm supported memories before creating your story.")
    if not context.source_memories:
        raise APIError(409, "NO_SUPPORTED_MEMORIES", "No confirmed memories can yet be safely written by the mock writer.")
    sources = [source.model_dump(mode="json") for source in context.source_memories]
    try:
        content = await asyncio.wait_for(writer.write(payload.language, payload.style, sources), timeout=10)
        verification = verify_story(content, payload.language, payload.style, sources, context.canonical_content)
    except TimeoutError:
        raise APIError(504, "STORY_WRITER_TIMEOUT", "The simulated story writer timed out.") from None
    except Exception:
        raise APIError(503, "STORY_WRITER_INVALID_RESPONSE", "The simulated writer returned an unusable draft.") from None
    if verification.status != "passed" or verification.unsupported_claims:
        raise APIError(422, "DRAFT_VERIFICATION_FAILED", "The draft contains unsupported content and was not saved.")
    body = await gateway.story_rpc("save_story_generation", {
        **binding, "p_confirm_generation": True, "p_context_token": context.context_token,
        "p_content": content,
    })
    return gateway.draft(body, project_id)


@router.get("/story-projects/{project_id}/drafts", response_model=list[StoryDraftResponse])
async def list_drafts(project_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.list_drafts(project_id, limit, offset)


@router.get("/story-drafts/{draft_id}", response_model=StoryDraftResponse)
async def read_draft(draft_id: UUID, gateway: Gateway):
    return await gateway.get_draft(draft_id)


@router.patch("/story-drafts/{draft_id}", response_model=StoryDraftResponse)
async def edit_draft(draft_id: UUID, payload: StoryDraftPatch, gateway: Gateway):
    """Preserve the generated original; manual edits always need human review."""
    return await gateway.edit_draft(draft_id, payload.content, payload.expected_revision)


@router.get("/story-projects/{project_id}/verification", response_model=StoryProjectVerification)
async def project_verification(project_id: UUID, gateway: Gateway):
    return await gateway.project_verification(project_id)


@router.get("/story-drafts/{draft_id}/history", response_model=list[StoryEditResponse])
async def edit_history(draft_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.edit_history(draft_id, limit, offset)
