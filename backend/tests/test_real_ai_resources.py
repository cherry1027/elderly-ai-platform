"""Offline HTTPX boundaries, not hosted JWT/RLS or real-provider evidence."""

import asyncio
from copy import deepcopy
import json
from uuid import UUID

import httpx
from pydantic import SecretStr
import pytest

from app.core.config import Settings
from app.core.errors import APIError
from app.services.auth import AuthenticatedUser
from app.services.real_ai_resources import RealAIGateway


OWNER = UUID("a9290000-0000-4000-8000-000000000001")
OTHER = UUID("a9290000-0000-4000-8000-000000000002")
PROJECT = UUID("b9290000-0000-4000-8000-000000000001")
SESSION = UUID("c9290000-0000-4000-8000-000000000001")
TRANSCRIPT = UUID("d9290000-0000-4000-8000-000000000001")
ASSISTANT = UUID("d9290000-0000-4000-8000-000000000002")
OPERATION = UUID("e9290000-0000-4000-8000-000000000001")
CLAIM_TOKEN = UUID("e9290000-0000-4000-8000-000000000002")
ACTION = UUID("e9290000-0000-4000-8000-000000000003")
MEMORY = UUID("f9290000-0000-4000-8000-000000000001")
PUBLISHABLE = "sb_publishable_synthetic_public_fixture"
SERVER_SECRET = "sb_secret_synthetic_server_fixture"
USER_TOKEN = "synthetic_user_access_token_fixture"
STAMP = "2026-10-29T12:00:00Z"
PROVENANCE = {"mode": "real", "provider": "openai", "model": "offline-fixture", "version": 1}


def settings(secret=SERVER_SECRET):
    return Settings(_env_file=None, supabase_url="https://offline-fixture.supabase.co",
                    supabase_publishable_key=PUBLISHABLE, supabase_secret_key=secret)


async def use_gateway(handler, action, *, secret=SERVER_SECRET):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = RealAIGateway(settings(secret), client, AuthenticatedUser(OWNER, SecretStr(USER_TOKEN)))
        return await action(gateway)


def run(handler, action, **kwargs):
    return asyncio.run(use_gateway(handler, action, **kwargs))


def project_row():
    return {"id": str(PROJECT), "user_id": str(OWNER), "title": "Offline fixture", "description": None,
            "language": "en", "status": "draft", "created_at": STAMP, "updated_at": STAMP}


def session_row():
    return {"id": str(SESSION), "project_id": str(PROJECT), "language": "en", "status": "active",
            "created_at": STAMP, "updated_at": STAMP, "ended_at": None}


def transcript_row():
    return {"transcript_id": str(TRANSCRIPT), "owner_id": str(OWNER), "operation_id": str(OPERATION),
            "project_id": str(PROJECT), "session_id": str(SESSION), "language": "en", "text": "I lived in Malmö.",
            "status": "completed", "created_at": STAMP, "provenance": deepcopy(PROVENANCE)}


def message_row(role="assistant"):
    return {"id": str(ASSISTANT if role == "assistant" else TRANSCRIPT), "owner_id": str(OWNER),
            "operation_id": str(OPERATION), "project_id": str(PROJECT), "session_id": str(SESSION),
            "source_transcript_id": str(TRANSCRIPT), "role": role, "language": "en",
            "text": "What do you remember?" if role == "assistant" else "I lived in Malmö.",
            "sequence": 2 if role == "assistant" else 1, "created_at": STAMP,
            "provenance": deepcopy(PROVENANCE)}


def memory_row():
    return {"id": str(MEMORY), "owner_id": str(OWNER), "project_id": str(PROJECT), "session_id": str(SESSION),
            "source_message_id": str(TRANSCRIPT), "fact_type": "location", "value": "Malmö", "evidence": "Malmö",
            "year": None, "slot": "home", "uncertain": True, "status": "pending", "corrected_value": None,
            "version": 1, "created_at": STAMP, "updated_at": STAMP}


def assert_user_headers(request):
    assert request.headers["apikey"] == PUBLISHABLE
    assert request.headers["authorization"] == f"Bearer {USER_TOKEN}"
    assert SERVER_SECRET not in str(request.headers)


