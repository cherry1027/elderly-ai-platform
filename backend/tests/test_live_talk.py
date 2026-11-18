import asyncio
from base64 import b64decode, b64encode
from contextlib import nullcontext
from dataclasses import replace
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
from app.core.errors import APIError
from app.services.ai_budget import live_talk_ceiling_microusd, observed_cost_microusd
from app.services.live_talk import (
    FINAL_INPUT_FRAMES, FINISH_REMINDER_EVENT, FINISH_TURN_EVENT, LIVE_MODEL, LIVE_SECONDS,
    LiveTalkError, LiveTalkProvider, SpokenTurn,
)
from app.services.openai_client import mark_ai_dispatched
from tests.test_real_ai_api import SESSION, harness
from tests.test_real_ai_reconciliation import ReconciliationGateway
from tests.test_softer_cedar import voiced_pcm

PREVIEW = "https://memy-visual-redesign-preview.onrender.com"
PCM = b"\x00\x08" * 240
SPOKEN = {
    "en": SpokenTurn("I picked berries with my sister.", "What do you remember about those walks?", PCM),
    "sv": SpokenTurn("Jag badade i Vänern.", "Vad minns du från de dagarna?", PCM),
}
PATH = f"/api/v2/story-sessions/{SESSION}/live-talk?talk_preview=true"


class FakeLiveSocket:
    def __init__(self, spoken, silence_frames=0):
        self.spoken = spoken
        self.events = asyncio.Queue()
        self.sent = []
        self.microphone = []
        self.silence_frames = silence_frames
        self.quiet_frames = 0
        self.heard = False
        self.replied = False
        self.finished = False
        self.reply_attempts = 0

    def emit(self, spoken):
        for kind, text in (("input", spoken.transcript), ("output", spoken.reply)):
            if text:
                self.events.put_nowait({"type": f"session.{kind}_transcript.delta", "delta": text,
                                        "start_ms": 250, "end_ms": 700})
        self.events.put_nowait({"type": "session.output_audio.delta", "delta": b64encode(spoken.pcm).decode()})

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
        elif event["type"] in {"session.commentary.append", "session.instructions.append"}:
            primary = event["type"] == "session.commentary.append"
            assert event["event_id"] == (FINISH_TURN_EVENT if primary else FINISH_REMINDER_EVENT)
            self.finished = True
            self.replied = False
            self.quiet_frames = 0
            self.events.put_nowait({"type": event["type"] + "ed", "client_event_id": event["event_id"]})
        elif event["type"] == "session.input_audio.append":
            pcm = b64decode(event["audio"], validate=True)
            self.microphone.append(pcm)
            if any(pcm):
                self.heard = True
                self.quiet_frames = 0
            else:
                self.quiet_frames += 1
            if self.finished and self.heard and not self.replied and self.quiet_frames >= self.silence_frames:
                self.emit(replace(self.spoken, transcript='') if self.reply_attempts else self.spoken)
                self.reply_attempts += 1
                self.replied = True
        elif event["type"] == "session.close":
            self.events.put_nowait({"type": "session.closed", "usage": {"seconds": 4}, "session": {"id": "test"}})


class FakeSavedReadingSocket(FakeLiveSocket):
    async def send(self, raw):
        event = json.loads(raw)
        if event["type"] == "session.instructions.append":
            self.sent.append(event)
            self.events.put_nowait({"type": "session.output_audio.delta", "delta": b64encode(self.spoken.pcm).decode()})
            self.events.put_nowait({"type": "session.output_transcript.delta", "delta": self.spoken.reply,
                                    "start_ms": 500, "end_ms": 800})
        elif event["type"] == "session.close":
            self.sent.append(event)
            self.events.put_nowait({"type": "session.closed", "reason": "close_requested",
                                    "usage": {"seconds": 3.4}, "session": {"id": "test"}})
        else:
            await super().send(raw)


