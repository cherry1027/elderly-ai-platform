"""Live activation and credentials stay closed without explicit private approval."""

from datetime import datetime,timedelta,timezone
import json

from pydantic import SecretStr
import pytest

from app.core.config import Settings
from app.core.errors import APIError
from app.services.real_ai_runtime import RealAIRuntime
from app.main import create_app
from fastapi.testclient import TestClient


def configured(tmp_path,**changes):
    private=tmp_path/"private"
    private.mkdir(mode=0o700)
    approval=private/"approval.json"
    approval.write_text(json.dumps({"approval_id":"synthetic-offline-test","approved_by":"unit-test",
        "expires_at":(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),
        "max_calls":2,"max_calls_per_minute":2,"budget_microusd":2000,
        "reserve_per_call_microusd":1000,"allowed_models":["gpt-test"]}))
    approval.chmod(0o600)
    data=dict(_env_file=None,supabase_url="https://synthetic.supabase.co",supabase_publishable_key="synthetic-public",
        supabase_secret_key="sb_secret_synthetic",openai_api_key="synthetic-never-used",real_ai_enabled=True,
        real_ai_transcription_model="gpt-test",openai_text_model="gpt-test",openai_verifier_model="gpt-test",
        real_ai_speech_model="gpt-test",live_ai_approval_path=approval,ai_usage_ledger_path=private/"usage.sqlite3")
    return Settings(**{**data,**changes})


def test_disabled_runtime_never_constructs_or_contacts_a_provider(monkeypatch):
    monkeypatch.setattr("app.services.real_ai_runtime.OpenAIClient",lambda *a,**k:pytest.fail("disabled constructor"))
    runtime=RealAIRuntime(Settings(_env_file=None))
    assert runtime.provider is None
    assert runtime.capabilities()["reason"]=="LIVE_AI_DISABLED"
    with pytest.raises(APIError):runtime.require()


@pytest.mark.parametrize("missing",["supabase_secret_key","openai_api_key","live_ai_approval_path"])
def test_missing_required_setup_never_opens_real_path(tmp_path,missing):
    runtime=RealAIRuntime(configured(tmp_path,**{missing:None}),provider=object())
    assert runtime.capabilities()["reason"]=="REAL_AI_NOT_CONFIGURED"


def test_valid_offline_approval_preflight_does_not_reserve_or_create_ledger(tmp_path):
    settings=configured(tmp_path)
    provider=object()
    runtime=RealAIRuntime(settings,provider=provider)
    assert runtime.require() is provider
    assert runtime.capabilities()["enabled"] is True
    assert not settings.ai_usage_ledger_path.exists()
    # Activation metadata never includes keys, models, approval author or budget.
    encoded=json.dumps(runtime.capabilities())
    for secret in ("synthetic-never-used","sb_secret_synthetic","unit-test","2000"):
        assert secret not in encoded


def test_private_approval_permissions_and_model_allowlist_are_required(tmp_path):
    settings=configured(tmp_path,openai_text_model="not-approved")
    runtime=RealAIRuntime(settings,provider=object())
    assert runtime.capabilities()["enabled"] is False
    settings.live_ai_approval_path.chmod(0o644)
    assert runtime.capabilities()["enabled"] is False


def test_app_lifespan_owns_a_separate_reusable_provider_pool(tmp_path):
    settings = configured(tmp_path, real_ai_speech_model="gpt-realtime-2.1-mini",
                          real_ai_transcription_model="gpt-transcribe")
    app = create_app(settings)
    adapters = app.state.real_ai._http_clients
    assert len(adapters) == 2 and all(c.http_client is None for c in adapters)
    with TestClient(app):
        pool = adapters[0].http_client
        assert pool is adapters[1].http_client and not pool.is_closed
        assert pool is not app.state.http_client
        assert 'authorization' not in pool.headers and 'apikey' not in pool.headers
        assert not pool.follow_redirects
        assert not settings.ai_usage_ledger_path.exists()
    assert pool.is_closed
    assert all(c.http_client is None for c in adapters)
