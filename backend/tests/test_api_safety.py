"""Small-body limits, secret-safe unexpected errors, and audio guard isolation."""

import asyncio
import json

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.core import api_safety
from app.core.api_safety import APISafetyMiddleware, MAX_API_BODY_BYTES
from app.core.config import Settings
from app.main import create_app


def application():
    app = create_app(Settings(_env_file=None))

    @app.post("/api/v1/body-probe")
    async def body_probe(request: Request):
        return {"size": len(await request.body())}

    @app.get("/api/v1/failure-probe")
    async def failure_probe():
        raise RuntimeError("private-token-private-story")

    return app


def test_exact_body_limit_is_accepted_and_one_byte_more_is_rejected():
    with TestClient(application()) as client:
        assert client.post("/api/v1/body-probe", content=b"x" * MAX_API_BODY_BYTES).json() == {"size": MAX_API_BODY_BYTES}
        result = client.post("/api/v1/body-probe", content=b"x" * (MAX_API_BODY_BYTES + 1))
    assert result.status_code == 413
    assert result.json()["error"]["code"] == "REQUEST_TOO_LARGE"
    assert result.headers["cache-control"] == "no-store"


def test_unexpected_errors_are_json_no_store_and_cors_safe(caplog):
    with TestClient(application()) as client:
        result = client.get("/api/v1/failure-probe", headers={"Origin": "http://127.0.0.1:5173"})
    assert result.status_code == 500
    assert result.json() == {"error": {"code": "INTERNAL_ERROR", "message": "An unexpected service error occurred."}}
    assert result.headers["cache-control"] == "no-store"
    assert result.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert "private-token-private-story" not in result.text + caplog.text


def invoke(frames, *, path="/api/v1/body-probe", headers=(), app=None):
    sent, read, seen = [], [], []

    async def receive():
        read.append(True)
        frame = frames.pop(0)
        if callable(frame):
            return await frame()
        return frame

    async def send(message):
        sent.append(message)

    async def downstream(scope, receive, send):
        seen.append(await receive())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    scope = {"type": "http", "path": path, "method": "POST", "headers": list(headers)}
    asyncio.run(APISafetyMiddleware(app or downstream)(scope, receive, send))
    return sent, read, seen


def test_chunked_body_counts_all_bytes_without_content_length():
    frames = [{"type": "http.request", "body": b"x" * MAX_API_BODY_BYTES, "more_body": True},
              {"type": "http.request", "body": b"x", "more_body": False}]
    sent, read, seen = invoke(frames)
    assert len(read) == 2 and not seen
    assert sent[0]["status"] == 413


def test_chunked_body_replays_exact_content_once():
    sent, _, seen = invoke([{"type": "http.request", "body": b"ab", "more_body": True},
                           {"type": "http.request", "body": b"cd", "more_body": False}])
    assert sent[0]["status"] == 200
    assert seen == [{"type": "http.request", "body": b"abcd", "more_body": False}]


@pytest.mark.parametrize("lengths", [[b"-1"], [b"invalid"], [b"3", b"3"], [b"9" * 5000]])
def test_malformed_content_length_is_rejected_without_reading(lengths):
    sent, read, seen = invoke([], headers=[(b"content-length", length) for length in lengths])
    assert sent[0]["status"] == 422 and not read and not seen


def test_oversized_declared_length_is_rejected_without_reading():
    sent, read, seen = invoke([], headers=[(b"content-length", str(MAX_API_BODY_BYTES + 1).encode())])
    assert sent[0]["status"] == 413 and not read and not seen


def test_disconnected_client_does_not_run_the_handler():
    sent, _, seen = invoke([{"type": "http.disconnect"}])
    assert not sent and not seen


def test_slow_small_body_gets_safe_timeout(monkeypatch):
    monkeypatch.setattr(api_safety, "API_BODY_TIMEOUT_SECONDS", 0.001)

    async def slow():
        await asyncio.sleep(1)

    sent, _, seen = invoke([slow])
    assert sent[0]["status"] == 408 and not seen
    assert json.loads(sent[1]["body"])["error"]["code"] == "REQUEST_TIMEOUT"


@pytest.mark.parametrize("ending", ["transcribe", "transcribe/"])
def test_audio_keeps_authentication_before_reading(ending):
    async def auth_reject(scope, receive, send):
        await send({"type": "http.response.start", "status": 401, "headers": []})
        await send({"type": "http.response.body", "body": b"unauthorized"})

    sent, read, _ = invoke([], path=f"/api/v1/story-sessions/id/{ending}", app=auth_reject,
                           headers=[(b"content-length", b"30000000")])
    assert sent[0]["status"] == 401 and not read


def test_response_already_started_is_not_replaced():
    sent = []

    async def downstream(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("stream failed")

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    with pytest.raises(RuntimeError):
        asyncio.run(APISafetyMiddleware(downstream)({"type": "http", "path": "/api/v1/test", "headers": []}, receive, send))
    assert len(sent) == 1 and sent[0]["status"] == 200


def test_openapi_documents_guard_errors_for_every_business_operation():
    schema = create_app(Settings(_env_file=None)).openapi()
    for path, item in schema["paths"].items():
        if path.startswith("/api/v1/"):
            for method, operation in item.items():
                if method in {"get", "post", "patch"}:
                    for status in ("408", "413", "500"):
                        assert operation["responses"][status]["content"]["application/json"]["schema"] == {"$ref": "#/components/schemas/ErrorResponse"}


@pytest.mark.parametrize("path,method", [("/api/v1/story-drafts/{draft_id}/export", "post"),
                                      ("/api/v1/story-exports/{export_id}/download", "get")])
def test_pdf_errors_document_json_not_binary(path, method):
    operation = create_app(Settings(_env_file=None)).openapi()["paths"][path][method]
    for status in ("401", "404", "409", "422", "500", "503"):
        assert set(operation["responses"][status]["content"]) == {"application/json"}
