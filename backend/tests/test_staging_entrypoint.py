"""Image entrypoint safety/diagnostics with fully simulated OS operations."""
import errno
import importlib.util
import json
from pathlib import Path
import stat
from types import SimpleNamespace

import pytest


@pytest.fixture
def entrypoint(monkeypatch):
    path = Path(__file__).resolve().parents[2] / "deployment/start_staging.py"
    spec = importlib.util.spec_from_file_location("memy_staging_entrypoint_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []
    ids = {"uid": 0, "gid": 0}
    metadata = {"parent": stat.S_IFDIR | 0o755, "state": stat.S_IFDIR | 0o700, "uid": 0, "gid": 0, "dev": 17, "ino": 31, "children": []}
    failures = {}
    def op(name, *args, **kwargs):
        calls.append((name, args, kwargs))
        if name in failures:
            raise failures[name]
    class Parent:
        def lstat(self):
            op("parent-lstat")
            return SimpleNamespace(st_mode=metadata["parent"])
    class State:
        parent = Parent()
        def mkdir(self, **kwargs):
            op("state-mkdir", **kwargs)
        def lstat(self):
            op("state-lstat")
            return SimpleNamespace(st_mode=metadata["state"], st_uid=metadata["uid"], st_gid=metadata["gid"], st_dev=metadata["dev"], st_ino=metadata["ino"])
    state = State()
    real_open, real_fstat, real_listdir = module.os.open, module.os.fstat, module.os.listdir
    real_fchmod, real_fchown, real_close = module.os.fchmod, module.os.fchown, module.os.close
    def open_state(path, flags, *args, **kwargs):
        if path is not state: return real_open(path, flags, *args, **kwargs)
        op("bootstrap-open", flags)
        return 321
    def fstat(fd):
        if fd != 321: return real_fstat(fd)
        op("bootstrap-fstat")
        return SimpleNamespace(st_mode=metadata["state"], st_uid=metadata["uid"], st_gid=metadata["gid"], st_dev=metadata["dev"], st_ino=metadata["ino"])
    def listdir(path):
        if path != 321: return real_listdir(path)
        op("bootstrap-listdir")
        return metadata["children"]
    def fchmod(fd, mode):
        if fd != 321: return real_fchmod(fd, mode)
        op("bootstrap-mode", mode)
        if not metadata.get("ignore_mode"): metadata["state"] = stat.S_IFDIR | mode
    def fchown(fd, uid, gid):
        if fd != 321: return real_fchown(fd, uid, gid)
        op("bootstrap-owner", uid, gid)
        if not metadata.get("ignore_owner"): metadata.update(uid=uid, gid=gid)
    def close(fd):
        if fd != 321: return real_close(fd)
        op("bootstrap-close")
    monkeypatch.setattr(module.os, "open", open_state)
    monkeypatch.setattr(module.os, "fstat", fstat)
    monkeypatch.setattr(module.os, "listdir", listdir)
    monkeypatch.setattr(module.os, "fchmod", fchmod)
    monkeypatch.setattr(module.os, "fchown", fchown)
    monkeypatch.setattr(module.os, "close", close)
    for name in ("STAGING_BOOTSTRAP_AI_OFF", "STAGING_ENABLE_REAL_AI", "REAL_AI_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(module, "Path", lambda _: state)
    monkeypatch.setattr(module.os, "geteuid", lambda: ids["uid"])
    monkeypatch.setattr(module.os, "getegid", lambda: ids["gid"])
    monkeypatch.setattr(module.os, "chown", lambda *a, **k: op("state-chown", *a, **k))
    monkeypatch.setattr(module.os, "setgroups", lambda *a: op("drop-supplementary-groups", *a))
    def set_id(key, stage, value):
        op(stage, value)
        ids[key] = value
    monkeypatch.setattr(module.os, "setgid", lambda value: set_id("gid", "drop-gid", value))
    monkeypatch.setattr(module.os, "setuid", lambda value: set_id("uid", "drop-uid", value))
    monkeypatch.setattr(module.os, "umask", lambda *a: op("private-umask", *a))
    monkeypatch.setattr(module.os, "execv", lambda *a: op("exec-launcher", *a))
    return module, calls, ids, metadata, failures


def test_entrypoint_preserves_checks_and_drops_identity_before_exec(entrypoint, monkeypatch):
    module, calls, ids, _, _ = entrypoint
    monkeypatch.setattr(module.sys, "argv", ["start_staging.py", "--check"])
    assert module.run() == 0
    assert [row[0] for row in calls] == ["parent-lstat", "state-mkdir", "state-lstat", "state-chown", "drop-supplementary-groups", "drop-gid", "drop-uid", "private-umask", "exec-launcher"]
    assert ids == {"uid": 10001, "gid": 10001}
    assert calls[1][2] == {"mode": 0o700}
    assert calls[3][1][1:] == (10001, 10001) and calls[3][2] == {"follow_symlinks": False}
    assert calls[-2][1] == (0o077,)
    assert calls[-1][1][1] == [module.sys.executable, "/app/backend/scripts/run_staging.py", "--check"]


@pytest.mark.parametrize("stage", ["parent-lstat", "state-mkdir", "state-lstat", "state-chown", "drop-supplementary-groups", "drop-gid", "drop-uid", "private-umask", "exec-launcher"])
def test_each_os_failure_has_exact_stage_errno_and_no_private_exception(entrypoint, capsys, stage):
    module, _, _, _, failures = entrypoint
    failures[stage] = PermissionError(errno.EPERM, "private-config-marker", "/private/never-log-this")
    assert module.run() == 2
    output = capsys.readouterr()
    data = json.loads(output.err)
    assert data["event"] == "staging_volume_preparation" and data["ok"] is False
    assert data["stage"] == stage and data["errno"] == errno.EPERM and data["kind"] == "os-error"
    assert isinstance(data["euid"], int) and isinstance(data["egid"], int)
    assert "private-config-marker" not in output.err and "/private/" not in output.err
    assert output.out == ""


@pytest.mark.parametrize("field,value,stage", [
    ("parent", stat.S_IFLNK | 0o755, "parent-validation"),
    ("state", stat.S_IFLNK | 0o700, "state-validation"),
    ("state", stat.S_IFDIR | 0o755, "state-validation"),
    ("uid", 1234, "state-validation"),
])
def test_unsafe_paths_and_permissions_still_fail_without_chown_or_exec(entrypoint, capsys, field, value, stage):
    module, calls, _, metadata, _ = entrypoint
    metadata[field] = value
    assert module.run() == 2
    data = json.loads(capsys.readouterr().err)
    assert data["stage"] == stage and data["kind"] == "validation-error" and data["errno"] is None
    assert not any(row[0] in {"state-chown", "exec-launcher"} for row in calls)


def test_existing_private_directory_is_not_recursively_modified(entrypoint):
    module, calls, _, _, failures = entrypoint
    failures["state-mkdir"] = FileExistsError()
    assert module.run() == 0
    assert len([row for row in calls if row[0] == "state-chown"]) == 1


def test_already_unprivileged_start_never_attempts_privileged_preparation(entrypoint):
    module, calls, ids, _, _ = entrypoint
    ids.update(uid=10001, gid=10001)
    assert module.run() == 0
    assert [row[0] for row in calls] == ["private-umask", "exec-launcher"]


def ai_off_bootstrap(monkeypatch):
    for key, value in {"STAGING_BOOTSTRAP_AI_OFF": "true", "STAGING_ENABLE_REAL_AI": "false", "REAL_AI_ENABLED": "false"}.items():
        monkeypatch.setenv(key, value)


@pytest.mark.parametrize("uid,mode", [(0, 0o755), (1000, 0o755), (1000, 0o700), (10001, 0o775)])
def test_explicit_ai_off_bootstrap_claims_only_empty_real_platform_directory(entrypoint, monkeypatch, uid, mode):
    module, calls, _, metadata, _ = entrypoint
    ai_off_bootstrap(monkeypatch)
    metadata.update(uid=uid, state=stat.S_IFDIR | mode)
    assert module.run() == 0
    assert metadata["uid"] == metadata["gid"] == 10001
    assert stat.S_IMODE(metadata["state"]) == 0o700
    opened = next(row for row in calls if row[0] == "bootstrap-open")
    assert opened[1][0] & module.os.O_NOFOLLOW and opened[1][0] & module.os.O_DIRECTORY
    assert [row[0] for row in calls].count("bootstrap-close") == 1
    assert [row[0] for row in calls].count("bootstrap-listdir") == 2


@pytest.mark.parametrize("flag,value", [("STAGING_BOOTSTRAP_AI_OFF", "false"), ("STAGING_ENABLE_REAL_AI", "true"), ("REAL_AI_ENABLED", "true"), ("REAL_AI_ENABLED", "")])
def test_directory_repair_requires_all_three_explicit_ai_off_flags(entrypoint, monkeypatch, capsys, flag, value):
    module, calls, _, metadata, _ = entrypoint
    ai_off_bootstrap(monkeypatch)
    monkeypatch.setenv(flag, value)
    metadata.update(uid=1000, state=stat.S_IFDIR | 0o755)
    assert module.run() == 2
    data=json.loads(capsys.readouterr().err)
    assert data["stage"] == "state-validation" and data["uid"] == 1000 and data["mode"] == 0o755
    assert not any(row[0].startswith("bootstrap-") for row in calls)


@pytest.mark.parametrize("kind", ["populated", "symlink", "unchanged-mode", "unchanged-owner"])
def test_bootstrap_never_claims_populated_or_linked_state_and_requires_changes_to_stick(entrypoint, monkeypatch, capsys, kind):
    module, calls, _, metadata, _ = entrypoint
    ai_off_bootstrap(monkeypatch)
    metadata.update(uid=1000, state=stat.S_IFDIR | 0o755)
    if kind == "populated": metadata["children"] = ["existing-ledger.sqlite3"]
    if kind == "symlink": metadata["state"] = stat.S_IFLNK | 0o755
    if kind == "unchanged-mode": metadata["ignore_mode"] = True
    if kind == "unchanged-owner": metadata["ignore_owner"] = True
    assert module.run() == 2
    data=json.loads(capsys.readouterr().err)
    assert data["stage"] == {"populated":"bootstrap-empty", "symlink":"state-validation"}.get(kind, "bootstrap-recheck")
    assert not any(row[0] in {"state-chown", "exec-launcher"} for row in calls)
    if kind in {"populated", "symlink"}:
        assert not any(row[0] in {"bootstrap-mode", "bootstrap-owner"} for row in calls)
    if kind != "symlink": assert any(row[0] == "bootstrap-close" for row in calls)


def test_populated_correct_private_directory_keeps_existing_startup_contract(entrypoint):
    module, calls, _, metadata, _ = entrypoint
    metadata["children"] = ["existing-ledger.sqlite3"]
    assert module.run() == 0
    assert not any(row[0].startswith("bootstrap-") for row in calls)
