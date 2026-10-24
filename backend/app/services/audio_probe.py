"""Isolated decoder subprocess. Never prints file contents or decoder errors."""

import json
import sys
from fractions import Fraction

import av

FORMATS = {".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".webm": "matroska"}
CODECS = {
    ".wav": {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_u8", "pcm_f32le"},
    ".mp3": {"mp3", "mp3float"},
    ".m4a": {"aac", "alac"},
    ".webm": {"opus", "vorbis"},
}


def inspect_audio(path: str, suffix: str) -> float:
    # No URLs or playlist auto-detection. File-like input plus this protocol
    # allowlist prevents the decoder from fetching referenced files/networks.
    av.logging.set_level(av.logging.PANIC)
    with open(path, "rb") as source, av.open(
        source, format=FORMATS[suffix], mode="r",
        options={"protocol_whitelist": "pipe", "enable_drefs": "0"},
    ) as container:
        streams = list(container.streams)
        if len(streams) != 1 or streams[0].type != "audio":
            raise ValueError("Exactly one audio stream is required")
        stream = streams[0]
        stream.codec_context.thread_count = 1
        if stream.codec_context.name not in CODECS[suffix]:
            raise ValueError("Unsupported codec")
        duration = Fraction(0)
        first_timestamp = None
        for frame in container.decode(stream):
            if not 8000 <= frame.sample_rate <= 96000 or len(frame.layout.channels) > 2:
                raise ValueError("Unsupported sample rate or channel count")
            frame_duration = Fraction(frame.samples, frame.sample_rate)
            duration += frame_duration
            if duration > 90:
                raise OverflowError
            if frame.pts is not None and frame.time_base is not None:
                timestamp = frame.pts * frame.time_base
                if first_timestamp is None:
                    first_timestamp = timestamp
                if timestamp - first_timestamp + frame_duration > 90:
                    raise OverflowError
        if duration <= 0:
            raise ValueError("Empty audio")
        return float(duration)


def main() -> int:
    try:
        # CPU is bounded separately from the parent's wall-clock timeout.
        if sys.platform != "win32":
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        # Darwin does not permit lowering RLIMIT_DATA on all runtimes. Linux
        # enforces this additional heap cap; CPU/wall limits apply on both.
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_DATA, (512 * 1024**2, 512 * 1024**2))
        seconds = inspect_audio(sys.argv[1], sys.argv[2])
        print(json.dumps({"duration_seconds": seconds}))
        return 0
    except OverflowError:
        return 3
    except Exception:
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
