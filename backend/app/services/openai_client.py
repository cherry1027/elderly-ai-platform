"""Bounded, stateless OpenAI transport for separately approved evaluation.

No credentials in URLs, redirects, proxy environment, logs, automatic retries,
provider-side conversation state or database writes. Every attempt is reserved
durably before transmission. Creating a key is NOT spending approval.
"""

from __future__ import annotations

import asyncio
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import stat
from tempfile import TemporaryDirectory
from contextvars import ContextVar
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from pydantic import SecretStr

from app.core.errors import APIError
from app.services.audio_upload import Recording

MAX_JSON_BYTES = 128_000
MAX_RESPONSE_BYTES = 512_000
MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
PROVIDER_BILLING_CODES = frozenset({
    "insufficient_quota", "billing_hard_limit_reached", "credit_balance_exhausted",
    "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
})


@dataclass
class DispatchTrace:
    dispatched: bool = False


ai_dispatch_trace: ContextVar[DispatchTrace | None] = ContextVar("memy_ai_dispatch", default=None)


def mark_ai_dispatched():
    trace = ai_dispatch_trace.get()
    if trace is not None:
        trace.dispatched = True


def invalid_response():
    return APIError(503, "AI_INVALID_RESPONSE", "The AI provider returned an unusable result.")


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def structured_body(model, operation, instructions, payload, schema, max_output_tokens):
    body = {
        "model": model, "store": False, "service_tier": "default",
        "instructions": instructions,
        "input": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False, allow_nan=False)}],
        "text": {"format": {"type": "json_schema", "name": operation,
                            "strict": True, "schema": schema}},
        "max_output_tokens": max_output_tokens,
    }
    # The selected evaluation model documents this mode. Keep short responses
    # from spending their output allowance on hidden reasoning tokens.
    if model == "gpt-6.1-terra":
        body["reasoning"] = {"effort": "none"}
    return body


async def provider_failure(response):
    """Classify only allowlisted provider error codes; never expose raw bodies."""
    code, kind = None, None
    if response.status_code in {400, 401, 403, 429}:
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > 8192:
                break
        if len(data) <= 8192:
            try:
                payload = json.loads(data, object_pairs_hook=strict_object)
                detail = payload.get("error") if isinstance(payload, dict) else None
                code = detail.get("code") if isinstance(detail, dict) else None
                kind = detail.get("type") if isinstance(detail, dict) else None
            except (ValueError, UnicodeError, RecursionError):
                pass
    safe_codes = PROVIDER_BILLING_CODES | {"rate_limit_exceeded", "invalid_api_key", "model_not_found"}
    safe_types = {"tokens", "requests", "insufficient_quota", "invalid_request_error", "rate_limit_error"}
    diagnostics = {"http_status": response.status_code,
        "provider_error_code": code if isinstance(code, str) and code in safe_codes else "unclassified",
        "provider_error_type": kind if isinstance(kind, str) and kind in safe_types else "unclassified"}
    for header in ("retry-after", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
                   "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens"):
        raw = response.headers.get(header, "")
        if re.fullmatch(r"\d{1,10}", raw):
            diagnostics[header] = int(raw)

    def failure(code, message):
        error = APIError(503, code, message)
        error.provider_diagnostics = diagnostics  # Safe metadata, never the provider body.
        return error

    if (response.status_code in {400, 429} and (
        (isinstance(code, str) and code in PROVIDER_BILLING_CODES)
        or kind == "insufficient_quota")):
        return failure("AI_PROVIDER_QUOTA_EXHAUSTED", "The AI provider's API credits or billing limit require attention.")
    if response.status_code == 401:
        return failure("AI_PROVIDER_AUTHENTICATION_FAILED", "The AI provider's credentials require attention.")
    if response.status_code == 403:
        return failure("AI_PROVIDER_ACCESS_DENIED", "The AI provider's model access requires attention.")
    if response.status_code == 429:
        return failure("AI_PROVIDER_RATE_LIMIT", "The AI provider is busy; retry later.")
    return failure("AI_PROVIDER_UNAVAILABLE", "The AI provider is temporarily unavailable.")


