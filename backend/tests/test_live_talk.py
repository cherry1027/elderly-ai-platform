import asyncio
from base64 import b64encode
from contextlib import nullcontext
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr
from starlette.websockets import WebSocketDisconnect
import pytest

from app.api import real_ai_live
from app.services.ai_budget import live_talk_ceiling_microusd, observed_cost_microusd
from app.services.live_talk import LIVE_MODEL, LIVE_SECONDS, LiveTalkProvider, SpokenTurn
from tests.test_real_ai_api import SESSION, harness
from tests.test_real_ai_reconciliation import ReconciliationGateway

PREVIEW = "https://memy-visual-redesign-preview.onrender.com"
PCM = b"\x00\x08" * 240
SPOKEN = SpokenTurn("Jag badade i Vänern.", "Vad minns du från de dagarna?", PCM)
PATH = f"/api/v2/story-sessions/{SESSION}/live-talk?talk_preview=true"


class FakeLiveSocket:
    def __init__(self):
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
            for kind, text in (("input", SPOKEN.transcript), ("output", SPOKEN.reply)):
                self.events.put_nowait({"type": f"session.{kind}_transcript.delta", "delta": text,
                                        "start_ms": 250, "end_ms": 700})
            self.events.put_nowait({"type": "session.output_audio.delta", "delta": b64encode(PCM).decode()})
        elif event["type"] == "session.close":
            self.events.put_nowait({"type": "session.closed", "usage": {"seconds": 4}, "session": {"id": "test"}})


def test_live_speech_streams_and_same_duration_reservation_is_settled():
    async def scenario():
        socket = FakeLiveSocket()
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

        assert await LiveTalkProvider(SecretStr("test"), governor, connector=connect).talk([], mic(), ready, voice) == SPOKEN
        assert events == [("reserved", LIVE_SECONDS + 5), "ready", PCM,
                          ("settled", ("one", "conversation", LIVE_MODEL, {"seconds": 4}), {"status": "completed"})]
        setup = socket.sent[0]["session"]
        assert setup["model"] == LIVE_MODEL and setup["audio"]["output"]["voice"] == "cedar" and not setup["store"]

    asyncio.run(scenario())
    assert observed_cost_microusd("conversation", LIVE_MODEL, {"seconds": 60}, "completed", None) == 62_501
    assert live_talk_ceiling_microusd(80) == 83_336


@pytest.fixture
def mounted_live(harness, monkeypatch):
    app, _, _ = harness("sv")
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

    gateway = LiveGateway("sv")
    audio_delivered = []

    async def authenticate(*_):
        return gateway.user

    async def extract(*_):
        assert audio_delivered
        return []

    async def talk(_history, microphone, ready, voice):
        await ready()
        async for pcm in microphone:
            assert pcm == PCM
            break
        assert not any(row.get("result") for row in gateway.claims.values())
        await voice(PCM)
        audio_delivered.append(True)
        return SPOKEN

    monkeypatch.setattr(real_ai_live, "authenticate", authenticate)
    monkeypatch.setattr(real_ai_live, "RealAIGateway", lambda *_: gateway)
    realtime = app.state.real_ai
    realtime.live_talk_provider = SimpleNamespace(talk=talk)
    realtime.require_preview_talk = lambda: SimpleNamespace(extract_live_memories=extract)
    realtime.governor = SimpleNamespace(workflow=nullcontext)
    return app, gateway, audio_delivered


def test_socket_sends_audio_before_saving_the_owned_turn(mounted_live):
    app, gateway, delivered = mounted_live
    key = str(uuid4())
    with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
        ws.send_json({"token": "test", "key": key})
        assert ws.receive_json()["type"] == "operation"
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(PCM)
        assert ws.receive_bytes() == PCM
        assert ws.receive_json() == {"type": "saving"}
        saved = ws.receive_json()
    assert delivered == [True]
    assert saved["type"] == "saved", saved
    assert saved["transcript"]["text"] == SPOKEN.transcript
    assert saved["turn"]["message"]["provenance"]["model"] == LIVE_MODEL
    assert saved["turn"]["message"]["text"] == SPOKEN.reply and saved["memories_checked"]
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