@pytest.mark.parametrize("language,text,transcript,match", [
    ("en", "What do you remember?", "what do you remember", True),
    ("sv", "Vad minns du från Vänern?", "Vad minns du från Vänern?", True),
    ("sv", "Vad minns du från Vänern?", "Vad minns du från Vättern?", False),
])
def test_saved_reply_uses_the_live_voice_and_checks_the_entire_utterance(language, text, transcript, match):
    async def scenario():
        socket = FakeSavedReadingSocket(SpokenTurn("", transcript, PCM))
        calls = []
        governor = SimpleNamespace(
            reserve_live_audio=lambda op, seconds: calls.append(("reserve", op, seconds)) or "one",
            settle=lambda *args, **kwargs: calls.append(("settle", args, kwargs)),
        )
        provider = LiveTalkProvider(SecretStr("test"), governor, voice_id="voice_minna_test",
                                    connector=lambda *_args, **_kwargs: socket)
        if match:
            audio = await provider.synthesize(text, language)
            assert audio.voice == "voice_minna_test" and audio.model == LIVE_MODEL
            with wave.open(BytesIO(audio.data), "rb") as wav:
                assert wav.readframes(wav.getnframes()) == PCM
        else:
            with pytest.raises(APIError) as rejected:
                await provider.synthesize(text, language)
            assert rejected.value.code == "AI_SPEECH_INVALID_RESPONSE"
        start = socket.sent[0]["session"]
        assert start["audio"]["output"]["voice"] == {"id": "voice_minna_test"} and start["store"] is False
        assert json.loads(start["input"][0]["content"][0]["text"]) == {"saved_reply": text, "language": language}
        assert socket.microphone and all(frame == bytes(len(frame)) for frame in socket.microphone)
        commands = [item["content"] for item in socket.sent if item["type"] == "session.instructions.append"]
        assert len(commands) == 1 and text in commands[0]
        assert calls == [("reserve", "speech_synthesis", 25),
                         ("settle", ("one", "speech_synthesis", LIVE_MODEL, {"seconds": 3.4}),
                          {"status": "completed" if match else "failed"})]

    asyncio.run(scenario())


@pytest.mark.parametrize("language,prompt_fragment", [
    ("en", "Speak natural English"),
    ("sv", "Svara på naturlig svenska"),
])
@pytest.mark.parametrize("voice_id,selected_voice", [(None, "coral"), ("voice_minna_test", {"id": "voice_minna_test"})])
def test_live_speech_streams_the_selected_voice_with_the_same_reservation(language, prompt_fragment, voice_id, selected_voice):
    async def scenario():
        spoken = replace(SPOKEN[language], pcm=voiced_pcm())
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
            yield None

        async def ready():
            events.append("ready")

        async def voice(pcm):
            assert not any(event["type"] == "session.close" for event in socket.sent)
            events.append(pcm)

        provider = LiveTalkProvider(SecretStr("test"), governor, voice_id=voice_id, connector=connect)
        result = await provider.talk([], mic(), ready, voice, language=language)
        assert result.transcript == spoken.transcript and result.reply == spoken.reply
        assert result.pcm == b"".join(events[2:-1]) == spoken.pcm
        assert len(result.pcm) == len(spoken.pcm)
        assert events[:2] == [("reserved", LIVE_SECONDS + 5), "ready"]
        assert events[-1] == ("settled", ("one", "conversation", LIVE_MODEL, {"seconds": 4}), {"status": "completed"})
        setup = socket.sent[0]["session"]
        assert setup["model"] == LIVE_MODEL and setup["audio"]["output"]["voice"] == selected_voice and not setup["store"]
        assert "clearly feminine voice" in setup["instructions"] and "light, natural Swedish accent" in setup["instructions"]
        assert prompt_fragment in setup["instructions"]

    asyncio.run(scenario())
    assert observed_cost_microusd("conversation", LIVE_MODEL, {"seconds": 60}, "completed", None) == 62_501
    assert live_talk_ceiling_microusd(80) == 83_336