MAX_STREAM_BYTES = 2_000_000
MAX_STREAM_EVENTS = 8_192


def _structured_output(response):
    """Keep the existing strict final envelope validation for both transports."""
    try:
        if response["status"] != "completed" or response.get("error") is not None:
            raise ValueError
        messages = []
        for index, item in enumerate(response["output"]):
            if item.get("type") == "reasoning":
                continue
            if item.get("type") != "message" or item.get("role") != "assistant" or item.get("status") != "completed":
                raise ValueError
            messages.append((index, item))
        if len(messages) != 1 or len(messages[0][1]["content"]) != 1:
            raise ValueError
        index, message = messages[0]
        part = message["content"][0]
        if part.get("type") != "output_text" or not isinstance(part.get("text"), str):
            raise ValueError
        result = json.loads(part["text"], object_pairs_hook=strict_object)
        if not isinstance(result, dict):
            raise ValueError
        return result, part["text"], index, message.get("id")
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        raise invalid_response() from None


async def _response_events(response):
    """Strict bounded SSE framing; UTF-8/JSON errors never become app text."""
    pending = bytearray()
    data, event_name = [], None
    size = count = event_size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_STREAM_BYTES:
            raise invalid_response()
        pending.extend(chunk)
        while b"\n" in pending:
            boundary = pending.index(b"\n")
            line = bytes(pending[:boundary])
            del pending[:boundary + 1]
            if line.endswith(b"\r"):
                line = line[:-1]
            event_size += len(line) + 1
            if event_size > MAX_RESPONSE_BYTES:
                raise invalid_response()
            if not line:
                if data:
                    count += 1
                    if count > MAX_STREAM_EVENTS:
                        raise invalid_response()
                    try:
                        event = json.loads("\n".join(data), object_pairs_hook=strict_object)
                    except (ValueError, TypeError, UnicodeError, RecursionError):
                        raise invalid_response() from None
                    if (not isinstance(event, dict) or not isinstance(event.get("type"), str)
                        or (event_name is not None and event_name != event["type"])):
                        raise invalid_response()
                    yield event
                elif event_name is not None:
                    raise invalid_response()
                data, event_name, event_size = [], None, 0
            elif line.startswith(b":"):
                continue
            else:
                field, separator, value = line.partition(b":")
                if not separator:
                    raise invalid_response()
                if value.startswith(b" "):
                    value = value[1:]
                try:
                    value = value.decode("utf-8", errors="strict")
                except UnicodeError:
                    raise invalid_response() from None
                if field == b"data":
                    data.append(value)
                elif field == b"event" and event_name is None and value:
                    event_name = value
                else:
                    raise invalid_response()
        if len(pending) + event_size > MAX_RESPONSE_BYTES:
            raise invalid_response()
    if pending or data or event_name is not None:
        raise invalid_response()


