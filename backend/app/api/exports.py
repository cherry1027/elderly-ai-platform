"""Private on-demand PDFs and explicit, non-destructive story continuation."""

import asyncio
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, Request, Response

from app.api.dependencies import get_current_user
from app.core.errors import APIError, unavailable
from app.schemas.exports import (
    ContinueStoryRequest, ContinueStoryResponse, SAFE_PDF_FILENAME,
    StoryExportMetadata, StoryExportRequest,
)
from app.services.auth import AuthenticatedUser
from app.services.export_resources import ExportGateway
from app.services.pdf_export import PdfDocument

PDF_RENDER_TIMEOUT_SECONDS = 15

router = APIRouter(prefix="/api/v1", tags=["PDF exports and continuation"], responses={
    # Explicit JSON media type: FastAPI otherwise inherits PDFResponse's media
    # type for error models as well as successful binary downloads.
    code: {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}}}
    for code in (401, 403, 404, 409, 422, 503, 504)
})


class PDFResponse(Response):
    media_type = "application/pdf"


def get_export_gateway(request: Request,
                       user: Annotated[AuthenticatedUser, Depends(get_current_user)]) -> ExportGateway:
    return ExportGateway(request.app.state.settings, request.app.state.http_client, user)


Gateway = Annotated[ExportGateway, Depends(get_export_gateway)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


async def render_document(request: Request, **options) -> PdfDocument:
    """Bound CPU work; a timed-out worker retains its slot until actually done."""
    slots = request.app.state.pdf_slots
    if slots.locked():
        raise APIError(503, "PDF_BUSY", "Document generation is busy; retry shortly.")
    await slots.acquire()

    async def work():
        try:
            return await asyncio.to_thread(request.app.state.pdf_renderer.render, **options)
        finally:
            slots.release()

    task = asyncio.create_task(work())
    request.app.state.pdf_tasks.add(task)

    def completed(finished):
        request.app.state.pdf_tasks.discard(finished)
        if not finished.cancelled():
            finished.exception()  # Retrieve errors even after an HTTP timeout.

    task.add_done_callback(completed)
    try:
        document = await asyncio.wait_for(asyncio.shield(task), timeout=PDF_RENDER_TIMEOUT_SECONDS)
    except TimeoutError:
        raise APIError(504, "PDF_GENERATION_TIMEOUT", "Document generation timed out.") from None
    except APIError:
        raise
    except Exception:
        raise APIError(503, "PDF_GENERATION_FAILED", "The document could not be generated.") from None
    if (not isinstance(document, PdfDocument) or type(document.data) is not bytes
        or not 20 <= len(document.data) <= 2_000_000
        or not document.data.startswith(b"%PDF-") or not document.data.rstrip().endswith(b"%%EOF")
        or type(document.page_count) is not int or not 1 <= document.page_count <= 100
        or not isinstance(document.filename, str) or len(document.filename) > 100
        or not re.fullmatch(SAFE_PDF_FILENAME, document.filename)):
        raise APIError(503, "PDF_GENERATION_FAILED", "The document could not be generated.")
    return document


def pdf_response(document: PdfDocument, metadata: StoryExportMetadata, *, status_code=200):
    return PDFResponse(document.data, status_code=status_code, headers={
        "Content-Disposition": f'attachment; filename="{document.filename}"',
        "Cache-Control": "private, no-store", "Pragma": "no-cache", "Expires": "0",
        "X-Content-Type-Options": "nosniff",
        "X-Memy-Export-Id": str(metadata.export_id),
        "X-Memy-Draft-Version": str(metadata.draft_version),
        "X-Memy-Draft-Revision": str(metadata.draft_revision),
        "X-Memy-Page-Count": str(document.page_count),
    })


async def reject_explicit_null(request: Request):
    if await request.body() and await request.json() is None:
        raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")


@router.post("/story-drafts/{draft_id}/export", status_code=201, response_class=PDFResponse)
async def export_draft(draft_id: UUID, request: Request, gateway: Gateway,
                       payload: Annotated[StoryExportRequest, Body()] = StoryExportRequest()):
    """Render a saved owned revision; record its audit before returning any bytes."""
    await reject_explicit_null(request)
    context = await gateway.load_export_context(draft_id)
    renderer = request.app.state.pdf_renderer
    if renderer.renderer_version != "memy_pdf_v1":
        raise APIError(503, "PDF_GENERATION_FAILED", "The document renderer is unavailable.")
    document = await render_document(
        request, title=context.project_title, content=context.draft.content,
        language=context.draft.language, draft_version=context.draft.version,
        draft_revision=context.draft.revision,
        include_title_page=payload.include_title_page,
        include_page_numbers=payload.include_page_numbers,
    )
    metadata = await gateway.record_export(context, payload, document, renderer.renderer_version)
    return pdf_response(document, metadata, status_code=201)


@router.get("/story-projects/{project_id}/exports", response_model=list[StoryExportMetadata])
async def list_exports(project_id: UUID, gateway: Gateway, limit: Limit = 50, offset: Offset = 0):
    return await gateway.list_exports(project_id, limit, offset)


@router.get("/story-exports/{export_id}/download", response_class=PDFResponse)
async def download_export(export_id: UUID, request: Request, gateway: Gateway):
    """Re-render the audited historical revision privately, without new audit rows."""
    saved = await gateway.get_export(export_id)
    metadata = saved.export
    if request.app.state.pdf_renderer.renderer_version != metadata.renderer_version:
        raise APIError(503, "PDF_GENERATION_FAILED", "The document renderer is unavailable.")
    document = await render_document(
        request, title=metadata.title, content=saved.content, language=metadata.language,
        draft_version=metadata.draft_version, draft_revision=metadata.draft_revision,
        include_title_page=metadata.include_title_page,
        include_page_numbers=metadata.include_page_numbers,
    )
    if document.filename != metadata.filename:
        raise unavailable()
    return pdf_response(document, metadata)


@router.post("/story-projects/{project_id}/continue", response_model=ContinueStoryResponse)
async def continue_story(project_id: UUID, request: Request, gateway: Gateway,
                         payload: Annotated[ContinueStoryRequest, Body()] = ContinueStoryRequest()):
    """Resume/create a session; never regenerate or overwrite an existing draft."""
    await reject_explicit_null(request)
    return await gateway.continue_project(project_id)
