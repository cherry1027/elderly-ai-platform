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
from app.core.config import Settings
from app.core.errors import APIError, api_error_handler, validation_error_handler
from app.services.transcription import DisabledTranscriptionProvider, TranscriptionProvider


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    transcription_provider: TranscriptionProvider | None = None,
) -> FastAPI:
    config = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.audio_slots = asyncio.Semaphore(2)
        async with httpx.AsyncClient(
            timeout=config.request_timeout_seconds,
            follow_redirects=False,
            transport=transport,
        ) as client:
            application.state.http_client = client
            yield

    application = FastAPI(
        title="Memy AI Backend", version="0.2.0", lifespan=lifespan
    )
    application.state.settings = config
    application.state.transcription_provider = transcription_provider or DisabledTranscriptionProvider()
    application.add_exception_handler(APIError, api_error_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)

    @application.middleware("http")
    async def protect_user_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language", "Idempotency-Key"],
    )
    application.include_router(health_router)
    application.include_router(readiness_router)
    application.include_router(story_projects_router)
    application.include_router(audio_router)
    return application


app = create_app()
