"""Explicit live gate and bounded private transient speech cache; no startup calls."""

from collections import OrderedDict
from datetime import datetime, timedelta, timezone
import hashlib
import time
from uuid import UUID

from app.core.errors import APIError
from app.services.ai_controls import AISpendingGovernor
from app.services.openai_client import OpenAIClient, MODEL_NAME
from app.services.real_ai_provider import RealAIProvider, RealtimeSpeechProvider


class SpeechCache:
    """Single-process, private audio; restart/expiry requires explicit re-synthesis."""

    def __init__(self, *, ttl=300, max_bytes=32_000_000, clock=time.monotonic):
        self.ttl, self.max_bytes, self.clock = ttl, max_bytes, clock
        self._items = OrderedDict()
        self._size = 0

    def _purge(self):
        for key, (_, expires, data) in list(self._items.items()):
            if expires <= self.clock():
                self._size -= len(data)
                del self._items[key]

    def put(self, owner: UUID, speech_id: UUID, data: bytes, digest: str, *, expires_at=None):
        self._purge()
        if (type(data) is not bytes or not 44 <= len(data) <= min(8_000_000, self.max_bytes)
            or hashlib.sha256(data).hexdigest() != digest):
            raise APIError(503, "SPEECH_INVALID_RESPONSE", "Spoken reply is unavailable.")
        lifetime = self.ttl
        if expires_at is not None:
            if type(expires_at) not in {float, int} or not 0 < expires_at - time.time() <= self.ttl:
                raise APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")
            lifetime = min(lifetime, expires_at - time.time())
        key = (owner, speech_id)
        if key in self._items:
            self._size -= len(self._items.pop(key)[2])
        while self._items and self._size + len(data) > self.max_bytes:
            _, (_, _, old) = self._items.popitem(last=False)
            self._size -= len(old)
        self._items[key] = (digest, self.clock() + lifetime, data)
        self._size += len(data)

    def get(self, owner: UUID, speech_id: UUID, digest: str) -> bytes:
        self._purge()
        item = self._items.get((owner, speech_id))
        if item is None or item[0] != digest:
            raise APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")
        return item[2]

    def clear(self):
        self._items.clear()
        self._size = 0

    def close(self):
        self.clear()


class RealAIRuntime:
    def __init__(self, settings, provider=None):
        self.settings = settings
        self.provider = provider
        self.governor = AISpendingGovernor(settings.live_ai_approval_path, settings.ai_usage_ledger_path,
                                          budget_policy_path=settings.ai_budget_policy_path)
        if settings.real_ai_speech_storage_path is not None:
            from app.services.encrypted_speech_cache import EncryptedSpeechCache
            key = settings.real_ai_speech_encryption_key
            self.cache = EncryptedSpeechCache(settings.real_ai_speech_storage_path,
                key.get_secret_value() if key is not None else "",
                ttl=settings.real_ai_speech_retention_seconds,
                max_bytes=settings.real_ai_speech_max_bytes)
        else:
            self.cache = SpeechCache(ttl=settings.real_ai_speech_retention_seconds,
                                     max_bytes=settings.real_ai_speech_max_bytes)
        self.usage_observer = None
        self._http_clients = ()
        if settings.real_ai_enabled and settings.real_ai_usage_log_path is not None:
            from app.services.ai_usage import UsageObserver
            self.usage_observer = UsageObserver(settings.real_ai_usage_log_path)
        self.models = (settings.real_ai_transcription_model, settings.openai_text_model,
                       settings.openai_verifier_model, settings.real_ai_speech_model)
        if settings.real_ai_enabled and provider is None and self.configured:
            client = OpenAIClient(settings.openai_api_key, settings.openai_text_model, self.governor,
                                  timeout_seconds=settings.openai_timeout_seconds, usage_observer=self.usage_observer)
            verifier = OpenAIClient(settings.openai_api_key, settings.openai_verifier_model, self.governor,
                                    timeout_seconds=settings.openai_timeout_seconds, usage_observer=self.usage_observer)
            self._http_clients = (client, verifier)
            speech = None
            if not settings.real_ai_text_only and settings.real_ai_speech_enabled:
                speech = RealtimeSpeechProvider(settings.openai_api_key, self.governor,
                    model=settings.real_ai_speech_model, voice=settings.real_ai_voice,
                    timeout_seconds=settings.openai_timeout_seconds, usage_observer=self.usage_observer)
            self.provider = RealAIProvider(client, transcription_model=settings.real_ai_transcription_model,
                                           verifier_client=verifier, speech=speech,
                                           combined_turn=settings.real_ai_combined_turn_enabled)

    @property
    def needs_http_pool(self):
        return bool(self._http_clients)

    def bind_http_client(self, client):
        """Reuse the lifespan's provider-only pool; never share Auth headers."""
        for adapter in self._http_clients:
            adapter.http_client = client

    @property
    def configured(self):
        c = self.settings
        return bool(c.supabase_configured and c.supabase_secret_key
            and c.supabase_secret_key.get_secret_value().strip()
            and c.openai_api_key and c.openai_api_key.get_secret_value().strip()
            and c.live_ai_approval_path and all(MODEL_NAME.fullmatch(m) for m in self.models))

    def require(self):
        if not self.settings.real_ai_enabled:
            raise APIError(503, "LIVE_AI_DISABLED", "Real AI is not enabled. No paid request was made.")
        if not self.configured or self.provider is None:
            raise APIError(503, "REAL_AI_NOT_CONFIGURED", "Real AI configuration is incomplete.")
        self.governor.check_approval(self.models)
        return self.provider

    def capabilities(self):
        reason = "READY"
        try:
            self.require()
            # No reservation: distinguish a closed allowance from connectivity.
            self.governor.check_budget()
        except APIError as error:
            reason = error.code
        enabled = reason == "READY"
        all_features = enabled and not self.settings.real_ai_text_only
        features = {"transcription": all_features and self.settings.real_ai_transcription_enabled,
                    "conversation": enabled and self.settings.real_ai_conversation_enabled,
                    "writing": all_features and self.settings.real_ai_writing_enabled,
                    "speech": all_features and self.settings.real_ai_speech_enabled}
        for feature, calls in (("conversation", getattr(self.provider, "conversation_calls", 2)), ("writing", 2)):
            if features[feature]:
                try:
                    self.governor.check_budget(required_calls=calls)
                except APIError as error:
                    features[feature] = False
                    if not any(features.values()):
                        reason = error.code
        if enabled and not any(features.values()) and reason == "READY":
            reason = "LIVE_AI_DISABLED"
        return {"contract": "real-v2", "mode": "real", "enabled": any(features.values()),
                **features, "reason": reason}