class OpenAIClient:
    def __init__(self, api_key: SecretStr, text_model: str, governor, *,
                 transport: httpx.AsyncBaseTransport | None = None,
                 timeout_seconds: float = 30, usage_observer=None,
                 http_client: httpx.AsyncClient | None = None):
        if not isinstance(api_key, SecretStr) or not api_key.get_secret_value().strip():
            raise APIError(503, "AI_NOT_CONFIGURED", "The AI provider is not configured.")
        if not MODEL_NAME.fullmatch(text_model) or not 0 < timeout_seconds <= 60:
            raise APIError(503, "AI_NOT_CONFIGURED", "The AI provider is not configured.")
        self._key = api_key
        self.text_model = text_model
        self.governor = governor
        self._transport = transport
        self.timeout_seconds = timeout_seconds
        self.usage_observer = usage_observer
        # The app lifespan owns this pool. Standalone offline/evaluation clients
        # retain their short-lived transport when no pool is supplied.
        self.http_client = http_client

    @asynccontextmanager
    async def _connection(self):
        if self.http_client is not None:
            yield self.http_client
        else:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=self.timeout_seconds,
                follow_redirects=False, trust_env=False,
            ) as client:
                yield client

    async def _request(self, operation: str, model: str, endpoint: str, *, audio_seconds=None, **kwargs) -> dict:
        # No retry loop: uncertain failures/cancellation can still be charged.
        body = kwargs.get("json")
        if audio_seconds is not None and operation == "transcription" and hasattr(self.governor, "reserve_transcription"):
            reservation_id = self.governor.reserve_transcription(model, audio_seconds)
        elif isinstance(body, dict) and hasattr(self.governor, "reserve_request"):
            reservation_id = self.governor.reserve_request(operation, model,
                input_bytes=len(json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")),
                max_output_tokens=body.get("max_output_tokens"))
        else:
            reservation_id = self.governor.reserve(operation, model)
        reported_usage, service_tier, outcome = None, None, "failed"
        mark_ai_dispatched()  # After approval, before any provider network attempt.
        try:
            async with asyncio.timeout(self.timeout_seconds):
                async with self._connection() as client:
                    async with client.stream(
                        "POST", "https://api.openai.com/v1/" + endpoint,
                        headers={"Authorization": "Bearer " + self._key.get_secret_value()},
                        **kwargs,
                    ) as response:
                        if not 200 <= response.status_code < 300:
                            raise await provider_failure(response)
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
            reported_usage = result.get("usage")
            service_tier = result.get("service_tier")
            outcome = "completed"
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
        finally:
            if self.usage_observer is not None:
                self.usage_observer.record(operation, model, reported_usage,
                    reservation_id=reservation_id, status=outcome, service_tier=service_tier)
            if hasattr(self.governor, "settle"):
                self.governor.settle(reservation_id, operation, model, reported_usage,
                    status=outcome, service_tier=service_tier)

    async def structured(self, operation: str, instructions: str, payload: dict,
                         schema: dict, max_output_tokens: int = 2048) -> dict:
        if type(max_output_tokens) is not int or not 16 <= max_output_tokens <= 4096:
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        try:
            body = structured_body(self.text_model, operation, instructions, payload, schema, max_output_tokens)
            encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.") from None
        if len(encoded) > MAX_JSON_BYTES:
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        response = await self._request(operation, self.text_model, "responses", json=body)
        # Never accept partial output, tools, refusals or multiple competing answers.
        return _structured_output(response)[0]

    async def structured_streamed(self, operation: str, instructions: str, payload: dict,
                                  schema: dict, max_output_tokens: int = 2048, *, on_text) -> dict:
        """Opt-in provisional transport; one reserved attempt, one final result.

        on_text receives bounded accumulated structured JSON privately. Only the
        provider may turn a fully decoded nested reply into a public preview.
        Nothing here persists a turn or retries an incomplete provider attempt.
        """
        if type(max_output_tokens) is not int or not 16 <= max_output_tokens <= 4096 or not callable(on_text):
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        try:
            body = structured_body(self.text_model, operation, instructions, payload, schema, max_output_tokens)
            body["stream"] = True
            encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.") from None
        if len(encoded) > MAX_JSON_BYTES:
            raise APIError(422, "AI_INPUT_LIMIT", "The AI request exceeds approved limits.")
        reservation_id = (self.governor.reserve_request(operation, self.text_model,
            input_bytes=len(encoded), max_output_tokens=max_output_tokens)
            if hasattr(self.governor, "reserve_request") else self.governor.reserve(operation, self.text_model))
        reported_usage, service_tier, outcome = None, None, "failed"
        mark_ai_dispatched()
        try:
            async with asyncio.timeout(self.timeout_seconds):
                async with self._connection() as client:
                    async with client.stream("POST", "https://api.openai.com/v1/responses",
                        headers={"Authorization": "Bearer " + self._key.get_secret_value()}, json=body) as response:
                        if not 200 <= response.status_code < 300:
                            raise await provider_failure(response)
                        if response.headers.get("content-type", "").split(";", 1)[0].strip() != "text/event-stream":
                            raise invalid_response()
                        previous_sequence, identity, text, text_done = -1, None, "", False
                        allowed = {"response.created", "response.in_progress", "response.output_item.added",
                            "response.content_part.added", "response.output_text.delta", "response.output_text.done",
                            "response.content_part.done", "response.output_item.done", "response.completed"}
                        async for event in _response_events(response):
                            kind, sequence = event["type"], event.get("sequence_number")
                            if (kind not in allowed or type(sequence) is not int
                                or sequence <= previous_sequence):
                                raise invalid_response()
                            previous_sequence = sequence
                            if kind in {"response.output_text.delta", "response.output_text.done"}:
                                current = (event.get("item_id"), event.get("output_index"), event.get("content_index"))
                                if (not isinstance(current[0], str) or not 1 <= len(current[0]) <= 256
                                    or type(current[1]) is not int or current[1] < 0 or type(current[2]) is not int or current[2] != 0
                                    or (identity is not None and current != identity) or text_done):
                                    raise invalid_response()
                                identity = current
                                if kind == "response.output_text.delta":
                                    delta = event.get("delta")
                                    if not isinstance(delta, str):
                                        raise invalid_response()
                                    text += delta
                                    if len(text.encode("utf-8")) > MAX_RESPONSE_BYTES:
                                        raise invalid_response()
                                    await on_text(text)
                                else:
                                    if event.get("text") != text:
                                        raise invalid_response()
                                    text_done = True
                            elif kind == "response.completed":
                                final = event.get("response")
                                if not isinstance(final, dict):
                                    raise invalid_response()
                                parsed, final_text, output_index, item_id = _structured_output(final)
                                if identity is None or identity != (item_id, output_index, 0) or text != final_text:
                                    raise invalid_response()
                                reported_usage, service_tier = final.get("usage"), final.get("service_tier")
                                outcome = "completed"
                                # response.completed is authoritative. Waiting
                                # for an idle provider socket to close adds no
                                # validation and can turn success into timeout.
                                # Returning exits both HTTP contexts, then runs
                                # the single observer/settlement below.
                                return parsed
                        raise invalid_response()  # EOF before a valid terminal.
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
        finally:
            if self.usage_observer is not None:
                self.usage_observer.record(operation, self.text_model, reported_usage,
                    reservation_id=reservation_id, status=outcome, service_tier=service_tier)
            if hasattr(self.governor, "settle"):
                self.governor.settle(reservation_id, operation, self.text_model, reported_usage,
                    status=outcome, service_tier=service_tier)

    async def transcribe(self, path: Path, language: str, model: str, *, validated_recording: Recording | None = None) -> str:
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
                # Only the real upload route provides the result of the bounded
                # decoder. A mismatch fails before reservation or transmission.
                digest = None
                if validated_recording is not None:
                    if (type(validated_recording) is not Recording or validated_recording.path != path
                        or validated_recording.language != language
                        or type(validated_recording.duration_seconds) not in {int, float}
                        or not math.isfinite(validated_recording.duration_seconds)
                        or not 0 < validated_recording.duration_seconds <= 90):
                        raise ValueError
                    digest = sha256()
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
                            if digest is not None:
                                digest.update(chunk)
                            target.write(chunk)
                if digest is None:
                    duration_seconds = await probe_duration(snapshot, suffix)
                else:
                    if digest.hexdigest() != validated_recording.content_sha256:
                        raise ValueError
                    duration_seconds = validated_recording.duration_seconds
                fields = {"model": model, "response_format": "json"}
                fields.update({"languages[]": language} if model == "gpt-transcribe" else {"language": language})
                mime = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webm": "audio/webm"}[suffix]
                with snapshot.open("rb") as stream:
                    response = await self._request("transcription", model, "audio/transcriptions",
                        audio_seconds=duration_seconds, data=fields, files={"file": ("recording" + suffix, stream, mime)})
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
