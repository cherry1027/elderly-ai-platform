"""Text/source conversation demo; external AI calls are not implemented."""

import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status

from app.api.dependencies import get_current_user
from app.core.errors import APIError
from app.schemas.conversations import (
    ClarificationResponse, ConversationTurnResponse, MemoryPatch, MemoryResponse,
    MessageCreate, MessageResponse,
)
from app.schemas.errors import ErrorResponse
from app.services.auth import AuthenticatedUser
from app.services.conversation_resources import ConversationGateway

router = APIRouter(prefix="/api/v1", tags=["Simulated conversations"], responses={
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 503, 504)
})


def get_conversation_gateway(
    request: Request, user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> ConversationGateway:
    return ConversationGateway(request.app.state.settings, request.app.state.http_client, user)


Gateway = Annotated[ConversationGateway, Depends(get_conversation_gateway)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


@router.post(
    "/story-sessions/{session_id}/messages", response_model=ConversationTurnResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_message(
    session_id: UUID, payload: MessageCreate, request: Request, gateway: Gateway,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
) -> dict:
    """Append an atomic mock turn or process an existing immutable user source.

    Reuse the same UUID request key on retries. No real AI or transcription
    service is invoked. Every extracted candidate remains pending confirmation.
    """
    session = await gateway.get_owned_session(session_id)
    provider = request.app.state.conversation_provider
    if payload.language != session["language"]:
        raise APIError(422, "LANGUAGE_MISMATCH", "Message language must match the selected session language.")
    text = payload.text
    if payload.source_message_id is not None:
        text = (await gateway.source_message(session, payload.source_message_id))["text"]
    params = {
        "p_session_id": str(session_id), "p_idempotency_key": str(idempotency_key),
        "p_text": text, "p_language": session["language"],
        "p_source_message_id": str(payload.source_message_id) if payload.source_message_id else None,
    }
    existing = await gateway.conversation_rpc("get_conversation_turn", params)
    if existing is not None:
        return gateway.turn(existing, session, text, payload.source_message_id)
    if provider.mode != "mock":
        raise APIError(503, "CONVERSATION_DISABLED", "The simulated conversation feature is not enabled.")
    if session["status"] != "active":
        raise APIError(409, "SESSION_COMPLETED", "This conversation session is completed.")
    sequence = await gateway.latest_sequence(session)
    prior_facts = await gateway.prior_facts(session)
    try:
        result = await asyncio.wait_for(provider.respond(text, session["language"], prior_facts), timeout=10)
        if (not isinstance(result.text, str) or not result.text.strip() or len(result.text) > 2000
            or "\0" in result.text or not isinstance(result.facts, list) or len(result.facts) > 8):
            raise ValueError
        result.text.encode("utf-8")
        facts = [gateway.candidate_payload(candidate, text) for candidate in result.facts]
        known_ids = {fact["id"] for fact in prior_facts}
        if any(fact["conflicts_with_fact_id"] is not None and fact["conflicts_with_fact_id"] not in known_ids for fact in facts):
            raise ValueError
    except TimeoutError:
        raise APIError(504, "CONVERSATION_TIMEOUT", "The simulated conversation timed out.") from None
    except APIError:
        raise
    except Exception:
        raise APIError(503, "CONVERSATION_INVALID_RESPONSE", "The simulated provider returned an unusable result.") from None
    row = await gateway.conversation_rpc("append_conversation_turn", {
        **params, "p_expected_sequence": sequence,
        "p_assistant_text": result.text, "p_facts": facts,
        "p_context_versions": sorted(
            ({"id": fact["id"], "version": fact["version"]} for fact in prior_facts),
            key=lambda item: item["id"],
        ),
    })
    return gateway.turn(row, session, text, payload.source_message_id)


@router.get("/story-sessions/{session_id}/messages", response_model=list[MessageResponse])
async def list_messages(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    """Ordered history, including Day 3 audio originals; source text is immutable."""
    return await gateway.list_messages(session_id, limit, offset)


@router.get("/story-sessions/{session_id}/memories", response_model=list[MemoryResponse])
async def list_memories(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.list_memories(session_id, limit, offset)


@router.get("/story-sessions/{session_id}/clarifications", response_model=list[ClarificationResponse])
async def list_clarifications(session_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    """Only unresolved questions; resolving a fact never edits its source."""
    return await gateway.list_clarifications(session_id, limit, offset)


@router.patch("/memories/{fact_id}", response_model=MemoryResponse)
async def resolve_memory(fact_id: UUID, payload: MemoryPatch, gateway: Gateway):
    return await gateway.resolve_memory(fact_id, payload.model_dump(exclude_unset=True))
