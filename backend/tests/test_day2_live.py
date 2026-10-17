"""Opt-in cloud smoke test using two existing development users' access tokens.

Never creates accounts, reads passwords, uses service-role keys, or targets the
legacy project. Only synthetic projects created by this test are deleted.
"""

import os
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.mark.integration
@pytest.mark.skipif(
    os.getenv("RUN_MEMY_DAY2_INTEGRATION") != "1",
    reason="requires two existing development users and explicit opt-in",
)
def test_live_two_user_project_and_session_workflow():
    settings = Settings()
    base_url = str(settings.supabase_url).rstrip("/")
    if base_url != "https://edbkuunyeyxnyenmmqud.supabase.co":
        pytest.fail("Live writes are allowed only against the dedicated development project.")
    token_a = os.getenv("MEMY_TEST_USER_A_TOKEN")
    token_b = os.getenv("MEMY_TEST_USER_B_TOKEN")
    if not token_a or not token_b:
        pytest.fail("Set two development access tokens locally; never paste them in chat.")
    key = settings.supabase_publishable_key.get_secret_value()
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    created = []

    with httpx.Client(timeout=10, follow_redirects=False) as upstream:
        user_ids = []
        for headers in (headers_a, headers_b):
            response = upstream.get(f"{base_url}/auth/v1/user", headers={**headers, "apikey": key})
            assert response.status_code == 200, "Both development users need valid access tokens."
            user_ids.append(response.json().get("id"))
        assert all(user_ids) and user_ids[0] != user_ids[1], "Use two different development users."

        try:
            with TestClient(create_app(settings)) as client:
                for headers, language in ((headers_a, "sv"), (headers_b, "en")):
                    response = client.post(
                        "/api/v1/story-projects", headers=headers,
                        json={"title": f"Day 2 test – {uuid4()}", "language": language},
                    )
                    assert response.status_code == 201
                    project = response.json()
                    created.append((project["id"], headers))
                    assert project["language"] == language

                project_id = created[0][0]
                other_project_id = created[1][0]
                path = f"/api/v1/story-projects/{project_id}"
                assert client.get(path, headers=headers_b).status_code == 404
                assert client.get(f"/api/v1/story-projects/{other_project_id}", headers=headers_a).status_code == 404
                assert client.patch(path, headers=headers_b, json={"title": "Unauthorized change"}).status_code == 404
                assert client.post(f"{path}/sessions", headers=headers_b).status_code == 404
                assert client.get(f"{path}/sessions", headers=headers_b).status_code == 404

                response = client.patch(path, headers=headers_a, json={"title": "Mina barndomsminnen"})
                assert response.status_code == 200
                assert response.json()["title"] == "Mina barndomsminnen"
                assert response.json()["language"] == "sv"
                assert client.get(path, headers=headers_a).status_code == 200
                projects = client.get("/api/v1/story-projects", headers=headers_a)
                assert projects.status_code == 200
                assert any(project["id"] == project_id for project in projects.json())

                response = client.post(f"{path}/sessions", headers={**headers_a, "Accept-Language": "en"})
                assert response.status_code == 201
                session = response.json()
                assert session["language"] == "sv"
                assert session["project_id"] == project_id
                sessions = client.get(f"{path}/sessions", headers=headers_a)
                assert sessions.status_code == 200
                assert any(item["id"] == session["id"] for item in sessions.json())
        finally:
            cleanup_failed = False
            for project_id, headers in created:
                try:
                    response = upstream.delete(
                        f"{base_url}/rest/v1/story_projects",
                        params={"id": f"eq.{project_id}"},
                        headers={**headers, "apikey": key},
                    )
                    cleanup_failed |= response.status_code not in (200, 204)
                except httpx.HTTPError:
                    cleanup_failed = True
            if cleanup_failed:
                pytest.fail("Synthetic test-project cleanup failed; check the development dashboard.")
