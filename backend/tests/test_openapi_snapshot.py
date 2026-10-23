"""Keep the exported mobile contract in sync without calling hosted services."""

import json
import os
from pathlib import Path
import subprocess
import sys

from scripts.export_openapi import SNAPSHOT, main, render_specification


def test_checked_in_openapi_snapshot_matches_application():
    assert SNAPSHOT.read_text(encoding="utf-8") == render_specification()
    assert main(["--check"]) == 0


def test_openapi_schema_is_deterministic_and_does_not_embed_configured_credentials(monkeypatch):
    initial = render_specification()
    monkeypatch.setenv("SUPABASE_URL", "https://synthetic-never-contacted.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "synthetic-unused-config-value")
    monkeypatch.setenv("CONVERSATION_MODE", "mock")
    monkeypatch.setenv("STORY_GENERATION_MODE", "mock")
    assert render_specification() == initial
    assert "synthetic-unused-config-value" not in initial
    assert "synthetic-never-contacted" not in initial
    spec = json.loads(initial)
    assert spec["info"]["version"] == "0.8.1"
    methods = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
    assert sum(method in methods for item in spec["paths"].values() for method in item) == 25


def test_fresh_export_fails_safely_on_invalid_environment_configuration():
    script = Path(__file__).resolve().parents[1] / "scripts" / "export_openapi.py"
    for name, value in (
        ("SUPABASE_URL", "synthetic-invalid-url-never-contacted"),
        ("CORS_ORIGINS", "synthetic-invalid-json"),
        ("REQUEST_TIMEOUT_SECONDS", "synthetic-invalid-timeout"),
    ):
        environment = {**os.environ, name: value}
        result = subprocess.run([sys.executable, str(script), "--check"],
                                capture_output=True, text=True, env=environment, timeout=15)
        assert result.returncode == 2
        assert "check application configuration and dependencies" in result.stderr
        assert value not in result.stdout + result.stderr
        assert "Traceback" not in result.stderr
