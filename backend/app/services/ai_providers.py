"""Explicit provider selection for offline/approved evaluation, not public SQL."""

from dataclasses import dataclass

import httpx

from app.core.config import Settings
from app.core.errors import APIError
from app.services.conversation_provider import DisabledConversationProvider, MockConversationProvider
from app.services.story_writer import DisabledStoryWriter, MockStoryWriter
from app.services.transcription import DisabledTranscriptionProvider, SimulatedTranscriptionProvider


@dataclass(frozen=True)
class EvaluationProviders:
    mode: str
    transcription: object
    conversation: object
    story: object


def evaluation_providers(settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> EvaluationProviders:
    if settings.ai_provider_mode == "disabled":
        return EvaluationProviders("disabled", DisabledTranscriptionProvider(),
                                   DisabledConversationProvider(), DisabledStoryWriter())
    if settings.ai_provider_mode == "mock":
        return EvaluationProviders("mock", SimulatedTranscriptionProvider(),
                                   MockConversationProvider(), MockStoryWriter())
    if not settings.openai_api_key or not settings.live_ai_approval_path:
        raise APIError(503, "AI_SPENDING_NOT_APPROVED", "Live AI requires explicit spending approval.")
    from app.services.ai_controls import AISpendingGovernor
    from app.services.openai_client import OpenAIClient, OpenAITranscriptionProvider
    from app.services.openai_conversation import OpenAIConversationProvider
    from app.services.openai_story import OpenAIStoryWriter

    governor = AISpendingGovernor(settings.live_ai_approval_path, settings.ai_usage_ledger_path)
    client = OpenAIClient(settings.openai_api_key, settings.openai_text_model, governor,
                          transport=transport, timeout_seconds=settings.openai_timeout_seconds)
    verifier = OpenAIClient(settings.openai_api_key,
                            settings.openai_verifier_model or settings.openai_text_model, governor,
                            transport=transport, timeout_seconds=settings.openai_timeout_seconds)
    return EvaluationProviders("openai", OpenAITranscriptionProvider(client, settings.openai_transcription_model),
                               OpenAIConversationProvider(client), OpenAIStoryWriter(client, verifier))
