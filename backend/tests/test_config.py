import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_missing_credentials_are_allowed_for_liveness():
    assert not Settings(_env_file=None).supabase_configured


def test_frontend_environment_aliases_work(monkeypatch):
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key")
    settings = Settings(_env_file=None)
    assert settings.supabase_configured
    assert "test-key" not in repr(settings)


def test_backend_file_values_override_frontend_file_values(tmp_path):
    frontend = tmp_path / "frontend.env"
    backend = tmp_path / "backend.env"
    frontend.write_text(
        "VITE_SUPABASE_URL=https://old.supabase.co\n"
        "VITE_SUPABASE_PUBLISHABLE_KEY=old-key\n"
    )
    backend.write_text(
        "SUPABASE_URL=https://new.supabase.co\nSUPABASE_PUBLISHABLE_KEY=new-key\n"
    )
    settings = Settings(_env_file=(frontend, backend))
    assert str(settings.supabase_url) == "https://new.supabase.co/"
    assert settings.supabase_publishable_key.get_secret_value() == "new-key"


def test_process_environment_alias_overrides_backend_file(monkeypatch, tmp_path):
    backend = tmp_path / "backend.env"
    backend.write_text("SUPABASE_URL=https://file.supabase.co\n")
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://process.supabase.co")
    settings = Settings(_env_file=backend)
    assert str(settings.supabase_url) == "https://process.supabase.co/"


@pytest.mark.parametrize(
    "url",
    ["not-a-url", "http://example.com", "https://user:pass@example.com", "https://example.com/rest/v1"],
)
def test_invalid_or_insecure_supabase_urls_fail_early(url):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, supabase_url=url)


def test_local_supabase_http_is_allowed():
    assert Settings(_env_file=None, supabase_url="http://127.0.0.1:54321").supabase_url


@pytest.mark.parametrize("origins", [["*"], ["https://example.com/path"], ["file://example"]])
def test_cors_requires_explicit_origins(origins):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=origins)
