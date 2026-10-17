"""Authenticated story-project and conversation-session routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Request, status

from app.api.dependencies import get_gateway
from app.core.errors import APIError
from app.schemas.errors import ErrorResponse
from app.schemas.story_projects import (
    ConversationSessionResponse,
    SessionCreate,
    StoryProjectCreate,
    StoryProjectPatch,
    StoryProjectResponse,
)
from app.services.resources import SupabaseGateway


ERROR_RESPONSES = {
    401: {"description": "A valid Supabase Bearer token is required."},
    403: {"description": "Access was denied by database permissions."},
    404: {"description": "The owned story project was not found."},
    409: {"description": "The request conflicts with existing data."},
    422: {"description": "The path, query, or request body is invalid."},
    503: {"description": "Supabase is unavailable or not configured."},
}
for error_response in ERROR_RESPONSES.values():
    error_response["model"] = ErrorResponse

router = APIRouter(
    prefix="/api/v1/story-projects",
    tags=["Story projects"],
    responses=ERROR_RESPONSES,
)

Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=100_000)]


@router.post(
    "",
    response_model=StoryProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_story_project(
    payload: StoryProjectCreate,
    gateway: Gateway,
) -> dict:
    """Create an owned project with an explicit English/Swedish language."""
    return await gateway.create_project(payload.model_dump(exclude_unset=True))


@router.get("", response_model=list[StoryProjectResponse])
async def list_story_projects(
    gateway: Gateway,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
) -> list[dict]:
    """List the authenticated user's non-deleted projects."""
    return await gateway.list_projects(limit=limit, offset=offset)


@router.get("/{project_id}", response_model=StoryProjectResponse)
async def get_story_project(
    project_id: UUID,
    gateway: Gateway,
) -> dict:
    """Return one owned project without revealing another user's resources."""
    return await gateway.get_project(project_id)


@router.patch("/{project_id}", response_model=StoryProjectResponse)
async def update_story_project(
    project_id: UUID,
    payload: StoryProjectPatch,
    gateway: Gateway,
) -> dict:
    """Update title or description; language is immutable on Day 2."""
    return await gateway.update_project(
        project_id,
        payload.model_dump(exclude_unset=True),
    )


@router.post(
    "/{project_id}/sessions",
    response_model=ConversationSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation_session(
    project_id: UUID,
    gateway: Gateway,
    request: Request,
    payload: Annotated[SessionCreate, Body()] = SessionCreate(),
) -> dict:
    """Create a session that inherits its owned project's language."""
    # FastAPI otherwise treats explicit JSON null as an omitted default body.
    if await request.body() and await request.json() is None:
        raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")
    return await gateway.create_session(project_id)


@router.get(
    "/{project_id}/sessions",
    response_model=list[ConversationSessionResponse],
)
async def list_conversation_sessions(
    project_id: UUID,
    gateway: Gateway,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
) -> list[dict]:
    """List sessions for an owned project in the gateway's stable order."""
    return await gateway.list_sessions(project_id, limit=limit, offset=offset)
