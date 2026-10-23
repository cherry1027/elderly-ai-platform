"""Default offline instructions; --run counts only current-user development rows.

No deletes, file writes, story content output, OpenAI calls or service-role keys.
"""

import argparse
import asyncio
import getpass
import json
from pathlib import Path
import re
import sys
import warnings

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.services.auth import authenticate  # noqa: E402
from app.services.privacy_inventory import inventory_visible_data  # noqa: E402
from scripts.verify_two_users import DEV_SUPABASE_URL  # noqa: E402


async def run(settings, token):
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds,
                                 follow_redirects=False, trust_env=False) as client:
        user = await authenticate(settings, client, token)
        return await inventory_visible_data(settings, client, user)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Prompt privately for a development user access token and make read-only requests.")
    args = parser.parse_args(argv)
    if not args.run:
        print(json.dumps({"mode": "offline", "network_calls": 0, "deleted": False,
                          "next_step": "Use --run only with your own authorised development user access token. See docs/day-13-privacy-retention.md."}))
        return 0
    try:
        settings = Settings()
        if (not settings.supabase_configured
                or str(settings.supabase_url).rstrip("/") != DEV_SUPABASE_URL):
            raise ValueError
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            token = getpass.getpass("Development user access token (hidden): ")
        if not 1 <= len(token) <= 16384 or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", token):
            raise ValueError
        result = asyncio.run(run(settings, token))
    except (Exception, KeyboardInterrupt):
        # Neither configuration errors, failed upstream bodies nor exception
        # strings may reveal credentials, story content or private identities.
        print("Privacy inventory unavailable; no deletion was performed.", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
