from unittest.mock import Mock

import pytest

from app.core.config import Settings
from app.services.transcription import DisabledTranscriptionProvider, SimulatedTranscriptionProvider
from scripts import run_mobile_dev
from scripts.verify_two_users import DEV_SUPABASE_URL


def configured(url=DEV_SUPABASE_URL):
    return Settings(_env_file=None, supabase_url=url, supabase_publishable_key="test-public-key")


@pytest.mark.parametrize("arguments,host", [([], "127.0.0.1"), (["--lan"], "0.0.0.0")])
def test_launcher_pins_dev_and_mock_only_modes(monkeypatch, capsys, arguments, host):
    monkeypatch.setattr(run_mobile_dev, "Settings", configured)
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    assert run_mobile_dev.main(arguments) == 0
    app = start.call_args.args[0]
    assert app.state.settings.conversation_mode == app.state.settings.story_generation_mode == "mock"
    assert app.state.transcription_provider.enabled is False
    assert isinstance(app.state.transcription_provider, DisabledTranscriptionProvider)
    assert start.call_args.kwargs == {"host": host, "port": 8000, "access_log": False,
                                      "proxy_headers": False, "limit_concurrency": 32, "timeout_keep_alive": 5}
    output = capsys.readouterr().out
    assert "503 TRANSCRIPTION_DISABLED" in output
    assert "SIMULATED TRANSCRIPTION ENABLED" not in output


@pytest.mark.parametrize("url", [None, "https://legacy.supabase.co", "https://another-project.supabase.co"])
@pytest.mark.parametrize("arguments", [[], ["--simulate-transcription"]])
def test_launcher_refuses_legacy_or_missing_configuration(monkeypatch, url, arguments):
    monkeypatch.setattr(run_mobile_dev, "Settings", lambda: configured(url))
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    assert run_mobile_dev.main(arguments) == 2
    start.assert_not_called()


@pytest.mark.parametrize("lan", [False, True])
def test_simulation_requires_explicit_cli_flag_and_warns_about_fixed_fictional_results(monkeypatch, capsys, lan):
    monkeypatch.setattr(run_mobile_dev, "Settings", configured)
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    arguments = ["--simulate-transcription", "--port", "8001"] + (["--lan"] if lan else [])
    assert run_mobile_dev.main(arguments) == 0
    app = start.call_args.args[0]
    assert isinstance(app.state.transcription_provider, SimulatedTranscriptionProvider)
    assert app.state.transcription_provider.enabled is True
    assert app.state.settings.conversation_mode == app.state.settings.story_generation_mode == "mock"
    assert start.call_args.kwargs["host"] == ("0.0.0.0" if lan else "127.0.0.1")
    assert start.call_args.kwargs["port"] == 8001
    assert start.call_args.kwargs["access_log"] is False
    assert start.call_args.kwargs["proxy_headers"] is False
    output = capsys.readouterr().out
    assert "SIMULATED TRANSCRIPTION ENABLED" in output
    assert "validated but not interpreted" in output
    assert "NOT speech recognition" in output
    assert "No paid AI is called" in output


def test_environment_variables_cannot_enable_transcription_without_cli_flag(monkeypatch):
    for name in ("TRANSCRIPTION_MODE", "SIMULATE_TRANSCRIPTION", "MEMY_SIMULATE_TRANSCRIPTION"):
        monkeypatch.setenv(name, "simulated")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-unused-provider-key")
    monkeypatch.setattr(run_mobile_dev, "Settings", configured)
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    assert run_mobile_dev.main([]) == 0
    assert isinstance(start.call_args.args[0].state.transcription_provider, DisabledTranscriptionProvider)


@pytest.mark.parametrize("port", ["80", "65536", "-1"])
def test_launcher_rejects_invalid_port(port):
    with pytest.raises(SystemExit):
        run_mobile_dev.main(["--port", port])
