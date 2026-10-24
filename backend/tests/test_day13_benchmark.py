"""The timing tool is explicit about simulated dependencies and no acceptance."""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from scripts import benchmark_security


def test_timing_tool_uses_fake_upstreams_real_pdf_and_never_claims_capacity():
    report = asyncio.run(benchmark_security.run(iterations=4, concurrency=2))
    assert report["network_calls"] == report["paid_calls"] == 0
    assert report["mock_upstream_calls"] == 8
    assert not report["hosted_capacity_verified"] and not report["device_acceptance_verified"]
    assert report["metrics"]["authenticated_project_list"]["samples"] == 4
    pdf = report["metrics"]["in_memory_pdf_15999_characters"]
    assert pdf["samples"] == 3 and 20 < pdf["max_bytes"] < 2_000_000
    for forbidden in (benchmark_security.OWNER, benchmark_security.PROJECT, "fictional-token", "Malmö"):
        assert forbidden not in json.dumps(report)


def test_cli_failure_suppresses_exception_details(monkeypatch, capsys):
    async def failure(*args):
        raise RuntimeError("private-token-and-story")

    monkeypatch.setattr(benchmark_security, "run", failure)
    assert benchmark_security.main([]) == 2
    output = capsys.readouterr()
    assert output.out == "" and "private-token-and-story" not in output.err


@pytest.mark.parametrize("name,value", [("CORS_ORIGINS", "private-invalid-cors"),
                                         ("AI_PROVIDER_MODE", "openai")])
def test_configured_import_failure_is_sanitized_in_fresh_process(name, value):
    script = Path(__file__).resolve().parents[1] / "scripts/benchmark_security.py"
    result = subprocess.run([sys.executable, str(script)],
                            env={**os.environ, name: value}, capture_output=True, text=True, timeout=15)
    assert result.returncode == 2
    assert "Traceback" not in result.stdout + result.stderr
    assert "private-invalid-cors" not in result.stdout + result.stderr
    assert "details suppressed" in result.stderr
