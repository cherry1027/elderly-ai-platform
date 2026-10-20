"""Start a private, mock-only development API; LAN exposure is explicit opt-in."""

import argparse
import sys
from pathlib import Path

import uvicorn

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from scripts.verify_two_users import DEV_SUPABASE_URL  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan", action="store_true", help="Expose port on trusted local network interfaces (no public hosting).")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("Use a non-privileged port between 1024 and 65535.")
    try:
        settings = Settings()
        if not settings.supabase_configured or str(settings.supabase_url).rstrip("/") != DEV_SUPABASE_URL:
            raise ValueError
    except Exception:
        print("Refusing to start: configure only the dedicated Memy development Supabase project.", file=sys.stderr)
        return 2
    # These modes contain no external AI implementation. Transcription stays
    # disabled; fictional audio is confined to the acceptance harness.
    settings = settings.model_copy(update={"conversation_mode": "mock", "story_generation_mode": "mock"})
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    if args.lan:
        print("Trusted LAN only: use http://<this-computer-LAN-IP>:" + str(args.port))
        print("Do not port-forward, expose publicly, or use real personal recordings.")
    else:
        print(f"Local API: http://127.0.0.1:{args.port}")
    print("Conversation/story are fictional mocks; live transcription is disabled. Stop with Ctrl+C.")
    uvicorn.run(create_app(settings), host=host, port=args.port, access_log=False,
                proxy_headers=False, limit_concurrency=32, timeout_keep_alive=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
