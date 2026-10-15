import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def configured_settings():
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="test-publishable-key",
    )


def test_readiness_checks_profiles_without_fetching_rows():
    def handler(request):
        assert request.method == "HEAD"
        assert request.url.path == "/rest/v1/profiles"
        assert dict(request.url.params) == {"select": "id", "limit": "0"}
        assert request.headers["apikey"] == "test-publishable-key"
        return httpx.Response(200)

    with TestClient(create_app(configured_settings(), transport=httpx.MockTransport(handler))) as client:
        response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"
    assert response.headers["cache-control"] == "no-store"


def test_readiness_without_configuration_returns_503():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.get("/ready")
        assert client.get("/health").status_code == 200
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SUPABASE_NOT_CONFIGURED"


@pytest.mark.parametrize("status", [301, 401, 403, 404, 429, 500, 503])
def test_upstream_errors_are_sanitized(status):
    def handler(request):
        return httpx.Response(status, text="private-upstream-details")

    with TestClient(create_app(configured_settings(), transport=httpx.MockTransport(handler))) as client:
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SUPABASE_UNAVAILABLE"
    assert "private-upstream-details" not in response.text
    assert "test-publishable-key" not in response.text


@pytest.mark.parametrize("exception", [httpx.ConnectError, httpx.ReadTimeout])
def test_network_failure_does_not_break_liveness(exception):
    def handler(request):
        raise exception("unreachable", request=request)

    with TestClient(create_app(configured_settings(), transport=httpx.MockTransport(handler))) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/health").status_code == 200


def test_cors_allows_configured_frontend_bearer_requests():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,accept-language",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8080"


def test_cors_denies_unknown_origins():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.options(
            "/health",
            headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
        )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
