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
    metadata = {"parent": stat.S_IFDIR | 0o755, "state": stat.S_IFDIR | 0o700, "uid": 0}
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
            return SimpleNamespace(st_mode=metadata["state"], st_uid=metadata["uid"])
    state = State()
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
