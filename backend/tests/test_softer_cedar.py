"""Offline check of Minna's audio filter and stream boundaries."""

import asyncio
import math
import struct

import numpy as np
import parselmouth

from app.services.softer_cedar import PACKET_BYTES, SAMPLE_RATE, SofterCedar


def voiced_pcm():
    frames = 2 * (PACKET_BYTES // 2) + 137
    samples = []
    for i in range(frames):
        angle = 2 * math.pi * 146 * i / SAMPLE_RATE
        waveform = math.sin(angle) + 0.22 * math.sin(2 * angle) + 0.16 * math.sin(3 * angle)
        samples.append(round(7_000 * waveform))
    return struct.pack(f"<{frames}h", *samples)


def test_softer_cedar_emits_while_audio_arrives_and_preserves_timing():
    original = voiced_pcm()

    async def stream():
        cedar = SofterCedar()
        first = await cedar.push(original[:15_000])
        assert len(first) == 1 and len(first[0]) == PACKET_BYTES
        tail = await cedar.push(original[15_000:], final=True)
        return first + tail

    packets = asyncio.run(stream())
    assert [len(packet) for packet in packets] == [PACKET_BYTES, PACKET_BYTES, 274]
    filtered = b"".join(packets)
    assert len(filtered) == len(original) and filtered != original
    samples = np.frombuffer(filtered, dtype="<i2").astype(np.float64) / 32768.0
    pitch = parselmouth.Sound(samples, SAMPLE_RATE).to_pitch(pitch_floor=65, pitch_ceiling=425)
    frequencies = pitch.selected_array["frequency"]
    assert 174 <= np.median(frequencies[frequencies > 0]) <= 190


def test_flush_preserves_silence_and_can_continue_after_a_live_pause():
    async def stream():
        cedar = SofterCedar()
        silence = b"\0" * 1_002
        assert await cedar.push(silence) == ()
        assert await cedar.push(b"", final=True) == (silence,)
        assert await cedar.push(b"", final=True) == ()
        assert await cedar.push(silence, final=True) == (silence,)

    asyncio.run(stream())
