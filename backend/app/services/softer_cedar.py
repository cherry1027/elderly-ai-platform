"""Apply Minna's approved Cedar sound while keeping verified 24 kHz PCM streamable."""

import asyncio
from threading import Lock

import numpy as np
import parselmouth
from parselmouth.praat import call

SAMPLE_RATE = 24_000
PACKET_BYTES = SAMPLE_RATE // 2  # 250 ms of mono, signed 16-bit PCM.
_HOP = PACKET_BYTES // 2
_OVERLAP = 1_200  # 50 ms of crossfade and lookahead.
_WINDOW = _HOP + _OVERLAP
_FADE = np.linspace(0.0, 1.0, _OVERLAP, endpoint=False)
_PRAAT_LOCK = Lock()
_PITCH_FLOOR, _PITCH_CEILING = 65.0, 425.0
_FORMANTS, _PITCH_SCALE, _PITCH_RANGE = 1.12, 1.25, 0.86


class SofterCedar:
    """A per-reply filter. Every emitted packet is also used for the replay WAV."""

    def __init__(self):
        self._pending = bytearray()
        self._tail = None

    async def push(self, pcm: bytes, *, final: bool = False) -> tuple[bytes, ...]:
        return await asyncio.to_thread(self._push, pcm, final)

    def _push(self, pcm: bytes, final: bool) -> tuple[bytes, ...]:
        if len(pcm) % 2:
            raise ValueError("Cedar input must contain whole PCM samples")
        self._pending.extend(pcm)
        packets = []
        while len(self._pending) >= 2 * _WINDOW:
            values = self._shape(bytes(self._pending[:2 * _WINDOW]))
            self._join(values)
            packets.append(self._pcm16(values[:_HOP]))
            self._tail = values[_HOP:]
            del self._pending[:PACKET_BYTES]
        if final and self._pending:
            if self._tail is not None and len(self._pending) == 2 * _OVERLAP:
                values = self._tail
            else:
                values = self._shape(bytes(self._pending))
                self._join(values)
            packets.extend(self._pcm16(values[start:start + _HOP]) for start in range(0, len(values), _HOP))
            self._pending.clear()
            self._tail = None
        return tuple(packets)

    def _join(self, values):
        if self._tail is not None:
            length = min(len(values), _OVERLAP)
            fade = _FADE[:length]
            values[:length] = self._tail[:length] * (1.0 - fade) + values[:length] * fade

    def _shape(self, pcm):
        values = np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0
        if len(values) < _OVERLAP or float(np.max(np.abs(values))) < 0.004:
            return values
        with _PRAAT_LOCK:
            sound = parselmouth.Sound(values, SAMPLE_RATE)
            pitch = sound.to_pitch(pitch_floor=_PITCH_FLOOR, pitch_ceiling=_PITCH_CEILING)
            frequencies = pitch.selected_array["frequency"]
            voiced = frequencies[frequencies > 0]
            if len(voiced) < 3:
                return values  # Keep breaths and unvoiced consonants intact.
            median = float(np.median(voiced))
            shaped = call([sound, pitch], "Change gender", _FORMANTS, median * _PITCH_SCALE, _PITCH_RANGE, 1.0)
            if shaped.sampling_frequency != SAMPLE_RATE:
                shaped = shaped.resample(SAMPLE_RATE, precision=50)
            output = shaped.values[0].copy()
        if not len(output) or abs(len(output) - len(values)) > 3 or not np.isfinite(output).all():
            raise ValueError("Cedar processing returned invalid audio")
        if len(output) < len(values):
            output = np.pad(output, (0, len(values) - len(output)))
        output = output[:len(values)]
        output_rms = float(np.sqrt(np.mean(output ** 2)))
        if output_rms > 0:
            output *= min(float(np.sqrt(np.mean(values ** 2))) / output_rms, 1.8)
        return output

    @staticmethod
    def _pcm16(values):
        return np.rint(np.clip(values, -0.999, 0.999) * 32768.0).astype("<i2").tobytes()