@pytest.mark.parametrize("language,short_phrase", [("sv", "Vid sjön."), ("en", "By the lake.")])
def test_finishing_a_quiet_short_phrase_keeps_the_provider_open_for_an_immediate_reply(language, short_phrase):
    async def scenario():
        spoken = replace(SPOKEN[language], transcript=short_phrase, pcm=voiced_pcm())
        socket = FakeLiveSocket(spoken, silence_frames=8)
        quiet_phrase = b"\x50\x00" * 2_400
        played = []

        async def microphone():
            yield quiet_phrase
            yield None

        async def on_voice(pcm):
            assert not any(event["type"] == "session.close" for event in socket.sent)
            played.append(pcm)

        provider = LiveTalkProvider(SecretStr("test"), None)
        turn, _ = await provider._exchange(socket, "test", microphone(), on_voice, language=language)
        assert turn.transcript == short_phrase and turn.reply == spoken.reply
        assert turn.pcm == b"".join(played) and len(turn.pcm) == len(spoken.pcm)
        assert socket.microphone[0] == quiet_phrase
        assert len(socket.microphone[1:]) >= 8
        assert all(frame == bytes(4_800) for frame in socket.microphone[1:])

    asyncio.run(scenario())


def test_live_talk_keeps_the_whole_turn_and_discards_audio_until_done_is_acknowledged():
    async def scenario():
        early = SpokenTurn("Jag gick", "För tidigt.", b"\x00\x10" * 240)
        final = SpokenTurn(" hem och hämtade syster.", "Vad hände när ni kom tillbaka?", PCM)
        listened_during_pause = asyncio.Event()
        played = []

        class InterruptingSocket(FakeLiveSocket):
            async def send(self, raw):
                event = json.loads(raw)
                if event['type'] == 'session.commentary.append':
                    # Even audio arriving after the button but before the model
                    # receives the release cue still belongs to an old reply.
                    self.emit(SpokenTurn("", "Fortfarande för tidigt.", early.pcm))
                await super().send(raw)

            async def recv(self):
                result = await super().recv()
                if json.loads(result).get('delta') == b64encode(early.pcm).decode():
                    listened_during_pause.set()
                return result

        socket = InterruptingSocket(final, silence_frames=1)
        second_phrase = b"\x00\x04" * 240

        async def microphone():
            yield PCM
            yield bytes(len(PCM))
            socket.emit(early)
            await listened_during_pause.wait()
            assert not played and not socket.finished
            yield second_phrase
            yield None

        async def on_voice(pcm):
            assert socket.finished
            played.append(pcm)

        provider = LiveTalkProvider(SecretStr("test"), None)
        turn, _ = await asyncio.wait_for(provider._exchange(socket, "test", microphone(), on_voice, language='sv'), timeout=4)
        assert turn == SpokenTurn(early.transcript + final.transcript, final.reply, final.pcm)
        assert played == [final.pcm]
        assert socket.microphone[:3] == [PCM, bytes(len(PCM)), second_phrase]
        assert socket.microphone[3:3 + FINAL_INPUT_FRAMES] == [bytes(4_800)] * FINAL_INPUT_FRAMES
        names = [item['type'] for item in socket.sent]
        assert names[:4 + FINAL_INPUT_FRAMES] == ['session.input_audio.append'] * (3 + FINAL_INPUT_FRAMES) + ['session.commentary.append']

    asyncio.run(scenario())


@pytest.mark.parametrize('fragment', ['', 'That'])
def test_live_session_cues_once_more_if_the_first_reply_is_missing_or_stalled(monkeypatch, fragment):
    monkeypatch.setattr('app.services.live_talk.FINISH_REMINDER_AFTER', 0.05)

    class SilentUntilReminder(FakeLiveSocket):
        async def send(self, raw):
            event = json.loads(raw)
            if event['type'] == 'session.commentary.append':
                self.sent.append(event)
                self.events.put_nowait({'type': 'session.commentary.appended', 'client_event_id': FINISH_TURN_EVENT})
                if fragment:
                    self.emit(SpokenTurn('', fragment, b'\x00\x20' * 240))
            elif event['type'] == 'session.instructions.append':
                self.sent.append(event)
                self.finished = True
                self.events.put_nowait({'type': 'session.instructions.appended', 'client_event_id': FINISH_REMINDER_EVENT})
            else:
                await super().send(raw)

    async def scenario():
        socket = SilentUntilReminder(SPOKEN['en'])
        played = []

        async def microphone():
            yield PCM
            yield None

        async def on_voice(pcm):
            played.append(pcm)

        provider = LiveTalkProvider(SecretStr('test'), None)
        result, _ = await provider._exchange(socket, 'test', microphone(), on_voice, language='en')
        assert result == SPOKEN['en'] and played == [result.pcm]
        assert [event.get('event_id') for event in socket.sent if event.get('event_id')] == [FINISH_TURN_EVENT, FINISH_REMINDER_EVENT]

    asyncio.run(scenario())


