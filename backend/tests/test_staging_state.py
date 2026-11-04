"""Local-only financial-state migration/restart/backup checks."""

import hashlib
import json
from pathlib import Path
import sqlite3

import pytest

from scripts.staging_state import (
    APPLICATION_ID, StateError, create_backup, history_manifest, ledger_connection,
    main, restore_new, verify_backup, verify_history, write_new,
)


@pytest.fixture
def state(tmp_path):
    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    ledger = root / "ledger.sqlite3"
    ledger.touch(mode=0o600)
    con = sqlite3.connect(ledger)
    con.executescript(f"""
        PRAGMA application_id={APPLICATION_ID};
        PRAGMA user_version=1;
        CREATE TABLE approvals(approval_id TEXT PRIMARY KEY,digest TEXT,reserved_calls INTEGER,
            reserved_microusd INTEGER,last_reserved_at REAL);
        CREATE TABLE reservations(reservation_id TEXT PRIMARY KEY,approval_id TEXT,
            operation TEXT,model TEXT,reserved_at REAL,ceiling_microusd INTEGER);
        INSERT INTO approvals VALUES('old','old-digest',1,250000,1.0);
        INSERT INTO reservations VALUES('reservation-1','old','conversation','synthetic',1.0,250000);
        CREATE TABLE additional_history(row_id TEXT PRIMARY KEY, amount INTEGER);
        INSERT INTO additional_history VALUES('preserved',750000);
    """)
    con.close()
    write_new(root / "usage.jsonl", b'{"synthetic":"numeric-evidence-placeholder"}\n')
    return root


def seed_backup(root, label="snapshot"):
    target = root / label
    create_backup(root / "ledger.sqlite3", root / "usage.jsonl", target)
    return target


def test_backup_and_isolated_restore_preserve_entire_source_database(state):
    before = (state / "ledger.sqlite3").read_bytes()
    snapshot = seed_backup(state)
    assert verify_backup(snapshot)["reservations"] == 1
    restored = state / "restored"
    assert restore_new(snapshot, restored)["isolated_restore_verified"] is True
    con = sqlite3.connect(restored / "ledger.sqlite3")
    assert con.execute("SELECT * FROM additional_history").fetchall() == [("preserved", 750000)]
    assert con.execute("SELECT sum(ceiling_microusd) FROM reservations").fetchone() == (250000,)
    con.close()
    assert before == (state / "ledger.sqlite3").read_bytes()
    assert (state / "usage.jsonl").read_bytes() == (restored / "usage.jsonl").read_bytes()
    assert all((p.stat().st_mode & 0o777) == 0o600 for p in restored.iterdir())


def test_manifest_accepts_added_calls_but_rejects_changed_or_missing_history(state):
    snapshot = seed_backup(state)
    ledger = state / "ledger.sqlite3"
    con = sqlite3.connect(ledger)
    con.execute("INSERT INTO reservations VALUES('reservation-2','old','conversation','synthetic',2.0,250000)")
    con.execute("UPDATE approvals SET reserved_calls=2,reserved_microusd=500000,last_reserved_at=2.0")
    con.commit()
    assert verify_history(ledger, snapshot / "history.json")["reservations"] == 2
    con.execute("UPDATE reservations SET ceiling_microusd=1 WHERE reservation_id='reservation-1'")
    con.execute("UPDATE approvals SET reserved_microusd=250001")
    con.commit()
    with pytest.raises(StateError, match="HISTORICAL_STATE_CHANGED"):
        verify_history(ledger, snapshot / "history.json")
    con.execute("DELETE FROM reservations WHERE reservation_id='reservation-1'")
    con.execute("UPDATE approvals SET reserved_calls=1,reserved_microusd=250000")
    con.commit()
    with pytest.raises(StateError, match="HISTORICAL_STATE_CHANGED"):
        verify_history(ledger, snapshot / "history.json")
    con.close()


def test_manifest_rejects_rebound_approval_identity(state):
    snapshot = seed_backup(state)
    con = sqlite3.connect(state / "ledger.sqlite3")
    con.execute("UPDATE approvals SET digest='different'")
    con.commit()
    con.close()
    with pytest.raises(StateError):
        verify_history(state / "ledger.sqlite3", snapshot / "history.json")