def test_owned_reads_and_review_rpc_keep_user_jwt_and_strip_internal_row_fields():
    requests = []

    def handler(request):
        assert_user_headers(request)
        requests.append(request)
        path = request.url.path
        if path.endswith("/real_transcripts"):
            assert request.url.params["owner_id"] == f"eq.{OWNER}"
            assert request.url.params["transcript_id"] == f"eq.{TRANSCRIPT}"
            return httpx.Response(200, json=[transcript_row()])
        if path.endswith("/story_projects"):
            assert request.url.params["user_id"] == f"eq.{OWNER}"
            return httpx.Response(200, json=[project_row()])
        assert path.endswith("/rpc/review_real_memory")
        assert json.loads(request.content)["p_memory_id"] == str(MEMORY)
        return httpx.Response(200, json={"status": "confirmed"})

    async def action(gateway):
        row = await gateway.one("real_transcripts", "transcript_id", TRANSCRIPT)
        assert "owner_id" not in row and "operation_id" not in row
        assert row["text"] == "I lived in Malmö."
        return await gateway.rpc("review_real_memory", {"p_memory_id": str(MEMORY)})

    assert run(handler, action) == {"status": "confirmed"}
    assert len(requests) == 3


@pytest.mark.parametrize("secret", [SERVER_SECRET, "eyJsynthetic.service-role.fixture"])
def test_service_completion_credentials_are_separate_from_owner_read_token(secret):
    seen = []

    def handler(request):
        assert request.headers["apikey"] == secret
        if secret.startswith("eyJ"):
            assert request.headers["authorization"] == "Bearer " + secret
        else:
            assert "authorization" not in request.headers
        assert USER_TOKEN not in str(request.headers)
        body = json.loads(request.content)
        seen.append((request.url.path, body))
        assert body["p_owner_id"] == str(OWNER)
        if request.url.path.endswith("/claim_real_ai_operation"):
            assert body["p_project_id"] == str(PROJECT) and body["p_session_id"] == str(SESSION)
            assert body["p_action_key"] == str(ACTION)
            return httpx.Response(200, json={"operation_id": str(OPERATION), "kind": "transcription",
                "status": "in_progress", "claimed": True, "claim_token": str(CLAIM_TOKEN), "result": None})
        assert body["p_operation_id"] == str(OPERATION) and body["p_claim_token"] == str(CLAIM_TOKEN)
        if request.url.path.endswith("/complete_real_ai_operation"):
            assert body["p_provenance"] == PROVENANCE
            return httpx.Response(200, json={"saved": True})
        assert request.url.path.endswith("/fail_real_ai_operation")
        assert body["p_uncertain"] is True
        return httpx.Response(200, json={"status": "uncertain"})

    async def action(gateway):
        claim = await gateway.claim(PROJECT, SESSION, "transcription", ACTION, "a" * 64)
        assert await gateway.complete(claim, {"text": "Original"}, PROVENANCE) == {"saved": True}
        await gateway.fail(claim, "PROVIDER_UNCERTAIN")

    run(handler, action, secret=secret)
    assert len(seen) == 3


@pytest.mark.parametrize("secret", [None, "", " ", PUBLISHABLE, "arbitrary-nonsecret-fixture"])
def test_missing_or_publishable_service_credential_fails_closed_before_network(secret):
    def handler(request):
        pytest.fail("No transport call is permitted for an invalid server credential")

    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.claim(PROJECT, SESSION, "transcription", ACTION, "a" * 64), secret=secret)
    assert error.value.status_code == 503
    assert error.value.code == "REAL_AI_NOT_CONFIGURED"
    if secret and secret.strip():
        assert secret not in error.value.message


@pytest.mark.parametrize("tamper", [
    {"owner_id": str(OTHER)}, {"owner_id": None}, {"owner_id": "invalid"},
])
def test_upstream_owner_mismatch_never_becomes_a_private_read(tamper):
    def handler(request):
        return httpx.Response(200, json=[{**transcript_row(), **tamper}])

    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.rows("real_transcripts", filters={}))
    assert error.value.status_code == 503


def test_resource_id_mismatch_fails_before_returning_wrong_owned_row():
    def handler(request):
        return httpx.Response(200, json=[{**transcript_row(), "transcript_id": str(ASSISTANT)}])

    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.one("real_transcripts", "transcript_id", TRANSCRIPT))
    assert error.value.status_code == 503


@pytest.mark.parametrize("field,value", [("session_id", str(OTHER)), ("project_id", str(OTHER)), ("language", "sv")])
def test_transcript_list_rejects_wrong_session_project_or_language(field, value):
    def handler(request):
        assert_user_headers(request)
        if request.url.path.endswith("/conversation_sessions"):
            return httpx.Response(200, json=[session_row()])
        if request.url.path.endswith("/story_projects"):
            return httpx.Response(200, json=[project_row()])
        return httpx.Response(200, json=[{**transcript_row(), field: value}])

    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.transcripts(SESSION, 50, 0))
    assert error.value.status_code == 503


