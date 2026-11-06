"""Offline roster checks never authorize releases or expose account identities."""
import json
from pathlib import Path
import shutil
import sqlite3
from uuid import uuid4

import pytest

from scripts.pilot_preflight import CHECKS, DEFAULT, PreflightError, assess, main
from scripts.staging_state import StateError, create_backup
from test_ai_budget_accounting import budget, user, reserve


@pytest.fixture
def plan():
    return json.loads(DEFAULT.read_bytes())


def encoded(plan):
    return json.dumps(plan).encode()


def ready(plan, count=2):
    plan["backend"]["review"] = plan["mobile"]["review"] = "pass"
    plan["checks"] = dict.fromkeys(CHECKS, "pass")
    plan["distribution"] = {"kind": "mobile_web", "api_origin": "https://api.example.com"}
    plan["testers"] = [{"slot": i+1, "user_id": str(uuid4()), "account_ready": True,
                        "password_setup_verified": True, "sign_in_verified": True,
                        "consent_recorded": True} for i in range(count)]
    return plan


def test_template_is_explicitly_not_ready_and_never_spends(plan):
    r = assess(encoded(plan))
    assert r["result"] == "NOT_READY"
    assert r["ready_accounts"] == r["network_calls"] == r["provider_calls"] == 0
    assert not r["accepted"] and not r["spending_authorized"]
    assert "budget_approval" in r["blockers"]


def test_complete_self_report_cannot_bypass_missing_financial_evidence(plan):
    r = assess(encoded(ready(plan)))
    assert r["result"] == "NOT_READY"
    assert r["blockers"] == ["current_ledger_history_not_checked", "financial_backup_not_checked"]
    assert not r["release_authorized"]


def test_roster_reports_only_counts_never_real_ids(plan):
    plan = ready(plan, 5)
    r = assess(encoded(plan))
    rendered = json.dumps(r)
    assert r["ready_accounts"] == 5
    assert all(t["user_id"] not in rendered for t in plan["testers"])


@pytest.mark.parametrize("count", [0, 1])
def test_two_ready_accounts_required_for_initial_soft_start(plan, count):
    r = assess(encoded(ready(plan, count)))
    assert "at_least_two_ready_accounts" in r["blockers"]


def test_incomplete_fifth_slot_blocks_full_roster(plan):
    ready(plan, 5)
    plan["testers"][-1]["consent_recorded"] = False
    r = assess(encoded(plan))
    assert r["ready_accounts"] == 4 and "incomplete_roster" in r["blockers"]


@pytest.mark.parametrize("mutation", [
    lambda p: p["testers"].append(dict(p["testers"][0], slot=6)),
    lambda p: p["testers"][1].update(user_id=p["testers"][0]["user_id"]),
    lambda p: p["testers"][1].update(slot=1),
    lambda p: p["testers"][0].update(user_id="not-an-id"),
    lambda p: p["testers"][0].update(user_id="00000000-0000-0000-0000-000000000000"),
    lambda p: p["testers"][0].update(account_ready=1),
    lambda p: p["testers"][0].update(user_id=None),
    lambda p: p["testers"][0].update(email="never-print@example.invalid"),
    lambda p: p["testers"][0].update(account_ready=False),
    lambda p: p["backend"].update(commit="main"),
    lambda p: p["backend"].update(commit="0"*40),
    lambda p: p["mobile"].update(patch_sha256="invalid"),
    lambda p: p["checks"].update(budget_approval="not_applicable"),
    lambda p: p["checks"].pop("privacy_and_cleanup"),
    lambda p: p["distribution"].update(api_origin="http://192.168.1.2:8001"),
    lambda p: p["distribution"].update(api_origin="https://api.example.com/path"),
    lambda p: p["distribution"].update(api_origin="https://api.example.com?key=secret"),
])
def test_invalid_inputs_fail_closed(plan, mutation):
    ready(plan, 5)
    mutation(plan)
    with pytest.raises(PreflightError):
        assess(encoded(plan))


