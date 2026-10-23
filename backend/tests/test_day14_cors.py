"""Web/native handoff retains machine-readable retry metadata without broad CORS."""

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_allowed_web_origin_can_read_retry_after_but_untrusted_origin_cannot():
    def upstream(request):
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": "11111111-1111-4111-8111-111111111111"})
        return httpx.Response(200, json=[])

    config = Settings(_env_file=None, supabase_url="https://synthetic.supabase.co",
                      supabase_publishable_key="synthetic-publishable", api_requests_per_minute=1)
    app = create_app(config, transport=httpx.MockTransport(upstream))
    headers = {"Authorization": "Bearer fictional-token", "Origin": "http://127.0.0.1:5173"}
    with TestClient(app) as client:
        assert client.get("/api/v1/story-projects", headers=headers).status_code == 200
        response = client.get("/api/v1/story-projects", headers=headers)
        assert response.status_code == 429
        assert response.headers["retry-after"] == "60"
        exposed = {item.strip().lower() for item in response.headers["access-control-expose-headers"].split(",")}
        assert "retry-after" in exposed
        assert response.headers["access-control-allow-origin"] == headers["Origin"]
        assert response.headers["cache-control"] == "no-store"
        untrusted = client.get("/api/v1/story-projects", headers={**headers, "Origin": "https://untrusted.invalid"})
        assert "access-control-allow-origin" not in untrusted.headers
        assert "access-control-allow-credentials" not in response.headers
