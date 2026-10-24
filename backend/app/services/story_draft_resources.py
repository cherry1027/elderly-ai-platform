"""Owned, versioned story access through narrowly granted PostgreSQL RPCs."""

from uuid import UUID

import httpx
from pydantic import ValidationError

from app.core.errors import APIError, invalid_token, unavailable
from app.schemas.story_drafts import (
    StoryDraftResponse, StoryEditResponse, StoryGenerationContext, StoryProjectVerification,
)
from app.services.resources import SupabaseGateway


class StoryDraftGateway(SupabaseGateway):
    async def story_rpc(self, name: str, payload: dict):
        try:
            response = await self.client.post(
                f"{self.base_url}/rest/v1/rpc/{name}", json=payload, headers=self.headers,
            )
        except httpx.HTTPError:
            raise unavailable() from None
        if response.status_code == 401:
            raise invalid_token()
        if response.status_code == 204 and name == "get_story_generation":
            return None
        try:
            body = response.json()
        except ValueError:
            raise unavailable() from None
        if not 200 <= response.status_code < 300:
            code = body.get("code") if isinstance(body, dict) else None
            if code == "P0002":
                raise APIError(404, "RESOURCE_NOT_FOUND", "The owned story resource was not found.")
            if code == "23505":
                raise APIError(409, "IDEMPOTENCY_CONFLICT", "This request key was already used for different input.")
            if code == "55000" or response.status_code == 409:
                raise APIError(409, "STORY_CONTEXT_CHANGED", "The story or its sources changed; reload and retry.")
            if code == "54000":
                raise APIError(409, "CONTEXT_LIMIT", "The story exceeds the reviewed demonstration limits.")
            if code == "42501" or response.status_code == 403:
                raise APIError(403, "ACCESS_DENIED", "Access is denied.")
            if code in ("22023", "22001", "22P02"):
                raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")
            raise unavailable()
        return body

    @staticmethod
    def draft(row, project_id: UUID | str | None = None, draft_id: UUID | None = None) -> dict:
        try:
            result = StoryDraftResponse.model_validate(row)
            if project_id is not None and str(result.project_id) != str(project_id):
                raise ValueError
            if draft_id is not None and result.draft_id != draft_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return result.model_dump(mode="json")

    async def generation_context(self, project: dict) -> StoryGenerationContext:
        body = await self.story_rpc("load_story_context", {"p_project_id": project["id"]})
        try:
            result = StoryGenerationContext.model_validate(body)
            if str(result.project_id) != project["id"] or result.language != project["language"]:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return result

    async def get_draft(self, draft_id: UUID) -> dict:
        body = await self.story_rpc("get_story_draft", {"p_draft_id": str(draft_id)})
        draft = self.draft(body, draft_id=draft_id)
        await self.get_project(UUID(draft["project_id"]))
        return draft

    async def list_drafts(self, project_id: UUID, limit: int, offset: int) -> list[dict]:
        await self.get_project(project_id)
        rows = await self.story_rpc("list_story_drafts", {
            "p_project_id": str(project_id), "p_limit": limit, "p_offset": offset,
        })
        if not isinstance(rows, list) or len(rows) > limit:
            raise unavailable()
        return [self.draft(row, project_id) for row in rows]

    async def edit_draft(self, draft_id: UUID, content: str, revision: int) -> dict:
        before = await self.get_draft(draft_id)
        body = await self.story_rpc("edit_story_draft", {
            "p_draft_id": str(draft_id), "p_expected_revision": revision, "p_content": content,
        })
        result = self.draft(body, before["project_id"], draft_id)
        if (result["original_content"] != before["original_content"]
            or result["version"] != before["version"] or result["language"] != before["language"]
            or result["source_memories"] != before["source_memories"] or result["content"] != content):
            raise unavailable()
        return result

    async def project_verification(self, project_id: UUID) -> dict:
        await self.get_project(project_id)
        body = await self.story_rpc("get_story_project_verification", {"p_project_id": str(project_id)})
        try:
            report = StoryProjectVerification.model_validate(body)
            if report.project_id != project_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return report.model_dump(mode="json")

    async def edit_history(self, draft_id: UUID, limit: int, offset: int) -> list[dict]:
        await self.get_draft(draft_id)
        rows = await self.story_rpc("list_story_edit_history", {
            "p_draft_id": str(draft_id), "p_limit": limit, "p_offset": offset,
        })
        if not isinstance(rows, list) or len(rows) > limit:
            raise unavailable()
        results = []
        for row in rows:
            try:
                revision = StoryEditResponse.model_validate(row)
                if revision.draft_id != draft_id:
                    raise ValueError
            except (ValueError, TypeError, ValidationError):
                raise unavailable() from None
            results.append(revision.model_dump(mode="json"))
        return results