@pytest.mark.parametrize("status,code,expected", [
    (401, None, 401), (400, "P0002", 404), (409, "40001", 409), (400, "23505", 409),
    (400, "55000", 409), (400, "22023", 422), (400, "22001", 422),
    (400, "42501", 403), (403, None, 403), (500, "UNKNOWN", 503),
])
def test_rpc_errors_map_only_known_statuses_and_never_expose_upstream_details(status, code, expected):
    def handler(request):
        return httpx.Response(status, json={"code": code, "message": "upstream-private-content", "details": SERVER_SECRET})

    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.rpc("get_real_ai_operation", {"p_operation_id": str(OPERATION)}))
    assert error.value.status_code == expected
    assert "upstream-private-content" not in error.value.message and SERVER_SECRET not in error.value.message


@pytest.mark.parametrize("body", [b"[]", b"null", b'"text"', b"{", b'{"status":1,"status":2}', b"x" * 2_000_001])
def test_rpc_rejects_ambiguous_nonobject_malformed_or_oversized_json(body):
    with pytest.raises(APIError) as error:
        run(lambda request: httpx.Response(200, content=body),
            lambda gateway: gateway.rpc("get_real_ai_operation", {}))
    assert error.value.status_code == 503


@pytest.mark.parametrize("patch", [
    {"claimed": "false"}, {"kind": "speech"}, {"operation_id": "bad"},
    {"claimed": False, "claim_token": str(CLAIM_TOKEN)},
    {"status": "completed", "claimed": True},
    {"claimed": False, "status": "unknown", "claim_token": None},
])
def test_claim_rejects_revealed_replay_nonce_or_incoherent_upstream_shape(patch):
    base = {"operation_id": str(OPERATION), "kind": "transcription", "status": "in_progress", "claimed": True,
            "claim_token": str(CLAIM_TOKEN), "result": None}
    with pytest.raises(APIError) as error:
        run(lambda request: httpx.Response(200, json={**base, **patch}),
            lambda gateway: gateway.claim(PROJECT, SESSION, "transcription", ACTION, "a" * 64))
    assert error.value.status_code == 503


def test_completed_turn_normalizes_explicit_open_questions_without_internal_fields():
    user = {k: v for k, v in message_row("user").items() if k not in {"owner_id", "operation_id"}}
    assistant = {k: v for k, v in message_row().items() if k not in {"owner_id", "operation_id"}}
    memory = {k: v for k, v in memory_row().items() if k != "owner_id"}
    raw = {"user_message": user, "message": assistant, "memories": [memory], "mode": "real",
           "clarifications": [{"id": str(CLAIM_TOKEN), "fact_id": str(MEMORY), "session_id": str(SESSION),
               "conflicts_with_fact_id": None, "status": "open", "question": "Was Malmö your home?",
               "resolution": None, "created_at": STAMP, "resolved_at": None}],
           "requires_clarification": True}
    result = run(lambda request: pytest.fail("Normalization must not call the network"),
                 lambda gateway: gateway.normalize_result("conversation", raw))
    assert result["memories"][0]["clarification_question"] == "Was Malmö your home?"
    assert "clarifications" not in result and "requires_clarification" not in result
    assert result["message"]["provenance"] == PROVENANCE and result["mode"] == "real"


def test_speech_normalization_reads_owned_assistant_language_with_user_credentials():
    def handler(request):
        assert_user_headers(request)
        if request.url.path.endswith("/real_conversation_messages"):
            assert request.url.params["owner_id"] == f"eq.{OWNER}"
            return httpx.Response(200, json=[message_row()])
        return httpx.Response(200, json=[project_row()])

    raw = {"speech_id": str(OPERATION), "assistant_message_id": str(ASSISTANT), "media_type": "audio/wav",
           "audio_sha256": "a" * 64, "audio_size": 1000, "expires_at": STAMP,
           "owner_id": str(OWNER), "operation_id": str(OPERATION), "provenance": PROVENANCE}
    result = run(handler, lambda gateway: gateway.normalize_result("speech", raw))
    assert result["language"] == "en" and result["status"] == "ready"
    assert "owner_id" not in result and "operation_id" not in result and "provenance" not in result


def test_speech_normalization_never_accepts_another_owners_assistant_row():
    def handler(request):
        return httpx.Response(200, json=[{**message_row(), "owner_id": str(OTHER)}])

    raw = {"speech_id": str(OPERATION), "assistant_message_id": str(ASSISTANT), "media_type": "audio/wav",
           "audio_sha256": "a" * 64, "audio_size": 1000, "expires_at": STAMP}
    with pytest.raises(APIError) as error:
        run(handler, lambda gateway: gateway.normalize_result("speech", raw))
    assert error.value.status_code == 503
