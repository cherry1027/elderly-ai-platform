"""Owned conversation reads and atomic, retry-safe PostgreSQL mutations."""

from dataclasses import asdict
from uuid import UUID

import httpx
from pydantic import ValidationError

from app.core.errors import APIError, invalid_token, unavailable
from app.schemas.conversations import (
    ClarificationResponse, ConversationTurnResponse, MemoryResponse, MessageResponse,
)
from app.services.audio_resources import AudioGateway

MESSAGE_COLUMNS = "id,session_id,sequence,role,text,language,created_at"
MEMORY_COLUMNS = (
    "id,project_id,session_id,source_message_id,fact_type,value,evidence,year,slot,"
    "uncertain,status,corrected_value,version,created_at,updated_at"
)
CLARIFICATION_COLUMNS = (
    "id,fact_id,session_id,conflicts_with_fact_id,question,status,resolution,created_at,resolved_at"
)


class ConversationGateway(AudioGateway):
    async def conversation_rpc(self, name: str, payload: dict):
        try:
            response = await self.client.post(
                f"{self.base_url}/rest/v1/rpc/{name}", json=payload, headers=self.headers,
            )
        except httpx.HTTPError:
            raise unavailable() from None
        if response.status_code == 401:
            raise invalid_token()
        if response.status_code == 204 and name == "get_conversation_turn":
            return None
        try:
            body = response.json()
        except ValueError:
            raise unavailable() from None
        if not 200 <= response.status_code < 300:
            code = body.get("code") if isinstance(body, dict) else None
            if code == "P0002":
                raise APIError(404, "RESOURCE_NOT_FOUND", "The owned conversation resource was not found.")
            if code == "23505":
                raise APIError(409, "IDEMPOTENCY_CONFLICT", "This request key was already used for different input.")
            if code == "55000" or response.status_code == 409:
                raise APIError(409, "CONVERSATION_CHANGED", "The conversation changed; reload and retry.")
            if code == "42501" or response.status_code == 403:
                raise APIError(403, "ACCESS_DENIED", "Access is denied.")
            if code in ("22023", "22001", "22P02"):
                raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")
            raise unavailable()
        if body is not None and not isinstance(body, dict):
            raise unavailable()
        return body

    @staticmethod
    def message(row: dict, session: dict) -> dict:
        try:
            model = MessageResponse.model_validate(row)
            if str(model.session_id) != session["id"] or model.language != session["language"]:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return model.model_dump(mode="json")

    @staticmethod
    def memory(row: dict, session: dict) -> dict:
        try:
            model = MemoryResponse.model_validate(row)
            if str(model.session_id) != session["id"] or str(model.project_id) != session["project_id"]:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return model.model_dump(mode="json")

    @classmethod
    def turn(cls, row: dict, session: dict, source_text: str, source_id: UUID | None) -> dict:
        try:
            turn = ConversationTurnResponse.model_validate(row)
            user = cls.message(turn.user_message.model_dump(mode="json"), session)
            assistant = cls.message(turn.message.model_dump(mode="json"), session)
            if user["role"] != "user" or assistant["role"] != "assistant":
                raise ValueError
            if user["id"] == assistant["id"] or user["sequence"] >= assistant["sequence"]:
                raise ValueError
            if user["text"] != source_text or (source_id is not None and user["id"] != str(source_id)):
                raise ValueError
            facts = {}
            for fact in turn.memories:
                cls.memory(fact.model_dump(mode="json"), session)
                if str(fact.source_message_id) != user["id"] or fact.evidence not in source_text or fact.value not in source_text:
                    raise ValueError
                if fact.status != "pending" or fact.corrected_value is not None or fact.id in facts:
                    raise ValueError
                facts[fact.id] = fact
            ids = set()
            for clarification in turn.clarifications:
                if str(clarification.session_id) != session["id"] or clarification.fact_id not in facts:
                    raise ValueError
                if clarification.id in ids or clarification.status != "open":
                    raise ValueError
                ids.add(clarification.id)
            if turn.requires_clarification != bool(turn.clarifications):
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        return turn.model_dump(mode="json")

    async def source_message(self, session: dict, message_id: UUID) -> dict:
        rows = await self._request("GET", "conversation_message_history", params={
            "select": MESSAGE_COLUMNS, "id": f"eq.{message_id}",
            "session_id": f"eq.{session['id']}", "limit": "1",
        })
        if not rows:
            raise APIError(404, "SOURCE_NOT_FOUND", "An owned user source message was not found.")
        if len(rows) != 1:
            raise unavailable()
        row = self.message(rows[0], session)
        if row["id"] != str(message_id) or row["role"] != "user":
            raise APIError(404, "SOURCE_NOT_FOUND", "An owned user source message was not found.")
        return row

    async def list_messages(self, session_id: UUID, limit: int, offset: int) -> list[dict]:
        session = await self.get_owned_session(session_id)
        rows = await self._request("GET", "conversation_message_history", params={
            "select": MESSAGE_COLUMNS, "session_id": f"eq.{session_id}",
            "order": "sequence.asc", "limit": str(limit), "offset": str(offset),
        })
        if len(rows) > limit:
            raise unavailable()
        return [self.message(row, session) for row in rows]

    async def latest_sequence(self, session: dict) -> int:
        rows = await self._request("GET", "conversation_message_history", params={
            "select": MESSAGE_COLUMNS, "session_id": f"eq.{session['id']}",
            "order": "sequence.desc", "limit": "1",
        })
        if len(rows) > 1:
            raise unavailable()
        return self.message(rows[0], session)["sequence"] if rows else 0

    async def prior_facts(self, session: dict) -> list[dict]:
        # Never silently truncate evidence and then claim a conflict-free result.
        rows = await self._request("GET", "memory_facts", params={
            "select": MEMORY_COLUMNS, "project_id": f"eq.{session['project_id']}",
            "status": "neq.rejected", "order": "created_at.asc,id.asc", "limit": "201",
        })
        if len(rows) > 200:
            raise APIError(409, "CONTEXT_LIMIT", "This project needs a larger reviewed conversation context.")
        results = []
        for row in rows:
            try:
                fact = MemoryResponse.model_validate(row)
                if str(fact.project_id) != session["project_id"] or fact.status == "rejected":
                    raise ValueError
            except (ValueError, TypeError, ValidationError):
                raise unavailable() from None
            results.append(fact.model_dump(mode="json"))
        return results

    async def list_memories(self, session_id: UUID, limit: int, offset: int) -> list[dict]:
        session = await self.get_owned_session(session_id)
        rows = await self._request("GET", "memory_facts", params={
            "select": MEMORY_COLUMNS, "session_id": f"eq.{session_id}",
            "order": "created_at.asc,id.asc", "limit": str(limit), "offset": str(offset),
        })
        if len(rows) > limit:
            raise unavailable()
        return [self.memory(row, session) for row in rows]

    async def list_clarifications(self, session_id: UUID, limit: int, offset: int) -> list[dict]:
        session = await self.get_owned_session(session_id)
        rows = await self._request("GET", "memory_clarifications", params={
            "select": CLARIFICATION_COLUMNS, "session_id": f"eq.{session_id}",
            "status": "eq.open", "order": "created_at.asc,id.asc", "limit": str(limit), "offset": str(offset),
        })
        if len(rows) > limit:
            raise unavailable()
        result = []
        for row in rows:
            try:
                item = ClarificationResponse.model_validate(row)
                if str(item.session_id) != session["id"] or item.status != "open":
                    raise ValueError
            except (ValueError, TypeError, ValidationError):
                raise unavailable() from None
            result.append(item.model_dump(mode="json"))
        return result

    async def resolve_memory(self, fact_id: UUID, payload: dict) -> dict:
        rows = await self._request("GET", "memory_facts", params={
            "select": MEMORY_COLUMNS, "id": f"eq.{fact_id}", "limit": "1",
        })
        if not rows:
            raise APIError(404, "MEMORY_NOT_FOUND", "Memory was not found.")
        if len(rows) != 1:
            raise unavailable()
        try:
            before = MemoryResponse.model_validate(rows[0])
            if before.id != fact_id:
                raise ValueError
        except (ValueError, TypeError, ValidationError):
            raise unavailable() from None
        session = await self.get_owned_session(before.session_id)
        self.memory(rows[0], session)
        correction = payload.get("corrected_value")
        if payload["status"] == "confirmed" and "corrected_value" not in payload:
            # Omission preserves a correction the caller has actually read.
            # Do not derive a stale request's intent from a newer GET result:
            # the SQL replay rule could otherwise mistake that inherited value
            # for an explicitly repeated correction and report success.
            if before.corrected_value is not None and payload["expected_version"] != before.version:
                raise APIError(409, "CONVERSATION_CHANGED", "The conversation changed; reload and retry.")
            correction = before.corrected_value
        row = await self.conversation_rpc("resolve_memory_fact", {
            "p_fact_id": str(fact_id), "p_status": payload["status"],
            "p_corrected_value": correction,
            "p_expected_version": payload["expected_version"],
        })
        result = self.memory(row, session)
        if (result["id"] != str(fact_id) or result["source_message_id"] != str(before.source_message_id)
            or result["value"] != before.value or result["evidence"] != before.evidence
            or result["status"] != payload["status"]
            or result["corrected_value"] != correction):
            raise unavailable()
        return result

    @staticmethod
    def candidate_payload(candidate, text: str) -> dict:
        try:
            value = asdict(candidate)
            if (value["fact_type"] not in {"person", "relationship", "date", "location", "event", "emotion"}
                or not isinstance(value["value"], str) or not 1 <= len(value["value"]) <= 1000
                or not isinstance(value["evidence"], str) or not value["evidence"].strip()
                or len(value["evidence"]) > 1000 or value["evidence"] not in text or value["value"] not in text):
                raise ValueError
            year = value["year"]
            if year is not None and (type(year) is not int or not 1 <= year <= 2100 or str(year) not in value["evidence"]):
                raise ValueError
            if type(value["uncertain"]) is not bool:
                raise ValueError
            for key, maximum in (("slot", 80), ("clarification_question", 1000)):
                if value[key] is not None and (not isinstance(value[key], str) or not 1 <= len(value[key]) <= maximum):
                    raise ValueError
            if value["conflicts_with_fact_id"] is not None:
                UUID(value["conflicts_with_fact_id"])
            if (value["uncertain"] or value["conflicts_with_fact_id"] is not None) and not value["clarification_question"]:
                raise ValueError
        except (TypeError, KeyError, ValueError):
            raise APIError(503, "CONVERSATION_INVALID_RESPONSE", "The simulated provider returned an unusable result.") from None
        return value
