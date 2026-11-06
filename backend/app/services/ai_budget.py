"""Explicit, private pilot policy and append-only usage accounting.

Legacy attempt rows are never rewritten. An administrator must pin the reviewed
legacy baseline and outstanding remote exposure before cumulative accounting is
enabled. Public-rate estimates remain estimates, not provider invoices.
"""

from dataclasses import dataclass, replace
from decimal import Decimal, ROUND_CEILING
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import math
from uuid import UUID

from app.core.errors import APIError
from app.services.ai_controls import _private_parent, _private_file, _unique_object


POLICY_FIELDS = {
    "version", "policy_id", "approved_by", "global_budget_microusd",
    "baseline_exposure_microusd", "baseline_reservation_ids", "baseline_sha256",
    "external_hold_microusd", "per_user_budget_microusd", "per_user_max_calls",
    "subject_salt",
}
MAX_INTEGER = 2**53 - 1
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
_HEX = re.compile(r"[a-f0-9]{64}\Z")


def unavailable():
    return APIError(503, "AI_USAGE_UNAVAILABLE", "Live AI usage controls are unavailable.")


def baseline_fingerprint(rows):
    """Hash complete six-column immutable reservations, ordered by ID."""
    return hashlib.sha256(json.dumps(sorted([list(row) for row in rows]),
        separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class BudgetPolicy:
    policy_id: str
    digest: str
    global_budget_microusd: int
    baseline_exposure_microusd: int
    baseline_ids: tuple[str, ...]
    baseline_sha256: str
    external_hold_microusd: int
    per_user_budget_microusd: int
    per_user_max_calls: int
    subject_salt: str

    @property
    def namespace_digest(self):
        return hashlib.sha256(bytes.fromhex(self.subject_salt)).hexdigest()

    @property
    def accounting_core_digest(self):
        core = {"global_budget_microusd": self.global_budget_microusd,
            "baseline_exposure_microusd": self.baseline_exposure_microusd,
            "baseline_ids": sorted(self.baseline_ids), "baseline_sha256": self.baseline_sha256,
            "external_hold_microusd": self.external_hold_microusd,
            "subject_namespace_digest": self.namespace_digest}
        return hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def subject(self, user_id):
        try:
            canonical = str(UUID(str(user_id)))
        except (ValueError, TypeError, AttributeError):
            raise APIError(503, "AI_USER_LIMIT_UNAVAILABLE", "AI usage needs a verified signed-in account.") from None
        return hmac.new(bytes.fromhex(self.subject_salt), canonical.encode(), hashlib.sha256).hexdigest()


def load_policy(path):
    descriptor = None
    try:
        path = Path(path)
        _private_parent(path)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        _private_file(info)
        if info.st_size > 1_048_576:
            raise ValueError
        with os.fdopen(descriptor, encoding="utf-8") as stream:
            descriptor = None
            data = json.loads(stream.read(1_048_577), object_pairs_hook=_unique_object)
        if not isinstance(data, dict) or set(data) != POLICY_FIELDS or type(data["version"]) is not int or data["version"] != 1:
            raise ValueError
        if not isinstance(data["policy_id"], str) or not _ID.fullmatch(data["policy_id"]):
            raise ValueError
        if (not isinstance(data["approved_by"], str) or not 1 <= len(data["approved_by"]) <= 120
            or data["approved_by"] != data["approved_by"].strip()
            or any(ord(c) < 32 for c in data["approved_by"])):
            raise ValueError
        for field in ("global_budget_microusd", "per_user_budget_microusd", "per_user_max_calls"):
            if type(data[field]) is not int or not 1 <= data[field] <= MAX_INTEGER:
                raise ValueError
        for field in ("baseline_exposure_microusd", "external_hold_microusd"):
            if type(data[field]) is not int or not 0 <= data[field] <= MAX_INTEGER:
                raise ValueError
        if (data["baseline_exposure_microusd"] + data["external_hold_microusd"] > data["global_budget_microusd"]
            or data["per_user_budget_microusd"] > data["global_budget_microusd"]):
            raise ValueError
        ids = data["baseline_reservation_ids"]
        if not isinstance(ids, list) or len(ids) > 10_000 or len(ids) != len(set(ids)):
            raise ValueError
        for item in ids:
            if not isinstance(item, str) or str(UUID(item)) != item:
                raise ValueError
        for field in ("baseline_sha256", "subject_salt"):
            if not isinstance(data[field], str) or not _HEX.fullmatch(data[field]):
                raise ValueError
        if not ids and data["baseline_sha256"] != baseline_fingerprint([]):
            raise ValueError
        digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
        return BudgetPolicy(data["policy_id"], digest, data["global_budget_microusd"],
            data["baseline_exposure_microusd"], tuple(ids), data["baseline_sha256"],
            data["external_hold_microusd"], data["per_user_budget_microusd"],
            data["per_user_max_calls"], data["subject_salt"])
    except (OSError, ValueError, TypeError, OverflowError, UnicodeError, RecursionError):
        raise unavailable() from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


CEILING_INCREASE_COLUMNS = (
    "transition_id", "from_policy_id", "from_policy_digest", "to_policy_id", "to_policy_digest",
    "from_core_digest", "to_core_digest", "from_global_budget_microusd",
    "to_global_budget_microusd", "increase_microusd", "approved_by", "approved_at", "record_sha256",
)


def ceiling_increase_fingerprint(values):
    return hashlib.sha256(json.dumps(list(values), ensure_ascii=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def ceiling_increase_schema(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS budget_ceiling_increases (
        transition_id TEXT PRIMARY KEY, from_policy_id TEXT NOT NULL, from_policy_digest TEXT NOT NULL,
        to_policy_id TEXT NOT NULL UNIQUE, to_policy_digest TEXT NOT NULL,
        from_core_digest TEXT NOT NULL UNIQUE, to_core_digest TEXT NOT NULL UNIQUE,
        from_global_budget_microusd INTEGER NOT NULL, to_global_budget_microusd INTEGER NOT NULL,
        increase_microusd INTEGER NOT NULL, approved_by TEXT NOT NULL, approved_at REAL NOT NULL,
        record_sha256 TEXT NOT NULL
    )""")
    for operation in ("UPDATE", "DELETE"):
        connection.execute(f"""CREATE TRIGGER IF NOT EXISTS budget_ceiling_no_{operation.lower()}
            BEFORE {operation} ON budget_ceiling_increases BEGIN
            SELECT RAISE(ABORT, 'Budget ceiling audit is append-only'); END""")


def validate_ceiling_chain(connection, policy):
    """Only explicit, contiguous administrator-recorded increases can vary a cap.

    Recompute every endpoint using this policy's original baseline, namespace
    and remote hold. An audit record cannot authorize a rebase or a refund.
    The selected policy still uses its OWN ceiling, including an old policy.
    """
    records = connection.execute("SELECT " + ",".join(CEILING_INCREASE_COLUMNS)
        + " FROM budget_ceiling_increases ORDER BY from_global_budget_microusd LIMIT 1001").fetchall()
    if len(records) > 1000:
        raise unavailable()
    existing = {row[0]: row for row in connection.execute("SELECT * FROM budget_policies")}
    allowed = {policy.accounting_core_digest} if not records else set()
    previous_cap, previous_time = None, None
    for row in records:
        (identity, old_id, old_digest, new_id, new_digest, old_core, new_core,
         old_cap, new_cap, increase, reviewer, stamp, fingerprint) = row
        if (not all(isinstance(v, str) and _ID.fullmatch(v) for v in (identity, old_id, new_id))
            or old_id == new_id
            or not all(isinstance(v, str) and _HEX.fullmatch(v)
                       for v in (old_digest, new_digest, old_core, new_core, fingerprint))
            or any(type(v) is not int or not 1 <= v <= MAX_INTEGER for v in (old_cap, new_cap, increase))
            or new_cap - old_cap != increase
            or not isinstance(reviewer, str) or not 1 <= len(reviewer) <= 120
            or reviewer != reviewer.strip() or any(ord(c) < 32 for c in reviewer)
            or type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp <= 0
            or (previous_cap is not None and old_cap != previous_cap)
            or (previous_time is not None and stamp < previous_time)
            or ceiling_increase_fingerprint(row[:-1]) != fingerprint
            or replace(policy, global_budget_microusd=old_cap).accounting_core_digest != old_core
            or replace(policy, global_budget_microusd=new_cap).accounting_core_digest != new_core
            or existing.get(old_id) != (old_id, old_digest, policy.namespace_digest, old_core)
            or existing.get(new_id) != (new_id, new_digest, policy.namespace_digest, new_core)):
            raise unavailable()
        allowed.update((old_core, new_core))
        previous_cap, previous_time = new_cap, stamp
    if policy.accounting_core_digest not in allowed or any(row[3] not in allowed for row in existing.values()):
        raise unavailable()
    return {"maximum_ceiling_microusd": previous_cap or policy.global_budget_microusd,
            "transition_count": len(records)}


def ensure_schema(connection, policy):
    connection.execute("""CREATE TABLE IF NOT EXISTS budget_policies (
        policy_id TEXT PRIMARY KEY, digest TEXT NOT NULL, subject_namespace_digest TEXT NOT NULL,
        accounting_core_digest TEXT NOT NULL
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS reservation_subjects (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(reservation_id),
        subject_digest TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES budget_policies(policy_id)
    )""")
    connection.execute("CREATE INDEX IF NOT EXISTS budget_subject_lookup ON reservation_subjects(subject_digest)")
    connection.execute("""CREATE TABLE IF NOT EXISTS usage_settlements (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(reservation_id),
        accounted_microusd INTEGER NOT NULL, evidence_digest TEXT NOT NULL
    )""")
    connection.execute("""CREATE TABLE IF NOT EXISTS usage_overrun_reviews (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(reservation_id),
        accounted_microusd INTEGER NOT NULL, evidence_digest TEXT NOT NULL,
        reviewed_by TEXT NOT NULL, reviewed_at REAL NOT NULL, reason TEXT NOT NULL
    )""")
    ceiling_increase_schema(connection)
    old = connection.execute("SELECT digest FROM budget_policies WHERE policy_id=?", (policy.policy_id,)).fetchone()
    if old is not None and old[0] != policy.digest:
        raise unavailable()
    if connection.execute("SELECT 1 FROM budget_policies WHERE subject_namespace_digest<>? LIMIT 1",
                          (policy.namespace_digest,)).fetchone():
        raise unavailable()  # Changing the pseudonym namespace must never reset user limits.
    validate_ceiling_chain(connection, policy)
    connection.execute("INSERT OR IGNORE INTO budget_policies VALUES (?,?,?,?)",
                       (policy.policy_id, policy.digest, policy.namespace_digest, policy.accounting_core_digest))


def accounting(connection, policy, subject=None, approval_id=None):
    rows = connection.execute("SELECT reservation_id,approval_id,operation,model,reserved_at,ceiling_microusd FROM reservations").fetchall()
    baseline = set(policy.baseline_ids)
    pinned = [row for row in rows if row[0] in baseline]
    if len(pinned) != len(baseline) or baseline_fingerprint(pinned) != policy.baseline_sha256:
        raise unavailable()
    settlements = dict(connection.execute("SELECT reservation_id,accounted_microusd FROM usage_settlements"))
    evidence = dict(connection.execute("SELECT reservation_id,evidence_digest FROM usage_settlements"))
    reviews = {row[0]: row[1:] for row in connection.execute(
        "SELECT reservation_id,accounted_microusd,evidence_digest,reason FROM usage_overrun_reviews")}
    subjects = dict(connection.execute("SELECT reservation_id,subject_digest FROM reservation_subjects"))
    for aid, calls, gross in connection.execute("SELECT approval_id,reserved_calls,reserved_microusd FROM approvals"):
        actual = [row for row in rows if row[1] == aid]
        if (type(calls) is not int or type(gross) is not int or calls != len(actual)
            or gross != sum(row[5] for row in actual)):
            raise unavailable()
    exposure = policy.baseline_exposure_microusd + policy.external_hold_microusd
    user_exposure = user_calls = approval_exposure = 0
    for rid, aid, operation, model, stamp, ceiling in rows:
        amount = settlements.get(rid, ceiling)
        if type(ceiling) is not int or ceiling < 1 or type(amount) is not int or amount < 0 or amount > MAX_INTEGER:
            raise unavailable()
        if rid in settlements and amount > ceiling:
            if (operation != "transcription" or model != "gpt-transcribe"
                or amount - ceiling > 190
                or reviews.get(rid) != (amount, evidence[rid], "transcription_duration_rounding_v1")):
                raise unavailable()  # An exact, explicit rounding review is required.
        if rid not in baseline:
            exposure += amount
        if subject is not None and subjects.get(rid) == subject:
            user_exposure += amount
            user_calls += 1
        if aid == approval_id:
            approval_exposure += amount
    return {"global_accounted_microusd": exposure,
            "global_remaining_microusd": max(0, policy.global_budget_microusd - exposure),
            "external_hold_microusd": policy.external_hold_microusd,
            "user_accounted_microusd": user_exposure, "user_calls": user_calls,
            "approval_accounted_microusd": approval_exposure}


def observed_cost_microusd(operation, model, usage, status, service_tier):
    """Successful complete usage only; 25% reserve margin, rounded upward.

    Unknown/failed observations have no settlement and retain their full hold.
    All speech tokens use the higher audio rate; cached discounts are ignored.
    """
    from app.services.ai_usage import UsageObserver, sanitize_usage
    if status != "completed":
        return None
    clean = sanitize_usage(usage)
    if not isinstance(usage, dict):
        return None
    if service_tier is not None and not isinstance(service_tier, str):
        return None
    if model in {"gpt-transcribe", "gpt-realtime-2.1-mini"} and service_tier not in {None, "default"}:
        return None
    for field in ("input_tokens", "output_tokens", "total_tokens"):
        if field in usage and field not in clean:
            return None
    for detail, total in (("cached_input_tokens", "input_tokens"),
                          ("input_audio_tokens", "input_tokens"),
                          ("input_text_tokens", "input_tokens"),
                          ("output_audio_tokens", "output_tokens"),
                          ("output_text_tokens", "output_tokens"),
                          ("reasoning_tokens", "output_tokens")):
        if detail in clean and (total not in clean or clean[detail] > clean[total]):
            return None
    estimate = UsageObserver._estimate({"model": model, "usage": clean, "service_tier": service_tier})
    if estimate is None or not estimate.is_finite() or estimate < 0:
        return None
    return int((estimate * 1_250_000).to_integral_value(rounding=ROUND_CEILING)) + 1


def request_ceiling_microusd(model, input_bytes, max_output_tokens):
    """A token is never shorter than one input byte; include the full envelope.

    Only the pinned standard text model is supported for dynamic reservation.
    Other models keep the explicitly approved fixed per-attempt ceiling.
    """
    if model not in {"gpt-6.1-terra", "gpt-realtime-2.1-mini"}:
        return None
    if (type(input_bytes) is not int or not 1 <= input_bytes <= 128_000
        or type(max_output_tokens) is not int or not 16 <= max_output_tokens <= 4096):
        raise unavailable()
    base = ((input_bytes + max_output_tokens * 5) if model == "gpt-6.1-terra"
            else input_bytes * 10 + max_output_tokens * 20)
    return base * 5 // 4 + 2


def transcription_ceiling_microusd(seconds):
    if type(seconds) not in {int, float} or not 0 < seconds <= 90:
        raise unavailable()
    # Provider duration usage can round up to whole seconds. One additional
    # second covers decoder/container timing differences without lowering rates.
    rounded_seconds = math.ceil(seconds) + 1
    return int((Decimal(rounded_seconds) / 60 * Decimal("0.0045") * 1_250_000)
               .to_integral_value(rounding=ROUND_CEILING)) + 2
