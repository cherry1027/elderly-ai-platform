"""Offline, content-free checklist for a maximum five-person pilot.

Reads a private roster/checklist and optional financial snapshots. Never creates
accounts, requests a token, calls a provider, renews approval or releases a hold.
Even a complete checklist is self-reported and cannot authorize a release.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys
from uuid import UUID

if __package__:
    from .reconcile_ai_ledgers import report as ledger_report
    from .run_staging import https_origin
    from .staging_state import StateError, read_private, verify_backup, verify_history
else:
    from reconcile_ai_ledgers import report as ledger_report
    from run_staging import https_origin
    from staging_state import StateError, read_private, verify_backup, verify_history

MAX_BYTES = 64_000
DEFAULT = Path(__file__).resolve().parents[2] / "docs/fixtures/five-user-pilot.example.json"
CHECKS = (
    "backend_regressions", "mobile_regressions", "independent_review",
    "ledger_reconciliation", "budget_approval", "user_and_global_limits",
    "cohort_enforcement", "secure_distribution", "auth_callbacks",
    "hosted_two_user_ownership", "english_actual_device", "swedish_actual_device",
    "interruption_and_recovery", "pdf_and_saved_history", "backup_and_restore",
    "off_host_backup_and_monitoring", "privacy_and_cleanup", "support_contact",
    "founder_scope_approval",
)
STATES = {"pending", "pass", "fail"}
_SHA = re.compile(r"[0-9a-f]{40}")
_HASH = re.compile(r"[0-9a-f]{64}")
TOP = {"version", "backend", "mobile", "distribution", "testers", "checks"}


class PreflightError(ValueError):
    """Underlying values and exception details must never enter a report."""


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreflightError
        result[key] = value
    return result


def _constant(_):
    raise PreflightError


def _require(value):
    if not value:
        raise PreflightError


def _state(value):
    _require(type(value) is str and value in STATES)


def _source(value):
    _require(type(value) is dict and set(value) == {"commit", "patch_sha256", "review"})
    _require(type(value["commit"]) is str and _SHA.fullmatch(value["commit"])
             and value["commit"] != "0" * 40)
    _require(value["patch_sha256"] is None or (type(value["patch_sha256"]) is str
             and _HASH.fullmatch(value["patch_sha256"])))
    _state(value["review"])


def assess(raw: bytes, *, ledger: Path | None = None, history: Path | None = None,
           backup: Path | None = None, remote_ledger: Path | None = None) -> dict:
    _require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES)
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                           parse_constant=_constant)
        _require(type(value) is dict and set(value) == TOP)
        _require(type(value["version"]) is int and value["version"] == 1)
        for key in ("backend", "mobile"):
            _source(value[key])
        d = value["distribution"]
        _require(type(d) is dict and set(d) == {"kind", "api_origin"})
        _require(type(d["kind"]) is str and d["kind"] in {"undecided", "mobile_web", "native_beta"})
        _require(d["api_origin"] is None or (type(d["api_origin"]) is str
                 and d["api_origin"] == https_origin(d["api_origin"])))
        _require(type(value["checks"]) is dict and set(value["checks"]) == set(CHECKS))
        for state in value["checks"].values():
            _state(state)
        testers = value["testers"]
        _require(type(testers) is list and len(testers) <= 5)
        ids, slots, ready = set(), set(), 0
        flags = ("account_ready", "password_setup_verified", "sign_in_verified", "consent_recorded")
        for tester in testers:
            _require(type(tester) is dict and set(tester) == {"slot", "user_id", *flags})
            slot, uid = tester["slot"], tester["user_id"]
            _require(type(slot) is int and 1 <= slot <= 5 and slot not in slots)
            slots.add(slot)
            for flag in flags:
                _require(type(tester[flag]) is bool)
            if uid is not None:
                _require(type(uid) is str and str(UUID(uid)) == uid and uid not in ids
                         and UUID(uid).int != 0)
                ids.add(uid)
            _require(not any(tester[f] for f in flags) or uid is not None)
            _require(not (tester["sign_in_verified"] or tester["password_setup_verified"])
                     or tester["account_ready"])
            ready += int(uid is not None and all(tester[f] for f in flags))
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, StateError):
        raise PreflightError from None

    blockers = [name for name in CHECKS if value["checks"][name] != "pass"]
    for kind in ("backend", "mobile"):
        if value[kind]["review"] != "pass":
            blockers.append(kind + "_source_review")
    if d["kind"] == "undecided" or d["api_origin"] is None:
        blockers.append("distribution_not_configured")
    if ready < 2:
        blockers.append("at_least_two_ready_accounts")
    if ready != len(testers):
        blockers.append("incomplete_roster")

    accounting = {"snapshot_checked": False, "history_preserved": False,
                  "remote_evidence_returned": False, "history_modified": False,
                  "remote_hold_released": False}
    if ledger is not None:
        numeric = ledger_report(ledger, remote_ledger)
        accounting.update({"local_reservations": numeric["local_reservations"],
                           "local_settlements": numeric["local_settlements"],
                           "remote_evidence_returned": numeric["remote_ledger_returned"],
                           "unresolved_remote_hold_microusd": numeric["remote_hold_retained_microusd"]})
        if not numeric["remote_ledger_returned"]:
            blockers.append("remote_ledger_evidence_missing")
        if remote_ledger is not None and not numeric.get("append_only_import_reviewable", False):
            blockers.append("remote_ledger_conflicts")
        if history is not None:
            verify_history(ledger, history)
            accounting["history_preserved"] = True
    elif remote_ledger is not None or history is not None:
        raise PreflightError
    if backup is not None:
        if ledger is None:
            raise PreflightError
        verify_backup(backup)
        # A different valid snapshot is not evidence about this ledger. Its
        # immutable history must still be present in the current ledger.
        verify_history(ledger, backup / "history.json")
        accounting["snapshot_checked"] = True
    if not accounting["history_preserved"]:
        blockers.append("current_ledger_history_not_checked")
    if not accounting["snapshot_checked"]:
        blockers.append("financial_backup_not_checked")

    failed = any(v == "fail" for v in value["checks"].values()) or any(
        value[k]["review"] == "fail" for k in ("backend", "mobile"))
    return {"version": 1, "mode": "offline-read-only", "network_calls": 0,
            "provider_calls": 0, "result": "REPORTED_FAILURE" if failed else
            "NOT_READY" if blockers else "SELF_REPORTED_COMPLETE_REVIEW_REQUIRED",
            "cohort_limit": 5, "roster_slots": len(testers), "ready_accounts": ready,
            "passed_check_count": sum(v == "pass" for v in value["checks"].values()),
            "required_check_count": len(CHECKS), "blockers": blockers,
            "accounting": accounting, "accepted": False,
            "release_authorized": False, "spending_authorized": False,
            "independently_verified": False,
            "note": "Checklist statements require independent review; this command never approves a pilot or changes a budget."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, help="Private 0600 checklist in a 0700 directory; never commit real account IDs.")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--remote-ledger", type=Path)
    args = parser.parse_args(argv)
    try:
        raw = read_private(args.manifest, MAX_BYTES) if args.manifest else DEFAULT.read_bytes()
        result = assess(raw, ledger=args.ledger, history=args.history,
                        backup=args.backup, remote_ledger=args.remote_ledger)
    except (PreflightError, OSError, ValueError, TypeError, sqlite3.Error, RecursionError):
        print(json.dumps({"result": "INVALID_OR_UNSAFE_INPUT", "mode": "offline-read-only",
                          "network_calls": 0, "provider_calls": 0,
                          "history_modified": False, "release_authorized": False}))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    # File contents can never provide release or spending authorization.
    return 1 if result["result"] == "REPORTED_FAILURE" else 3


if __name__ == "__main__":
    raise SystemExit(main())
