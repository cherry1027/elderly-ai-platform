"""Offline only: fake approvals, temporary private ledgers and no provider calls."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from threading import Barrier
from uuid import UUID

import pytest

from app.core.errors import APIError
from app.services.ai_controls import AISpendingGovernor


NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc).timestamp()
pytestmark = pytest.mark.skipif(os.name != "posix", reason="Live evaluation controls require reviewed POSIX file protection")


def approval(**changes):
    return {
        "approval_id": "fictional-offline-evaluation-1",
        "approved_by": "Fictional test approver",
        "expires_at": "2026-10-24T12:00:00Z",
        "max_calls": 4,
        "max_calls_per_minute": 4,
        "budget_microusd": 4000,
        "reserve_per_call_microusd": 1000,
        "allowed_models": ["fictional-transcribe", "fictional-text"],
        **changes,
    }


@pytest.fixture
def controls(tmp_path):
    private = tmp_path / "private"
    private.mkdir(mode=0o700)
    # Resolve system temporary-directory aliases before checking the control path.
    private = private.resolve()
    approval_path, ledger = private / "approval.json", private / "usage.sqlite3"

    def write(data=None):
        approval_path.write_text(json.dumps(approval() if data is None else data), encoding="utf-8")
        approval_path.chmod(0o600)

    def governor(*, clock=lambda: NOW):
        return AISpendingGovernor(approval_path, ledger, clock=clock)

    return approval_path, ledger, write, governor


def assert_error(code, action, status=503):
    with pytest.raises(APIError) as failure:
        action()
    assert failure.value.code == code
    assert failure.value.status_code == status
    assert "fictional" not in failure.value.message.lower()


def ledger_rows(path):
    with sqlite3.connect(path) as connection:
        return connection.execute("SELECT operation,model,reserved_at,ceiling_microusd FROM reservations").fetchall()


def test_absent_approval_never_creates_a_ledger(controls, monkeypatch):
    path, ledger, _, governor = controls
    monkeypatch.setenv("AI_SPENDING_APPROVED", "true")
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("transcription", "fictional-transcribe"))
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: AISpendingGovernor(None, ledger).reserve("transcription", "fictional-transcribe"))
    assert not path.exists() and not ledger.exists()


@pytest.mark.parametrize("changes", [
    {"approval_id": ""}, {"approval_id": "secret/token"}, {"approved_by": ""},
    {"approved_by": " name "}, {"approved_by": "person\nprivate"},
    {"expires_at": "2026-10-23T12:00:00Z"}, {"expires_at": "2026-10-23T11:59:59Z"},
    {"expires_at": "2026-10-24T12:00:00"}, {"expires_at": "2026-10-24T12:00:00+01:00"},
    {"expires_at": "not a date"}, {"max_calls": True}, {"max_calls": 0},
    {"max_calls": 1.5}, {"max_calls": "5"}, {"max_calls": 2**53},
    {"max_calls_per_minute": 0}, {"budget_microusd": -1},
    {"reserve_per_call_microusd": 4001}, {"reserve_per_call_microusd": False},
    {"allowed_models": []}, {"allowed_models": "fictional-text"},
    {"allowed_models": ["fictional-text", "fictional-text"]},
    {"allowed_models": ["fictional-text\nsecret"]}, {"allowed_models": [1]},
    {"unexpected_secret": "not-an-approval-field"},
])
def test_malformed_or_expired_approval_is_denied_without_state(controls, changes):
    _, ledger, write, governor = controls
    write(approval(**changes))
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("transcription", "fictional-transcribe"))
    assert not ledger.exists()


@pytest.mark.parametrize("payload", ["not json", "[]", "null", '{"approval_id":"one","approval_id":"two"}', "x" * 16385, "[" * 1500 + "0" + "]" * 1500])
def test_invalid_json_or_duplicate_keys_are_denied(controls, payload):
    path, ledger, _, governor = controls
    path.write_text(payload, encoding="utf-8")
    path.chmod(0o600)
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("conversation", "fictional-text"))
    assert not ledger.exists()


@pytest.mark.parametrize("operation,model", [
    ("private source text", "fictional-text"), ("conversation", "unapproved-model"),
    ("conversation", "Bearer secret"), (None, "fictional-text"),
])
def test_only_safe_operations_and_allowlisted_models_are_accepted(controls, operation, model):
    _, ledger, write, governor = controls
    write()
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve(operation, model))
    assert not ledger.exists()


def test_reservations_survive_restarts_and_never_refund_failed_or_cancelled_attempts(controls):
    _, ledger, write, governor = controls
    write(approval(max_calls=2))
    first = governor().reserve("transcription", "fictional-transcribe")
    assert UUID(first).version == 4
    # No refund after a hypothetical timeout/cancellation: the provider may have charged.
    second = governor().reserve("conversation", "fictional-text")
    assert first != second
    assert_error("AI_USAGE_LIMIT", lambda: governor().reserve("conversation", "fictional-text"),429)
    assert len(ledger_rows(ledger)) == 2
    assert ledger.stat().st_mode & 0o777 == 0o600


def test_budget_ceiling_blocks_attempt_before_the_call_limit(controls):
    _, ledger, write, governor = controls
    write(approval(max_calls=20,budget_microusd=2500))
    governor().reserve("story_writer", "fictional-text")
    governor().reserve("story_verifier", "fictional-text")
    assert_error("AI_USAGE_LIMIT", lambda: governor().reserve("story_writer", "fictional-text"),429)
    with sqlite3.connect(ledger) as connection:
        assert connection.execute("SELECT reserved_calls,reserved_microusd FROM approvals").fetchone() == (2,2000)


def test_rolling_minute_limit_is_persistent_and_does_not_consume_denied_attempts(controls):
    _, ledger, write, governor = controls
    write(approval(max_calls_per_minute=1))
    governor().reserve("memory_extraction", "fictional-text")
    assert_error("AI_RATE_LIMIT", lambda: governor(clock=lambda: NOW+59.999).reserve("conversation", "fictional-text"),429)
    governor(clock=lambda: NOW+60).reserve("conversation", "fictional-text")
    assert len(ledger_rows(ledger)) == 2


@pytest.mark.parametrize("changes", [
    {"budget_microusd": 10000}, {"max_calls": 100}, {"reserve_per_call_microusd": 1},
    {"expires_at": "2026-10-25T12:00:00Z"}, {"allowed_models": ["fictional-text"]},
    {"approved_by": "Different fictional approver"},
])
def test_existing_approval_id_cannot_be_rebound_to_reset_or_expand_counters(controls, changes):
    path, ledger, write, governor = controls
    write()
    governor().reserve("conversation", "fictional-text")
    write(approval(**changes))
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("conversation", "fictional-text"))
    assert len(ledger_rows(ledger)) == 1
    # Canonical JSON formatting changes do not invalidate the unchanged approval.
    path.write_text(json.dumps(approval(),sort_keys=True,indent=2),encoding="utf-8")
    governor().reserve("conversation", "fictional-text")
    assert len(ledger_rows(ledger)) == 2


def test_two_instances_concurrently_reserve_only_the_remaining_allowance(controls):
    _, ledger, write, governor = controls
    write(approval(max_calls=1,max_calls_per_minute=10))
    gate = Barrier(2)

    def attempt(instance):
        gate.wait()
        try:
            return instance.reserve("conversation", "fictional-text")
        except APIError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt,[governor(),governor()]))
    assert results.count("AI_USAGE_LIMIT") == 1
    assert len(ledger_rows(ledger)) == 1
    assert UUID(next(result for result in results if result != "AI_USAGE_LIMIT")).version == 4


def test_approval_expires_after_a_successful_reservation(controls):
    _, ledger, write, governor = controls
    write(approval(expires_at="2026-10-23T12:00:01Z"))
    governor().reserve("conversation", "fictional-text")
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor(clock=lambda: NOW+1).reserve("conversation", "fictional-text"))
    assert len(ledger_rows(ledger)) == 1


def test_time_going_backwards_fails_closed_without_resetting_rate(controls):
    _, ledger, write, governor = controls
    write()
    governor().reserve("conversation", "fictional-text")
    assert_error("AI_USAGE_UNAVAILABLE", lambda: governor(clock=lambda: NOW-1).reserve("conversation", "fictional-text"))
    assert len(ledger_rows(ledger)) == 1


@pytest.mark.parametrize("kind", ["symlink", "hardlink", "permissions"])
def test_unsafe_approval_file_is_denied(controls, kind):
    path, ledger, write, governor = controls
    write()
    if kind == "permissions":
        path.chmod(0o644)
    else:
        target = path.with_name("other.json")
        path.rename(target)
        if kind == "symlink":
            path.symlink_to(target)
        else:
            os.link(target,path)
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("conversation", "fictional-text"))
    assert not ledger.exists()


@pytest.mark.parametrize("kind", ["symlink", "hardlink", "permissions", "corrupt", "unrelated"])
def test_unsafe_or_unrecognized_ledger_fails_closed(controls, kind):
    _, ledger, write, governor = controls
    write()
    if kind == "unrelated":
        with sqlite3.connect(ledger) as connection:
            connection.execute("CREATE TABLE unrelated(value text)")
        ledger.chmod(0o600)
    elif kind == "corrupt":
        ledger.write_bytes(b"not a database")
        ledger.chmod(0o600)
    else:
        governor().reserve("conversation", "fictional-text")
        if kind == "permissions":
            ledger.chmod(0o644)
        else:
            target = ledger.with_name("other.sqlite3")
            ledger.rename(target)
            if kind == "symlink":
                ledger.symlink_to(target)
            else:
                os.link(target,ledger)
    assert_error("AI_USAGE_UNAVAILABLE", lambda: governor().reserve("conversation", "fictional-text"))


def test_private_directory_and_absolute_paths_are_required(controls):
    path, ledger, write, governor = controls
    write()
    path.parent.chmod(0o755)
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor().reserve("conversation", "fictional-text"))
    path.parent.chmod(0o700)
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: AISpendingGovernor(Path("relative.json"),ledger,clock=lambda:NOW).reserve("conversation","fictional-text"))
    assert_error("AI_USAGE_UNAVAILABLE", lambda: AISpendingGovernor(path,Path("relative.sqlite3"),clock=lambda:NOW).reserve("conversation","fictional-text"))


def test_reservation_ledger_contains_no_author_secrets_user_ids_or_content(controls):
    _, ledger, write, governor = controls
    private_value = "PRIVATE_PERSON_EMAIL_TOKEN_AND_PROMPT"
    write(approval(approved_by=private_value))
    governor().reserve("conversation", "fictional-text")
    assert not hasattr(governor(), "refund")
    with sqlite3.connect(ledger) as connection:
        rows = list(connection.iterdump())
    assert private_value not in "\n".join(rows)
    assert private_value.encode() not in ledger.read_bytes()
    assert ledger_rows(ledger) == [("conversation","fictional-text",NOW,1000)]


@pytest.mark.parametrize("kind", ["approval", "ledger"])
def test_fifo_control_paths_are_rejected_without_a_blocking_open(controls, kind):
    path, ledger, write, governor = controls
    write()
    selected = path if kind == "approval" else ledger
    if selected.exists():
        selected.unlink()
    os.mkfifo(selected,mode=0o600)
    assert_error("AI_SPENDING_NOT_APPROVED" if kind == "approval" else "AI_USAGE_UNAVAILABLE",
        lambda: governor().reserve("conversation", "fictional-text"))


@pytest.mark.parametrize("suffix", ["-journal", "-wal", "-shm"])
def test_unsafe_sqlite_sidecars_are_rejected_without_touching_the_target(controls, suffix):
    _, ledger, write, governor = controls
    write()
    target = ledger.with_name("do-not-change.txt")
    target.write_text("Existing fictional data",encoding="utf-8")
    target.chmod(0o600)
    ledger.with_name(ledger.name+suffix).symlink_to(target)
    assert_error("AI_USAGE_UNAVAILABLE", lambda: governor().reserve("conversation", "fictional-text"))
    assert target.read_text(encoding="utf-8") == "Existing fictional data"
    assert not ledger.exists()


@pytest.mark.parametrize("now", [float("nan"),float("inf"),-1,None,"not-a-clock"])
def test_invalid_clock_fails_closed_before_ledger_creation(controls, now):
    _, ledger, write, governor = controls
    write()
    assert_error("AI_USAGE_UNAVAILABLE", lambda: governor(clock=lambda:now).reserve("conversation","fictional-text"))
    assert not ledger.exists()


def test_missing_previously_used_ledger_is_not_silently_recreated(controls):
    _, ledger, write, governor = controls
    write()
    instance = governor()
    instance.reserve("conversation", "fictional-text")
    ledger.unlink()
    assert_error("AI_USAGE_UNAVAILABLE", lambda: instance.reserve("conversation", "fictional-text"))
    assert not ledger.exists()


def test_inconsistent_counter_state_cannot_reset_the_allowance(controls):
    _, ledger, write, governor = controls
    write()
    governor().reserve("conversation", "fictional-text")
    with sqlite3.connect(ledger) as connection:
        connection.execute("UPDATE approvals SET reserved_calls=0,reserved_microusd=0")
    assert_error("AI_USAGE_UNAVAILABLE", lambda: governor().reserve("conversation", "fictional-text"))
    assert len(ledger_rows(ledger)) == 1


def test_replaced_previously_used_ledger_is_not_accepted(controls):
    _, ledger, write, governor = controls
    write()
    instance = governor()
    instance.reserve("conversation", "fictional-text")
    ledger.rename(ledger.with_name("previous.sqlite3"))
    ledger.touch(mode=0o600)
    assert_error("AI_USAGE_UNAVAILABLE", lambda: instance.reserve("conversation", "fictional-text"))


def test_removing_approval_immediately_prevents_further_reservations(controls):
    path, ledger, write, governor = controls
    write()
    instance = governor()
    instance.reserve("conversation", "fictional-text")
    path.unlink()
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: instance.reserve("conversation", "fictional-text"))
    assert len(ledger_rows(ledger)) == 1


def test_new_written_approval_id_creates_a_separate_allowance_without_erasing_old_audit(controls):
    _, ledger, write, governor = controls
    write(approval(max_calls=1))
    governor().reserve("conversation", "fictional-text")
    assert_error("AI_USAGE_LIMIT", lambda: governor().reserve("conversation", "fictional-text"),429)
    write(approval(approval_id="fictional-offline-evaluation-2",max_calls=1))
    governor().reserve("conversation", "fictional-text")
    with sqlite3.connect(ledger) as connection:
        assert connection.execute("SELECT count(*),sum(reserved_calls) FROM approvals").fetchone() == (2,2)
    assert len(ledger_rows(ledger)) == 2


def test_expiry_is_rechecked_after_obtaining_the_atomic_write_lock(controls):
    _, ledger, write, governor = controls
    write(approval(expires_at="2026-10-23T12:00:01Z"))
    ticks = iter([NOW,NOW+1])
    assert_error("AI_SPENDING_NOT_APPROVED", lambda: governor(clock=lambda:next(ticks)).reserve("conversation", "fictional-text"))
    with sqlite3.connect(ledger) as connection:
        assert connection.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0] == 0
