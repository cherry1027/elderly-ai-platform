"""Staging controls tested without providers, network listeners or hosted data."""

import base64
import json
import os
import sqlite3

from fastapi.testclient import TestClient
import httpx
import pytest

from scripts.monitor_staging import monitor
from scripts.run_staging import (
    DEVELOPMENT_SUPABASE, StateError, https_origin, main, prune_backups,
    staging_app, staging_configuration,
)
from scripts.staging_state import APPLICATION_ID, create_backup, write_new


@pytest.fixture
def staging(tmp_path, monkeypatch):
    state = tmp_path / "private"
    state.mkdir(mode=0o700)
    for key, value in {
        "STAGING_STATE_DIR": str(state), "STAGING_ORIGIN": "https://memy-stage.example.com",
        "STAGING_TLS_MODE": "render-edge", "RENDER": "true",
        "RENDER_EXTERNAL_HOSTNAME": "memy-stage.example.com", "CORS_ORIGINS": '["https://memy-web.example.com"]',
        "SUPABASE_URL": DEVELOPMENT_SUPABASE, "SUPABASE_PUBLISHABLE_KEY": "synthetic-public",
        "STAGING_BOOTSTRAP_AI_OFF": "true", "STAGING_ENABLE_REAL_AI": "false",
    }.items():
        monkeypatch.setenv(key, value)
    return state


def historical_state(state):
    ledger = state / "ledger.sqlite3"
    ledger.touch(mode=0o600)
    con = sqlite3.connect(ledger)
    con.executescript(f"""
        PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=1;
        CREATE TABLE approvals(approval_id TEXT PRIMARY KEY,digest TEXT,reserved_calls INTEGER,
            reserved_microusd INTEGER,last_reserved_at REAL);
        CREATE TABLE reservations(reservation_id TEXT PRIMARY KEY,approval_id TEXT,
            operation TEXT,model TEXT,reserved_at REAL,ceiling_microusd INTEGER);
        INSERT INTO approvals VALUES('old','digest',1,250000,1.0);
        INSERT INTO reservations VALUES('id','old','conversation','synthetic',1.0,250000);
    """)
    con.close()
    write_new(state / "usage.jsonl", b"{}\n")
    create_backup(ledger, state / "usage.jsonl", state / "seed")
    write_new(state / "history.json", (state / "seed" / "history.json").read_bytes())


@pytest.mark.parametrize("origin", [
    "http://memy.example.com", "https://localhost", "https://127.0.0.1", "https://*.example.com",
    "https://user:pass@example.com", "https://example.com/path", "https://example.com?key=x",
    "https://example.com#x", "https://example.com:8000", "https://-bad.example.com", "https://singlelabel",
])
def test_origin_validation(origin):
    with pytest.raises((ValueError, StateError)):
        https_origin(origin)


def test_explicit_ai_off_bootstrap_never_initializes_a_ledger(staging, monkeypatch):
    monkeypatch.setenv("REAL_AI_ENABLED", "true")
    settings, options = staging_configuration()
    assert settings.real_ai_enabled is False
    app = staging_app(settings, options)
    with TestClient(app, base_url="https://memy-stage.example.com") as client:
        assert client.get("/health").status_code == 200
        cap = client.get("/api/v2/capabilities").json()
        assert cap["enabled"] is False and cap["reason"] == "LIVE_AI_DISABLED"
    assert not (staging / "ledger.sqlite3").exists()


def test_missing_history_without_explicit_bootstrap_fails_without_reset(staging, monkeypatch):
    monkeypatch.setenv("STAGING_BOOTSTRAP_AI_OFF", "false")
    with pytest.raises(FileNotFoundError):
        staging_configuration()
    assert not (staging / "ledger.sqlite3").exists()


def test_preserved_history_is_required_after_provisioning(staging, monkeypatch):
    historical_state(staging)
    monkeypatch.setenv("STAGING_BOOTSTRAP_AI_OFF", "false")
    settings, options = staging_configuration()
    assert settings.ai_usage_ledger_path == staging / "ledger.sqlite3"
    assert settings.real_ai_usage_log_path == staging / "usage.jsonl"
    assert options["bootstrap"] is False
    assert main(["--check"]) == 0


def test_launcher_restores_process_umask_for_in_process_callers(staging):
    previous = os.umask(0o022)
    try:
        assert main(["--check"]) == 0
        current = os.umask(0o022)
        assert current == 0o022
    finally:
        os.umask(previous)


def test_encrypted_speech_database_survives_staging_configuration_restart(staging, monkeypatch):
    monkeypatch.setenv("REAL_AI_SPEECH_STORAGE_PATH", str(staging / "speech.sqlite3"))
    monkeypatch.setenv("REAL_AI_SPEECH_ENCRYPTION_KEY", base64.b64encode(b"s" * 32).decode())
    first_settings, first_options = staging_configuration()
    first = staging_app(first_settings, first_options)
    first.state.real_ai.cache.close()
    assert (staging / "speech.sqlite3").is_file()
    second_settings, second_options = staging_configuration()
    second = staging_app(second_settings, second_options)
    second.state.real_ai.cache.close()
    assert second_settings.real_ai_speech_storage_path == staging / "speech.sqlite3"


