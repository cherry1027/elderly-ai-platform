"""Credential-free HTTPS liveness/database/capability smoke check.

Does not sign in, inspect user data, create records or invoke an AI operation.
Suitable for a scheduled external monitor. Exit 1 indicates a service failure;
an intentionally disabled AI capability is reported separately, not as an outage.
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import urlsplit

import httpx


def monitor(origin: str, client: httpx.Client) -> dict:
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment or "*" in origin):
        raise ValueError("HTTPS origin required")
    result = {}
    for name, path in (("health", "/health"), ("database", "/ready"), ("capabilities", "/api/v2/capabilities")):
        try:
            response = client.get(origin.rstrip("/") + path)
            body = response.json()
            if name == "health":
                ok = response.status_code == 200 and body.get("status") == "ok" and body.get("service") == "memy-ai-backend"
            elif name == "database":
                ok = response.status_code == 200 and body.get("database") == "ok"
            else:
                ok = response.status_code == 200 and body.get("contract") == "real-v2" and body.get("mode") == "real"
                if ok:
                    result["ai_enabled"] = body.get("enabled") is True
                    for field in ("transcription", "conversation", "writing", "speech"):
                        result[field] = body.get(field) is True
            result[name] = "ok" if ok else "failed"
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            result[name] = "failed"
    result["service_healthy"] = all(result.get(name) == "ok" for name in ("health", "database", "capabilities"))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    args = parser.parse_args(argv)
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            result = monitor(args.origin, client)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["service_healthy"] else 1
    except ValueError:
        print('{"monitor":"invalid_https_origin"}', file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
