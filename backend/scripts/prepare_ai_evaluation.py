"""Prepare fictional local TTS audio; no OpenAI request or human voice data.

macOS-only optional fixture builder. Existing files are never overwritten. Other
platforms can record the same fictional references deliberately instead.
"""

from pathlib import Path
import subprocess
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.audio_upload import decoder_environment

REFERENCES = {
    "en": "My name is Ada. I grew up in Malmö. I moved in 1974.",
    "sv": "Jag heter Ada. Jag växte upp i Malmö. Jag flyttade 1974.",
}
VOICES = {"en": "Samantha", "sv": "Alva"}


def prepare(destination: Path) -> list[Path]:
    if sys.platform != "darwin" or not Path("/usr/bin/say").is_file():
        raise RuntimeError("Local speech fixtures need installed macOS voices; record the fictional references instead.")
    if destination.exists():
        raise RuntimeError("Choose a new fixture directory; existing recordings are never overwritten.")
    destination.mkdir(parents=True, mode=0o700)
    results = []
    for language, reference in REFERENCES.items():
        target = destination / f"fictional-{language}.wav"
        subprocess.run(["/usr/bin/say", "-v", VOICES[language], "-r", "140",
                        "--file-format=WAVE", "--data-format=LEI16@16000", "-o", str(target), reference],
                       check=True, capture_output=True, timeout=45, env=decoder_environment())
        target.chmod(0o600)
        results.append(target)
    return results


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args(argv)
    try:
        for target in prepare(args.output_directory):
            print(target)
        print("Fictional synthetic voices only; no transcription or quality evaluation has run.")
    except Exception:
        print("Could not prepare local synthetic recordings; no provider was called.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
