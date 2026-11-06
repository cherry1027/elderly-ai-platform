"""Owned user reads and narrowly scoped service-only real-provider completion."""

from datetime import datetime, timezone
import asyncio
from copy import deepcopy
import json
from uuid import UUID

import httpx
from pydantic import ValidationError

from app.core.errors import APIError, invalid_token, unavailable
from app.schemas.conversations import ClarificationResponse
from app.schemas.real_ai import (
    RealTranscript, RealMessage, RealMemory, RealTurn, RealDraft, RealSpeech,
    RealOperation, RealExportMetadata, RealSavedExport, RealTextMessageCreate,
)
from app.schemas.story_drafts import StoryGenerationContext, StoryEditResponse
from app.services.audio_resources import AudioGateway
from app.services.openai_client import strict_object

MODELS = {"transcription": RealTranscript, "conversation": RealTurn, "generation": RealDraft, "speech": RealSpeech}


def validated(model, row):
    try:
        return model.model_validate(row).model_dump(mode="json")
    except (ValueError, TypeError, ValidationError):
        raise unavailable() from None


async def read_together(*reads):
    """Overlap independent owned reads; never leave siblings running on failure."""
    tasks = [asyncio.create_task(read) for read in reads]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


class RealAIGateway(AudioGateway):
    def __init__(self, settings, client, user):
        super().__init__(settings, client, user)
        self.settings = settings
        # The dependency creates one gateway per HTTP request. Cache only these
        # validated ownership rows, never Auth, narratives or mutable memories.
        self._owned_read_scope = (user.id, self.base_url, self.headers["Authorization"])
        self._owned_read_cache = {}
        self._owned_read_locks = {}

    async def _owned_read(self, kind, identifier, load):
        scope = (self.user.id, self.base_url, "Bearer " + self.user.access_token.get_secret_value())
        if scope != self._owned_read_scope or self.headers.get("Authorization") != scope[2]:
            # A gateway cannot be carried across sign-ins or have its validated
            # owner/token replaced. A new HTTP request needs a new gateway.
            raise unavailable()
        key = (self.user.id, kind, identifier)
        if key not in self._owned_read_cache:
            lock = self._owned_read_locks.setdefault(key, asyncio.Lock())
            async with lock:
                if key not in self._owned_read_cache:
                    # Execute in the caller's task: failure/cancellation leaves
                    # no result cached and no detached upstream read running.
                    self._owned_read_cache[key] = deepcopy(await load())
        return deepcopy(self._owned_read_cache[key])

    async def get_project(self, project_id: UUID) -> dict:
        return await self._owned_read("project", project_id,
            lambda: super(RealAIGateway, self).get_project(project_id))

    async def get_owned_session(self, session_id: UUID, *, active: bool = False) -> dict:
        session = await self._owned_read("session", session_id,
            lambda: super(RealAIGateway, self).get_owned_session(session_id, active=False))
        # Checking active state is a per-caller requirement, never a cache key
        # that lets a previously read completed session authorize a paid turn.
        if active and session["status"] != "active":
            raise APIError(409, "SESSION_COMPLETED", "This conversation session is completed.")
        return session

    async def rpc(self, name, payload, *, service=False):
        headers = self.headers
        if service:
            key = self.settings.supabase_secret_key
            if not key or not key.get_secret_value().strip():
                raise APIError(503, "REAL_AI_NOT_CONFIGURED", "Real AI persistence is not configured.")
            secret = key.get_secret_value()
            # Modern secret keys belong only in apikey; legacy JWTs also use Bearer.
            if not (secret.startswith("sb_secret_") or secret.startswith("eyJ")):
                raise APIError(503, "REAL_AI_NOT_CONFIGURED", "Real AI persistence is not configured.")
            headers = {"apikey": secret, "Prefer": "return=representation"}
            if secret.startswith("eyJ"):
                headers["Authorization"] = "Bearer " + secret
        try:
            async with self.client.stream("POST", f"{self.base_url}/rest/v1/rpc/{name}",
                                          headers=headers, json=payload) as response:
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 2_000_000:
                        raise unavailable()
                try:
                    row = json.loads(data, object_pairs_hook=strict_object)
                except (ValueError, UnicodeError, RecursionError):
                    raise unavailable() from None
                if not 200 <= response.status_code < 300:
                    code = row.get("code") if isinstance(row, dict) else None
                    if response.status_code == 401 and not service:
                        raise invalid_token()
                    if code == "P0002":
                        raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
                    if code in {"40001", "23505", "55000"} or response.status_code == 409:
                        raise APIError(409, "REAL_AI_CONFLICT", "The saved state changed. Reload before continuing.")
                    if code in {"22023", "22001"}:
                        raise APIError(422, "VALIDATION_ERROR", "Request validation failed.")
                    if code == "42501" or response.status_code == 403:
                        raise APIError(403, "ACCESS_DENIED", "Access is denied.")
                    raise unavailable()
        except httpx.HTTPError:
            raise unavailable() from None
        if not isinstance(row, dict):
            raise unavailable()
        return row

    async def rows(self, table, *, filters, limit=100, offset=0, order="created_at.asc", keep_operation_id=False):
        rows = await self._request("GET", table, params={
            "select": "*", "owner_id": f"eq.{self.user.id}", **filters,
            "limit": str(limit), "offset": str(offset), "order": order,
        })
        if len(rows) > limit or any(str(r.get("owner_id")) != str(self.user.id) for r in rows):
            raise unavailable()
        for field, predicate in filters.items():
            if not predicate.startswith("eq.") or any(str(r.get(field)) != predicate[3:] for r in rows):
                raise unavailable()
        private = {"owner_id"} if keep_operation_id else {"owner_id", "operation_id"}
        return [{k: v for k, v in r.items() if k not in private} for r in rows]

    async def one(self, table, id_field, resource_id):
        rows = await self.rows(table, filters={id_field: f"eq.{resource_id}"}, limit=1,
                               keep_operation_id=table == "real_conversation_messages")
        if not rows:
            raise APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        row = rows[0]
        if str(row.get(id_field)) != str(resource_id):
            raise unavailable()
        try:
            project_id = UUID(str(row["project_id"]))
        except (KeyError, ValueError, TypeError):
            raise unavailable() from None
        await self.get_project(project_id)
        if table == "real_conversation_messages":
            if row.get("source_transcript_id") is None:
                try:
                    session_id = UUID(row["session_id"])
                except (KeyError, TypeError, ValueError):
                    raise unavailable() from None
                session = await self.get_owned_session(session_id)
                return (await self._hydrate_messages([row], session_id, session))[0]
            # Preserve the published voice shape and its original read count.
            row = {key: value for key, value in row.items() if key != "operation_id"}
        return row

    async def claim(self, project_id, session_id, kind, key, digest):
        row = await self.rpc("claim_real_ai_operation", {
            "p_owner_id": str(self.user.id), "p_project_id": str(project_id),
            "p_session_id": str(session_id) if session_id else None, "p_kind": kind,
            "p_action_key": str(key), "p_request_sha256": digest,
        }, service=True)
        try:
            UUID(row["operation_id"])
            if row["kind"] != kind or type(row["claimed"]) is not bool:
                raise ValueError
            if row["claimed"]:
                UUID(row["claim_token"])
                if row["status"] != "in_progress" or row.get("result") is not None:
                    raise ValueError
            elif row.get("claim_token") is not None:
                raise ValueError
            elif row["status"] not in {"in_progress", "completed", "failed", "uncertain"}:
                raise ValueError
        except (KeyError, ValueError, TypeError):
            raise unavailable() from None
        return row

    async def complete(self, claim, result, provenance):
        return await self.rpc("complete_real_ai_operation", {
            "p_owner_id": str(self.user.id), "p_operation_id": claim["operation_id"],
            "p_claim_token": claim["claim_token"], "p_result": result, "p_provenance": provenance,
        }, service=True)

    async def fail(self, claim, code, *, uncertain=True):
        await self.rpc("fail_real_ai_operation", {
            "p_owner_id": str(self.user.id), "p_operation_id": claim["operation_id"],
            "p_claim_token": claim["claim_token"], "p_error_code": code, "p_uncertain": uncertain,
        }, service=True)

    async def memories(self, session_id, limit=100, offset=0):
        await self.get_owned_session(session_id)
        rows, questions = await read_together(
            self.rows("real_memories", filters={"session_id": f"eq.{session_id}"},
                      limit=limit, offset=offset, order="created_at.asc,id.asc"),
            self.rows("real_memory_clarifications", filters={"session_id": f"eq.{session_id}"}, limit=201),
        )
        if len(questions) > 200:
            raise APIError(409, "AI_CONTEXT_LIMIT", "This story requires review before continuing.")
        q = {r["fact_id"]: r["question"] for r in questions if r["status"] == "open"}
        return [validated(RealMemory, {**r, "clarification_question": q.get(r["id"])}) for r in rows]

    async def project_memories(self, project_id):
        await self.get_project(project_id)
        rows, questions = await read_together(
            self.rows("real_memories", filters={"project_id": f"eq.{project_id}"}, limit=201),
            self.rows("real_memory_clarifications", filters={"project_id": f"eq.{project_id}", "status": "eq.open"}, limit=201),
        )
        if len(rows) > 200:
            raise APIError(409, "AI_CONTEXT_LIMIT", "Review the story before adding more context.")
        # Open questions are explicit context, never silently treated as confirmed facts.
        if len(questions) > 200:
            raise unavailable()
        q = {r["fact_id"]: r["question"] for r in questions}
        return [validated(RealMemory, {**r, "clarification_question": q.get(r["id"])}) for r in rows]

    async def transcripts(self, session_id, limit, offset):
        session = await self.get_owned_session(session_id)
        rows = await self.rows("real_transcripts", filters={"session_id": f"eq.{session_id}"},
                               limit=limit, offset=offset, order="created_at.asc,transcript_id.asc")
        result = [validated(RealTranscript, r) for r in rows]
        if any(r["session_id"] != str(session_id) or r["project_id"] != session["project_id"] or r["language"] != session["language"] for r in result):
            raise unavailable()
        return result

    async def messages(self, session_id, limit=100, offset=0, recent=False):
        session = await self.get_owned_session(session_id)
        rows = await self.rows("real_conversation_messages", filters={"session_id": f"eq.{session_id}"},
                               limit=limit, offset=offset, order="sequence.desc" if recent else "sequence.asc",
                               keep_operation_id=True)
        return await self._hydrate_messages(rows, session_id, session)

    async def _hydrate_messages(self, rows, session_id, session):
        # No new column is added to the shared messages table: older backends
        # must keep reading their existing voice-only sessions. Only typed rows
        # need one additional, owned batch read of immutable original sources.
        typed = [row for row in rows if row.get("source_transcript_id") is None]
        sources = {}
        if typed:
            try:
                operation_ids = list(dict.fromkeys(str(UUID(row["operation_id"])) for row in typed))
            except (KeyError, ValueError, TypeError):
                raise unavailable() from None
            response = await self.rpc("get_real_text_chat_sources", {
                "p_session_id": str(session_id), "p_operation_ids": operation_ids,
            })
            if (not isinstance(response, dict) or set(response) != {"sources"}
                or not isinstance(response["sources"], list) or len(response["sources"]) != len(operation_ids)):
                raise unavailable()
            for source in response["sources"]:
                if (not isinstance(source, dict)
                    or set(source) != {"input_id", "operation_id", "project_id", "session_id", "language", "text"}
                    or any(not isinstance(value, str) for value in source.values())
                    or source["operation_id"] not in operation_ids or source["operation_id"] in sources
                    or source["input_id"] != source["operation_id"]
                    or source["project_id"] != session["project_id"] or source["session_id"] != str(session_id)
                    or source["language"] != session["language"]):
                    raise unavailable()
                validated(RealTextMessageCreate, {"text": source["text"], "language": source["language"]})
                sources[source["operation_id"]] = source
        result = []
        for row in rows:
            if row.get("source_transcript_id") is None:
                source = sources.get(row["operation_id"])
                if source is None:
                    raise unavailable()
                if (row.get("source_text_input_id") not in (None, source["input_id"])
                    or (row.get("role") == "user" and row.get("text") != source["text"])):
                    raise unavailable()
                row = {**row, "source_text_input_id": source["input_id"]}
            result.append(validated(RealMessage, {k: v for k, v in row.items() if k != "operation_id"}))
        if any(r["session_id"] != str(session_id) or r["project_id"] != session["project_id"] or r["language"] != session["language"] for r in result):
            raise unavailable()
        return sorted(result, key=lambda r: r["sequence"])

    async def context(self, project_id):
        await self.get_project(project_id)
        return await self._context_for_owned_project(project_id)

    async def _context_for_owned_project(self, project_id):
        # Only callers that just checked this project's ownership may use this.
        # The context RPC still uses the user's JWT and database RLS.
        row = await self.rpc("get_real_story_context", {"p_project_id": str(project_id)})
        result = validated(StoryGenerationContext, row)
        if result["project_id"] != str(project_id):
            raise unavailable()
        return result

    async def draft(self, draft_id):
        row = await self.one("real_story_drafts", "draft_id", draft_id)
        draft = validated(RealDraft, row)
        context = await self.context(UUID(draft["project_id"]))
        current = context["source_memories"] == draft["source_memories"] and not context["blocking_clarifications"]
        if not current:
            draft["verification"].update(status="stale_sources", sources_current=False,
                                            reason="Reviewed source memories changed; review this saved draft.")
        return validated(RealDraft, draft)

    @staticmethod
    def _draft_with_context(draft, context):
        if draft["project_id"] != context["project_id"] or draft["language"] != context["language"]:
            raise unavailable()
        current = context["source_memories"] == draft["source_memories"] and not context["blocking_clarifications"]
        if not current:
            draft["verification"].update(status="stale_sources", sources_current=False,
                                            reason="Reviewed source memories changed; review this saved draft.")
        return validated(RealDraft, draft)

    async def drafts(self, project_id, limit=50, offset=0):
        """Read one page against one current source snapshot, without N+1 reads."""
        project = await self.get_project(project_id)
        rows = await self.rows("real_story_drafts", filters={"project_id": f"eq.{project_id}"},
                               limit=limit, offset=offset, order="version.desc")
        drafts = [validated(RealDraft, row) for row in rows]
        if any(draft["project_id"] != str(project_id) or draft["language"] != project["language"] for draft in drafts):
            raise unavailable()
        if not drafts:
            return []
        context = await self._context_for_owned_project(project_id)
        return [self._draft_with_context(draft, context) for draft in drafts]

    async def normalize_result(self, kind, row):
        try:
            return await self._normalize_result(kind, row)
        except (KeyError, TypeError, ValueError, AttributeError):
            raise unavailable() from None

    async def _normalize_result(self, kind, row):
        if kind == "conversation":
            clarifications = [validated(ClarificationResponse, c) for c in row.get("clarifications", [])]
            memory_ids = {m["id"] for m in row["memories"]}
            if (len(clarifications) > 8 or row.get("requires_clarification") != bool(clarifications)
                or any(c["fact_id"] not in memory_ids or c["session_id"] != row["message"]["session_id"] for c in clarifications)):
                raise unavailable()
            questions = {c["fact_id"]: c["question"] for c in clarifications if c["status"] == "open"}
            row = {"user_message": row["user_message"], "message": row["message"], "mode": row["mode"],
                   "memories": [{**m, "clarification_question": questions.get(m["id"])} for m in row["memories"]]}
        if kind == "speech":
            row = {k: row[k] for k in ("speech_id", "assistant_message_id", "media_type", "audio_sha256", "audio_size", "expires_at")}
            # Language is read from the owned assistant, not client-supplied metadata.
            assistant = await self.one("real_conversation_messages", "id", UUID(row["assistant_message_id"]))
            row.update(language=assistant["language"], status="ready")
        return validated(MODELS[kind], row)
