"""Offline real-TypeScript/FastAPI contract bridge and safety checks."""

import io
import json
import subprocess
import sys

from fastapi.testclient import TestClient
import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from scripts import verify_mobile_contract as verifier


def test_actual_pinned_mobile_typescript_client_matches_real_fastapi_offline():
    # Backend-only/shallow clones and Python-only machines can run the normal
    # suite. Skip only absent prerequisites, never changed source or a failed
    # contract when both the pinned blob and supported runtime are present.
    try:
        verifier.load_mobile_source(verifier.BACKEND_DIR.parent)
    except verifier.ContractCheckError as error:
        if str(error) == "PINNED_MOBILE_SOURCE_UNAVAILABLE":
            pytest.skip("Pinned mobile Git blob unavailable; run the explicit CLI in a clone containing commit 59762f2")
        raise
    try:
        node = verifier.resolve_node()
    except verifier.ContractCheckError as error:
        if str(error) == "NODE_24_OR_NEWER_REQUIRED":
            pytest.skip("Node 24+ is required only for the optional real TypeScript contract check")
        raise
    report = verifier.run_contract_check(node=node)
    assert report["result"] == "PASS"
    assert report["mobile_commit"] == "59762f2f8413b7f328421fb158489594511a1e06"
    assert report["source_sha256"] == verifier.MOBILE_SOURCE_SHA256
    assert report["request_count"] == 15
    assert len(report["checks"]) == 17
    assert {"create-en", "create-sv", "patch-sv", "cross-user-detail",
            "database-write-unavailable-no-retry", "missing-auth-no-dispatch"} <= set(report["checks"])
    assert report["transport"] == "in-process-offline"


def test_pinned_source_is_read_from_exact_git_object_without_fetch(monkeypatch, tmp_path):
    seen = []

    def run(command, **kwargs):
        seen.append((command, kwargs))
        return subprocess.CompletedProcess(command, 128, stdout=b"", stderr=b"private unrelated git message")

    monkeypatch.setattr(verifier.subprocess, "run", run)
    with pytest.raises(verifier.ContractCheckError, match="^PINNED_MOBILE_SOURCE_UNAVAILABLE$"):
        verifier.load_mobile_source(tmp_path)
    assert seen[0][0] == ["git", "show", f"{verifier.MOBILE_COMMIT}:{verifier.MOBILE_SOURCE_PATH}"]
    assert seen[0][1]["cwd"] == tmp_path
    assert seen[0][1]["timeout"] == 10


def test_source_digest_refuses_unreviewed_module(monkeypatch, tmp_path):
    monkeypatch.setattr(verifier.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args[0], 0, stdout=b"throw new Error('not the pinned module')"))
    with pytest.raises(verifier.ContractCheckError, match="^PINNED_MOBILE_SOURCE_MISMATCH$"):
        verifier.load_mobile_source(tmp_path)


def test_missing_node_fails_with_safe_actionable_classification(monkeypatch):
    monkeypatch.setattr(verifier, "load_mobile_source", lambda *_args: "synthetic")
    monkeypatch.setattr(verifier.shutil, "which", lambda *_args: None)
    with pytest.raises(verifier.ContractCheckError, match="^NODE_24_OR_NEWER_REQUIRED$"):
        verifier.run_contract_check()


@pytest.mark.parametrize("version,supported", [(b"v24.11.1\n", True), (b"v25.0.0\n", True),
    (b"v22.13.0\n", False), (b"v20.0.0\n", False), (b"not a version\n", False)])
def test_node_preflight_validates_version_with_sanitized_environment(monkeypatch, version, supported):
    seen = []
    monkeypatch.setenv("NODE_OPTIONS", "--require=should-never-execute.cjs")
    monkeypatch.setenv("MEMY_DAY7_USER_A_TOKEN", "synthetic-parent-token")

    def run(command, **kwargs):
        seen.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout=version, stderr=b"private ignored details")

    monkeypatch.setattr(verifier.subprocess, "run", run)
    if supported:
        assert verifier.resolve_node("synthetic-node") == "synthetic-node"
    else:
        with pytest.raises(verifier.ContractCheckError, match="^NODE_24_OR_NEWER_REQUIRED$"):
            verifier.resolve_node("synthetic-node")
    assert seen[0][0] == ["synthetic-node", "--version"]
    assert seen[0][1]["timeout"] == 5
    assert "NODE_OPTIONS" not in seen[0][1]["env"]
    assert "MEMY_DAY7_USER_A_TOKEN" not in seen[0][1]["env"]


