import asyncio
from base64 import b64encode
from contextlib import nullcontext
import json
from types import SimpleNamespace
from uuid import UUID, uuid4
import wave
from io import BytesIO

from fastapi.testclient import TestClient
from pydantic import SecretStr
from starlette.websockets import WebSocketDisconnect
import pytest

from app.api import real_ai_live
from app.api.real_ai import speech_cache_id
from app.services.ai_budget import live_talk_ceiling_microusd, observed_cost_microusd
from app.services.live_talk import LIVE_MODEL, LIVE_SECONDS, LiveTalkProvider, SpokenTurn
from tests.test_real_ai_api import SESSION, harness
from tests.test_real_ai_reconciliation import ReconciliationGateway

PREVIEW = "https://memy-visual-redesign-preview.onrender.com"
PCM = b"\x00\x08" * 240
SPOKEN = {
    "en": SpokenTurn("I picked berries with my sister.", "What do you remember about those walks?", PCM),
    "sv": SpokenTurn("Jag badade i Vänern.", "Vad minns du från de dagarna?", PCM),
}
PATH = f"/api/v2/story-sessions/{SESSION}/live-talk?talk_preview=true"


class FakeLiveSocket:
    def __init__(self, spoken):
        self.spoken = spoken
        self.events = asyncio.Queue()
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def recv(self):
        return json.dumps(await self.events.get())

    async def send(self, raw):
        event = json.loads(raw)
        self.sent.append(event)
        if event["type"] == "session.start":
            self.events.put_nowait({"type": "session.started", "session": {"id": "test", "model": LIVE_MODEL}})
        elif event["type"] == "session.input_audio.append":
            for kind, text in (("input", self.spoken.transcript), ("output", self.spoken.reply)):
                self.events.put_nowait({"type": f"session.{kind}_transcript.delta", "delta": text,
                                        "start_ms": 250, "end_ms": 700})
            self.events.put_nowait({"type": "session.output_audio.delta", "delta": b64encode(PCM).decode()})
        elif event["type"] == "session.close":
            self.events.put_nowait({"type": "session.closed", "usage": {"seconds": 4}, "session": {"id": "test"}})


@pytest.mark.parametrize("language,voice_name,prompt_fragment", [
    ("en", "marin", "Speak natural English"), ("sv", "cedar", "Svara på naturlig svenska"),
])
def test_live_speech_streams_and_same_duration_reservation_is_settled(language, voice_name, prompt_fragment):
    async def scenario():
        spoken = SPOKEN[language]
        socket = FakeLiveSocket(spoken)
        events = []
        governor = SimpleNamespace(
            reserve_live_talk=lambda bound: events.append(("reserved", bound)) or "one",
            settle=lambda *args, **kwargs: events.append(("settled", args, kwargs)),
        )

        def connect(url, **kwargs):
            assert url == "wss://api.openai.com/v1/live/sessions"
            assert not events or events[0] == ("reserved", LIVE_SECONDS + 5)
            return socket

        async def mic():
            yield PCM

        async def ready():
            events.append("ready")

        async def voice(pcm):
            assert not any(event["type"] == "session.close" for event in socket.sent)
            events.append(pcm)

        provider = LiveTalkProvider(SecretStr("test"), governor, english_voice="marin", connector=connect)
        assert await provider.talk([], mic(), ready, voice, language=language) == spoken
        assert events == [("reserved", LIVE_SECONDS + 5), "ready", PCM,
                          ("settled", ("one", "conversation", LIVE_MODEL, {"seconds": 4}), {"status": "completed"})]
        setup = socket.sent[0]["session"]
        assert setup["model"] == LIVE_MODEL and setup["audio"]["output"]["voice"] == voice_name and not setup["store"]
        assert prompt_fragment in setup["instructions"]

    asyncio.run(scenario())
    assert observed_cost_microusd("conversation", LIVE_MODEL, {"seconds": 60}, "completed", None) == 62_501
    assert live_talk_ceiling_microusd(80) == 83_336


@pytest.fixture
def mounted_live(harness, monkeypatch, request):
    language = getattr(request, "param", "sv")
    spoken = SPOKEN[language]
    app, _, _ = harness(language)
    settings = app.state.settings
    settings.real_ai_live_talk_enabled = True
    settings.real_ai_preview_talk_enabled = True
    class LiveGateway(ReconciliationGateway):
        async def complete(self, claim, payload, provenance):
            if claim["kind"] == "transcription":
                self.transcript.update(text=payload["text"], provenance=provenance)
            row = await super().complete(claim, payload, provenance)
            if claim["kind"] == "conversation":
                row.update(clarifications=[], requires_clarification=False)
                row["user_message"]["provenance"] = self.transcript["provenance"]
                row["message"]["provenance"] = provenance
            return row

    gateway = LiveGateway(language)
    audio_delivered = []

    async def authenticate(*_):
        return gateway.user

    async def extract(text, extraction_language, prior):
        assert audio_delivered
        assert (text, extraction_language, prior) == (spoken.transcript, language, [])
        return []

    async def talk(_history, microphone, ready, voice, *, language):
        assert language == gateway.language
        await ready()
        async for pcm in microphone:
            assert pcm == PCM
            break
        assert not any(row.get("result") for row in gateway.claims.values())
        await voice(PCM)
        audio_delivered.append(True)
        return spoken

    monkeypatch.setattr(real_ai_live, "authenticate", authenticate)
    monkeypatch.setattr(real_ai_live, "RealAIGateway", lambda *_: gateway)
    realtime = app.state.real_ai
    realtime.live_talk_provider = SimpleNamespace(talk=talk)
    realtime.require_preview_talk = lambda: SimpleNamespace(extract_live_memories=extract)
    realtime.governor = SimpleNamespace(workflow=nullcontext)
    return app, gateway, audio_delivered


@pytest.mark.parametrize("mounted_live", ["en", "sv"], indirect=True)
def test_socket_sends_audio_before_saving_the_owned_turn(mounted_live):
    app, gateway, delivered = mounted_live
    language = gateway.language
    spoken = SPOKEN[language]
    key = str(uuid4())
    with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
        ws.send_json({"token": "test", "key": key})
        assert ws.receive_json()["type"] == "operation"
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(PCM)
        assert ws.receive_bytes() == PCM
        assert ws.receive_json() == {"type": "saving"}
        saved = ws.receive_json()
        speech = next(row["result"] for row in gateway.claims.values() if row["kind"] == "speech")
        cache_id = speech_cache_id(UUID(speech["speech_id"]), language == "sv")
        audio = app.state.real_ai.cache.get(gateway.user.id, cache_id, speech["audio_sha256"])
        with wave.open(BytesIO(audio), "rb") as wav:
            assert wav.readframes(wav.getnframes()) == PCM
    assert delivered == [True]
    assert saved["type"] == "saved", saved
    assert saved["transcript"]["text"] == spoken.transcript and saved["transcript"]["language"] == language
    message = saved["turn"]["message"]
    assert message["provenance"]["model"] == LIVE_MODEL
    assert message["text"] == spoken.reply and message["language"] == language and saved["memories_checked"]
    assert len(gateway.claims) == 3


@pytest.mark.parametrize("origin,path", [
    ("https://memy-pilot.onrender.com", PATH),
    (PREVIEW, PATH.split("?")[0]),
])
def test_socket_rejects_nonpreview_requests_without_provider_use(mounted_live, origin, path):
    app, gateway, delivered = mounted_live
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(path, headers={"Origin": origin}):
            pass
    assert not gateway.claims and not delivered
