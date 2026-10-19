import pytest


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch):
    """Offline tests must not use a developer's credentials or CORS settings."""
    for name in (
        "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY", "CORS_ORIGINS", "REQUEST_TIMEOUT_SECONDS",
        "CONVERSATION_MODE",
        "STORY_GENERATION_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