@pytest.mark.parametrize("failure", [OSError("private executable path"), subprocess.TimeoutExpired("node", 5)])
def test_node_preflight_operating_system_errors_are_safe(monkeypatch, failure):
    def fail(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(verifier.subprocess, "run", fail)
    with pytest.raises(verifier.ContractCheckError, match="^NODE_24_OR_NEWER_REQUIRED$"):
        verifier.resolve_node("synthetic-node")


@pytest.mark.parametrize("failure", [OSError("private file path"), subprocess.TimeoutExpired("git", 10)])
def test_git_operating_system_failures_never_echo_details(monkeypatch, tmp_path, failure):
    def fail(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(verifier.subprocess, "run", fail)
    with pytest.raises(verifier.ContractCheckError, match="^PINNED_MOBILE_SOURCE_UNAVAILABLE$"):
        verifier.load_mobile_source(tmp_path)


def test_console_report_contains_only_fixed_safe_failure(monkeypatch):
    def fail():
        raise verifier.ContractCheckError("MOBILE_CLIENT_FAILED")

    monkeypatch.setattr(verifier, "run_contract_check", fail)
    output = io.StringIO()
    assert verifier.main(output) == 1
    assert output.getvalue() == "result=FAIL\nreason=MOBILE_CLIENT_FAILED\n"


def test_success_output_discloses_offline_limitations(monkeypatch):
    monkeypatch.setattr(verifier, "run_contract_check", lambda: {"result": "PASS", "checks": []})
    output = io.StringIO()
    assert verifier.main(output) == 0
    assert "no_real_device_no_LAN_no_live_Auth_no_database_RLS_proof" in output.getvalue()
    assert "synthetic-alice-token" not in output.getvalue()


def test_optimized_python_cli_fails_closed_before_source_or_node_work():
    result = subprocess.run([sys.executable, "-O", str(verifier.BACKEND_DIR / "scripts/verify_mobile_contract.py")],
                            capture_output=True, text=True, timeout=10, env=verifier.child_environment())
    assert result.returncode == 1
    assert result.stdout == "result=FAIL\nreason=OPTIMIZED_PYTHON_UNSUPPORTED\n"
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("change", ["reordered", "wrong-names", "extra", "reported-count", "observed-count", "project-count"])
def test_standalone_requires_exact_checks_and_independent_request_count(change):
    message = {"checks": list(verifier.EXPECTED_CHECKS), "request_count": 15}
    observed, projects = 15, 3
    if change == "reordered":
        message["checks"] = list(reversed(message["checks"]))
    elif change == "wrong-names":
        message["checks"][0] = "unrelated-check"
    elif change == "extra":
        message["checks"].append("extra-check")
    elif change == "reported-count":
        message["request_count"] = 14
    elif change == "observed-count":
        observed = 14
    else:
        projects = 4
    with pytest.raises(verifier.ContractCheckError, match="^MOBILE_CONTRACT_CHECK_FAILED$"):
        verifier.contract_report(message, observed, projects)


def test_unexpected_cli_failures_do_not_echo_exception_or_traceback(monkeypatch):
    def fail():
        raise RuntimeError("SYNTHETIC_PRIVATE_UPSTREAM_RESPONSE synthetic-parent-token")

    monkeypatch.setattr(verifier, "run_contract_check", fail)
    output = io.StringIO()
    assert verifier.main(output) == 1
    assert output.getvalue() == "result=FAIL\nreason=MOBILE_CONTRACT_CHECK_FAILED\n"


@pytest.mark.parametrize("failure", ["kill", "wait", "close"])
def test_cleanup_errors_are_classified_without_private_details(monkeypatch, failure):
    class FailingStream(io.StringIO):
        def close(self):
            if failure == "close" and not getattr(self, "failed_once", False):
                self.failed_once = True
                raise OSError("private close information")
            super().close()

    class Process:
        stdin = FailingStream()
        stdout = FailingStream("")

        def poll(self):
            return None

        def kill(self):
            if failure == "kill":
                raise OSError("private kill information")

        def wait(self, **_kwargs):
            if failure == "wait":
                raise OSError("private wait information")
            return 0

    monkeypatch.setattr(verifier, "load_mobile_source", lambda *_args: "synthetic")
    monkeypatch.setattr(verifier, "resolve_node", lambda *_args: "synthetic-node")
    monkeypatch.setattr(verifier.subprocess, "Popen", lambda *_args, **_kwargs: Process())
    with pytest.raises(verifier.ContractCheckError, match="^MOBILE_CLIENT_CLEANUP_FAILED$"):
        verifier.run_contract_check()


@pytest.mark.parametrize("origin", ["https://example.com", "http://127.0.0.1:8000",
                                    "http://192.168.50.2:8001", "https://192.168.50.2:8000"])
def test_bridge_rejects_unexpected_origins_before_fastapi_dispatch(origin):
    class NeverCalled:
        def request(self, *_args, **_kwargs):
            pytest.fail("Unexpected origin reached FastAPI")

    with pytest.raises(AssertionError):
        verifier.dispatch(NeverCalled(), verifier.SyntheticSupabase(), {
            "type": "request", "url": f"{origin}/api/v1/story-projects",
        })


def test_fastapi_missing_auth_is_401_without_upstream_calls():
    def never(_request):
        pytest.fail("Missing auth called the upstream fixture")

    app = create_app(Settings(_env_file=None, supabase_url="https://offline-supabase.invalid",
                              supabase_publishable_key=verifier.PUBLIC_KEY),
                     transport=httpx.MockTransport(never))
    with TestClient(app) as client:
        response = verifier.dispatch(client, verifier.SyntheticSupabase(), {
            "type": "request", "id": 1, "case": "direct-missing-auth",
            "url": "http://192.168.50.2:8000/api/v1/story-projects?limit=50&offset=0",
            "method": "GET", "headers": {"Accept": "application/json"}, "body": None,
            "credentials": "omit", "cache": "no-store", "redirect": "error",
        })
    assert response["status"] == 401
    assert json.loads(response["body"])["error"]["code"] == "AUTHORIZATION_REQUIRED"