def test_one_word_fragments_never_play_or_replace_the_original_words(monkeypatch):
    monkeypatch.setattr('app.services.live_talk.FINISHED_REPLY_TIMEOUT', 1.2)
    monkeypatch.setattr('app.services.live_talk.FINISH_REMINDER_AFTER', 0.05)

    async def scenario():
        spoken = SpokenTurn(SPOKEN['en'].transcript, 'That', PCM)
        socket = FakeLiveSocket(spoken)

        async def mic():
            yield PCM
            yield None

        async def voice(_pcm):
            pytest.fail('One-word audio reached the listener')

        result, _ = await LiveTalkProvider(SecretStr('test'), None)._exchange(socket, 'test', mic(), voice, language='en')
        assert result == SpokenTurn(spoken.transcript, '', b'')

    asyncio.run(scenario())


def test_first_audio_is_preserved_when_reply_caption_arrives_in_two_parts():
    full = SpokenTurn('I fell from my bicycle.', 'That sounds like a sudden fall.', PCM * 2)

    class SplitCaptionSocket(FakeLiveSocket):
        tail_delivered = False

        def emit(self, spoken):
            super().emit(SpokenTurn(spoken.transcript, 'That', PCM))
            super().emit(SpokenTurn('', ' sounds like a sudden fall.', PCM))

        async def recv(self):
            raw = await super().recv()
            if json.loads(raw).get('delta') == ' sounds like a sudden fall.':
                self.tail_delivered = True
            return raw

    async def scenario():
        socket = SplitCaptionSocket(full)
        played = []

        async def mic():
            yield PCM
            yield None

        async def voice(pcm):
            assert socket.tail_delivered
            played.append(pcm)

        result, _ = await LiveTalkProvider(SecretStr('test'), None)._exchange(socket, 'test', mic(), voice, language='en')
        assert result == full and b''.join(played) == full.pcm

    asyncio.run(scenario())


def test_live_does_not_pad_over_a_pause_already_sent_before_done():
    async def scenario():
        socket = FakeLiveSocket(SPOKEN['en'])

        async def mic():
            yield PCM
            for _ in range(FINAL_INPUT_FRAMES):
                yield bytes(4_800)
                await asyncio.sleep(0.01)
            yield None

        async def voice(_pcm):
            pass

        result, _ = await LiveTalkProvider(SecretStr('test'), None)._exchange(socket, 'test', mic(), voice, language='en')
        assert result == SPOKEN['en']
        types = [event['type'] for event in socket.sent]
        assert types.index('session.commentary.append') == FINAL_INPUT_FRAMES + 1

    asyncio.run(scenario())


@pytest.mark.parametrize("explicit_stop", [False, True])
def test_empty_stop_or_disconnect_cannot_trigger_a_spoken_reply(explicit_stop):
    async def scenario():
        socket = FakeLiveSocket(SPOKEN["en"])

        async def microphone():
            if explicit_stop:
                yield None
            else:
                yield PCM
                socket.emit(SPOKEN['en'])  # An unsubmitted turn must leave no saved result.

        async def on_voice(_pcm):
            pytest.fail("Live Talk spoke before the user sent audio")

        provider = LiveTalkProvider(SecretStr("test"), None)
        turn, _ = await provider._exchange(socket, "test", microphone(), on_voice, language='en')
        assert not turn.transcript and not turn.reply and not turn.pcm
        assert socket.microphone == ([] if explicit_stop else [PCM])
        assert not socket.finished

    asyncio.run(scenario())


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
        mark_ai_dispatched()
        await ready()
        assert await anext(microphone) == PCM
        await voice(b'\x00\x10' * 240)  # The relay must suppress premature output too.
        assert await anext(microphone) is None
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
        ws.send_text('stop')
        assert ws.receive_bytes() == PCM
        assert ws.receive_json() == {"type": "saving"}
        saved = ws.receive_json()
        speech = next(row["result"] for row in gateway.claims.values() if row["kind"] == "speech")
        cache_id = speech_cache_id(UUID(speech["speech_id"]), True, language)
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