def test_bootstrap_cannot_hide_a_partial_import_or_enable_paid_calls(staging, monkeypatch):
    write_new(staging / "usage.jsonl", b"{}\n")
    with pytest.raises(StateError, match="INCOMPLETE_STAGING_STATE"):
        staging_configuration()
    monkeypatch.setenv("STAGING_ENABLE_REAL_AI", "true")
    with pytest.raises(StateError, match="BOOTSTRAP_CANNOT_ENABLE_AI"):
        staging_configuration()


def test_wrong_project_cannot_start_staging(staging, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://different.supabase.co")
    with pytest.raises(StateError, match="DEVELOPMENT_PROJECT_REQUIRED"):
        staging_configuration()


def test_paid_staging_requires_reviewed_private_cohort_without_creating_history(staging, monkeypatch):
    from uuid import uuid4

    historical_state(staging)
    monkeypatch.setenv("STAGING_BOOTSTRAP_AI_OFF", "false")
    monkeypatch.setenv("STAGING_ENABLE_REAL_AI", "true")
    monkeypatch.setenv("REAL_AI_ENABLED", "true")
    with pytest.raises(StateError, match="PILOT_COHORT_REQUIRED"):
        staging_configuration()
    cohort = staging / "cohort.json"
    write_new(cohort, b'{"version":1,"approved_by":"offline-review","user_ids":[]}')
    monkeypatch.setenv("AI_PILOT_COHORT_PATH", str(cohort))
    with pytest.raises(StateError, match="PILOT_COHORT_UNAVAILABLE"):
        staging_configuration()
    cohort.write_text(json.dumps({"version": 1, "approved_by": "offline-review", "user_ids": [str(uuid4())]}))
    approval, policy = staging / "approval.json", staging / "policy.json"
    write_new(approval, b"{}")
    write_new(policy, b"{}")
    monkeypatch.setenv("LIVE_AI_APPROVAL_PATH", str(approval))
    monkeypatch.setenv("AI_BUDGET_POLICY_PATH", str(policy))
    monkeypatch.setenv("REAL_AI_SPEECH_ENABLED", "false")
    settings, _ = staging_configuration()
    assert settings.real_ai_enabled is True and settings.ai_pilot_cohort_path == cohort
    con = sqlite3.connect(staging / "ledger.sqlite3")
    try:
        assert con.execute("SELECT count(*) FROM reservations").fetchone() == (1,)
    finally:
        con.close()


@pytest.mark.parametrize("key,value", [
    ("RENDER", "false"), ("RENDER_EXTERNAL_HOSTNAME", "wrong.example.com"),
    ("RENDER_EXTERNAL_HOSTNAME", ""),
    ("CORS_ORIGINS", '["http://localhost:5173"]'), ("CORS_ORIGINS", '["*"]'),
    ("STAGING_TLS_MODE", "insecure"), ("STAGING_ENABLE_REAL_AI", "1"),
])
def test_unreviewed_transport_and_permissive_configuration_are_rejected(staging, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises((ValueError, StateError)):
        staging_configuration()


def test_allowed_host_cors_auth_and_security_headers(staging):
    settings, options = staging_configuration()
    with TestClient(staging_app(settings, options), base_url="https://memy-stage.example.com") as client:
        good = client.get("/health")
        assert good.status_code == 200
        assert good.headers["Strict-Transport-Security"] == "max-age=31536000"
        assert good.headers["X-Content-Type-Options"] == "nosniff"
        assert client.get("/health", headers={"host": "attacker.example.com"}).status_code == 400
        assert client.get("/api/v1/story-projects").status_code == 401
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404
        preflight = client.options("/api/v1/story-projects", headers={
            "Origin": "https://memy-web.example.com", "Access-Control-Request-Method": "GET",
        })
        assert preflight.headers["Access-Control-Allow-Origin"] == "https://memy-web.example.com"
        unrelated = client.options("/api/v1/story-projects", headers={
            "Origin": "https://unrelated.example.com", "Access-Control-Request-Method": "GET",
        })
        assert "Access-Control-Allow-Origin" not in unrelated.headers


def test_monitor_only_requests_public_read_only_routes_and_sanitizes_results():
    seen = []
    def handler(request):
        seen.append((request.method, request.url.path, dict(request.headers)))
        payload = {
            "/health": {"status": "ok", "service": "memy-ai-backend"},
            "/ready": {"database": "ok"},
            "/api/v2/capabilities": {"contract": "real-v2", "mode": "real", "enabled": False},
        }
        return httpx.Response(200, json=payload[request.url.path])
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = monitor("https://memy-stage.example.com", client)
    assert result["service_healthy"] is True and result["ai_enabled"] is False
    assert [row[0] for row in seen] == ["GET", "GET", "GET"]
    assert [row[1] for row in seen] == ["/health", "/ready", "/api/v2/capabilities"]
    assert all("authorization" not in row[2] and "apikey" not in row[2] for row in seen)


def test_monitor_never_echoes_upstream_error_bodies():
    marker = "private-story-or-token"
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503, text=marker))) as client:
        result = monitor("https://memy-stage.example.com", client)
    assert result["service_healthy"] is False
    assert marker not in json.dumps(result)


