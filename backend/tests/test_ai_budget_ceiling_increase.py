"""Synthetic administrator increases preserve cumulative usage and remote holds."""

import json
import sqlite3

import pytest

from app.core.errors import APIError
from app.services.ai_budget import accounting, load_policy
from app.services.ai_controls import AISpendingGovernor
from scripts.increase_ai_ceiling import IncreaseError, increase_ceiling, main
from scripts.reconcile_ai_ledgers import report
from scripts.staging_state import StateError, create_backup, restore_new, verify_history
from tests.test_ai_budget_accounting import budget, NOW, USER_A, user, reserve, complete


@pytest.fixture
def increase(budget):
    folder, approval, ledger, policy, data, rules, write, make = budget
    # Leave only a small remaining old allowance to exercise the old hard cap.
    rules["baseline_exposure_microusd"] = rules["global_budget_microusd"] - 750000 - 2500
    write(policy, rules)
    with user():
        rid = reserve(make())
        complete(make(), rid)
        reserve(make())  # Unknown outcome: its full reservation stays held.
    new_path = folder / "new-policy.json"
    new = {**rules, "policy_id": "approved-five-dollar-increase",
           "global_budget_microusd": rules["global_budget_microusd"] + 5000000,
           "per_user_budget_microusd": 5000000, "per_user_max_calls": 1000}
    write(new_path, new)

    def apply(**changes):
        return increase_ceiling(ledger, policy, new_path, authorized_increase_microusd=5000000,
                                approved_by="Synthetic reviewed authorization", clock=lambda: NOW, **changes)
    return budget, new_path, new, apply


def rows(path):
    with sqlite3.connect(path) as con:
        return {name: con.execute("SELECT * FROM " + name).fetchall() for name in (
            "reservations", "approvals", "reservation_subjects", "usage_settlements")}


def test_exact_increase_preserves_every_prior_financial_row_and_old_ceiling(increase):
    b, new_path, _, apply = increase
    before = rows(b[2])
    with user(), pytest.raises(APIError) as old_cap:
        reserve(b[-1]())
    assert old_cap.value.code == "AI_GLOBAL_BUDGET_EXHAUSTED"
    result = apply()
    assert result["increase_recorded"] and result["new_ceiling_microusd"] == 15500000
    assert result["external_hold_microusd"] == 750000
    assert not result["history_rewritten"] and not result["providers_enabled"] and not result["spending_approved"]
    assert rows(b[2]) == before
    old, new = load_policy(b[3]), load_policy(new_path)
    with sqlite3.connect(b[2]) as con:
        a, c = accounting(con, old), accounting(con, new)
        assert c["global_accounted_microusd"] == a["global_accounted_microusd"]
        assert c["global_remaining_microusd"] - a["global_remaining_microusd"] == 5000000
        assert con.execute("SELECT count(*) FROM budget_ceiling_increases").fetchone() == (1,)
    with user(), pytest.raises(APIError) as still_old:
        reserve(b[-1]())
    assert still_old.value.code == "AI_GLOBAL_BUDGET_EXHAUSTED"
    upgraded = AISpendingGovernor(b[1], b[2], clock=lambda: NOW, budget_policy_path=new_path)
    with user():
        reserve(upgraded)
    with sqlite3.connect(b[2]) as con:
        subject = new.subject(USER_A)
        assert accounting(con, new, subject)["user_calls"] == 3


def test_replay_never_applies_increment_twice_or_changes_history(increase):
    b, _, _, apply = increase
    first = apply()
    before = b[2].read_bytes()
    again = apply()
    assert first["increase_recorded"] and again["already_recorded"] and not again["increase_recorded"]
    assert b[2].read_bytes() == before


@pytest.mark.parametrize("field,value", [
    ("global_budget_microusd", 15500001), ("policy_id", "synthetic-policy"),
    ("baseline_exposure_microusd", 0), ("external_hold_microusd", 0),
    ("subject_salt", "34"*32), ("baseline_reservation_ids", ["11111111-1111-4111-8111-111111111111"]),
    ("baseline_sha256", "ab"*32),
])
def test_changed_anchor_unapproved_amount_or_same_identity_cannot_apply(increase, field, value):
    b, new_path, new, apply = increase
    b[6](new_path, {**new, field: value})
    before = b[2].read_bytes()
    with pytest.raises((APIError, IncreaseError)):
        apply()
    assert b[2].read_bytes() == before