@pytest.mark.parametrize("raw", [b'{"version":1,"version":1}', b'NaN', b'{}', b'x'*64001])
def test_strict_json_and_bounds(raw):
    with pytest.raises(PreflightError):
        assess(raw)


def test_failed_gate_is_reported_without_approval(plan):
    ready(plan)
    plan["checks"]["hosted_two_user_ownership"] = "fail"
    assert assess(encoded(plan))["result"] == "REPORTED_FAILURE"


def test_cli_private_input_refuses_public_file_and_sanitizes_errors(tmp_path, capsys):
    f = tmp_path / "secret-roster.json"
    f.write_text('{"user_id":"private-value-never-print"}')
    f.chmod(0o644)
    assert main(["--manifest", str(f)]) == 2
    output = capsys.readouterr().out
    assert "private-value" not in output and str(f) not in output
    assert json.loads(output)["result"] == "INVALID_OR_UNSAFE_INPUT"


def test_default_cli_never_reports_success(capsys):
    assert main([]) == 3
    assert json.loads(capsys.readouterr().out)["result"] == "NOT_READY"


def test_accounting_evidence_does_not_release_hold_or_authorize(plan, monkeypatch):
    import scripts.pilot_preflight as preflight
    ready(plan)
    monkeypatch.setattr(preflight, "ledger_report", lambda *a: {
        "local_reservations": 79, "local_settlements": 21,
        "remote_ledger_returned": True, "remote_hold_retained_microusd": 750000,
        "append_only_import_reviewable": True,
    })
    monkeypatch.setattr(preflight, "verify_history", lambda *a: {"reservations":79})
    monkeypatch.setattr(preflight, "verify_backup", lambda *a: {"reservations":79})
    result = assess(encoded(plan), ledger=Path("ledger"), history=Path("history"), backup=Path("backup"), remote_ledger=Path("remote"))
    assert result["result"] == "SELF_REPORTED_COMPLETE_REVIEW_REQUIRED"
    assert result["accounting"]["unresolved_remote_hold_microusd"] == 750000
    assert not result["accounting"]["remote_hold_released"]
    assert not result["accepted"] and not result["release_authorized"] and not result["spending_authorized"]


def test_missing_remote_evidence_still_blocks_optimistic_checklist(plan, monkeypatch):
    import scripts.pilot_preflight as preflight
    ready(plan)
    monkeypatch.setattr(preflight, "ledger_report", lambda *a: {
        "local_reservations":79,"local_settlements":21,
        "remote_ledger_returned":False,"remote_hold_retained_microusd":750000,
    })
    result = assess(encoded(plan), ledger="ledger")
    assert "remote_ledger_evidence_missing" in result["blockers"]


def test_history_cannot_be_checked_without_ledger(plan):
    with pytest.raises(PreflightError):
        assess(encoded(plan), history="anything")


def test_snapshot_cannot_be_checked_without_current_ledger(plan):
    with pytest.raises(PreflightError):
        assess(encoded(plan), backup=Path("anything"))


def test_unrelated_valid_snapshot_is_not_current_ledger_backup_evidence(plan, budget):
    with user():
        reserve(budget[-1]())
    usage = budget[0] / "usage.jsonl"
    usage.write_text('{}\n')
    usage.chmod(0o600)
    snapshot = budget[0] / "snapshot"
    create_backup(budget[2], usage, snapshot)
    other_ledger = budget[0] / "different-ledger.sqlite3"
    shutil.copyfile(budget[2], other_ledger)
    other_ledger.chmod(0o600)
    with sqlite3.connect(other_ledger) as connection:
        connection.execute("UPDATE reservations SET model='other-model'")
    with pytest.raises(StateError, match="HISTORICAL_STATE_CHANGED"):
        assess(encoded(ready(plan)), ledger=other_ledger, backup=snapshot)
