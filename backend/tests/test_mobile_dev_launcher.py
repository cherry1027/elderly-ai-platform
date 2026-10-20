from unittest.mock import Mock

import pytest

from app.core.config import Settings
from scripts import run_mobile_dev
from scripts.verify_two_users import DEV_SUPABASE_URL


def configured(url=DEV_SUPABASE_URL):
    return Settings(_env_file=None, supabase_url=url, supabase_publishable_key="test-public-key")


@pytest.mark.parametrize("arguments,host", [([], "127.0.0.1"), (["--lan"], "0.0.0.0")])
def test_launcher_pins_dev_and_mock_only_modes(monkeypatch, arguments, host):
    monkeypatch.setattr(run_mobile_dev, "Settings", configured)
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    assert run_mobile_dev.main(arguments) == 0
    app = start.call_args.args[0]
    assert app.state.settings.conversation_mode == app.state.settings.story_generation_mode == "mock"
    assert app.state.transcription_provider.enabled is False
    assert start.call_args.kwargs == {"host": host, "port": 8000, "access_log": False,
                                      "proxy_headers": False, "limit_concurrency": 32, "timeout_keep_alive": 5}


def test_launcher_refuses_legacy_or_missing_configuration(monkeypatch):
    monkeypatch.setattr(run_mobile_dev, "Settings", lambda: configured("https://legacy.supabase.co"))
    start = Mock()
    monkeypatch.setattr(run_mobile_dev.uvicorn, "run", start)
    assert run_mobile_dev.main([]) == 2
    start.assert_not_called()


@pytest.mark.parametrize("port", ["80", "65536", "-1"])
def test_launcher_rejects_invalid_port(port):
    with pytest.raises(SystemExit):
        run_mobile_dev.main(["--port", port])
