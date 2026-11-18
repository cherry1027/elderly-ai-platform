"""Preview-only authenticated English and Swedish voice relay with background saves."""

import asyncio
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import json
import re
from uuid import UUID, uuid5
import wave

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.real_ai import digest, result_scope, speech_cache_id, uses_talk_preview
from app.core.errors import APIError, invalid_token, unavailable
from app.services.ai_controls import ai_budget_subject
from app.services.auth import authenticate
from app.services.live_talk import LIVE_MODEL, LIVE_PROMPTS, PCM_RATE, LiveTalkError
from app.services.openai_client import strict_object
from app.services.pilot_cohort import require_pilot_member
from app.services.real_ai_resources import RealAIGateway

router = APIRouter()
PROVENANCE = {"mode": "real", "provider": "openai", "model": LIVE_MODEL, "version": 1}


async def _authorized_hello(socket):
    async with asyncio.timeout(5):
        raw = await socket.receive_text()
    if not isinstance(raw, str) or len(raw) > 16_600:
        raise invalid_token()
    try:
        body = json.loads(raw, object_pairs_hook=strict_object)
        if set(body) != {"token", "key"} or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,16384}", body["token"]):
            raise ValueError
        key = UUID(body["key"])
        if str(key) != body["key"] or key.version != 4:
            raise ValueError
    except (ValueError, TypeError, KeyError, AttributeError):
        raise invalid_token() from None
    state = socket.app.state
    user = await authenticate(state.settings, state.http_client, body["token"])
    state.user_rate_limiter.check(user.id)
    require_pilot_member(state.settings, user.id)
    return RealAIGateway(state.settings, state.http_client, user), key


async def _complete(gateway, claim, project_id, session_id, payload, *, assistant=None):
    raw = await gateway.complete(claim, payload, PROVENANCE)
    result = await gateway.normalize_result(claim["kind"], raw, speech_assistant=assistant)
    return result_scope(claim["kind"], result, project_id, session_id, claim["operation_id"])


async def _close_claim(gateway, claim, error, uncertain):
    try:
        await asyncio.shield(gateway.fail(claim, error, uncertain=uncertain))
    except (Exception, asyncio.CancelledError):
        pass  # An unconfirmed write stays unretryable under the existing claim.


