"""User-scoped PostgREST access. The user's JWT always remains subject to RLS."""

from uuid import UUID

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import APIError, invalid_token, unavailable
from app.schemas.story_projects import ConversationSessionResponse, StoryProjectResponse
from app.services.auth import AuthenticatedUser

PROJECT_COLUMNS = "id,user_id,title,description,language,status,created_at,updated_at"
SESSION_COLUMNS = "id,project_id,language,status,created_at,updated_at,ended_at"


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient, user: AuthenticatedUser):
        self.base_url = str(settings.supabase_url).rstrip("/")
        self.client = client
        self.user = user
        self.headers = {
            "apikey": settings.supabase_publishable_key.get_secret_value(),
            "Authorization": f"Bearer {user.access_token.get_secret_value()}",
            "Prefer": "return=representation",
        }

    async def _request(self, method: str, relation: str, *, params: dict, payload=None):
        try:
            response = await self.client.request(
                method,
                f"{self.base_url}/rest/v1/{relation}",
                params=params,
                json=payload,
                headers=self.headers,
            )
        except httpx.HTTPError:
            raise unavailable() from None
        if response.status_code == 401:
            raise invalid_token()
        if response.status_code == 403:
            raise APIError(403, "ACCESS_DENIED", "Access is denied.")
        if response.status_code == 409:
            raise APIError(409, "CONFLICT", "The request conflicts with existing data.")
        if not 200 <= response.status_code < 300:
            raise unavailable()
        try:
            rows = response.json()
        except ValueError:
            raise unavailable() from None
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise unavailable()
        return rows

    def _project(self, row: dict, expected_id: UUID | None = None) -> dict:
        # The explicit owner filter is defense in depth, not a substitute for RLS.
        try:
            if UUID(str(row.get("user_id"))) != self.user.id:
                raise ValueError
            project = StoryProjectResponse.model_validate({key: value for key, value in row.items() if key != "user_id"})
            if expected_id is not None and project.id != expected_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return project.model_dump(mode="json")

    @staticmethod
    def _session(row: dict, project_id: UUID) -> dict:
        try:
            session = ConversationSessionResponse.model_validate(row)
            if session.project_id != project_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return session.model_dump(mode="json")

    def _project_params(self, project_id: UUID | None = None) -> dict:
        params = {"select": PROJECT_COLUMNS, "user_id": f"eq.{self.user.id}"}
        if project_id is not None:
            params.update({"id": f"eq.{project_id}", "limit": "1"})
        return params

    async def create_project(self, payload: dict) -> dict:
        # Client-supplied owner fields never reach this boundary.
        values = {key: payload[key] for key in ("title", "language", "description") if key in payload}
        values["user_id"] = str(self.user.id)
        rows = await self._request(
            "POST", "story_projects", params={"select": PROJECT_COLUMNS}, payload=values
        )
        if len(rows) != 1:
            raise unavailable()
        return self._project(rows[0])

    async def list_projects(self, limit: int, offset: int) -> list[dict]:
        params = self._project_params()
        params.update({"order": "created_at.desc,id.desc", "limit": str(limit), "offset": str(offset)})
        rows = await self._request("GET", "story_projects", params=params)
        if len(rows) > limit:
            raise unavailable()
        return [self._project(row) for row in rows]

    async def get_project(self, project_id: UUID) -> dict:
        rows = await self._request("GET", "story_projects", params=self._project_params(project_id))
        if not rows:
            raise APIError(404, "PROJECT_NOT_FOUND", "Story project was not found.")
        if len(rows) != 1:
            raise unavailable()
        return self._project(rows[0], project_id)

    async def update_project(self, project_id: UUID, payload: dict) -> dict:
        values = {key: payload[key] for key in ("title", "description") if key in payload}
        params = self._project_params(project_id)
        # PostgREST limiting mutations requires extra configuration and is not
        # necessary when both id (the primary key) and user_id are filtered.
        params.pop("limit")
        rows = await self._request("PATCH", "story_projects", params=params, payload=values)
        if not rows:
            raise APIError(404, "PROJECT_NOT_FOUND", "Story project was not found.")
        if len(rows) != 1:
            raise unavailable()
        return self._project(rows[0], project_id)

    async def create_session(self, project_id: UUID) -> dict:
        project = await self.get_project(project_id)
        rows = await self._request(
            "POST", "conversation_sessions", params={"select": SESSION_COLUMNS},
            payload={"project_id": str(project_id), "language": project["language"]},
        )
        if len(rows) != 1:
            raise unavailable()
        session = self._session(rows[0], project_id)
        if session["language"] != project["language"]:
            raise unavailable()
        return session

    async def list_sessions(self, project_id: UUID, limit: int, offset: int) -> list[dict]:
        await self.get_project(project_id)
        rows = await self._request(
            "GET", "conversation_sessions",
            params={
                "select": SESSION_COLUMNS, "project_id": f"eq.{project_id}",
                "order": "created_at.desc,id.desc", "limit": str(limit), "offset": str(offset),
            },
        )
        if len(rows) > limit:
            raise unavailable()
        return [self._session(row, project_id) for row in rows]
