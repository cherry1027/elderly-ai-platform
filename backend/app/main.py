from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.readiness import router as readiness_router
from app.core.config import Settings


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    config = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        async with httpx.AsyncClient(
            timeout=config.request_timeout_seconds,
            follow_redirects=False,
            transport=transport,
        ) as client:
            application.state.http_client = client
            yield

    application = FastAPI(
        title="Memy AI Backend", version="0.1.0", lifespan=lifespan
    )
    application.state.settings = config
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
    )
    application.include_router(health_router)
    application.include_router(readiness_router)
    return application


app = create_app()
