"""Explicit append-only administrative ceiling increase; no provider activation.

Reads an existing ledger and two reviewed private policies. It never creates a
ledger, changes a baseline/remote hold, refunds usage or renews an approval.
Without --execute, this command only explains the required separate review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import time
from urllib.parse import quote

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.ai_budget import (
    CEILING_INCREASE_COLUMNS, MAX_INTEGER, accounting, ceiling_increase_fingerprint,
    ensure_schema, load_policy, validate_ceiling_chain,
)
from app.services.ai_controls import _private_parent, _private_file


class IncreaseError(ValueError):
    """Only fixed sanitized classifications may leave this administrative tool."""


def increase_ceiling(ledger: Path, old_policy: Path, new_policy: Path, *,
                     authorized_increase_microusd: int, approved_by: str, clock=time.time):
    old, new = load_policy(old_policy), load_policy(new_policy)
    if (type(authorized_increase_microusd) is not int
        or not 1 <= authorized_increase_microusd <= MAX_INTEGER
        or new.global_budget_microusd - old.global_budget_microusd != authorized_increase_microusd
        or new.policy_id == old.policy_id
        or (old.baseline_exposure_microusd, old.baseline_ids, old.baseline_sha256,
            old.external_hold_microusd, old.subject_salt) !=
           (new.baseline_exposure_microusd, new.baseline_ids, new.baseline_sha256,
            new.external_hold_microusd, new.subject_salt)
        or not isinstance(approved_by, str) or not 1 <= len(approved_by) <= 120
        or approved_by != approved_by.strip() or any(ord(c) < 32 for c in approved_by)):
        raise IncreaseError("INCREASE_NOT_AUTHORIZED")
    stamp = clock()
    if type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp <= 0:
        raise IncreaseError("INVALID_REVIEW_TIME")
    stamp = float(stamp)  # SQLite's REAL affinity must preserve the audit fingerprint.
    ledger = Path(ledger)
    descriptor, connection = None, None
    try:
        _private_parent(ledger)
        descriptor = os.open(ledger, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        _private_file(info)
        for suffix in ("-wal", "-shm", "-journal"):
            sidecar = ledger.with_name(ledger.name + suffix)
            if sidecar.exists() or sidecar.is_symlink():
                _private_file(sidecar.lstat())
        connection = sqlite3.connect("file:" + quote(str(ledger), safe="/") + "?mode=rw", uri=True)
        if (ledger.lstat().st_dev, ledger.lstat().st_ino) != (info.st_dev, info.st_ino):
            raise IncreaseError("LEDGER_CHANGED")
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
        if (connection.execute("PRAGMA application_id").fetchone()[0] != 0x4D454D59
            or connection.execute("PRAGMA user_version").fetchone()[0] != 1
            or connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]
            or connection.execute("PRAGMA foreign_key_check").fetchone() is not None
            or connection.execute("SELECT count(*) FROM reservations").fetchone()[0] < 1):
            raise IncreaseError("HISTORICAL_LEDGER_REQUIRED")
        original = connection.execute("SELECT * FROM budget_policies WHERE policy_id=?", (old.policy_id,)).fetchone()
        if original != (old.policy_id, old.digest, old.namespace_digest, old.accounting_core_digest):
            raise IncreaseError("ORIGINAL_POLICY_REQUIRED")
        ensure_schema(connection, old)
        chain = validate_ceiling_chain(connection, old)
        before = accounting(connection, old)
        transition_id = "increase_" + hashlib.sha256((old.digest + new.digest).encode()).hexdigest()
        prefix = (transition_id, old.policy_id, old.digest, new.policy_id, new.digest,
                  old.accounting_core_digest, new.accounting_core_digest, old.global_budget_microusd,
                  new.global_budget_microusd, authorized_increase_microusd, approved_by)
        recorded = connection.execute("SELECT " + ",".join(CEILING_INCREASE_COLUMNS)
            + " FROM budget_ceiling_increases WHERE transition_id=?", (transition_id,)).fetchone()
        if recorded is not None:
            if recorded[:11] != prefix:
                raise IncreaseError("TRANSITION_CONFLICT")
            ensure_schema(connection, new)
            connection.rollback()  # Replay performs no writes.
            return {"increase_recorded": False, "already_recorded": True,
                    "authorized_increase_microusd": authorized_increase_microusd,
                    "old_ceiling_microusd": old.global_budget_microusd,
                    "new_ceiling_microusd": new.global_budget_microusd,
                    "history_rewritten": False, "remote_hold_released": False,
                    "spending_approved": False, "providers_enabled": False}
        if chain["maximum_ceiling_microusd"] != old.global_budget_microusd:
            raise IncreaseError("LATEST_POLICY_REQUIRED")
        prior_stamp = connection.execute("SELECT max(approved_at) FROM budget_ceiling_increases").fetchone()[0]
        if prior_stamp is not None and stamp < prior_stamp:
            raise IncreaseError("INVALID_REVIEW_TIME")
        if connection.execute("SELECT 1 FROM budget_policies WHERE policy_id=?", (new.policy_id,)).fetchone():
            raise IncreaseError("NEW_POLICY_ID_REQUIRED")
        connection.execute("INSERT INTO budget_policies VALUES (?,?,?,?)",
            (new.policy_id, new.digest, new.namespace_digest, new.accounting_core_digest))
        values = prefix + (stamp,)
        connection.execute("INSERT INTO budget_ceiling_increases VALUES (" + ",".join("?" for _ in CEILING_INCREASE_COLUMNS) + ")",
                           values + (ceiling_increase_fingerprint(values),))
        ensure_schema(connection, new)
        after = accounting(connection, new)
        if before["global_accounted_microusd"] != after["global_accounted_microusd"]:
            raise IncreaseError("ACCOUNTING_CHANGED")
        connection.commit()
        return {"increase_recorded": True, "already_recorded": False,
                "authorized_increase_microusd": authorized_increase_microusd,
                "old_ceiling_microusd": old.global_budget_microusd,
                "new_ceiling_microusd": new.global_budget_microusd,
                "accounted_exposure_microusd": after["global_accounted_microusd"],
                "external_hold_microusd": new.external_hold_microusd,
                "history_rewritten": False, "remote_hold_released": False,
                "spending_approved": False, "providers_enabled": False}
    finally:
        if connection is not None:
            if connection.in_transaction:
                connection.rollback()
            connection.close()
        if descriptor is not None:
            os.close(descriptor)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--old-policy", type=Path)
    parser.add_argument("--new-policy", type=Path)
    parser.add_argument("--authorized-increase-microusd", type=int)
    parser.add_argument("--approved-by")
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps({"mode": "review-only", "history_modified": False,
                          "providers_enabled": False, "spending_approved": False}))
        return 0
    try:
        result = increase_ceiling(args.ledger, args.old_policy, args.new_policy,
            authorized_increase_microusd=args.authorized_increase_microusd, approved_by=args.approved_by)
    except Exception:
        print(json.dumps({"result": "INCREASE_REJECTED", "providers_enabled": False,
                          "spending_approved": False}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
