"""Credential-free image/runtime smoke check; never a live-AI or user-data test.

The build runs this as uid/gid 10001. It uses only synthetic bytes and ephemeral
/tmp files. Importing app.main, creating Settings, reading env/dotenv/private
state or invoking any external service is deliberately unnecessary here.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import wave

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))


def check_runtime():
    import av
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from app.services.audio_upload import probe_duration
    from app.services.pdf_export import RealPdfRenderer

    # Verify the decoders the app accepts; no encoder or system ffmpeg is needed.
    for name in ("pcm_s16le", "aac", "alac", "mp3", "opus", "vorbis"):
        av.codec.Codec(name, "r")
    key = AESGCM.generate_key(bit_length=256)
    cipher = AESGCM(key)
    nonce, sample = b"\0" * 12, b"synthetic-image-check"
    if cipher.decrypt(nonce, cipher.encrypt(nonce, sample, b"test"), b"test") != sample:
        raise ValueError("Synthetic encryption check failed")
    with TemporaryDirectory(prefix="memy-image-check-") as directory:
        path = Path(directory) / "synthetic.wav"
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\0\0" * 1600)
        duration = asyncio.run(probe_duration(path, ".wav"))
        if not .09 <= duration <= .11:
            raise ValueError("Synthetic decoder check failed")
    for language, title, content in (
        ("en", "Packaging check", "This is synthetic English text."),
        ("sv", "Paketkontroll", "Detta är syntetisk text med å, ä och ö från Malmö."),
    ):
        document = RealPdfRenderer().render(title=title, content=content, language=language,
            draft_version=1, draft_revision=1, include_title_page=True, include_page_numbers=True)
        if not document.data.startswith(b"%PDF-") or b"%%EOF" not in document.data[-64:] or document.page_count < 1:
            raise ValueError("Synthetic PDF check failed")
    return {"container_runtime_preflight": "ok", "audio_decoders": True,
        "bounded_decoder_subprocess": True, "encrypted_cache_primitive": True,
        "english_swedish_pdf_fonts": True, "network_requests": 0,
        "private_configuration_read": False}


def main():
    try:
        print(json.dumps(check_runtime()), flush=True)
        return 0
    except Exception:
        # Build logs remain safe if the check is reused by an operator.
        print('{"container_runtime_preflight":"failed"}', file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
