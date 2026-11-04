"""Recovery hints distinguish closed budgets from genuinely retryable limits."""

from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.core.errors import APIError, api_error_handler


def response_for(code, status=429, *, operation_id=None):
    app = FastAPI()
    app.add_exception_handler(APIError, api_error_handler)

    @app.get("/failure")
    def failure():
        error = APIError(status, code, "A safe fallback message.")
        error.operation_id = operation_id
        raise error

    with TestClient(app) as client:
        return client.get("/failure")


@pytest.mark.parametrize("code", [
    "AI_USAGE_LIMIT", "AI_GLOBAL_BUDGET_EXHAUSTED", "AI_USER_BUDGET_EXHAUSTED",
    "AI_SPENDING_NOT_APPROVED", "AI_USAGE_UNAVAILABLE", "LIVE_AI_DISABLED",
    "AI_PROVIDER_QUOTA_EXHAUSTED", "AI_PROVIDER_AUTHENTICATION_FAILED",
])
def test_closed_allowances_have_no_misleading_retry_timer(code):
    response = response_for(code)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == code
    assert set(response.json()["error"]) == {"code", "message"}
    assert "saved work" in response.json()["error"]["message"]
    assert "retry-after" not in response.headers
    assert response.headers["x-memy-recovery"] == "contact-operator"
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("code", ["AI_RATE_LIMIT", "RATE_LIMITED", "AI_BUSY", "AUDIO_BUSY"])
def test_short_rate_and_capacity_limits_keep_bounded_retry_advice(code):
    response = response_for(code)
    assert response.headers["retry-after"] == "60"
    assert response.headers["x-memy-recovery"] == "wait"


def test_ambiguous_provider_failure_preserves_saved_result_link_without_automatic_retry():
    operation = uuid4()
    response = response_for("AI_PROVIDER_TIMEOUT", 504, operation_id=operation)
    assert response.headers["x-memy-operation-id"] == str(operation)
    assert response.headers["x-memy-recovery"] == "check-saved"
    assert "retry-after" not in response.headers


def test_invalid_operation_header_cannot_inject_response_headers():
    response = response_for("AI_PROVIDER_UNAVAILABLE", 503, operation_id="x\r\nsecret: value")
    assert "x-memy-operation-id" not in response.headers
    assert "secret" not in response.headers


def test_authentication_failure_keeps_bearer_challenge_and_sign_in_advice():
    response = response_for("INVALID_ACCESS_TOKEN", 401)
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["x-memy-recovery"] == "sign-in"


def test_unknown_error_is_not_assigned_an_unsafe_recovery_action():
    response = response_for("FUTURE_ERROR", 503)
    assert response.json() == {"error": {"code": "FUTURE_ERROR", "message": "A safe fallback message."}}
    assert "x-memy-recovery" not in response.headers
