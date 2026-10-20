"""Offline cross-language check of the pinned real Expo project API client.

Loads only one self-contained TypeScript module from a local Git object. Its
injected fetch is bridged over stdio to FastAPI TestClient; Auth and PostgREST
are stateful HTTPX MockTransport fixtures. No sockets, emails, credentials or
cloud access are used. This is not real-iPhone, LAN, Auth-token or RLS proof.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
from typing import TextIO
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

MOBILE_COMMIT = "59762f2f8413b7f328421fb158489594511a1e06"
MOBILE_SOURCE_PATH = "apps/mobile/src/api/story-projects.ts"
MOBILE_SOURCE_SHA256 = "d16d988a1e086dd72c6c35aacf83a53e00ceb6bf1d7325529381fc4918ce7a64"
ALICE = "11111111-1111-4111-8111-111111111111"
BOB = "22222222-2222-4222-8222-222222222222"
PUBLIC_KEY = "synthetic-publishable-key"
STAMP = "2026-10-20T10:00:00Z"
EXPECTED_CHECKS = (
    "create-en", "create-sv", "list-own-projects", "detail-en", "patch-en",
    "detail-sv", "patch-sv", "patch-clear-description", "missing-auth-no-dispatch",
    "expired-auth", "cross-user-detail", "cross-user-update", "other-owner-list",
    "database-read-unavailable", "database-write-unavailable-no-retry",
    "local-validation-no-dispatch", "reconcile-owner-data",
)
EXPECTED_REQUEST_COUNT = 15


class ContractCheckError(Exception):
    """A fixed, secret-free failure classification."""


def load_mobile_source(repo_dir: Path) -> str:
    """Read the exact reviewed blob without fetching or checking out a branch."""
    try:
        result = subprocess.run(
            ["git", "show", f"{MOBILE_COMMIT}:{MOBILE_SOURCE_PATH}"],
            cwd=repo_dir, capture_output=True, timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ContractCheckError("PINNED_MOBILE_SOURCE_UNAVAILABLE") from None
    if result.returncode != 0:
        raise ContractCheckError("PINNED_MOBILE_SOURCE_UNAVAILABLE")
    if hashlib.sha256(result.stdout).hexdigest() != MOBILE_SOURCE_SHA256:
        raise ContractCheckError("PINNED_MOBILE_SOURCE_MISMATCH")
    return result.stdout.decode("utf-8")


def child_environment() -> dict[str, str]:
    """Minimal child environment: no tokens, NODE_OPTIONS or app .env values."""
    environment = {name: os.environ[name] for name in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP") if name in os.environ}
    environment["NODE_NO_WARNINGS"] = "1"
    return environment


def resolve_node(node: str | None = None) -> str:
    """Require the supported runtime without executing inherited Node options."""
    executable = node or shutil.which("node")
    if not executable:
        raise ContractCheckError("NODE_24_OR_NEWER_REQUIRED")
    try:
        result = subprocess.run([executable, "--version"], capture_output=True,
                                timeout=5, check=False, env=child_environment())
        version = re.fullmatch(rb"v(\d+)\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\s*", result.stdout)
        if result.returncode != 0 or version is None or int(version[1]) < 24:
            raise ContractCheckError("NODE_24_OR_NEWER_REQUIRED")
    except (OSError, subprocess.TimeoutExpired):
        raise ContractCheckError("NODE_24_OR_NEWER_REQUIRED") from None
    return executable


class SyntheticSupabase:
    """Small owner-filtered fixture, not a replacement for PostgreSQL RLS tests."""

    def __init__(self):
        self.case = ""
        self.projects = [{
            "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "user_id": BOB,
            "title": "Bob fictional project", "description": None, "language": "en",
            "status": "draft", "created_at": STAMP, "updated_at": STAMP,
        }]
        self.project_counter = 1

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "offline-supabase.invalid"
        assert request.headers["apikey"] == PUBLIC_KEY
        token = request.headers.get("authorization")
        user = {"Bearer synthetic-alice-token": ALICE, "Bearer synthetic-bob-token": BOB}.get(token)
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": user}) if user else httpx.Response(
                401, json={"message": "SYNTHETIC_PRIVATE_UPSTREAM_RESPONSE"})
        assert user is not None
        assert request.url.path == "/rest/v1/story_projects"
        if self.case.startswith("database-"):
            return httpx.Response(500, json={"message": "SYNTHETIC_PRIVATE_UPSTREAM_RESPONSE"})
        if request.method == "POST":
            values = json.loads(request.content)
            assert values["user_id"] == user
            assert set(values) == {"user_id", "title", "language"}
            self.project_counter += 1
            row = {"id": str(UUID(int=self.project_counter)), "description": None,
                   "status": "draft", "created_at": STAMP, "updated_at": STAMP, **values}
            self.projects.append(row)
            return httpx.Response(201, json=[dict(row)])
        assert request.method in {"GET", "PATCH"}
        assert request.url.params["user_id"] == f"eq.{user}"
        rows = [row for row in self.projects if row["user_id"] == user]
        selected = request.url.params.get("id")
        if selected:
            rows = [row for row in rows if f"eq.{row['id']}" == selected]
        if request.method == "PATCH":
            values = json.loads(request.content)
            assert set(values) <= {"title", "description"}
            for row in rows:
                row.update(values)
        return httpx.Response(200, json=[dict(row) for row in rows])


def dispatch(client: TestClient, fixture: SyntheticSupabase, message: dict) -> dict:
    """Validate the genuine mobile request before forwarding in-process."""
    assert message["type"] == "request"
    parsed = urlsplit(message["url"])
    assert (parsed.scheme, parsed.netloc) == ("http", "192.168.50.2:8000")
    assert parsed.path.startswith("/api/v1/story-projects")
    assert "/api/v1/api/v1/" not in parsed.path
    assert message["credentials"] == "omit"
    assert message["cache"] == "no-store"
    assert message["redirect"] == "error"
    assert message["method"] in {"GET", "POST", "PATCH"}
    fixture.case = message["case"]
    response = client.request(
        message["method"], parsed.path + (f"?{parsed.query}" if parsed.query else ""),
        headers=message["headers"], content=message["body"],
    )
    assert response.headers.get("cache-control") == "no-store"
    return {"type": "response", "id": message["id"], "status": response.status_code,
            "headers": {"content-type": response.headers["content-type"]}, "body": response.text}


def contract_report(message: dict, observed_requests: int, project_count: int) -> dict:
    """Accept only the exact successful suite and independently counted bridge."""
    if (message.get("checks") != list(EXPECTED_CHECKS)
        or message.get("request_count") != EXPECTED_REQUEST_COUNT
        or observed_requests != EXPECTED_REQUEST_COUNT or project_count != 3):
        raise ContractCheckError("MOBILE_CONTRACT_CHECK_FAILED")
    return {"result": "PASS", "mobile_commit": MOBILE_COMMIT,
            "source_sha256": MOBILE_SOURCE_SHA256, "checks": list(EXPECTED_CHECKS),
            "request_count": observed_requests, "transport": "in-process-offline"}


def run_contract_check(*, repo_dir: Path | None = None, node: str | None = None) -> dict:
    # The fixture and bridge use Python assertions as executable invariants.
    # Never present successful verification after Python has removed them.
    if not __debug__:
        raise ContractCheckError("OPTIMIZED_PYTHON_UNSUPPORTED")
    source = load_mobile_source(repo_dir or BACKEND_DIR.parent)
    executable = resolve_node(node)
    # Do not pass parent auth tokens, NODE_OPTIONS, .env or developer tooling
    # configuration into the child. Node's actual network API is never called.
    environment = child_environment()
    fixture = SyntheticSupabase()
    app = create_app(Settings(_env_file=None, supabase_url="https://offline-supabase.invalid",
                              supabase_publishable_key=PUBLIC_KEY),
                     transport=httpx.MockTransport(fixture.handle))
    process = None
    try:
        process = subprocess.Popen(
            [executable, str(BACKEND_DIR / "scripts/mobile_contract_client.cjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", env=environment,
        )
        messages = queue.Queue()

        def read_lines():
            try:
                for line in process.stdout:
                    messages.put(line if len(line) < 200_000 else "invalid")
            except Exception:
                # A failed/closed pipe must not print a thread traceback.
                pass
            finally:
                messages.put(None)

        threading.Thread(target=read_lines, daemon=True).start()
        process.stdin.write(json.dumps({"type": "source", "source": source}) + "\n")
        process.stdin.flush()
        observed_requests = 0
        with TestClient(app) as client:
            for _ in range(100):
                try:
                    line = messages.get(timeout=15)
                except queue.Empty:
                    raise ContractCheckError("MOBILE_CLIENT_TIMEOUT") from None
                if line is None:
                    raise ContractCheckError("MOBILE_CLIENT_FAILED")
                message = json.loads(line)
                if message.get("type") == "result":
                    report = contract_report(message, observed_requests, len(fixture.projects))
                    assert process.wait(timeout=5) == 0
                    return report
                reply = dispatch(client, fixture, message)
                observed_requests += 1
                process.stdin.write(json.dumps(reply) + "\n")
                process.stdin.flush()
        raise ContractCheckError("MOBILE_CLIENT_PROTOCOL_LIMIT")
    except ContractCheckError:
        raise
    except (OSError, ValueError, KeyError, AssertionError, subprocess.TimeoutExpired):
        raise ContractCheckError("MOBILE_CONTRACT_CHECK_FAILED") from None
    finally:
        if process is not None:
            cleanup_failed = False
            try:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
            except Exception:
                cleanup_failed = True
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        cleanup_failed = True
            if cleanup_failed:
                raise ContractCheckError("MOBILE_CLIENT_CLEANUP_FAILED") from None


def main(output: TextIO | None = None) -> int:
    destination = output or sys.stdout
    try:
        report = run_contract_check()
    except ContractCheckError as error:
        destination.write(f"result=FAIL\nreason={error}\n")
        return 1
    except Exception:
        destination.write("result=FAIL\nreason=MOBILE_CONTRACT_CHECK_FAILED\n")
        return 1
    destination.write(json.dumps(report, indent=2) + "\n")
    destination.write("limitations=no_real_device_no_LAN_no_live_Auth_no_database_RLS_proof\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