def test_backup_pruning_only_removes_verified_managed_copies(staging):
    historical_state(staging)
    backups = staging / "backups"
    backups.mkdir(mode=0o700)
    for stamp in ("20261101T000000000000Z", "20261102T000000000000Z", "20261103T000000000000Z"):
        create_backup(staging / "ledger.sqlite3", staging / "usage.jsonl", backups / stamp)
    other = backups / "unrelated"
    other.mkdir(mode=0o700)
    write_new(other / "keep", b"not a managed snapshot")
    prune_backups(backups, 2)
    assert not (backups / "20261101T000000000000Z").exists()
    assert (backups / "20261102T000000000000Z").exists()
    assert (backups / "20261103T000000000000Z").exists()
    assert (other / "keep").read_bytes() == b"not a managed snapshot"
    assert (staging / "ledger.sqlite3").exists()


def test_staging_launch_is_single_worker_and_shutdown_is_bounded(staging, monkeypatch):
    import uvicorn

    recorded = {}
    monkeypatch.setenv("WEB_CONCURRENCY", "7")
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: recorded.update(options))
    assert main([]) == 0
    assert recorded["workers"] == 1
    assert recorded["host"] == "0.0.0.0" and recorded["port"] == 10000
    assert recorded["proxy_headers"] is False and recorded["forwarded_allow_ips"] == ""
    assert recorded["timeout_graceful_shutdown"] == 20
    assert recorded["timeout_keep_alive"] == 5
    assert not (staging / "ledger.sqlite3").exists()
    assert not (staging / "backups").exists()


def test_web_stream_recovery_headers_are_exposed_only_to_exact_origin(staging):
    settings, options = staging_configuration()
    with TestClient(staging_app(settings, options), base_url="https://memy-stage.example.com") as client:
        accepted = client.get("/api/v2/capabilities", headers={"Origin": "https://memy-web.example.com"})
        assert accepted.headers["Access-Control-Allow-Origin"] == "https://memy-web.example.com"
        exposed = {part.strip().lower() for part in accepted.headers["Access-Control-Expose-Headers"].split(",")}
        assert {"x-memy-operation-id", "x-memy-recovery"} <= exposed
        assert "Access-Control-Allow-Credentials" not in accepted.headers
        denied = client.get("/api/v2/capabilities", headers={"Origin": "https://unrelated.example.com"})
        assert "Access-Control-Allow-Origin" not in denied.headers


def test_readiness_probes_database_but_liveness_never_does(staging):
    settings, options = staging_configuration()
    with TestClient(staging_app(settings, options), base_url="https://memy-stage.example.com") as client:
        calls = []
        async def failed_probe():
            calls.append("probe")
            return "SUPABASE_UNAVAILABLE"
        client.app.state.readiness_probe.check = failed_probe
        assert client.get("/health").status_code == 200 and calls == []
        assert client.get("/ready").status_code == 503 and calls == ["probe"]
        async def healthy_probe():
            calls.append("healthy")
            return None
        client.app.state.readiness_probe.check = healthy_probe
        assert client.get("/ready").status_code == 200
        assert calls == ["probe", "healthy"]


def test_security_headers_forward_each_stream_chunk_without_buffering():
    import asyncio
    from scripts.run_staging import SecurityHeaders

    async def exercise():
        events = []
        forwarded = asyncio.Event()
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/event-stream")]})
            await send({"type": "http.response.body", "body": b"first", "more_body": True})
            await asyncio.wait_for(forwarded.wait(), .2)
            await send({"type": "http.response.body", "body": b"last", "more_body": False})
        async def send(event):
            events.append(event)
            if event.get("body") == b"first":
                forwarded.set()
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}
        await SecurityHeaders(app)({"type": "http"}, receive, send)
        assert [e.get("body") for e in events[1:]] == [b"first", b"last"]
        assert (b"strict-transport-security", b"max-age=31536000") in events[0]["headers"]
    asyncio.run(exercise())


def test_staging_history_backup_worker_has_bounded_shutdown(staging, monkeypatch):
    import uvicorn
    from scripts import run_staging

    historical_state(staging)
    monkeypatch.setenv("STAGING_BOOTSTRAP_AI_OFF", "false")
    events = []
    class Worker:
        def __init__(self, *, target, args, daemon):
            self.stop = args[2]
            assert daemon is True and target is run_staging.backup_loop
        def start(self):
            events.append("started")
        def join(self, *, timeout):
            assert self.stop.is_set()
            events.append(("joined", timeout))
    monkeypatch.setattr(run_staging.threading, "Thread", Worker)
    monkeypatch.setattr(run_staging, "backup_once", lambda *args: events.append("snapshot"))
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: events.append("served"))
    assert main([]) == 0
    assert events == ["snapshot", "started", "served", ("joined", 2)]
