"""Fail-closed spending approval and a durable, single-host attempt governor.

This reserves an administrator-chosen cost *ceiling*, not measured provider billing.
It is only suitable for an explicitly opted-in evaluation on one host sharing one
private ledger. It is not a distributed or universal upstream spending hard cap.
Reserve once before EVERY paid HTTP attempt, including retries. Reservations are
never refunded: a timeout, cancellation or provider failure can still be charged.
Do not delete/replace the ledger to reset a still-active approval.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from app.core.errors import APIError


SUPPORTED_AI_OPERATIONS = frozenset({
    "transcription", "conversation", "memory_extraction", "story_writer", "story_verifier",
})
_APPROVAL_FIELDS = frozenset({
    "approval_id", "approved_by", "expires_at", "max_calls", "max_calls_per_minute",
    "budget_microusd", "reserve_per_call_microusd", "allowed_models",
})
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
_SAFE_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}\Z")
_MAX_INTEGER = 2**53 - 1
_APPLICATION_ID = 0x4D454D59
_SCHEMA_VERSION = 1


def _not_approved() -> APIError:
    return APIError(503, "AI_SPENDING_NOT_APPROVED", "Live AI spending is not approved.")


def _unavailable() -> APIError:
    return APIError(503, "AI_USAGE_UNAVAILABLE", "Live AI usage controls are unavailable.")


@dataclass(frozen=True)
class _Approval:
    approval_id: str
    digest: str
    expires_at: float
    max_calls: int
    max_calls_per_minute: int
    budget_microusd: int
    reserve_per_call_microusd: int
    allowed_models: frozenset[str]


def _private_parent(path: Path) -> None:
    """Reject indirection and shared directories; never create broad directories."""
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "getuid"):
        raise ValueError("Private control files need reviewed POSIX enforcement")
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("Unsafe control path")
    for directory in reversed(path.parents):
        if stat.S_ISLNK(directory.lstat().st_mode):
            raise ValueError("Linked control directory")
    parent = path.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError("Control directory must be private")


def _private_file(info: os.stat_result) -> None:
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
        or info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise ValueError("Control file must be private and unlinked")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate approval field")
        result[key] = value
    return result


def _load_approval(path: Path | None) -> _Approval:
    if path is None:
        raise _not_approved()
    descriptor: int | None = None
    try:
        _private_parent(path)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        _private_file(info)
        if info.st_size > 16_384:
            raise ValueError("Approval too large")
        with os.fdopen(descriptor, "r", encoding="utf-8") as source:
            descriptor = None
            raw = source.read(16_385)
            if len(raw) > 16_384:
                raise ValueError("Approval too large")
            data = json.loads(raw, object_pairs_hook=_unique_object)
        if not isinstance(data, dict) or set(data) != _APPROVAL_FIELDS:
            raise ValueError("Unexpected approval fields")
        approval_id, approved_by = data["approval_id"], data["approved_by"]
        if not isinstance(approval_id, str) or not _SAFE_ID.fullmatch(approval_id):
            raise ValueError("Invalid approval identity")
        if (not isinstance(approved_by, str) or not 1 <= len(approved_by) <= 120
            or approved_by != approved_by.strip() or any(ord(c) < 32 for c in approved_by)):
            raise ValueError("Missing approval author")
        expiry = data["expires_at"]
        if not isinstance(expiry, str) or len(expiry) > 40:
            raise ValueError("Invalid approval expiry")
        parsed = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
            raise ValueError("Approval expiry must explicitly use UTC")
        for field in ("max_calls", "max_calls_per_minute", "budget_microusd", "reserve_per_call_microusd"):
            if type(data[field]) is not int or not 1 <= data[field] <= _MAX_INTEGER:
                raise ValueError("Invalid approval limit")
        if data["reserve_per_call_microusd"] > data["budget_microusd"]:
            raise ValueError("A single reservation exceeds approval")
        models = data["allowed_models"]
        if (not isinstance(models, list) or not 1 <= len(models) <= 32
            or any(not isinstance(model, str) or not _SAFE_MODEL.fullmatch(model) for model in models)
            or len(set(models)) != len(models)):
            raise ValueError("Invalid approved models")
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return _Approval(
            approval_id=approval_id,
            digest=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            expires_at=parsed.timestamp(),
            max_calls=data["max_calls"],
            max_calls_per_minute=data["max_calls_per_minute"],
            budget_microusd=data["budget_microusd"],
            reserve_per_call_microusd=data["reserve_per_call_microusd"],
            allowed_models=frozenset(models),
        )
    except (OSError, UnicodeError, ValueError, TypeError, OverflowError, RecursionError):
        raise _not_approved() from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


class AISpendingGovernor:
    """JSON-approved, atomic per-attempt limits across processes/restarts on one host.

    POSIX-only evaluation: unsupported platforms fail closed until separately
    reviewed native file/ACL controls exist. Paths must be absolute, in existing
    private (0700) directories, with regular
    single-link private (0600) files. No environment variable grants approval.
    Approval IDs bind the complete approval document. Changing limits, author,
    expiry or models under an existing ID fails closed; a new written approval
    needs a new ID. Human authorization itself is not authenticated by this file.
    Keep write access restricted to the authorized evaluation administrator.
    """

    def __init__(
        self, approval_path: Path | None, ledger_path: Path,
        *, clock: Callable[[], float] = time.time,
    ) -> None:
        self.approval_path = Path(approval_path) if approval_path is not None else None
        self.ledger_path = Path(ledger_path)
        self._clock = clock
        self._seen_ledger = False
        self._ledger_identity: tuple[int, int] | None = None

    def _now(self) -> float:
        try:
            now = float(self._clock())
        except (OSError, ValueError, TypeError, OverflowError):
            raise _unavailable() from None
        if not math.isfinite(now) or now < 0:
            raise _unavailable()
        return now

    def _connect(self) -> sqlite3.Connection:
        _private_parent(self.ledger_path)
        for suffix in ("-journal", "-wal", "-shm"):
            try:
                sidecar = self.ledger_path.with_name(self.ledger_path.name + suffix).lstat()
            except FileNotFoundError:
                continue
            _private_file(sidecar)
        try:
            descriptor = os.open(self.ledger_path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            if self._seen_ledger:
                raise ValueError("Previously used ledger disappeared") from None
            try:
                descriptor = os.open(self.ledger_path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            except FileExistsError:
                descriptor = os.open(self.ledger_path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(descriptor)
            _private_file(info)
            if self._ledger_identity is not None and self._ledger_identity != (info.st_dev, info.st_ino):
                raise ValueError("Previously used ledger was replaced")
            connection = sqlite3.connect(str(self.ledger_path), timeout=5, isolation_level=None)
            try:
                current = self.ledger_path.lstat()
                _private_file(current)
                if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                    raise ValueError("Control ledger changed while opening")
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("PRAGMA synchronous = FULL")
                connection.execute("PRAGMA trusted_schema = OFF")
                self._seen_ledger = True
                self._ledger_identity = (info.st_dev, info.st_ino)
                return connection
            except Exception:
                connection.close()
                raise
        finally:
            os.close(descriptor)

    @staticmethod
    def _schema(connection: sqlite3.Connection) -> None:
        application_id = connection.execute("PRAGMA application_id").fetchone()[0]
        schema_version = connection.execute("PRAGMA user_version").fetchone()[0]
        if application_id == 0:
            if schema_version != 0 or connection.execute(
                "SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1"
            ).fetchone() is not None:
                raise ValueError("Unrecognized ledger")
            connection.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")
            connection.execute("""CREATE TABLE approvals (
                approval_id TEXT PRIMARY KEY, digest TEXT NOT NULL,
                reserved_calls INTEGER NOT NULL, reserved_microusd INTEGER NOT NULL,
                last_reserved_at REAL NOT NULL
            )""")
            connection.execute("""CREATE TABLE reservations (
                reservation_id TEXT PRIMARY KEY,
                approval_id TEXT NOT NULL REFERENCES approvals(approval_id),
                operation TEXT NOT NULL, model TEXT NOT NULL,
                reserved_at REAL NOT NULL, ceiling_microusd INTEGER NOT NULL
            )""")
            connection.execute("CREATE INDEX reservations_approval_time ON reservations(approval_id,reserved_at)")
        elif application_id != _APPLICATION_ID or schema_version != _SCHEMA_VERSION:
            raise ValueError("Unsupported ledger")

    def reserve(self, operation: str, model: str) -> str:
        """Commit a conservative reservation before one paid network attempt."""
        approval = _load_approval(self.approval_path)
        if (not isinstance(operation, str) or operation not in SUPPORTED_AI_OPERATIONS
            or not isinstance(model, str) or model not in approval.allowed_models):
            raise _not_approved()
        if self._now() >= approval.expires_at:
            raise _not_approved()
        connection: sqlite3.Connection | None = None
        try:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            self._schema(connection)
            now = self._now()
            if now >= approval.expires_at:
                raise _not_approved()
            row = connection.execute(
                "SELECT digest,reserved_calls,reserved_microusd,last_reserved_at FROM approvals WHERE approval_id=?",
                (approval.approval_id,),
            ).fetchone()
            if row is None:
                connection.execute("INSERT INTO approvals VALUES (?,?,0,0,0)",
                    (approval.approval_id, approval.digest))
                calls, reserved, last_timestamp = 0, 0, 0.0
            else:
                digest, calls, reserved, last_timestamp = row
                if digest != approval.digest:
                    raise _not_approved()
                if (type(calls) is not int or type(reserved) is not int
                    or calls < 0 or reserved != calls * approval.reserve_per_call_microusd
                    or not isinstance(last_timestamp, (float, int)) or not math.isfinite(last_timestamp)):
                    raise _unavailable()
                actual_calls, actual_reserved = connection.execute(
                    "SELECT count(*),COALESCE(sum(ceiling_microusd),0) FROM reservations WHERE approval_id=?",
                    (approval.approval_id,),
                ).fetchone()
                if (calls, reserved) != (actual_calls, actual_reserved):
                    raise _unavailable()
            if now < last_timestamp:
                raise _unavailable()
            if calls >= approval.max_calls or reserved > approval.budget_microusd - approval.reserve_per_call_microusd:
                raise APIError(429, "AI_USAGE_LIMIT", "The approved live AI usage limit was reached.")
            recent = connection.execute(
                "SELECT count(*) FROM reservations WHERE approval_id=? AND reserved_at>?",
                (approval.approval_id, now - 60),
            ).fetchone()[0]
            if recent >= approval.max_calls_per_minute:
                raise APIError(429, "AI_RATE_LIMIT", "The approved live AI request rate was reached.")
            reservation_id = str(uuid4())
            connection.execute("INSERT INTO reservations VALUES (?,?,?,?,?,?)", (
                reservation_id, approval.approval_id, operation, model, now, approval.reserve_per_call_microusd,
            ))
            connection.execute("""UPDATE approvals SET reserved_calls=?,reserved_microusd=?,last_reserved_at=?
                WHERE approval_id=?""", (calls + 1, reserved + approval.reserve_per_call_microusd,
                now, approval.approval_id))
            connection.execute("COMMIT")
            return reservation_id
        except APIError:
            raise
        except (OSError, sqlite3.Error, ValueError, TypeError, OverflowError):
            raise _unavailable() from None
        finally:
            if connection is not None:
                try:
                    if connection.in_transaction:
                        connection.rollback()
                except sqlite3.Error:
                    pass
                finally:
                    try:
                        connection.close()
                    except sqlite3.Error:
                        pass
