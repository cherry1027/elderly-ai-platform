import pytest


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch):
    """Offline tests must not use a developer's credentials or CORS settings."""
    for name in (
        "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY", "CORS_ORIGINS", "REQUEST_TIMEOUT_SECONDS",
        "CONVERSATION_MODE",
        "STORY_GENERATION_MODE",
        "API_MAX_CONCURRENT_REQUESTS", "API_REQUESTS_PER_MINUTE",
        "AI_PROVIDER_MODE", "OPENAI_API_KEY", "OPENAI_TEXT_MODEL", "OPENAI_VERIFIER_MODEL",
        "OPENAI_TRANSCRIPTION_MODEL", "OPENAI_TIMEOUT_SECONDS", "LIVE_AI_APPROVAL_PATH",
        "AI_USAGE_LEDGER_PATH",
    ):
        monkeypatch.delenv(name, raising=False)
