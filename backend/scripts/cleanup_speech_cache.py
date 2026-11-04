"""Sanitized private-cache inventory; deletes nothing without --apply.

Supply settings through the same private server environment used by staging.
This command does not contact Supabase or an AI provider. An authorized operator
must separately approve account/project deletion and its database/backup scope.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402
from app.core.errors import APIError  # noqa: E402
from app.services.encrypted_speech_cache import EncryptedSpeechCache  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--owner", type=UUID, help="Inventory/clean only this authorized owner's prepared audio.")
    scope.add_argument("--expired", action="store_true", help="Clean expired ciphertext only.")
    parser.add_argument("--apply", action="store_true", help="Apply the explicitly scoped cleanup; default is read-only.")
    args = parser.parse_args(argv)
    if args.apply and args.owner is None and not args.expired:
        parser.error("--apply requires --owner or --expired")
    try:
        settings = Settings()
        path, key = settings.real_ai_speech_storage_path, settings.real_ai_speech_encryption_key
        if path is None or not path.is_file() or key is None:
            print(json.dumps({"status": "not_configured", "deleted": False}))
            return 1
        cache = EncryptedSpeechCache(path, key.get_secret_value(),
            ttl=settings.real_ai_speech_retention_seconds, max_bytes=settings.real_ai_speech_max_bytes)
        result = {"status": "ok", "mode": "apply" if args.apply else "inventory",
                  "scope": "owner" if args.owner is not None else "expired" if args.expired else "all",
                  "before": cache.inventory(args.owner), "deleted_count": 0}
        if args.apply:
            result["deleted_count"] = cache.purge_owner(args.owner) if args.owner is not None else cache.purge_expired()
        result["after"] = cache.inventory(args.owner)
        cache.close()
        print(json.dumps(result, sort_keys=True))
        return 0
    except (APIError, ValueError, OSError):
        print(json.dumps({"status": "unavailable", "deleted": "unknown" if args.apply else False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
