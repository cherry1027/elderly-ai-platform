"""Private SQLite snapshots and append-preserving staging history checks.

This command never creates an empty ledger, resets counters, settles charges or
reads provider credentials. A snapshot preserves every SQLite table. Its history
manifest pins immutable rows while allowing future calls/counter increases.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from urllib.parse import quote

APPLICATION_ID = 0x4D454D59
MAX_CONTROL_BYTES = 32 * 1024 * 1024
_NAME = re.compile(r"^[a-z_][a-z0-9_]*$")
_IMMUTABLE_TABLES = (
    "reservations", "budget_policies", "reservation_subjects", "usage_settlements", "usage_overrun_reviews",
    "budget_ceiling_increases",
)


class StateError(ValueError):
    """A safe classification; callers must not print underlying exceptions."""


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode()


def private_directory(path: Path, *, create=False) -> Path:
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts or os.name != "posix":
        raise StateError("PRIVATE_DIRECTORY_REQUIRED")
    for parent in reversed(path.parents):
        if stat.S_ISLNK(parent.lstat().st_mode):
            raise StateError("LINKED_DIRECTORY_REJECTED")
    if create:
        path.mkdir(mode=0o700, exist_ok=False)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise StateError("PRIVATE_DIRECTORY_REQUIRED")
    return path


def private_file(path: Path) -> os.stat_result:
    path = Path(path)
    private_directory(path.parent)
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600):
        raise StateError("PRIVATE_FILE_REQUIRED")
    return info


def read_private(path: Path, maximum=MAX_CONTROL_BYTES) -> bytes:
    info = private_file(path)
    if info.st_size > maximum:
        raise StateError("STATE_TOO_LARGE")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        current = os.fstat(source.fileno())
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise StateError("STATE_CHANGED")
        value = source.read(maximum + 1)
    if len(value) > maximum:
        raise StateError("STATE_TOO_LARGE")
    return value


def write_new(path: Path, value: bytes):
    private_directory(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(value)
        out.flush()
        os.fsync(out.fileno())


def ledger_connection(path: Path) -> sqlite3.Connection:
    before = private_file(path)
    for suffix in ("-journal", "-wal", "-shm"):
        sidecar = path.with_name(path.name + suffix)
        if sidecar.exists() or sidecar.is_symlink():
            private_file(sidecar)
    con = sqlite3.connect(f"file:{quote(str(path), safe='/')}?mode=ro", uri=True)
    try:
        con.execute("PRAGMA query_only = ON")
        con.execute("PRAGMA trusted_schema = OFF")
        after = private_file(path)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise StateError("STATE_CHANGED")
        if con.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
            raise StateError("UNRECOGNIZED_LEDGER")
        if con.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise StateError("UNSUPPORTED_LEDGER")
        if con.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise StateError("LEDGER_INTEGRITY_FAILED")
        if con.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise StateError("LEDGER_INTEGRITY_FAILED")
        return con
    except BaseException:
        con.close()
        raise


def history_manifest(con: sqlite3.Connection) -> dict:
    """No biography, email, credential, raw user UUID or request data is added."""
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"approvals", "reservations"} <= names:
        raise StateError("MISSING_LEDGER_TABLE")
    count = con.execute("SELECT count(*) FROM reservations").fetchone()[0]
    if count == 0:
        raise StateError("HISTORICAL_LEDGER_REQUIRED")
    if count > 100_000:
        raise StateError("STATE_TOO_LARGE")
    # A syntactically valid SQLite backup must also retain coherent financial
    # counters. Settlements never rewrite these original gross reservations.
    if con.execute("""SELECT 1 FROM reservations r LEFT JOIN approvals a
        ON a.approval_id=r.approval_id WHERE a.approval_id IS NULL LIMIT 1""").fetchone():
        raise StateError("LEDGER_COUNTER_MISMATCH")
    for approval_id, calls, amount in con.execute(
            "SELECT approval_id,reserved_calls,reserved_microusd FROM approvals"):
        expected_calls, expected_amount = con.execute("""SELECT count(*),
            COALESCE(sum(ceiling_microusd),0) FROM reservations WHERE approval_id=?""",
            (approval_id,)).fetchone()
        if (type(calls) is not int or type(amount) is not int or calls < 0 or amount < 0
                or (calls, amount) != (expected_calls, expected_amount)):
            raise StateError("LEDGER_COUNTER_MISMATCH")
    tables = {}
    for name in _IMMUTABLE_TABLES:
        if name not in names:
            continue
        columns = [row[1] for row in con.execute(f'PRAGMA table_info("{name}")')]
        if not columns or any(not _NAME.fullmatch(c) for c in columns):
            raise StateError("UNRECOGNIZED_LEDGER")
        rows = sorted(hashlib.sha256(_canonical(list(row))).hexdigest()
                      for row in con.execute(f'SELECT * FROM "{name}"'))
        if len(rows) != len(set(rows)):
            raise StateError("DUPLICATE_LEDGER_ROW")
        tables[name] = {"columns": columns, "row_hashes": rows}
    # Approval counters legitimately grow; approval ID/digest must never change.
    tables["approvals"] = {
        "columns": ["approval_id", "digest"],
        "row_hashes": sorted(hashlib.sha256(_canonical(list(row))).hexdigest()
                             for row in con.execute("SELECT approval_id,digest FROM approvals")),
    }
    return {"version": 1, "application_id": APPLICATION_ID, "tables": tables}


def verify_history(ledger: Path, manifest_path: Path) -> dict:
    """Verify all pinned history remains, accepting additive future events."""
    expected = json.loads(read_private(manifest_path))
    if (not isinstance(expected, dict) or set(expected) != {"version", "application_id", "tables"}
            or expected["version"] != 1 or expected["application_id"] != APPLICATION_ID
            or not isinstance(expected["tables"], dict)
            or not {"approvals", "reservations"} <= set(expected["tables"])):
        raise StateError("INVALID_HISTORY_MANIFEST")
    con = ledger_connection(ledger)
    try:
        con.execute("BEGIN")
        actual = history_manifest(con)
        for name, pinned in expected["tables"].items():
            if (name not in _IMMUTABLE_TABLES + ("approvals",)
                    or not isinstance(pinned, dict) or set(pinned) != {"columns", "row_hashes"}
                    or not isinstance(pinned["row_hashes"], list)
                    or any(not isinstance(h, str) or not re.fullmatch(r"[a-f0-9]{64}", h)
                           for h in pinned["row_hashes"])
                    or name not in actual["tables"]
                    or pinned["columns"] != actual["tables"][name]["columns"]
                    or not set(pinned["row_hashes"]) <= set(actual["tables"][name]["row_hashes"])):
                raise StateError("HISTORICAL_STATE_CHANGED")
        return {"history_preserved": True,
                "reservations": con.execute("SELECT count(*) FROM reservations").fetchone()[0],
                "approvals": con.execute("SELECT count(*) FROM approvals").fetchone()[0]}
    finally:
        con.close()


def create_backup(ledger: Path, usage_log: Path, output: Path) -> dict:
    """SQLite online backup; source never overwritten or initialized.

    Quiesce provider calls before a handoff/cutover. A periodic snapshot taken
    while calls are active preserves the ledger conservatively, but final log
    observations may lag; restore/cutover still needs explicit reconciliation.
    """
    ledger, usage_log, output = Path(ledger), Path(usage_log), Path(output)
    con = ledger_connection(ledger)
    try:
        usage = read_private(usage_log)
        private_directory(output.parent)
        private_directory(output, create=True)
        snapshot = output / "ledger.sqlite3"
        write_new(snapshot, b"")
        destination = sqlite3.connect(snapshot)
        try:
            con.backup(destination)
        finally:
            destination.close()
        snapshot_con = ledger_connection(snapshot)
        try:
            baseline = history_manifest(snapshot_con)
        finally:
            snapshot_con.close()
        write_new(output / "usage.jsonl", usage)
        write_new(output / "history.json", _canonical(baseline) + b"\n")
        files = {name: hashlib.sha256(read_private(output / name)).hexdigest()
                 for name in ("ledger.sqlite3", "usage.jsonl", "history.json")}
        manifest = {"version": 1, "created_at": datetime.now(timezone.utc).isoformat(), "files": files}
        write_new(output / "snapshot.json", _canonical(manifest) + b"\n")
        parent_fd = os.open(output, os.O_RDONLY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        return {"backup_created": True, **verify_history(snapshot, output / "history.json")}
    finally:
        con.close()


def verify_backup(directory: Path) -> dict:
    private_directory(directory)
    data = json.loads(read_private(directory / "snapshot.json", 65536))
    names = {"ledger.sqlite3", "usage.jsonl", "history.json"}
    if (not isinstance(data, dict) or set(data) != {"version", "created_at", "files"}
            or data["version"] != 1 or not isinstance(data["files"], dict)
            or set(data["files"]) != names):
        raise StateError("INVALID_BACKUP_MANIFEST")
    for name, expected in data["files"].items():
        if hashlib.sha256(read_private(directory / name)).hexdigest() != expected:
            raise StateError("BACKUP_HASH_MISMATCH")
    return {"backup_valid": True, **verify_history(directory / "ledger.sqlite3", directory / "history.json")}


def restore_new(directory: Path, output: Path) -> dict:
    """An isolated new-directory restore only; overwrite is never supported."""
    verify_backup(directory)
    private_directory(output.parent)
    private_directory(output, create=True)
    for name in ("ledger.sqlite3", "usage.jsonl", "history.json", "snapshot.json"):
        write_new(output / name, read_private(directory / name))
    return {"isolated_restore_verified": True, **verify_backup(output)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup")
    backup.add_argument("--ledger", type=Path, required=True)
    backup.add_argument("--usage-log", type=Path, required=True)
    backup.add_argument("--output", type=Path, required=True)
    check = sub.add_parser("verify")
    check.add_argument("--backup", type=Path, required=True)
    restore = sub.add_parser("restore-new")
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "backup":
            result = create_backup(args.ledger, args.usage_log, args.output)
        elif args.command == "verify":
            result = verify_backup(args.backup)
        else:
            result = restore_new(args.backup, args.output)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({"state_check": "failed", "code": "STAGING_STATE_UNAVAILABLE"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