def test_socket_never_saves_a_model_reply_without_done(mounted_live):
    app, gateway, _ = mounted_live
    key = uuid4()

    async def premature_reply(_history, microphone, ready, voice, *, language):
        await ready()
        assert await anext(microphone) == PCM
        await voice(PCM)
        return SPOKEN[language]

    app.state.real_ai.live_talk_provider.talk = premature_reply
    with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
        ws.send_json({"token": "test", "key": str(key)})
        assert ws.receive_json()["type"] == "operation"
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(PCM)
        assert ws.receive_json() == {"type": "error", "code": "LIVE_TALK_NOT_SUBMITTED"}
    claim = gateway.claims[("transcription", key)]
    assert claim['status'] == 'failed' and claim['result'] is None and len(gateway.claims) == 1
    assert claim['error_code'] == 'LIVE_TALK_NOT_SUBMITTED'


@pytest.mark.parametrize("write_started,expected_status", [(False, "failed"), (True, "uncertain")])
def test_interrupted_live_turn_publishes_its_persistence_state_before_the_error(mounted_live, write_started, expected_status):
    app, gateway, _ = mounted_live
    key = uuid4()

    async def interrupted_talk(_history, microphone, ready, _voice, *, language):
        mark_ai_dispatched()
        await ready()
        assert await anext(microphone) == PCM
        raise LiveTalkError()

    async def interrupted_save(_claim, _payload, _provenance):
        raise LiveTalkError()

    if write_started:
        gateway.complete = interrupted_save
    else:
        app.state.real_ai.live_talk_provider.talk = interrupted_talk
    with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
        ws.send_json({"token": "test", "key": str(key)})
        assert ws.receive_json()["type"] == "operation"
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(PCM)
        if write_started:
            ws.send_text('stop')
            assert ws.receive_bytes() == PCM
            assert ws.receive_json() == {"type": "saving"}
        assert ws.receive_json() == {"type": "error", "code": "LIVE_TALK_INCOMPLETE"}
        assert gateway.claims[("transcription", key)]["status"] == expected_status
        assert len(gateway.claims) == 1


def test_no_speech_keeps_its_exact_failure_code_without_saving_an_empty_transcript(mounted_live):
    app, gateway, _ = mounted_live
    key = uuid4()

    async def no_speech(_history, microphone, ready, _voice, *, language):
        await ready()
        assert await anext(microphone) == PCM
        assert await anext(microphone) is None
        return SpokenTurn('', '', b'')

    app.state.real_ai.live_talk_provider.talk = no_speech
    with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
        ws.send_json({"token": "test", "key": str(key)})
        assert ws.receive_json()["type"] == "operation"
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(PCM)
        ws.send_text('stop')
        assert ws.receive_json() == {"type": "error", "code": "LIVE_TALK_NO_SPEECH"}
    claim = gateway.claims[("transcription", key)]
    assert claim['status'] == 'failed' and claim['error_code'] == 'LIVE_TALK_NO_SPEECH'
    assert claim['result'] is None and len(gateway.claims) == 1


def test_provider_failures_log_only_safe_phase_information(mounted_live, caplog):
    app, gateway, _ = mounted_live
    key = uuid4()

    async def disconnected(_history, microphone, ready, _voice, *, language):
        await ready()
        assert await anext(microphone) == PCM
        raise LiveTalkError('provider_connection_closed')

    app.state.real_ai.live_talk_provider.talk = disconnected
    with caplog.at_level('INFO', logger='uvicorn.error'):
        with TestClient(app) as client, client.websocket_connect(PATH, headers={"Origin": PREVIEW}) as ws:
            ws.send_json({"token": "test", "key": str(key)})
            ws.receive_json()
            ws.receive_json()
            ws.send_bytes(PCM)
            assert ws.receive_json() == {"type": "error", "code": "LIVE_TALK_INCOMPLETE"}
    assert 'reason=provider_connection_closed' in caplog.text
    assert 'submitted=False' in caplog.text and 'saving=False' in caplog.text
    assert str(key) not in caplog.text and SPOKEN['sv'].transcript not in caplog.text
    assert gateway.claims[("transcription", key)]['status'] == 'failed'


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
