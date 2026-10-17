"""Authentication is verified online, never inferred from user request data."""

from typing import Annotated
from uuid import UUID

import httpx
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.core.config import Settings
from app.main import create_app
from app.services.auth import AuthenticatedUser

USER_ID = "11111111-1111-4111-8111-111111111111"
TOKEN = "test-user-access-token"


def protected_app(handler, *, configured=True):
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co" if configured else None,
        supabase_publishable_key="test-publishable-key" if configured else None,
    )
    application = create_app(settings, transport=httpx.MockTransport(handler))

    @application.get("/api/v1/auth-probe")
    async def probe(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
        return {"id": str(user.id)}

    return application


def test_auth_verifies_user_and_forwards_exact_token():
    def handler(request):
        assert request.method == "GET"
        assert str(request.url) == "https://example.supabase.co/auth/v1/user"
        assert request.headers["apikey"] == "test-publishable-key"
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        return httpx.Response(200, json={"id": USER_ID})

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("header", [None, "", "Basic anything", "Bearer", "Bearer "])
def test_missing_or_wrong_auth_scheme_never_calls_upstream(header):
    def handler(request):
        pytest.fail("Invalid authentication must not reach Supabase")

    headers = {} if header is None else {"Authorization": header}
    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTHORIZATION_REQUIRED"
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("token", ["token with spaces", "token,other", "x" * 16385])
def test_malformed_bearer_credentials_are_rejected(token):
    def handler(request):
        pytest.fail("Malformed token must not reach Supabase")

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_ACCESS_TOKEN"


@pytest.mark.parametrize("status", [400, 401, 403, 422])
def test_rejected_or_expired_token_is_401_without_upstream_details(status):
    def handler(request):
        return httpx.Response(status, text="private-token-error")

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_ACCESS_TOKEN"
    assert response.headers["www-authenticate"] == "Bearer"
    assert "private-token-error" not in response.text
    assert TOKEN not in response.text


@pytest.mark.parametrize("status", [301, 404, 429, 500, 503])
def test_auth_dependency_failures_are_not_reported_as_invalid_credentials(status):
    def handler(request):
        return httpx.Response(status, text="private-internal-detail")

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SUPABASE_UNAVAILABLE"
    assert "private-internal-detail" not in response.text


@pytest.mark.parametrize("payload", [None, [], {}, {"id": "not-a-uuid"}, {"id": 123}])
def test_invalid_auth_success_payload_fails_closed(payload):
    def handler(request):
        return httpx.Response(200, json=payload)

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503


def test_auth_network_timeout_is_sanitized():
    def handler(request):
        raise httpx.ReadTimeout("private-url-and-token", request=request)

    with TestClient(protected_app(handler)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 503
    assert "private-url-and-token" not in response.text


def test_auth_missing_configuration_is_503():
    def handler(request):
        pytest.fail("Unconfigured auth must not make a network request")

    with TestClient(protected_app(handler, configured=False)) as client:
        response = client.get("/api/v1/auth-probe", headers={"Authorization": f"Bearer {TOKEN}"})
        assert client.get("/health").status_code == 200
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SUPABASE_NOT_CONFIGURED"


def test_credential_repr_never_displays_access_token():
    from pydantic import SecretStr

    user = AuthenticatedUser(UUID(USER_ID), SecretStr(TOKEN))
    assert TOKEN not in repr(user)
