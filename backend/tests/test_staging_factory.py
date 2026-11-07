"""Fresh-process staging import regression: no private configuration or network."""
import json
import os
from pathlib import Path
import subprocess
import sys

BACKEND = Path(__file__).resolve().parents[1]


def test_staging_factory_bootstrap_has_no_default_app_side_effect(tmp_path):
    state = tmp_path / "state"
    state.mkdir(mode=0o700)
    # Deliberately do not inherit private keys, approval paths or dotenv settings.
    environment = {
        "PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(BACKEND),
        "HOME": str(tmp_path), "TMPDIR": str(tmp_path),
        "STAGING_STATE_DIR": str(state), "STAGING_ORIGIN": "https://memy-api.example.com",
        "STAGING_TLS_MODE": "render-edge", "RENDER": "true",
        "RENDER_EXTERNAL_HOSTNAME": "memy-api.example.com", "CORS_ORIGINS": "[]",
        "SUPABASE_URL": "https://edbkuunyeyxnyenmmqud.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "synthetic-public",
        "STAGING_BOOTSTRAP_AI_OFF": "true", "STAGING_ENABLE_REAL_AI": "false", "REAL_AI_ENABLED": "false",
        "REAL_AI_SPEECH_STORAGE_PATH": str(state / "speech.sqlite3"),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    code = r'''
import json, sys
from pathlib import Path
import httpx
from fastapi.testclient import TestClient
from app.services.real_ai_runtime import RealAIRuntime
from scripts.run_staging import staging_configuration, staging_app
calls=[]
original=RealAIRuntime.__init__
def guarded_init(self, settings, *args, **kwargs):
    assert settings.real_ai_enabled is False
    assert settings.real_ai_speech_storage_path is None
    assert settings.real_ai_speech_encryption_key is None
    calls.append("normalized-bootstrap")
    original(self, settings, *args, **kwargs)
RealAIRuntime.__init__=guarded_init
def forbidden(*args, **kwargs):
    raise AssertionError("Unexpected external HTTP")
httpx.AsyncClient.send=forbidden
settings, options=staging_configuration()
app=staging_app(settings, options)
assert "app.main" not in sys.modules
assert calls == ["normalized-bootstrap"]
with TestClient(app, base_url="https://memy-api.example.com") as client:
    assert client.get("/health").status_code == 200
    assert client.get("/api/v2/capabilities").json()["enabled"] is False
assert not (options["state"] / "speech.sqlite3").exists()
assert not (options["state"] / "ledger.sqlite3").exists()
print(json.dumps({"factory_import_side_effect_free":True, "runtime_count":len(calls), "external_requests":0}))
'''
    result = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=environment,
                            capture_output=True, text=True, timeout=20, check=False)
    assert result.returncode == 0, "Synthetic staging factory subprocess failed"
    assert json.loads(result.stdout) == {"factory_import_side_effect_free": True, "runtime_count": 1, "external_requests": 0}
    assert list(state.iterdir()) == []


def test_local_main_preserves_app_and_factory_contract_without_private_dotenv(tmp_path):
    environment = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(BACKEND),
                   "HOME": str(tmp_path), "TMPDIR": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    code = r'''
from app.core import config
class SyntheticSettings(config.Settings):
    def __init__(self, **kwargs):
        # This explicit test fixture bypasses all local dotenv files.
        super().__init__(_env_file=None, real_ai_enabled=False)
config.Settings=SyntheticSettings
from app.main import app, create_app
from app.factory import create_app as factory
assert create_app is factory
assert app.title == "Memy AI Backend"
from fastapi.testclient import TestClient
with TestClient(app) as client:
    assert client.get("/health").status_code == 200
print("compatibility-ok")
'''
    result = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=environment,
                            capture_output=True, text=True, timeout=20, check=False)
    assert result.returncode == 0, "Synthetic local compatibility subprocess failed"
    assert result.stdout.strip() == "compatibility-ok"
