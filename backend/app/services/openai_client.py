"""Bounded, stateless OpenAI transport for separately approved evaluation.

No credentials in URLs, redirects, proxy environment, logs, automatic retries,
provider-side conversation state or database writes. Every attempt is reserved
durably before transmission. Creating a key is NOT spending approval.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import stat
from tempfile import TemporaryDirectory

import httpx
from pydantic import SecretStr

from app.core.errors import APIError

MAX_JSON_BYTES = 128_000
MAX_RESPONSE_BYTES = 512_000
MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def invalid_response():
    return APIError(503, "AI_INVALID_RESPONSE", "The AI provider returned an unusable result.")


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


class OpenAIClient:
    def __init__(self, api_key: SecretStr, text_model: str, governor, *,
                 transport: httpx.AsyncBaseTransport | None = None,
                 timeout_seconds: float = 30):
        if not isinstance(api_key, SecretStr) or not api_key.get_secret_value().strip():
            raise APIError(503, "AI_NOT_CONFIGURED", "The AI provider is not configured.")
        if not MODEL_NAME.fullmatch(text_model) or not 0 < timeout_seconds <= 60:
            raise APIError(503, "AI_NOT_CONFIGURED", "The AI provider is not configured.")
        self._key = api_key
        self.text_model = text_model
        self.governor = governor
        self._transport = transport
        self.timeout_seconds = timeout_seconds

    async def _request(self, operation: str, model: str, endpoint: str, **kwargs) -> dict:
        # No retry loop: uncertain failures/cancellation can still be charged.
        self.governor.reserve(operation, model)
        try:
            async with asyncio.timeout(self.timeout_seconds):
                async with httpx.AsyncClient(
                    transport=self._transport, timeout=self.timeout_seconds,
                    follow_redirects=False, trust_env=False,
                ) as client:
                    async with client.stream(
                        "POST", "https://api.openai.com/v1/" + endpoint,
                        headers={"Authorization": "Bearer " + self._key.get_secret_value()},
                        **kwargs,
                    ) as response:
                        if response.status_code == 429:
                            raise APIError(503, "AI_PROVIDER_RATE_LIMIT", "The AI provider is busy; retry later.")
                        if not 200 <= response.status_code < 300:
                            raise APIError(503, "AI_PROVIDER_UNAVAILABLE", "The AI provider is temporarily unavailable.")
                        if response.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
                            raise invalid_response()
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > MAX_RESPONSE_BYTES:
                                raise invalid_response()
            result = json.loads(data, object_pairs_hook=strict_object)
            if not isinstance(result, dict):
                raise invalid_response()
            return result
        except (TimeoutError, httpx.TimeoutException):
            raise APIError(504, "AI_PROVIDER_TIMEOUT", "The AI provider timed out.") from None
        except httpx.HTTPError:
            raise APIError(503, "AI_PROVIDER_UNAVAILABLE", "The AI provider is temporarily unavailable.") from None
        except (ValueError, UnicodeError, RecursionError):
            raise invalid_response() from None
        except APIError:
            raise
        except Exception:
            raise APIError(503, "AI_PROVIDER_UNAVAILABLE", "The AI provider is temporarily unavailable.") from None

    async def structured(self, operation: str, instructions: str, payload: dict,
                         schema: dict, max_output_tokens: int = 2048) -> dict:
        if type(max_output_tokens) is not int or not 16 <= max_output_tokens <= 4096:
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        try:
            body = {
                "model": self.text_model, "store": False,
                "instructions": instructions,
                "input": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False, allow_nan=False)}],
                "text": {"format": {"type": "json_schema", "name": operation,
                                    "strict": True, "schema": schema}},
                "max_output_tokens": max_output_tokens,
            }
            encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.") from None
        if len(encoded) > MAX_JSON_BYTES:
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        response = await self._request(operation, self.text_model, "responses", json=body)
        # Never accept partial output, tools, refusals or multiple competing answers.
        try:
            if response["status"] != "completed" or response.get("error") is not None:
                raise ValueError
            messages = []
            for item in response["output"]:
                if item.get("type") == "reasoning":
                    continue  # A reasoning-capable configured model may include this.
                if item.get("type") != "message" or item.get("role") != "assistant" or item.get("status") != "completed":
                    raise ValueError
                messages.append(item)
            if len(messages) != 1 or len(messages[0]["content"]) != 1:
                raise ValueError
            part = messages[0]["content"][0]
            if part.get("type") != "output_text":
                raise ValueError
            result = json.loads(part["text"], object_pairs_hook=strict_object)
            if not isinstance(result, dict):
                raise ValueError
            return result
        except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
            raise invalid_response() from None

    async def transcribe(self, path: Path, language: str, model: str) -> str:
        if language not in {"en", "sv"} or not MODEL_NAME.fullmatch(model):
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        # Snapshot through a no-follow descriptor BEFORE awaiting a decoder.
        # Probing a caller path then reopening it would permit replacement after
        # validation. Probe/upload only our bounded, private immutable selection.
        from app.services.audio_upload import MAX_AUDIO_BYTES, MIME_TYPES, probe_duration
        suffix = path.suffix.lower()
        with TemporaryDirectory(prefix="memy-openai-audio-") as directory:
            snapshot = Path(directory) / ("recording" + suffix)
            try:
                if suffix not in MIME_TYPES or path.is_symlink():
                    raise ValueError
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
                with os.fdopen(descriptor, "rb") as source:
                    info = os.fstat(source.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= MAX_AUDIO_BYTES:
                        raise ValueError
                    with snapshot.open("xb") as target:
                        total = 0
                        while chunk := source.read(64_000):
                            total += len(chunk)
                            if total > MAX_AUDIO_BYTES:
                                raise ValueError
                            target.write(chunk)
                await probe_duration(snapshot, suffix)
                fields = {"model": model, "response_format": "json"}
                fields.update({"languages[]": language} if model == "gpt-transcribe" else {"language": language})
                mime = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webm": "audio/webm"}[suffix]
                with snapshot.open("rb") as stream:
                    response = await self._request("transcription", model, "audio/transcriptions",
                        data=fields, files={"file": ("recording" + suffix, stream, mime)})
            except (OSError, ValueError):
                raise APIError(422, "INVALID_RECORDING", "A valid local recording is required.") from None
        text = response.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 32_000 or "\0" in text:
            raise invalid_response()
        try:
            text.encode("utf-8")
        except UnicodeError:
            raise invalid_response() from None
        return text  # Original provider text, not a translated/rewritten transcript.


class OpenAITranscriptionProvider:
    enabled = True
    mode = "openai"

    def __init__(self, client: OpenAIClient, model: str = "gpt-4o-mini-transcribe"):
        self.client = client
        self.model = model

    async def transcribe(self, path: Path, language: str) -> str:
        return await self.client.transcribe(path, language, self.model)
