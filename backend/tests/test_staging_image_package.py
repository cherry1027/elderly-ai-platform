"""Credential-free packaging checks; these do not substitute for a Docker build."""
import importlib.util
import json
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def image_preflight_module():
    spec = importlib.util.spec_from_file_location("memy_container_preflight", ROOT / "deployment/container_preflight.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_image_runtime_checks_real_synthetic_audio_and_pdf_without_settings_or_http(monkeypatch):
    from app.core.config import Settings
    import httpx

    def forbidden(*args, **kwargs):
        raise AssertionError("Settings or network must not be used for image verification")
    monkeypatch.setattr(Settings, "__init__", forbidden)
    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    result = image_preflight_module().check_runtime()
    assert result["container_runtime_preflight"] == "ok"
    assert result["bounded_decoder_subprocess"] and result["english_swedish_pdf_fonts"]
    assert result["network_requests"] == 0 and result["private_configuration_read"] is False


def test_image_preflight_failures_never_echo_exception_details(monkeypatch, capsys):
    module = image_preflight_module()
    def bad():
        raise ValueError("synthetic-private-marker")
    monkeypatch.setattr(module, "check_runtime", bad)
    assert module.main() == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err) == {"container_runtime_preflight": "failed"}
    assert "synthetic-private-marker" not in captured.err


def test_blueprint_has_one_disk_backed_liveness_checked_ai_off_service():
    blueprint = yaml.safe_load((ROOT / "deployment/render.staging.yaml").read_text())
    assert len(blueprint["services"]) == 1
    service = blueprint["services"][0]
    assert service["type"] == "web" and service["runtime"] == "docker"
    assert service["plan"] == "0.5c-512mb"
    assert service["numInstances"] == 1 and service["autoDeployTrigger"] == "off"
    assert service["healthCheckPath"] == "/health"
    assert "maxShutdownDelaySeconds" not in service
    assert service["disk"]["mountPath"] == "/var/data" and service["disk"]["sizeGB"] == 1
    rows = service["envVars"]
    env = {row["key"]: row.get("value") for row in rows}
    assert len(env) == len(rows)
    assert "REQUEST_TIMEOUT_SECONDS" not in env
    assert env["STAGING_BOOTSTRAP_AI_OFF"] == "true"
    assert env["STAGING_ENABLE_REAL_AI"] == env["REAL_AI_ENABLED"] == "false"
    assert env["REAL_AI_COMBINED_TURN_ENABLED"] == env["REAL_AI_STREAM_TURN_ENABLED"] == "true"
    assert env["CORS_ORIGINS"] == "[]"
    for name in ("LIVE_AI_APPROVAL_PATH", "AI_BUDGET_POLICY_PATH", "AI_PILOT_COHORT_PATH", "AI_USAGE_LEDGER_PATH", "REAL_AI_USAGE_LOG_PATH", "REAL_AI_SPEECH_STORAGE_PATH"):
        assert env[name].startswith("/var/data/memy/")
    for name in ("STAGING_ORIGIN", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "REAL_AI_SPEECH_ENCRYPTION_KEY"):
        assert next(row for row in rows if row["key"] == name) == {"key": name, "sync": False}
