"""User-JWT PDF audit access, historical revisions and safe continuation."""

import hashlib
from uuid import UUID

from pydantic import ValidationError

from app.core.errors import APIError, unavailable
from app.schemas.exports import (
    ContinueStoryResponse, SavedStoryExport, StoryExportContext,
    StoryExportMetadata, StoryExportRequest,
)
from app.services.story_draft_resources import StoryDraftGateway


class ExportGateway(StoryDraftGateway):
    async def export_rpc(self, name: str, payload: dict):
        try:
            return await self.story_rpc(name, payload)
        except APIError as error:
            if error.code == "STORY_CONTEXT_CHANGED":
                raise APIError(409, "EXPORT_SOURCE_CHANGED", "The saved story changed; reload and retry.") from None
            raise

    async def load_export_context(self, draft_id: UUID) -> StoryExportContext:
        row = await self.export_rpc("load_story_export_context", {"p_draft_id": str(draft_id)})
        try:
            context = StoryExportContext.model_validate(row)
            if context.draft.draft_id != draft_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        project = await self.get_project(context.draft.project_id)
        if context.draft.language != project["language"]:
            raise unavailable()
        if context.project_title != project["title"]:
            raise APIError(409, "EXPORT_SOURCE_CHANGED", "The saved story changed; reload and retry.")
        return context

    @staticmethod
    def metadata(row) -> StoryExportMetadata:
        try:
            return StoryExportMetadata.model_validate(row)
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None

    async def record_export(self, context: StoryExportContext, options: StoryExportRequest,
                            document, renderer_version: str) -> StoryExportMetadata:
        draft = context.draft
        row = await self.export_rpc("record_story_export", {
            "p_draft_id": str(draft.draft_id), "p_expected_revision": draft.revision,
            "p_expected_title": context.project_title,
            "p_include_title_page": options.include_title_page,
            "p_include_page_numbers": options.include_page_numbers,
            "p_renderer_version": renderer_version, "p_filename": document.filename,
            "p_byte_size": len(document.data), "p_page_count": document.page_count,
        })
        result = self.metadata(row)
        if (result.draft_id != draft.draft_id or result.project_id != draft.project_id
            or result.draft_revision != draft.revision or result.draft_version != draft.version
            or result.language != draft.language or result.title != context.project_title
            or result.include_title_page != options.include_title_page
            or result.include_page_numbers != options.include_page_numbers
            or result.filename != document.filename or result.renderer_version != renderer_version
            or result.content_sha256 != hashlib.sha256(draft.content.encode("utf-8")).hexdigest()):
            raise unavailable()
        return result

    async def get_export(self, export_id: UUID) -> SavedStoryExport:
        row = await self.export_rpc("get_story_export", {"p_export_id": str(export_id)})
        try:
            saved = SavedStoryExport.model_validate(row)
            if saved.export.export_id != export_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        project = await self.get_project(saved.export.project_id)
        if saved.export.language != project["language"]:
            raise unavailable()
        return saved

    async def list_exports(self, project_id: UUID, limit: int, offset: int) -> list[dict]:
        project = await self.get_project(project_id)
        rows = await self.export_rpc("list_story_exports", {
            "p_project_id": str(project_id), "p_limit": limit, "p_offset": offset,
        })
        if not isinstance(rows, list) or len(rows) > limit:
            raise unavailable()
        results = []
        for row in rows:
            result = self.metadata(row)
            if result.project_id != project_id or result.language != project["language"]:
                raise unavailable()
            results.append(result.model_dump(mode="json"))
        return results

    async def continue_project(self, project_id: UUID) -> dict:
        project = await self.get_project(project_id)
        row = await self.export_rpc("continue_story_project", {"p_project_id": str(project_id)})
        try:
            result = ContinueStoryResponse.model_validate(row)
            if result.project_id != project_id or result.language != project["language"]:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return result.model_dump(mode="json")
