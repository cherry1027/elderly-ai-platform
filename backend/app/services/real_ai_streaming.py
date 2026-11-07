"""Opt-in early reply preview; only a validated atomic result is saved.

A single worker owns the existing workflow/claim/governor. Cancellation joins
that worker; this module never resubmits, retries, or writes provider data.
"""
import asyncio
import json
from uuid import UUID

import anyio
from fastapi.responses import StreamingResponse

from app.core.errors import APIError, api_error_handler
from app.schemas.real_ai import RealTurn
from app.services.real_ai_progress import turn_progress
from app.services.real_ai_resources import validated

MAX_EVENT_BYTES = 1_000_000


def _frame(event):
    data = json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_EVENT_BYTES:
        raise APIError(503, "REAL_AI_UNCERTAIN", "Check the saved result before trying again.")
    return b"data: " + data + b"\n\n"


async def stream_turn_response(request, action):
    queue = asyncio.Queue(maxsize=4)
    operation = None
    reply = None
    saving = False
    closing = False

    async def progress(event):
        nonlocal operation, reply, saving
        if not isinstance(event, dict):
            raise ValueError("Invalid progress")
        kind = event.get("type")
        if kind == "operation":
            if operation is not None or set(event) != {"type", "operation_id", "project_id", "session_id"}:
                raise ValueError("Invalid operation progress")
            for key in ("operation_id", "project_id", "session_id"):
                if str(UUID(event[key])) != event[key]:
                    raise ValueError("Invalid operation scope")
            operation = dict(event)
        elif kind == "reply":
            text = event.get("text")
            if (operation is None or saving or reply is not None or set(event) != {"type", "text"}
                or not isinstance(text, str) or not text.strip() or len(text) > 1000 or "\0" in text):
                raise ValueError("Invalid reply progress")
            text.encode("utf-8")
            reply = text
        elif kind == "saving":
            if operation is None or saving or set(event) != {"type"}:
                raise ValueError("Invalid saving progress")
            saving = True
        else:
            raise ValueError("Unsupported progress")
        await queue.put(("event", dict(event)))

    async def worker():
        token = turn_progress.set(progress)
        try:
            result = validated(RealTurn, await action())
            if reply is not None and result["message"]["text"] != reply:
                raise APIError(503, "REAL_AI_UNCERTAIN", "Check the saved result before trying again.")
            await queue.put(("result", result))
        except asyncio.CancelledError:
            if closing:
                raise
            await queue.put(("error", APIError(503, "REAL_AI_UNCERTAIN", "Check the saved result before trying again.")))
        except APIError as error:
            await queue.put(("error", error))
        except Exception:
            await queue.put(("error", APIError(503, "REAL_AI_UNCERTAIN", "Check the saved result before trying again.")))
        finally:
            turn_progress.reset(token)

    task = asyncio.create_task(worker())

    async def cleanup():
        nonlocal closing
        closing = True
        if not task.done():
            task.cancel()
        # Starlette may cancel its response task on disconnect. Join cleanup
        # even inside that cancellation scope; never leave a paid worker alive.
        with anyio.CancelScope(shield=True):
            await asyncio.gather(task, return_exceptions=True)

    try:
        first_kind, first = await queue.get()
        if first_kind == "error":
            await cleanup()
            raise first
        if first_kind == "result":
            await cleanup()
            return first  # Completed idempotent replay stays a normal free JSON result.
        if operation is None:
            raise ValueError("Missing operation")
    except BaseException:
        await cleanup()
        raise

    async def events():
        yield _frame(first)
        while True:
            kind, item = await queue.get()
            if kind == "result":
                yield _frame({"type": "completed", "result": item})
                return
            if kind == "error":
                error_response = await api_error_handler(request, item)
                body = json.loads(error_response.body)
                event = {"type": "error", "status": error_response.status_code, "error": body["error"],
                    "operation_id": error_response.headers.get("x-memy-operation-id", operation["operation_id"]),
                    "recovery": error_response.headers.get("x-memy-recovery"),
                    "retry_after": error_response.headers.get("retry-after")}
                yield _frame(event)
                return
            yield _frame(item)

    class OwnedStream(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try:
                # Always watch receive-side disconnects, including ASGI 2.4+.
                # Waiting for the next socket write would let a disconnected
                # client leave an upstream provider request running meanwhile.
                async with anyio.create_task_group() as group:
                    async def stream_body():
                        try:
                            await self.stream_response(send)
                        finally:
                            group.cancel_scope.cancel()
                    group.start_soon(stream_body)
                    await self.listen_for_disconnect(receive)
                    group.cancel_scope.cancel()
                if self.background is not None:
                    await self.background()
            finally:
                await cleanup()

    return OwnedStream(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        "X-Memy-Operation-Id": operation["operation_id"],
    })