async def _cache_reply(runtime, gateway, project_id, session_id, message, pcm):
    message_id = UUID(message["id"])
    data = BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setparams((1, 2, PCM_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    audio = data.getvalue()
    language = message["language"]
    fingerprint = digest({"assistant_id": str(message_id), "language": language,
                          "text_sha256": sha256(message["text"].encode()).hexdigest()})
    claim = await gateway.claim(project_id, session_id, "speech", message_id, fingerprint)
    if not claim["claimed"]:
        return
    expires = datetime.now(timezone.utc) + timedelta(seconds=runtime.cache.ttl)
    hash_hex = sha256(audio).hexdigest()
    try:
        result = await _complete(gateway, claim, project_id, session_id,
            {"assistant_message_id": str(message_id), "media_type": "audio/wav",
             "audio_sha256": hash_hex, "audio_size": len(audio), "expires_at": expires.isoformat()}, assistant=message)
        runtime.cache.put(gateway.user.id, speech_cache_id(UUID(result["speech_id"]), True, language),
                          audio, hash_hex, expires_at=expires.timestamp())
    except BaseException:
        await _close_claim(gateway, claim, "REAL_AI_UNCERTAIN", True)
        raise


async def _save_spoken(runtime, gateway, project_id, session_id, key, transcript, spoken, extractor):
    language = transcript["language"]
    conversation = await gateway.claim(project_id, session_id, "conversation", uuid5(key, "gpt-live-turn"),
        digest({"source_transcript_id": transcript["transcript_id"], "language": language}))
    if not conversation["claimed"]:
        raise unavailable()
    memories = []
    memory_complete = False
    try:
        try:
            async with asyncio.timeout(10):
                prior = await gateway.project_memories(project_id)
                with runtime.governor.workflow():
                    memories = await extractor.extract_live_memories(transcript["text"], language, prior)
            memory_complete = True
        except (APIError, TimeoutError, ValueError, TypeError):
            # The verified original and audible reply survive optional extraction failure.
            pass
        turn = await _complete(gateway, conversation, project_id, session_id,
            {"source_transcript_id": transcript["transcript_id"], "assistant_text": spoken.reply,
             "memories": [asdict(item) for item in memories]})
    except BaseException:
        await _close_claim(gateway, conversation, "REAL_AI_UNCERTAIN", True)
        raise
    try:
        await _cache_reply(runtime, gateway, project_id, session_id, turn["message"], spoken.pcm)
    except APIError:
        pass  # Replay depends on cache availability, not on saving the turn.
    return turn, memory_complete


@router.websocket("/api/v2/story-sessions/{session_id}/live-talk")
async def live_talk(socket: WebSocket, session_id: UUID):
    state = socket.app.state
    settings = state.settings
    runtime = state.real_ai
    if (not uses_talk_preview(socket) or not settings.real_ai_live_talk_enabled
        or settings.real_ai_text_only or not settings.real_ai_transcription_enabled
        or not settings.real_ai_speech_enabled or not settings.real_ai_conversation_enabled
        or runtime.live_talk_provider is None or state.live_talk_slots.locked()):
        await socket.close(code=1008)
        return

    connected = True
    submitted = False

    async def send(event):
        nonlocal connected
        if connected and (submitted or not isinstance(event, bytes)):
            try:
                if isinstance(event, bytes):
                    await asyncio.wait_for(socket.send_bytes(event), timeout=1)
                else:
                    await asyncio.wait_for(socket.send_json(event), timeout=1)
            except (WebSocketDisconnect, RuntimeError, TimeoutError, OSError):
                connected = False

    async def microphone():
        nonlocal connected, submitted
        while connected:
            message = await socket.receive()
            if message["type"] == "websocket.disconnect":
                connected = False
                break
            if message.get("text") == "stop":
                submitted = True
                yield None  # A deliberate end of input; a disconnect simply ends the iterator.
                break
            pcm = message.get("bytes")
            if pcm is None:
                raise LiveTalkError()
            yield pcm

    async with state.live_talk_slots:
        await socket.accept()
        gateway = subject = identity = None
        claim = None
        transcript_write_started = False
        terminal_error = None
        try:
            gateway, key = await _authorized_hello(socket)
            identity = gateway.user.id
            if identity in state.live_talk_users:
                identity = None
                raise APIError(429, "AI_BUSY", "A Live Talk turn is already open.")
            state.live_talk_users.add(identity)
            session = await gateway.get_owned_session(session_id, active=True)
            language = session["language"]
            if language not in LIVE_PROMPTS:
                raise APIError(422, "LANGUAGE_MISMATCH", "Live Talk is available for English and Swedish stories in this preview.")
            extractor = runtime.require_preview_talk()
            project_id = UUID(session["project_id"])
            subject = ai_budget_subject.set(str(gateway.user.id))
            claim = await gateway.claim(project_id, session_id, "transcription", key,
                                       digest({"mode": "live-talk", "language": language}))
            if not claim["claimed"]:
                raise APIError(409, "AI_OPERATION_UNCERTAIN", "Check the saved turn before retrying.")
            recent = await gateway.messages(session_id, limit=4, recent=True)
            history = [{"type": "message", "role": item["role"], "content": [{
                "type": "input_text" if item["role"] == "user" else "output_text", "text": item["text"][:600],
            }]} for item in recent if item["role"] in ("user", "assistant")]
            await send({"type": "operation", "id": claim["operation_id"]})
            spoken = await runtime.live_talk_provider.talk(history, microphone(),
                lambda: send({"type": "ready"}), send, language=language)
            if not submitted or not spoken.transcript:
                raise APIError(422, "LIVE_TALK_NO_SPEECH", "Live Talk ended without a finished voice message.")
            await send({"type": "saving"})
            transcript_write_started = True
            transcript = await _complete(gateway, claim, project_id, session_id, {"text": spoken.transcript})
            claim = None
            turn, memory_complete = None, False
            if spoken.reply and spoken.pcm:
                turn, memory_complete = await _save_spoken(runtime, gateway, project_id, session_id, key,
                                                          transcript, spoken, extractor)
            await send({"type": "saved", "transcript": transcript, "turn": turn, "memories_checked": memory_complete})
        except WebSocketDisconnect:
            connected = False
        except Exception as error:
            terminal_error = error.code if isinstance(error, APIError) else "LIVE_TALK_INCOMPLETE"
        finally:
            if claim and claim["claimed"] and gateway is not None:
                # The provider can consume budget before any transcript write starts.
                # Its spending reservation is settled separately by the provider adapter.
                await _close_claim(gateway, claim, "LIVE_TALK_INCOMPLETE", transcript_write_started)
            if subject is not None:
                ai_budget_subject.reset(subject)
            if identity is not None:
                state.live_talk_users.discard(identity)
            if terminal_error is not None:
                await send({"type": "error", "code": terminal_error})
            if connected:
                try:
                    await socket.close()
                except (WebSocketDisconnect, RuntimeError, OSError):
                    pass
