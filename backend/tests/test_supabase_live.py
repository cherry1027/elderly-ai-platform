import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.mark.integration
@pytest.mark.skipif(os.getenv("RUN_SUPABASE_INTEGRATION") != "1", reason="opt-in live probe")
def test_live_supabase_data_api():
    # Root/backend dotenv files are used explicitly. No data is read or written.
    with TestClient(create_app(Settings())) as client:
        response = client.get("/ready")
    assert response.status_code == 200, response.json()
