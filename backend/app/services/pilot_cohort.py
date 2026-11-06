"""Private closed-pilot admission; never grants spending or changes ownership.

Only the authenticated backend identity is checked. Account UUIDs never enter
public capabilities, errors or logs. Saved reads, edits and PDF access do not
use this additional paid-action admission gate.
"""

import json
import os
from pathlib import Path
import stat
from uuid import UUID

from app.core.errors import APIError
from app.services.ai_controls import _private_parent, _private_file, _unique_object

MAX_COHORT_BYTES = 4096


def unavailable():
    return APIError(503, "AI_PILOT_CONFIG_UNAVAILABLE", "AI pilot access needs operator review.")


def load_cohort(path: Path) -> frozenset[UUID]:
    """Strict bounded read, with the same private POSIX boundary as AI controls.

    This only reads a reviewed list. It never creates users, controls, ledger
    rows, authorization records or provider calls.
    """
    descriptor = None
    try:
        path = Path(path)
        _private_parent(path)
        if stat.S_IMODE(path.parent.stat().st_mode) != 0o700:
            raise ValueError
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        _private_file(info)
        if stat.S_IMODE(info.st_mode) != 0o600 or not 1 <= info.st_size <= MAX_COHORT_BYTES:
            raise ValueError
        with os.fdopen(descriptor, "rb") as source:
            descriptor = None
            raw = source.read(MAX_COHORT_BYTES + 1)
        if len(raw) > MAX_COHORT_BYTES:
            raise ValueError
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
        if (not isinstance(data, dict) or set(data) != {"version", "approved_by", "user_ids"}
                or type(data["version"]) is not int or data["version"] != 1):
            raise ValueError
        reviewer = data["approved_by"]
        if (not isinstance(reviewer, str) or not 1 <= len(reviewer) <= 120
                or reviewer != reviewer.strip() or any(ord(c) < 32 for c in reviewer)):
            raise ValueError
        users = data["user_ids"]
        if not isinstance(users, list) or not 1 <= len(users) <= 5:
            raise ValueError
        if any(not isinstance(user, str) or str(UUID(user)) != user for user in users):
            raise ValueError
        result = frozenset(UUID(user) for user in users)
        if len(result) != len(users):
            raise ValueError
        return result
    except (OSError, ValueError, TypeError, OverflowError, UnicodeError, RecursionError):
        raise unavailable() from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def require_pilot_member(settings, user_id) -> None:
    path = settings.ai_pilot_cohort_path
    if path is None:
        return  # Backwards-compatible local behavior; staging enforces a list.
    members = load_cohort(path)
    try:
        identity = UUID(str(user_id))
    except (ValueError, TypeError, AttributeError):
        raise unavailable() from None
    if identity not in members:
        raise APIError(403, "AI_PILOT_ACCESS_DENIED", "AI testing is not enabled for this account.")
