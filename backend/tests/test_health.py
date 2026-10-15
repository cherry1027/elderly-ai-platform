import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.core.config import Settings


@pytest.fixture
def client():
    settings = Settings(_env_file=None, supabase_url=None, supabase_publishable_key=None)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_health_returns_success_without_database_credentials(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok", "service": "memy-ai-backend"}


def test_health_rejects_post(client):
    assert client.post("/health").status_code == 405


def test_unknown_route_returns_not_found(client):
    assert client.get("/does-not-exist").status_code == 404


def test_openapi_documents_health_response(client):
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "200" in response.json()["paths"]["/health"]["get"]["responses"]
    assert client.get("/docs").status_code == 200
