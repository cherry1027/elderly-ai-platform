"""Bound small API requests before JSON decoding; keep audio's own guard intact."""

import asyncio
import logging
import re

from starlette.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_API_BODY_BYTES = 262_144  # Fits 20k story characters even as escaped JSON.
API_BODY_TIMEOUT_SECONDS = 30
_AUDIO_PATH = re.compile(r"^/api/v1/story-sessions/[^/]+/transcribe/?$")
logger = logging.getLogger("memy.api")


class APISafetyMiddleware:
    def __init__(self, app: ASGIApp, max_concurrent_requests: int = 64):
        self.app = app
        self.max_concurrent_requests = max_concurrent_requests
        self._active_requests = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/v1/"):
            await self.app(scope, receive, send)
            return

        async def private_send(message: Message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if headers.get("Cache-Control") != "private, no-store":
                    headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
            await send(message)

        if self._active_requests >= self.max_concurrent_requests:
            await JSONResponse(
                {"error": {"code": "API_BUSY", "message": "The service is busy; retry shortly."}},
                status_code=503, headers={"Retry-After": "1"},
            )(scope, receive, private_send)
            return
        self._active_requests += 1
        try:
            await self._handle_private(scope, receive, private_send)
        finally:
            self._active_requests -= 1

    async def _handle_private(self, scope: Scope, receive: Receive, send: Send):

        async def error(status: int, code: str, message: str):
            await JSONResponse(
                {"error": {"code": code, "message": message}}, status_code=status,
                headers={"Cache-Control": "no-store"},
            )(scope, receive, send)

        # Audio must authenticate/authorize before reading multipart bytes. Its
        # existing streaming parser has separate 25 MB / 30 second bounds.
        if not _AUDIO_PATH.fullmatch(scope["path"]):
            lengths = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
            if lengths:
                try:
                    if len(lengths) != 1 or not lengths[0].isdigit():
                        raise ValueError
                    length = int(lengths[0])
                except ValueError:
                    await error(422, "VALIDATION_ERROR", "Request validation failed.")
                    return
                if length > MAX_API_BODY_BYTES:
                    await error(413, "REQUEST_TOO_LARGE", "API request body must not exceed 256 KiB.")
                    return
            buffered = bytearray()
            total = 0
            try:
                async with asyncio.timeout(API_BODY_TIMEOUT_SECONDS):
                    while True:
                        frame = await receive()
                        if frame["type"] == "http.disconnect":
                            return
                        chunk = frame.get("body", b"")
                        total += len(chunk)
                        if total > MAX_API_BODY_BYTES:
                            await error(413, "REQUEST_TOO_LARGE", "API request body must not exceed 256 KiB.")
                            return
                        buffered.extend(chunk)
                        if not frame.get("more_body", False):
                            break
            except TimeoutError:
                await error(408, "REQUEST_TIMEOUT", "API request body timed out.")
                return
            body = bytes(buffered)
            buffered.clear()
            delivered = False
            original_receive = receive

            async def buffered_receive() -> Message:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await original_receive()

            receive = buffered_receive

        started = False

        async def tracked_send(message: Message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except Exception:
            if started:
                raise  # A streaming response cannot safely be replaced.
            # Never log exception strings, request bodies, URLs or credentials.
            logger.error("Unhandled API failure; response details suppressed")
            await error(500, "INTERNAL_ERROR", "An unexpected service error occurred.")
