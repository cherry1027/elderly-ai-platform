"""Fail-closed spending approval and a durable, single-host attempt governor.

This reserves a conservative cost ceiling, not measured provider billing. An
optional administrator-reviewed cumulative policy adds request-sized ceilings,
future successful usage settlements, and individual/global pilot limits. Legacy
rows are never rewritten; failed/unknown attempts keep their complete hold.
One host must share one persistent private ledger. This is not a distributed or
universal upstream spending hard cap. Never reset a ledger to renew an approval.
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
from contextvars import ContextVar
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from app.core.errors import APIError


SUPPORTED_AI_OPERATIONS = frozenset({
    "transcription", "conversation", "memory_extraction", "story_writer", "story_verifier", "speech_synthesis",
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

# Set only from a validated backend Auth identity, never a request-body user_id.
ai_budget_subject: ContextVar[str | None] = ContextVar("memy_ai_budget_subject", default=None)


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
        *, clock: Callable[[], float] = time.time, budget_policy_path: Path | None = None,
    ) -> None:
        self.approval_path = Path(approval_path) if approval_path is not None else None
        self.ledger_path = Path(ledger_path)
        self._clock = clock
        self.budget_policy_path = Path(budget_policy_path) if budget_policy_path is not None else None
        self._seen_ledger = False
        self._ledger_identity: tuple[int, int] | None = None
        self._policy_digest: str | None = None

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

    def check_approval(self, models: tuple[str, ...]) -> None:
        """Non-spending preflight. Actual limits are still reserved per request."""
        approval = _load_approval(self.approval_path)
        if self._now() >= approval.expires_at or any(model not in approval.allowed_models for model in models):
            raise _not_approved()

    def _policy(self):
        if self.budget_policy_path is None:
            return None
        from app.services.ai_budget import load_policy
        policy = load_policy(self.budget_policy_path)
        if self._policy_digest is not None and self._policy_digest != policy.digest:
            raise _unavailable()
        self._policy_digest = policy.digest
        return policy

    @staticmethod
    def _require_policy_if_initialized(connection, policy):
        if (policy is None and connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='budget_policies'").fetchone()
            and connection.execute("SELECT 1 FROM budget_policies LIMIT 1").fetchone()):
            raise _unavailable()  # Removing an env path cannot disable cumulative limits.

    @staticmethod
    def _check_policy_limits(policy, totals, ceiling, *, required_calls):
        if totals["global_accounted_microusd"] > policy.global_budget_microusd - ceiling:
            raise APIError(429, "AI_GLOBAL_BUDGET_EXHAUSTED",
                           "The shared AI testing allowance is used up. Saved work is still available.")
        if (totals["user_accounted_microusd"] > policy.per_user_budget_microusd - ceiling
            or totals["user_calls"] + required_calls > policy.per_user_max_calls):
            raise APIError(429, "AI_USER_BUDGET_EXHAUSTED",
                           "Your AI testing allowance is used up. Saved work is still available.")

    def reserve_request(self, operation, model, *, input_bytes, max_output_tokens):
        """Use a bounded text ceiling only under an explicit cumulative policy."""
        ceiling = None
        if self.budget_policy_path is not None:
            from app.services.ai_budget import request_ceiling_microusd
            ceiling = request_ceiling_microusd(model, input_bytes, max_output_tokens)
        return self.reserve(operation, model, _ceiling_microusd=ceiling)

    def reserve_transcription(self, model, seconds):
        ceiling = None
        if self.budget_policy_path is not None:
            if model != "gpt-transcribe":
                raise _not_approved()
            from app.services.ai_budget import transcription_ceiling_microusd
            ceiling = transcription_ceiling_microusd(seconds)
        return self.reserve("transcription", model, _ceiling_microusd=ceiling)

    def check_request_group(self, requests):
        """Check the complete workflow before paying for its first stage.

        Caller holds workflow() until all stages finish. Later reservations stay
        atomic; failures retain their holds. This is a preflight, not a refund
        or an authorization to bypass the current approval.
        """
        if not isinstance(requests, (list, tuple)) or not 1 <= len(requests) <= 10:
            raise _unavailable()
        approval = _load_approval(self.approval_path)
        ceiling = 0
        for item in requests:
            if not isinstance(item, (list, tuple)) or len(item) != 3:
                raise _unavailable()
            model, input_bytes, max_output_tokens = item
            if model not in approval.allowed_models:
                raise _not_approved()
            if self.budget_policy_path is None:
                amount = approval.reserve_per_call_microusd
            else:
                from app.services.ai_budget import request_ceiling_microusd
                amount = request_ceiling_microusd(model, input_bytes, max_output_tokens)
                if amount is None or amount > approval.reserve_per_call_microusd:
                    raise _not_approved()
            ceiling += amount
        self.check_budget(required_calls=len(requests), minimum_microusd=ceiling)

    @contextmanager
    def workflow(self):
        """Serialize an entire multi-call action across one host's processes.

        The application holds this before checking/claiming and through saving
        the result, so parallel extraction steps cannot consume the last calls
        intended for their paired interviewer/writer step. No queue or retry.
        """
        if self._policy() is None:
            yield
            return
        descriptor = None
        try:
            import fcntl
            path = self.ledger_path.with_name(self.ledger_path.name + ".workflow.lock")
            _private_parent(path)
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
            info = os.fstat(descriptor)
            _private_file(info)
            current = path.lstat()
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                raise _unavailable()
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise APIError(429, "AI_BUSY", "Another AI reply is being saved. Try again shortly.") from None
            yield
        except APIError:
            raise
        except (ImportError, OSError, ValueError, TypeError):
            raise _unavailable() from None
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def check_budget(self, *, required_calls=1, minimum_microusd=1):
        """Free preflight; never reserves or releases funds.

        Runtime capabilities can check the global pool without a signed-in user.
        Authenticated actions also check that account's allowance. Request-sized
        ceilings are enforced atomically at dispatch, not guessed by this check.
        """
        if type(required_calls) is not int or not 1 <= required_calls <= 10_000:
            raise _unavailable()
        if type(minimum_microusd) is not int or not 1 <= minimum_microusd <= _MAX_INTEGER:
            raise _unavailable()
        approval = _load_approval(self.approval_path)
        if self._now() >= approval.expires_at:
            raise _not_approved()
        if required_calls > approval.max_calls:
            raise APIError(429, "AI_USAGE_LIMIT", "The approved AI testing allowance is used up. Saved work is still available.")
        if required_calls > approval.max_calls_per_minute:
            raise APIError(429, "AI_RATE_LIMIT", "The approved AI request rate is reached. Try again later.")
        policy = self._policy()
        if minimum_microusd > approval.budget_microusd:
            raise APIError(429, "AI_USAGE_LIMIT", "The approved AI testing allowance is used up. Saved work is still available.")
        try:
            self.ledger_path.lstat()
        except FileNotFoundError:
            if self._seen_ledger or (policy is not None and policy.baseline_ids):
                raise _unavailable() from None
            if policy is not None:
                initial = policy.baseline_exposure_microusd + policy.external_hold_microusd
                if ai_budget_subject.get() is not None:
                    policy.subject(ai_budget_subject.get())
                self._check_policy_limits(policy, {"global_accounted_microusd": initial,
                    "user_accounted_microusd": 0, "user_calls": 0}, minimum_microusd,
                    required_calls=required_calls)
            return
        except OSError:
            raise _unavailable() from None
        connection = None
        try:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            self._schema(connection)
            self._require_policy_if_initialized(connection, policy)
            row = connection.execute("SELECT digest,reserved_calls,reserved_microusd,last_reserved_at FROM approvals WHERE approval_id=?",
                                     (approval.approval_id,)).fetchone()
            calls = reserved = 0
            if row is not None:
                if row[0] != approval.digest:
                    raise _not_approved()
                calls, reserved = row[1:3]
                if self._now() < row[3]:
                    raise _unavailable()
                actual = connection.execute("SELECT count(*),COALESCE(sum(ceiling_microusd),0) FROM reservations WHERE approval_id=?",
                                            (approval.approval_id,)).fetchone()
                if (calls, reserved) != actual:
                    raise _unavailable()
            if calls + required_calls > approval.max_calls:
                raise APIError(429, "AI_USAGE_LIMIT", "The approved AI testing allowance is used up. Saved work is still available.")
            recent = connection.execute("SELECT count(*) FROM reservations WHERE approval_id=? AND reserved_at>?",
                                        (approval.approval_id, self._now() - 60)).fetchone()[0]
            if recent + required_calls > approval.max_calls_per_minute:
                raise APIError(429, "AI_RATE_LIMIT", "The approved AI request rate is reached. Try again later.")
            if policy is not None:
                from app.services.ai_budget import ensure_schema, accounting
                ensure_schema(connection, policy)
                user = ai_budget_subject.get()
                subject = policy.subject(user) if user is not None else None
                totals = accounting(connection, policy, subject, approval.approval_id)
                # Free preflight requires positive headroom; exact request ceiling
                # is only known after assembling bounded provider input.
                self._check_policy_limits(policy, totals, minimum_microusd, required_calls=required_calls)
                reserved = totals["approval_accounted_microusd"]
            if reserved > approval.budget_microusd - minimum_microusd:
                raise APIError(429, "AI_USAGE_LIMIT", "The approved AI testing allowance is used up. Saved work is still available.")
            connection.execute("COMMIT")
        except APIError:
            raise
        except (OSError, sqlite3.Error, ValueError, TypeError, OverflowError):
            raise _unavailable() from None
        finally:
            if connection is not None:
                if connection.in_transaction:
                    connection.rollback()
                connection.close()

    def settle(self, reservation_id, operation, model, usage, *, status, service_tier=None):
        """Append one auditable numeric settlement, never edit a reservation.

        Disabled for legacy fixed-reservation evaluations. Failed/unknown usage
        keeps its full reservation. Cost above the ceiling is recorded in full
        and all future dispatches fail closed until an administrator reviews it.
        """
        policy = self._policy()
        if policy is None:
            return
        from app.services.ai_budget import ensure_schema, observed_cost_microusd
        from app.services.ai_usage import sanitize_usage
        amount = observed_cost_microusd(operation, model, usage, status, service_tier)
        if amount is None:
            return
        evidence = hashlib.sha256(json.dumps({"operation": operation, "model": model,
            "usage": sanitize_usage(usage), "status": status, "service_tier": service_tier},
            sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        connection = None
        try:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            self._schema(connection)
            self._require_policy_if_initialized(connection, policy)
            ensure_schema(connection, policy)
            row = connection.execute("SELECT operation,model,ceiling_microusd FROM reservations WHERE reservation_id=?",
                                     (reservation_id,)).fetchone()
            if row is None or row[:2] != (operation, model):
                raise _unavailable()
            # Never use a new policy as permission to discount historical holds.
            if connection.execute("SELECT 1 FROM reservation_subjects WHERE reservation_id=?", (reservation_id,)).fetchone() is None:
                raise _unavailable()
            old = connection.execute("SELECT accounted_microusd,evidence_digest FROM usage_settlements WHERE reservation_id=?",
                                     (reservation_id,)).fetchone()
            if old is not None and old != (amount, evidence):
                raise _unavailable()
            connection.execute("INSERT OR IGNORE INTO usage_settlements VALUES (?,?,?)", (reservation_id, amount, evidence))
            connection.execute("COMMIT")
            if amount > row[2]:
                raise _unavailable()
        except APIError:
            raise
        except (OSError, sqlite3.Error, ValueError, TypeError, OverflowError):
            raise _unavailable() from None
        finally:
            if connection is not None:
                if connection.in_transaction:
                    connection.rollback()
                connection.close()

    def review_transcription_rounding(self, reservation_id, observation, *, reviewed_by):
        """Explicit administrative acknowledgement of one measured tiny overrun.

        This is never called from provider or API request handling. It requires
        the original numeric usage observation and cannot discount any amount,
        release a remote hold, renew approval or raise an individual/global cap.
        The complete higher settled amount continues to count against limits.
        """
        policy = self._policy()
        if policy is None:
            raise _unavailable()
        from app.services.ai_budget import ensure_schema, observed_cost_microusd
        from app.services.ai_usage import _validate_event, sanitize_usage
        try:
            event = _validate_event(observation)
            seconds = event["usage"].get("seconds")
            if (not isinstance(reviewed_by, str) or not _SAFE_ID.fullmatch(reviewed_by)
                or event["reservation_id"] != reservation_id or event["status"] != "completed"
                or event["operation"] != "transcription" or event["model"] != "gpt-transcribe"
                or type(seconds) not in {int, float} or not 0 < seconds <= 91
                or seconds != math.ceil(seconds)):
                raise ValueError
            amount = observed_cost_microusd(event["operation"], event["model"], event["usage"],
                                           event["status"], event["service_tier"])
            if amount is None:
                raise ValueError
            evidence = hashlib.sha256(json.dumps({"operation": event["operation"], "model": event["model"],
                "usage": sanitize_usage(event["usage"]), "status": event["status"], "service_tier": event["service_tier"]},
                sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        except (ValueError, TypeError, KeyError, OverflowError):
            raise _unavailable() from None
        connection = None
        try:
            with self.workflow():
                connection = self._connect()
                connection.execute("BEGIN IMMEDIATE")
                self._schema(connection)
                ensure_schema(connection, policy)
                row = connection.execute("""SELECT r.operation,r.model,r.ceiling_microusd,s.accounted_microusd,s.evidence_digest
                    FROM reservations r JOIN usage_settlements s USING(reservation_id)
                    JOIN reservation_subjects u USING(reservation_id) WHERE r.reservation_id=?""", (reservation_id,)).fetchone()
                if (row is None or row[:2] != ("transcription", "gpt-transcribe")
                    or row[3:] != (amount, evidence) or not 0 < amount - row[2] <= 190
                    or reservation_id in policy.baseline_ids):
                    raise _unavailable()
                reason = "transcription_duration_rounding_v1"
                old = connection.execute("SELECT accounted_microusd,evidence_digest,reviewed_by,reason FROM usage_overrun_reviews WHERE reservation_id=?",
                                         (reservation_id,)).fetchone()
                if old is not None and old != (amount, evidence, reviewed_by, reason):
                    raise _unavailable()
                connection.execute("INSERT OR IGNORE INTO usage_overrun_reviews VALUES (?,?,?,?,?,?)",
                                   (reservation_id, amount, evidence, reviewed_by, self._now(), reason))
                connection.execute("COMMIT")
                return {"review_recorded": True, "original_ceiling_microusd": row[2],
                        "full_accounted_microusd": amount, "historical_rows_rewritten": False}
        except APIError:
            raise
        except (OSError, sqlite3.Error, ValueError, TypeError, OverflowError):
            raise _unavailable() from None
        finally:
            if connection is not None:
                if connection.in_transaction:
                    connection.rollback()
                connection.close()

    def reserve(self, operation: str, model: str, *, _ceiling_microusd: int | None = None) -> str:
        """Commit a conservative reservation before one paid network attempt."""
        approval = _load_approval(self.approval_path)
        if (not isinstance(operation, str) or operation not in SUPPORTED_AI_OPERATIONS
            or not isinstance(model, str) or model not in approval.allowed_models):
            raise _not_approved()
        if self._now() >= approval.expires_at:
            raise _not_approved()
        policy = self._policy()
        ceiling = approval.reserve_per_call_microusd
        if policy is not None and _ceiling_microusd is not None:
            if type(_ceiling_microusd) is not int or not 1 <= _ceiling_microusd <= ceiling:
                raise _not_approved()
            ceiling = _ceiling_microusd
        if policy is not None and _ceiling_microusd is None:
            # The fixed path covers a bounded full input/output request. Unknown
            # models need reviewed pricing before cumulative accounting can run.
            minimum = {"gpt-6.1-terra": 185_602, "gpt-transcribe": 10_000,
                       "gpt-realtime-2.1-mini": 250_000}.get(model)
            if minimum is None or ceiling < minimum:
                raise _not_approved()
        subject = policy.subject(ai_budget_subject.get()) if policy is not None else None
        connection: sqlite3.Connection | None = None
        try:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            self._schema(connection)
            self._require_policy_if_initialized(connection, policy)
            if policy is not None:
                from app.services.ai_budget import ensure_schema
                ensure_schema(connection, policy)
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
                    or calls < 0 or reserved < 0
                    or (policy is None and reserved != calls * approval.reserve_per_call_microusd)
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
            accounted = reserved
            if policy is not None:
                from app.services.ai_budget import accounting
                totals = accounting(connection, policy, subject, approval.approval_id)
                self._check_policy_limits(policy, totals, ceiling, required_calls=1)
                accounted = totals["approval_accounted_microusd"]
            if calls >= approval.max_calls or accounted > approval.budget_microusd - ceiling:
                raise APIError(429, "AI_USAGE_LIMIT", "The approved AI testing allowance is used up. Saved work is still available.")
            recent = connection.execute(
                "SELECT count(*) FROM reservations WHERE approval_id=? AND reserved_at>?",
                (approval.approval_id, now - 60),
            ).fetchone()[0]
            if recent >= approval.max_calls_per_minute:
                raise APIError(429, "AI_RATE_LIMIT", "The approved live AI request rate was reached.")
            reservation_id = str(uuid4())
            connection.execute("INSERT INTO reservations VALUES (?,?,?,?,?,?)", (
                reservation_id, approval.approval_id, operation, model, now, ceiling,
            ))
            if policy is not None:
                connection.execute("INSERT INTO reservation_subjects VALUES (?,?,?)", (reservation_id, subject, policy.policy_id))
            connection.execute("""UPDATE approvals SET reserved_calls=?,reserved_microusd=?,last_reserved_at=?
                WHERE approval_id=?""", (calls + 1, reserved + ceiling,
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
