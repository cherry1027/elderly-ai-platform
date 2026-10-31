"""Private numeric provider-usage evidence, separate from spending reservations.

This never stores prompts, responses, credentials, user/story IDs or provider
error bodies. Usage-derived estimates are not provider invoices. Unknown or
failed attempts retain their conservative reservation in the spending ledger.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
try:
    import fcntl
except ImportError:  # Offline/mock application imports remain portable.
    fcntl = None
import json
import math
import os
from pathlib import Path
import re
import stat
import time
from uuid import UUID

from app.core.errors import APIError
from app.services.ai_controls import SUPPORTED_AI_OPERATIONS, _private_parent, _private_file, _unique_object


MAX_LOG_BYTES = 1_048_576
MAX_LINE_BYTES = 4_096
MAX_TOKEN_COUNT = 2**53 - 1
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
_TIERS = {"default", "flex", "priority", "fast", "scale", "auto", "ultrafast"}
_TOKEN_FIELDS = {
    "input_tokens", "output_tokens", "total_tokens", "cached_input_tokens",
    "input_audio_tokens", "input_text_tokens", "output_audio_tokens",
    "output_text_tokens", "reasoning_tokens",
}
_EVENT_FIELDS = {"version", "timestamp", "operation", "model", "reservation_id", "status", "service_tier", "usage"}


def _unavailable():
    return APIError(503, "AI_USAGE_UNAVAILABLE", "Live AI usage evidence is unavailable.")


def _token(value):
    return type(value) is int and 0 <= value <= MAX_TOKEN_COUNT


def _seconds(value):
    return type(value) in {int, float} and math.isfinite(value) and 0 <= value <= 86_400


def sanitize_usage(usage):
    """Read only known numeric paths. Unknown/malformed values never get logged."""
    if not isinstance(usage, dict):
        return {}
    result = {key: usage[key] for key in ("input_tokens", "output_tokens", "total_tokens")
              if _token(usage.get(key))}
    if _seconds(usage.get("seconds")):
        result["seconds"] = usage["seconds"]
    for parent in ("input_tokens_details", "input_token_details"):
        details = usage.get(parent)
        if not isinstance(details, dict):
            continue
        for source, target in (("cached_tokens", "cached_input_tokens"),
                               ("audio_tokens", "input_audio_tokens"), ("text_tokens", "input_text_tokens")):
            if _token(details.get(source)):
                result[target] = details[source]
    for parent in ("output_tokens_details", "output_token_details"):
        details = usage.get(parent)
        if not isinstance(details, dict):
            continue
        for source, target in (("audio_tokens", "output_audio_tokens"), ("text_tokens", "output_text_tokens"),
                               ("reasoning_tokens", "reasoning_tokens")):
            if _token(details.get(source)):
                result[target] = details[source]
    return result


def _validate_event(row):
    if (not isinstance(row, dict) or set(row) != _EVENT_FIELDS or type(row["version"]) is not int or row["version"] != 1
        or row["operation"] not in SUPPORTED_AI_OPERATIONS
        or not isinstance(row["model"], str) or not _MODEL.fullmatch(row["model"])
        or row["status"] not in {"completed", "failed"}
        or (row["service_tier"] is not None and row["service_tier"] not in _TIERS)
        or not isinstance(row["usage"], dict)):
        raise ValueError
    stamp = datetime.fromisoformat(row["timestamp"])
    if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError
    if row["reservation_id"] is not None:
        if str(UUID(row["reservation_id"])) != row["reservation_id"]:
            raise ValueError
    for field, value in row["usage"].items():
        if field == "seconds":
            if not _seconds(value):
                raise ValueError
        elif field not in _TOKEN_FIELDS or not _token(value):
            raise ValueError
    return row


class UsageObserver:
    """Append-only, flock-protected POSIX usage log in a private directory."""

    def __init__(self, path: Path, *, clock=time.time):
        self.path = Path(path)
        self.clock = clock
        self._identity = None
        try:
            self._check_parent()
            try:
                info = self.path.lstat()
            except FileNotFoundError:
                return
            self._check_file(info)
            self._identity = (info.st_dev, info.st_ino)
        except (OSError, ValueError, TypeError):
            raise _unavailable() from None

    def _check_parent(self):
        _private_parent(self.path)
        if stat.S_IMODE(self.path.parent.stat().st_mode) != 0o700:
            raise ValueError

    def _check_file(self, info):
        _private_file(info)
        if stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_LOG_BYTES:
            raise ValueError
        if self._identity is not None and self._identity != (info.st_dev, info.st_ino):
            raise ValueError

    def _open(self, *, create=False):
        self._check_parent()
        if fcntl is None:
            raise ValueError
        flags = os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK
        if create:
            flags |= os.O_CREAT
        descriptor = os.open(self.path, flags, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            info = os.fstat(descriptor)
            self._check_file(info)
            current = self.path.lstat()
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                raise ValueError
            self._identity = (info.st_dev, info.st_ino)
            return descriptor, info
        except BaseException:
            os.close(descriptor)
            raise

    @staticmethod
    def _read(descriptor, length):
        raw = os.pread(descriptor, MAX_LOG_BYTES + 1, 0)
        if len(raw) != length or len(raw) > MAX_LOG_BYTES or (raw and not raw.endswith(b"\n")):
            raise ValueError
        rows = []
        for line in raw.splitlines():
            if len(line) > MAX_LINE_BYTES:
                raise ValueError
            rows.append(_validate_event(json.loads(line, object_pairs_hook=_unique_object)))
        ids = [row["reservation_id"] for row in rows if row["reservation_id"] is not None]
        if len(ids) != len(set(ids)):
            raise ValueError
        return rows

    def record(self, operation, model, usage, *, reservation_id=None, status="completed", service_tier=None):
        descriptor = None
        try:
            if reservation_id is not None:
                reservation_id = str(UUID(str(reservation_id)))
            now = self.clock()
            if type(now) not in {int, float} or not math.isfinite(now) or now < 0:
                raise ValueError
            row = _validate_event({"version": 1,
                "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(),
                "operation": operation, "model": model, "reservation_id": reservation_id,
                "status": status, "service_tier": service_tier, "usage": sanitize_usage(usage)})
            encoded = (json.dumps(row, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
            if len(encoded) > MAX_LINE_BYTES:
                raise ValueError
            descriptor, info = self._open(create=True)
            rows = self._read(descriptor, info.st_size)
            if reservation_id is not None:
                for old in rows:
                    if old["reservation_id"] == reservation_id:
                        if {k:v for k,v in old.items() if k != "timestamp"} != {k:v for k,v in row.items() if k != "timestamp"}:
                            raise ValueError
                        return  # Exact duplicate observation cannot double-count billing evidence.
            if info.st_size + len(encoded) > MAX_LOG_BYTES:
                raise ValueError
            pending = memoryview(encoded)
            while pending:
                written = os.write(descriptor, pending)
                if not written:
                    raise OSError
                pending = pending[written:]
            os.fsync(descriptor)
        except (OSError, ValueError, TypeError, KeyError, UnicodeError, OverflowError):
            raise _unavailable() from None
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def __call__(self, operation, model, usage, **metadata):
        self.record(operation, model, usage, **metadata)

    @staticmethod
    def _estimate(row):
        """Conservative public-rate calculation; cached discounts are ignored."""
        usage = row["usage"]
        model = row["model"]
        if model == "gpt-transcribe":
            if "seconds" not in usage:
                return None
            return Decimal(str(usage["seconds"])) / 60 * Decimal("0.0045")
        if "input_tokens" not in usage or "output_tokens" not in usage:
            return None
        if "total_tokens" in usage and usage["input_tokens"] + usage["output_tokens"] != usage["total_tokens"]:
            return None
        if model == "gpt-realtime-2.1-mini":
            # Count every token at the higher audio rate, even text-only input.
            return (Decimal(usage["input_tokens"]) * 10 + Decimal(usage["output_tokens"]) * 20) / 1_000_000
        if model == "gpt-6.1-terra":
            factor = {"default": Decimal(1), "flex": Decimal("0.5"), "priority": Decimal(2), "fast": Decimal(2)}.get(row["service_tier"])
            if factor is None:
                return None
            return factor * (Decimal(usage["input_tokens"]) + Decimal(usage["output_tokens"]) * 5) / 1_000_000
        return None

    def summarize(self, *, reserved_attempts=None, reserve_per_call_usd="0.50"):
        descriptor = None
        try:
            if reserved_attempts is not None and (type(reserved_attempts) is not int or reserved_attempts < 0):
                raise ValueError
            ceiling = Decimal(str(reserve_per_call_usd))
            if not ceiling.is_finite() or ceiling <= 0:
                raise ValueError
            self._check_parent()
            try:
                descriptor, info = self._open()
            except FileNotFoundError:
                if self._identity is not None:
                    raise ValueError
                rows = []
            else:
                rows = self._read(descriptor, info.st_size)
            if reserved_attempts is not None and len(rows) > reserved_attempts:
                raise ValueError
            estimates = [self._estimate(row) for row in rows]
            known = [estimate for estimate in estimates if estimate is not None]
            total = sum(known, Decimal(0))
            totals = {field: sum(row["usage"].get(field, 0) for row in rows) for field in sorted(_TOKEN_FIELDS)}
            totals["seconds"] = sum(row["usage"].get("seconds", 0) for row in rows)
            return {
                "currency": "USD", "provider_usage_observations": len(rows),
                "completed_observations": sum(row["status"] == "completed" for row in rows),
                "failed_observations": sum(row["status"] == "failed" for row in rows),
                "measured_cost_observations": len(known),
                "unmeasured_attempts": (reserved_attempts if reserved_attempts is not None else len(rows)) - len(known),
                "usage_derived_estimate_usd": str(total),
                "estimate_complete": reserved_attempts is not None and reserved_attempts == len(known),
                "reserved_attempts": reserved_attempts,
                "reserved_ceiling_usd": str(ceiling * reserved_attempts) if reserved_attempts is not None else None,
                "reported_usage_totals": totals,
                "billing_basis": "Conservative usage-derived public-rate estimate; not an invoice; cached discounts ignored; VAT/FX/fees excluded.",
            }
        except (OSError, ValueError, TypeError, KeyError, UnicodeError, OverflowError, InvalidOperation):
            raise _unavailable() from None
        finally:
            if descriptor is not None:
                os.close(descriptor)
