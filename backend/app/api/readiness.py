from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.services.supabase import SupabaseUnavailable, check_supabase

router = APIRouter(tags=["Health"])


@router.get("/ready", responses={503: {"description": "Supabase unavailable"}})
async def readiness(request: Request):
    """Check the configured database data API without fetching personal data."""
    try:
        await check_supabase(request.app.state.settings, request.app.state.http_client)
    except SupabaseUnavailable as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "service": "memy-ai-backend",
                "error": {"code": str(exc), "message": "Database is not ready."},
            },
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        content={"status": "ok", "service": "memy-ai-backend", "database": "ok"},
        headers={"Cache-Control": "no-store"},
    )
