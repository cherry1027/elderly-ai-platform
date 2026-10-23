from contextlib import asynccontextmanager
import asyncio

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.readiness import router as readiness_router
from app.api.story_projects import router as story_projects_router
from app.api.audio import router as audio_router
from app.api.conversations import router as conversations_router
from app.api.story_drafts import router as story_drafts_router
from app.api.exports import router as exports_router
from app.core.config import Settings
from app.core.api_safety import APISafetyMiddleware
from app.core.errors import APIError, api_error_handler, validation_error_handler
from app.services.transcription import DisabledTranscriptionProvider, TranscriptionProvider
from app.services.conversation_provider import (
    ConversationProvider, DisabledConversationProvider, MockConversationProvider,
)
from app.services.story_writer import DisabledStoryWriter, MockStoryWriter, StoryWriter
from app.services.pdf_export import PdfRenderer
ERROR_JSON_CONTENT = {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}
API_GUARD_RESPONSES = {
    408: {"content": ERROR_JSON_CONTENT, "description": "API request body timed out."},
    413: {"content": ERROR_JSON_CONTENT, "description": "Request body exceeds its safe limit."},
    500: {"content": ERROR_JSON_CONTENT, "description": "Sanitized unexpected API failure."},
}


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    transcription_provider: TranscriptionProvider | None = None,
    conversation_provider: ConversationProvider | None = None,
    story_writer: StoryWriter | None = None,
    pdf_renderer: PdfRenderer | None = None,
) -> FastAPI:
    config = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.audio_slots = asyncio.Semaphore(2)
        application.state.pdf_slots = asyncio.Semaphore(2)
        application.state.pdf_tasks = set()
        async with httpx.AsyncClient(
            timeout=config.request_timeout_seconds,
            follow_redirects=False,
            transport=transport,
        ) as client:
            application.state.http_client = client
            try:
                yield
            finally:
                if application.state.pdf_tasks:
                    await asyncio.gather(*tuple(application.state.pdf_tasks), return_exceptions=True)

    application = FastAPI(
        title="Memy AI Backend", version="0.8.1", lifespan=lifespan
    )
    application.state.settings = config
    application.state.transcription_provider = transcription_provider or DisabledTranscriptionProvider()
    application.state.conversation_provider = conversation_provider or (
        MockConversationProvider() if config.conversation_mode == "mock" else DisabledConversationProvider()
    )
    application.state.story_writer = story_writer or (
        MockStoryWriter() if config.story_generation_mode == "mock" else DisabledStoryWriter()
    )
    application.state.pdf_renderer = pdf_renderer or PdfRenderer()
    application.add_exception_handler(APIError, api_error_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)

    @application.middleware("http")
    async def protect_user_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/"):
            if response.headers.get("Cache-Control") != "private, no-store":
                response.headers["Cache-Control"] = "no-store"
        return response

    application.add_middleware(APISafetyMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language", "Idempotency-Key"],
        expose_headers=["Content-Disposition", "Content-Length", "X-Memy-Export-Id",
                        "X-Memy-Draft-Version", "X-Memy-Draft-Revision", "X-Memy-Page-Count"],
    )
    application.include_router(health_router)
    application.include_router(readiness_router)
    application.include_router(story_projects_router, responses=API_GUARD_RESPONSES)
    application.include_router(audio_router, responses=API_GUARD_RESPONSES)
    application.include_router(conversations_router, responses=API_GUARD_RESPONSES)
    application.include_router(story_drafts_router, responses=API_GUARD_RESPONSES)
    application.include_router(exports_router, responses=API_GUARD_RESPONSES)
    return application


app = create_app()
