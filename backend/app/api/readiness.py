from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Health"])


@router.get("/ready", responses={503: {"description": "Supabase unavailable"}})
async def readiness(request: Request):
    """Zero-row data API probe, with a two-second local probe cooldown."""
    error = await request.app.state.readiness_probe.check()
    if error is not None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "service": "memy-ai-backend",
                "error": {"code": error, "message": "Database is not ready."},
            },
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        content={"status": "ok", "service": "memy-ai-backend", "database": "ok"},
        headers={"Cache-Control": "no-store"},
    )
