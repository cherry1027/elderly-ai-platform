"""Offline, content-free checklist for a maximum seven-person pilot.

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
from urllib.parse import urlsplit

if __package__:
    from .reconcile_ai_ledgers import report as ledger_report
    from .run_staging import https_origin
    from .staging_state import StateError, read_private, verify_backup, verify_history
else:
    from reconcile_ai_ledgers import report as ledger_report
    from run_staging import https_origin
    from staging_state import StateError, read_private, verify_backup, verify_history

from app.core.pilot_limits import MAX_PILOT_USERS

MAX_BYTES = 64_000
DEFAULT = Path(__file__).resolve().parents[2] / "docs/fixtures/seven-user-pilot.example.json"
DEFAULT_LAUNCH_PLAN = Path(__file__).resolve().parents[2] / "docs/fixtures/seven-user-launch-plan.example.json"
PILOT_BUDGET_SEK = {"total_cap": 350, "hosting_reserve": 100, "ai_cap": 175,
                    "safety_reserve": 75, "per_user_ai_cap": 25}
LAUNCH_DECISIONS = (
    "tester_contacts_confirmed", "password_setup_flow_verified",
    "privacy_notice_and_retention_reviewed", "support_contact_assigned",
    "hosting_quote_with_tax_reviewed", "fx_conversion_and_usd_caps_reviewed",
    "existing_ledger_and_remote_hold_preserved", "one_spending_host_chosen",
    "local_and_wsl_paid_calls_stopped_for_cutover", "encrypted_backup_restore_verified",
    "active_cohort_matches_verified_accounts", "hosted_capacity_and_streaming_verified",
    "phone_journey_and_ownership_verified", "runtime_approval_and_limits_verified",
)
DEVELOPMENT_PROJECT_REF = "edbkuunyeyxnyenmmqud"
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


def _launch_callback(value, web_origin):
    if value is None:
        return
    _require(type(value) is str and 0 < len(value) <= 512
             and all(33 <= ord(char) <= 126 for char in value))
    parsed = urlsplit(value)
    _require(web_origin is not None and not parsed.query and not parsed.fragment
             and parsed.username is None and parsed.password is None
             and parsed.path.startswith("/") and not parsed.path.startswith("//")
             and "\\" not in parsed.path and "%" not in parsed.path
             and ".." not in parsed.path.split("/"))
    origin = https_origin(f"{parsed.scheme}://{parsed.netloc}")
    _require(origin == web_origin and value == origin + parsed.path)


def assess_launch_plan(raw: bytes, *, distribution: dict | None = None) -> dict:
    """Review a non-executable SEK worksheet; never derive USD or grant spend."""
    _require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES)
    try:
        plan = json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                          parse_constant=_constant)
        _require(type(plan) is dict and set(plan) == {
            "version", "planned_people", "active_slots", "pilot_days", "budget_sek", "destinations", "decisions"})
        _require(type(plan["version"]) is int and plan["version"] == 1)
        _require(type(plan["planned_people"]) is int and plan["planned_people"] == MAX_PILOT_USERS)
        _require(type(plan["pilot_days"]) is int and 1 <= plan["pilot_days"] <= 7)
        active_slots = plan["active_slots"]
        _require(type(active_slots) is list and 2 <= len(active_slots) <= MAX_PILOT_USERS
                 and all(type(slot) is int and 1 <= slot <= MAX_PILOT_USERS for slot in active_slots)
                 and len(set(active_slots)) == len(active_slots))
        budget = plan["budget_sek"]
        _require(type(budget) is dict and set(budget) == set(PILOT_BUDGET_SEK))
        _require(all(type(budget[key]) is int and budget[key] == value
                     for key, value in PILOT_BUDGET_SEK.items()))
        _require(budget["hosting_reserve"] + budget["ai_cap"] + budget["safety_reserve"] == budget["total_cap"]
                 and budget["per_user_ai_cap"] * plan["planned_people"] == budget["ai_cap"])
        destinations = plan["destinations"]
        _require(type(destinations) is dict and set(destinations) == {
            "supabase_project_ref", "web_origin", "api_origin", "confirmation_redirect", "recovery_redirect"})
        _require(destinations["supabase_project_ref"] == DEVELOPMENT_PROJECT_REF)
        for name in ("web_origin", "api_origin"):
            value = destinations[name]
            _require(value is None or (type(value) is str and value == https_origin(value)))
        for name in ("confirmation_redirect", "recovery_redirect"):
            _launch_callback(destinations[name], destinations["web_origin"])
        decisions = plan["decisions"]
        _require(type(decisions) is dict and set(decisions) == set(LAUNCH_DECISIONS)
                 and all(type(value) is bool for value in decisions.values()))
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, StateError):
        raise PreflightError from None
    blockers = ["launch_plan_" + name for name in LAUNCH_DECISIONS if not decisions[name]]
    blockers.extend("launch_plan_" + name + "_pending" for name in (
        "web_origin", "api_origin", "confirmation_redirect", "recovery_redirect")
        if destinations[name] is None)
    if distribution is not None:
        _require(type(distribution) is dict and set(distribution) == {"kind", "api_origin"})
        if distribution["kind"] != "mobile_web":
            blockers.append("launch_plan_mobile_web_distribution_required")
        if (destinations["api_origin"] is not None and distribution["api_origin"] is not None
            and destinations["api_origin"] != distribution["api_origin"]):
            blockers.append("launch_plan_api_origin_mismatch")
    return {"checked": True, "mode": "offline-non-executable-plan", "planned_people": MAX_PILOT_USERS,
            "active_slots": list(active_slots), "future_slots": MAX_PILOT_USERS - len(active_slots),
            "pilot_days": plan["pilot_days"], "budget_sek": dict(budget), "blockers": blockers,
            "currency_conversion_performed": False, "approval_created": False,
            "spending_authorized": False, "release_authorized": False,
            "note": "Operator statements and SEK allocations do not create a USD approval or certify a hosted pilot."}


def assess(raw: bytes, *, ledger: Path | None = None, history: Path | None = None,
           backup: Path | None = None, remote_ledger: Path | None = None,
           launch_plan: bytes | None = None, cohort: Path | None = None) -> dict:
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
        _require(type(testers) is list and len(testers) <= MAX_PILOT_USERS)
        ids, slots, ready, ready_slots = set(), set(), 0, set()
        flags = ("account_ready", "password_setup_verified", "sign_in_verified", "consent_recorded")
        for tester in testers:
            _require(type(tester) is dict and set(tester) == {"slot", "user_id", *flags})
            slot, uid = tester["slot"], tester["user_id"]
            _require(type(slot) is int and 1 <= slot <= MAX_PILOT_USERS and slot not in slots)
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
            is_ready = uid is not None and all(tester[f] for f in flags)
            ready += int(is_ready)
            if is_ready:
                ready_slots.add(slot)
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, StateError):
        raise PreflightError from None

    launch = assess_launch_plan(launch_plan, distribution=d) if launch_plan is not None else {"checked": False}
    active_slots = set(launch["active_slots"]) if launch["checked"] else slots
    active_ready = len(ready_slots & active_slots)
    blockers = [name for name in CHECKS if value["checks"][name] != "pass"]
    blockers.extend(launch.get("blockers", []))
    for kind in ("backend", "mobile"):
        if value[kind]["review"] != "pass":
            blockers.append(kind + "_source_review")
    if d["kind"] == "undecided" or d["api_origin"] is None:
        blockers.append("distribution_not_configured")
    if active_ready < 2:
        blockers.append("at_least_two_ready_accounts")
    if not active_slots <= slots:
        blockers.append("active_roster_slots_missing")
    if active_ready != len(active_slots):
        blockers.append("incomplete_roster")
    cohort_report = {"checked": False, "matches_active_roster": False}
    if cohort is not None:
        from app.core.errors import APIError
        from app.services.pilot_cohort import load_cohort
        try:
            admitted = load_cohort(cohort)
        except APIError:
            raise PreflightError from None
        expected = {UUID(tester["user_id"]) for tester in testers
                    if tester["slot"] in active_slots and tester["user_id"] is not None}
        matches = len(expected) == len(active_slots) and admitted == expected
        cohort_report = {"checked": True, "members": len(admitted), "matches_active_roster": matches}
        if not matches:
            blockers.append("active_cohort_roster_mismatch")
    elif launch["checked"]:
        blockers.append("active_cohort_not_checked")

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
            "cohort_limit": MAX_PILOT_USERS, "roster_slots": len(testers), "ready_accounts": ready,
            "active_account_target": len(active_slots), "active_accounts_ready": active_ready,
            "future_account_slots": MAX_PILOT_USERS - len(active_slots) if launch["checked"] else 0,
            "active_cohort": cohort_report,
            "passed_check_count": sum(v == "pass" for v in value["checks"].values()),
            "required_check_count": len(CHECKS), "blockers": blockers, "launch_plan": launch,
            "accounting": accounting, "accepted": False,
            "release_authorized": False, "spending_authorized": False,
            "independently_verified": False,
            "note": "Checklist statements require independent review; this command never approves a pilot or changes a budget."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, help="Private 0600 checklist in a 0700 directory; never commit real account IDs.")
    parser.add_argument("--launch-plan", type=Path, help="Private 0600 non-executable seven-user SEK worksheet; never an AI approval.")
    parser.add_argument("--cohort", type=Path, help="Existing private cohort to compare with active verified roster IDs; never creates or changes it.")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--remote-ledger", type=Path)
    args = parser.parse_args(argv)
    try:
        raw = read_private(args.manifest, MAX_BYTES) if args.manifest else DEFAULT.read_bytes()
        result = assess(raw, ledger=args.ledger, history=args.history,
                        backup=args.backup, remote_ledger=args.remote_ledger,
                        launch_plan=read_private(args.launch_plan, MAX_BYTES) if args.launch_plan else None,
                        cohort=args.cohort)
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