@pytest.mark.parametrize("table", ["usage_settlements", "usage_overrun_reviews"])
def test_new_accounting_tables_are_copied_and_pinned(state, table):
    con = sqlite3.connect(state / "ledger.sqlite3")
    con.execute(f"CREATE TABLE {table}(reservation_id TEXT PRIMARY KEY, accounted_microusd INTEGER, evidence_digest TEXT)")
    con.execute(f"INSERT INTO {table} VALUES('reservation-1',1000,'hash')")
    con.commit()
    con.close()
    snapshot = seed_backup(state)
    con = sqlite3.connect(state / "ledger.sqlite3")
    con.execute(f"UPDATE {table} SET accounted_microusd=0")
    con.commit()
    con.close()
    with pytest.raises(StateError):
        verify_history(state / "ledger.sqlite3", snapshot / "history.json")


@pytest.mark.parametrize("name", ["ledger.sqlite3", "usage.jsonl", "history.json"])
def test_backup_detects_tampering(state, name):
    backup = seed_backup(state)
    with (backup / name).open("ab") as out:
        out.write(b"changed")
    with pytest.raises(StateError):
        verify_backup(backup)


def test_never_overwrites_existing_backup_or_restore_destination(state):
    backup = seed_backup(state)
    before = (backup / "snapshot.json").read_bytes()
    with pytest.raises(FileExistsError):
        seed_backup(state)
    with pytest.raises(FileExistsError):
        restore_new(backup, backup)
    assert before == (backup / "snapshot.json").read_bytes()


def test_missing_ledger_is_not_initialized(state):
    missing = state / "missing.sqlite3"
    with pytest.raises(FileNotFoundError):
        create_backup(missing, state / "usage.jsonl", state / "never")
    assert not missing.exists()
    assert not (state / "never").exists()


def test_linked_or_public_financial_state_is_rejected(state):
    linked = state / "linked.sqlite3"
    linked.symlink_to(state / "ledger.sqlite3")
    with pytest.raises(StateError):
        ledger_connection(linked)
    (state / "ledger.sqlite3").chmod(0o644)
    with pytest.raises(StateError):
        ledger_connection(state / "ledger.sqlite3")


def test_rejects_empty_or_unrecognized_database(state):
    con = sqlite3.connect(state / "ledger.sqlite3")
    con.execute("DELETE FROM reservations")
    con.commit()
    con.close()
    with pytest.raises(StateError, match="HISTORICAL_LEDGER_REQUIRED"):
        seed_backup(state)


def test_wal_backup_includes_committed_rows_and_preserves_writer(state):
    ledger = state / "ledger.sqlite3"
    con = sqlite3.connect(ledger)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("INSERT INTO reservations VALUES('wal-row','old','conversation','synthetic',2.0,250000)")
    con.execute("UPDATE approvals SET reserved_calls=2,reserved_microusd=500000,last_reserved_at=2.0")
    con.commit()
    try:
        snapshot = seed_backup(state)
        assert verify_backup(snapshot)["reservations"] == 2
        assert con.execute("SELECT count(*) FROM reservations").fetchone() == (2,)
    finally:
        con.close()


def test_safe_cli_failure_never_dumps_paths_or_file_content(state, capsys):
    secret_marker = "secret-never-print"
    path = state / secret_marker
    path.write_text(secret_marker)
    path.chmod(0o600)
    assert main(["backup", "--ledger", str(path), "--usage-log", str(path), "--output", str(state / "out")]) == 2
    captured = capsys.readouterr()
    assert secret_marker not in captured.err + captured.out
    assert str(state) not in captured.err + captured.out


def test_manifest_does_not_include_raw_user_or_reservation_values(state):
    snapshot = seed_backup(state)
    content = (snapshot / "history.json").read_text()
    assert "reservation-1" not in content
    assert "old-digest" not in content
    assert "250000" not in content
    assert "row_hashes" in json.loads(content)["tables"]["reservations"]
