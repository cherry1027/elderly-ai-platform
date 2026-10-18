"""User-scoped session and audio transcript access through Supabase RLS."""

from uuid import UUID

from app.core.errors import APIError, unavailable
from app.services.resources import SESSION_COLUMNS, SupabaseGateway


class AudioGateway(SupabaseGateway):
    async def get_owned_session(self, session_id: UUID, *, active: bool = False) -> dict:
        rows = await self._request(
            "GET", "conversation_sessions",
            params={"select": SESSION_COLUMNS, "id": f"eq.{session_id}", "limit": "1"},
        )
        if not rows:
            raise APIError(404, "SESSION_NOT_FOUND", "Conversation session was not found.")
        if len(rows) != 1:
            raise unavailable()
        try:
            project_id = UUID(str(rows[0].get("project_id")))
        except (ValueError, TypeError):
            raise unavailable() from None
        await self.get_project(project_id)
        session = self._session(rows[0], project_id)
        if UUID(session["id"]) != session_id:
            raise unavailable()
        if active and session["status"] != "active":
            raise APIError(409, "SESSION_COMPLETED", "This conversation session is completed.")
        return session