def test_unrecorded_policy_increase_remains_fail_closed(increase):
    b, new_path, _, _ = increase
    unreviewed = AISpendingGovernor(b[1], b[2], clock=lambda: NOW, budget_policy_path=new_path)
    before = b[2].read_bytes()
    with user(), pytest.raises(APIError) as denied:
        reserve(unreviewed)
    assert denied.value.code == "AI_USAGE_UNAVAILABLE" and b[2].read_bytes() == before


def test_audit_update_delete_and_tampering_are_blocked(increase):
    b, new_path, _, apply = increase
    apply()
    with sqlite3.connect(b[2]) as con:
        for sql in ("UPDATE budget_ceiling_increases SET increase_microusd=1", "DELETE FROM budget_ceiling_increases"):
            with pytest.raises(sqlite3.IntegrityError):
                con.execute(sql)
        # Even privileged trigger removal cannot make a damaged row admissible.
        con.execute("DROP TRIGGER budget_ceiling_no_update")
        con.execute("UPDATE budget_ceiling_increases SET increase_microusd=1")
    upgraded = AISpendingGovernor(b[1], b[2], clock=lambda: NOW, budget_policy_path=new_path)
    with user(), pytest.raises(APIError) as denied:
        reserve(upgraded)
    assert denied.value.code == "AI_USAGE_UNAVAILABLE"


def test_second_explicit_increase_requires_latest_endpoint_not_a_fork(increase):
    b, new_path, new, apply = increase
    apply()
    next_path = b[0] / "next-policy.json"
    b[6](next_path, {**new, "policy_id": "next-explicit-increase", "global_budget_microusd": 15700000})
    result = increase_ceiling(b[2], new_path, next_path, authorized_increase_microusd=200000,
        approved_by="Another synthetic review", clock=lambda: NOW + 1)
    assert result["new_ceiling_microusd"] == 15700000
    assert apply()["already_recorded"]
    fork_path = b[0] / "fork-policy.json"
    b[6](fork_path, {**b[5], "policy_id": "unreviewed-fork", "global_budget_microusd": 11500000})
    with pytest.raises(IncreaseError, match="LATEST_POLICY_REQUIRED"):
        increase_ceiling(b[2], b[3], fork_path, authorized_increase_microusd=1000000,
            approved_by="Synthetic review", clock=lambda: NOW + 2)


def test_backup_restore_and_reconciliation_preserve_and_compare_audit(increase):
    b, new_path, _, apply = increase
    apply()
    log = b[0] / "usage.jsonl"
    b[6](log, {})
    snapshot = b[0] / "snapshot"
    create_backup(b[2], log, snapshot)
    restore = b[0] / "isolated"
    assert restore_new(snapshot, restore)["isolated_restore_verified"]
    compared = report(b[2], restore / "ledger.sqlite3")
    assert compared["budget_ceiling_increases_shared"] == 1
    assert compared["budget_ceiling_increases_conflicts"] == 0
    assert compared["local_ceiling_increases"] == 1
    assert compared["remote_hold_retained_microusd"] == 750000
    assert not compared["safe_to_release_remote_hold"]
    with sqlite3.connect(restore / "ledger.sqlite3") as con:
        con.execute("DROP TRIGGER budget_ceiling_no_delete")
        con.execute("DELETE FROM budget_ceiling_increases")
    with pytest.raises(StateError, match="HISTORICAL_STATE_CHANGED"):
        verify_history(restore / "ledger.sqlite3", restore / "history.json")


def test_missing_ledger_is_never_created(increase):
    b, new_path, _, _ = increase
    missing = b[0] / "missing.sqlite3"
    with pytest.raises(FileNotFoundError):
        increase_ceiling(missing, b[3], new_path, authorized_increase_microusd=5000000,
            approved_by="Synthetic review")
    assert not missing.exists()


def test_cli_defaults_to_no_state_changes_and_sanitizes_failure(capsys):
    assert main([]) == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "review-only"
    assert main(["--execute", "--ledger", "/private/missing-sensitive-location"]) == 2
    output = capsys.readouterr().out
    assert "missing-sensitive-location" not in output and "INCREASE_REJECTED" in output
