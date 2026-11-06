"""Closed-cohort admission with synthetic identities only; no hosted/provider calls."""

import asyncio
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest

from app.api.real_ai import execute
from app.core.errors import APIError
from app.services.auth import AuthenticatedUser
from app.services.pilot_cohort import load_cohort, require_pilot_member
from tests.test_real_ai_api import OWNER, PROJECT, SESSION, TRANSCRIPT, harness
from tests.test_real_text_chat import text_harness, send
from tests.test_real_ai_reconciliation import (
    ReconciliationGateway, install_gateway, seed_completed_speech, wav_bytes,
)
from tests.test_real_pdf_without_ai import SavedPdfScenario, app_with_closed_ai


@pytest.fixture
def cohort(tmp_path):
    directory = tmp_path / "private-cohort"
    directory.mkdir(mode=0o700)
    path = directory / "cohort.json"
    data = {"version": 1, "approved_by": "offline-review", "user_ids": [str(OWNER)]}

    def write(value=data):
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        return path

    write()
    return path, data, write


def configure(app, path):
    app.state.settings = app.state.settings.model_copy(update={"ai_pilot_cohort_path": path})


def test_private_cohort_accepts_one_to_five_and_never_grants_spending(cohort):
    path, data, write = cohort
    assert load_cohort(path) == frozenset({OWNER})
    require_pilot_member(SimpleNamespace(ai_pilot_cohort_path=path), OWNER)
    data["user_ids"] = [str(uuid4()) for _ in range(5)]
    write(data)
    assert len(load_cohort(path)) == 5
    assert sorted(p.name for p in path.parent.iterdir()) == ["cohort.json"]


@pytest.mark.parametrize("change", [
    {"user_ids": []}, {"user_ids": [str(OWNER), str(OWNER)]},
    {"user_ids": [str(uuid4()) for _ in range(6)]},
    {"user_ids": ["not-a-uuid"]}, {"user_ids": ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]},
    {"user_ids": [None]}, {"user_ids": str(OWNER)},
    {"version": True}, {"version": 2}, {"approved_by": ""},
    {"approved_by": " review "}, {"approved_by": "review\nsecret"},
    {"extra": "private"},
])
def test_invalid_cohort_is_sanitized_and_closed(cohort, change):
    path, data, write = cohort
    write({**data, **change})
    with pytest.raises(APIError) as failure:
        load_cohort(path)
    assert failure.value.status_code == 503
    assert failure.value.code == "AI_PILOT_CONFIG_UNAVAILABLE"
    assert str(OWNER) not in failure.value.message and str(path) not in failure.value.message


@pytest.mark.parametrize("raw", [b"", b"not json", b"\xff", b"{}" * 3000,
    b'{"version":1,"version":1,"approved_by":"review","user_ids":[]}'])
def test_bounded_strict_json_rejects_bad_input(cohort, raw):
    path, _, _ = cohort
    path.write_bytes(raw)
    with pytest.raises(APIError):
        load_cohort(path)


@pytest.mark.parametrize("kind", ["missing", "public-file", "public-directory", "symlink", "hardlink"])
def test_private_control_boundary(cohort, tmp_path, kind):
    path, _, _ = cohort
    if kind == "missing":
        path.unlink()
    elif kind == "public-file":
        path.chmod(0o644)
    elif kind == "public-directory":
        path.parent.chmod(0o755)
    elif kind == "symlink":
        target = path.with_name("target")
        path.rename(target)
        path.symlink_to(target)
    else:
        path.with_name("second-link").hardlink_to(path)
    with pytest.raises(APIError):
        load_cohort(path)


def test_unset_preserves_existing_local_behavior():
    require_pilot_member(SimpleNamespace(ai_pilot_cohort_path=None), uuid4())


def test_member_can_send_and_outsider_cannot_spoof_identity(cohort, text_harness):
    path, _, _ = cohort
    app, gateway, provider = text_harness()
    configure(app, path)
    with TestClient(app) as client:
        assert send(client).status_code == 200
        gateway.user = AuthenticatedUser(uuid4(), SecretStr("synthetic-outsider-token"))
        denied = client.post(f"/api/v2/story-sessions/{SESSION}/text-messages?user_id={OWNER}",
            json={"text": "A synthetic memory.", "language": "en"},
            headers={"Idempotency-Key": str(uuid4()), "X-User-Id": str(OWNER)})
        forged = client.post(f"/api/v2/story-sessions/{SESSION}/text-messages",
            json={"text": "A synthetic memory.", "language": "en", "user_id": str(OWNER)},
            headers={"Idempotency-Key": str(uuid4())})
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "AI_PILOT_ACCESS_DENIED"
    assert denied.headers["x-memy-recovery"] == "contact-operator"
    assert "retry-after" not in denied.headers and "x-memy-operation-id" not in denied.headers
    assert str(OWNER) not in denied.text and str(gateway.user.id) not in denied.text
    assert forged.status_code == 422
    assert provider.calls == gateway.claim_count == 1


@pytest.mark.parametrize("action", ["transcription", "voice-message", "typed-message", "draft", "speech"])
def test_all_paid_routes_deny_before_provider_database_claim_or_audio_read(cohort, text_harness, monkeypatch, action):
    path, data, write = cohort
    write({**data, "user_ids": [str(uuid4())]})
    app, gateway, provider = text_harness()
    configure(app, path)

    async def forbidden(*_args, **_kwargs):
        pytest.fail("A rejected account must not read audio or access paid-action resources")

    gateway.get_owned_session = gateway.get_project = gateway.one = gateway.context = forbidden
    monkeypatch.setattr("app.api.real_ai.read_recording", forbidden)
    paths = {
        "transcription": (f"/api/v2/story-sessions/{SESSION}/transcribe", {"content": b"not multipart"}),
        "voice-message": (f"/api/v2/story-sessions/{SESSION}/messages", {"json": {"source_transcript_id": str(TRANSCRIPT), "language": "en"}}),
        "typed-message": (f"/api/v2/story-sessions/{SESSION}/text-messages", {"json": {"text": "My memory.", "language": "en"}}),
        "draft": (f"/api/v2/story-projects/{PROJECT}/generate", {"json": {"language": "en", "style": "warm", "confirm_generation": True}}),
        "speech": (f"/api/v2/conversation-messages/{uuid4()}/speech", {"json": {"language": "en"}}),
    }
    route, body = paths[action]
    with TestClient(app) as client:
        response = client.post(route, **body, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 403, response.text
    assert provider.calls == gateway.claim_count == 0


def test_execute_cannot_bypass_route_admission(cohort):
    path, data, write = cohort
    write({**data, "user_ids": [str(uuid4())]})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        settings=SimpleNamespace(ai_pilot_cohort_path=path))))
    gateway = SimpleNamespace(user=SimpleNamespace(id=OWNER))
    with pytest.raises(APIError) as failure:
        asyncio.run(execute(request, gateway, project_id=PROJECT, session_id=SESSION,
            kind="conversation", key=uuid4(), fingerprint="synthetic", produce=None, model="synthetic"))
    assert failure.value.code == "AI_PILOT_ACCESS_DENIED"


def test_removing_membership_or_breaking_file_never_blocks_saved_get_recovery(cohort, text_harness):
    path, data, write = cohort
    app, gateway, provider = text_harness()
    configure(app, path)
    key = uuid4()
    with TestClient(app) as client:
        saved = send(client, key=key)
        assert saved.status_code == 200
        write({**data, "user_ids": [str(uuid4())]})
        assert send(client).status_code == 403
        path.unlink()  # Broken admission must fail closed only for new paid work.
        failed = send(client)
        assert failed.status_code == 503
        assert failed.headers["x-memy-recovery"] == "contact-operator"
        history = client.get(f"/api/v2/story-sessions/{SESSION}/messages")
        operation = client.get(f"/api/v2/operations/by-key/conversation/{key}")
    assert history.status_code == operation.status_code == 200
    assert operation.json()["result"] == saved.json()
    assert provider.calls == gateway.claim_count == 1


def test_existing_prepared_speech_audio_remains_free_outside_cohort(cohort, harness):
    path, data, write = cohort
    write({**data, "user_ids": [str(uuid4())]})
    app, _, provider = harness()
    configure(app, path)
    gateway = ReconciliationGateway()
    install_gateway(app, gateway)
    audio = wav_bytes()
    _, speech_id, saved = seed_completed_speech(gateway,
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat(), data=audio, key=uuid4())
    app.state.real_ai.cache.put(OWNER, speech_id, audio, saved["audio_sha256"])
    with TestClient(app) as client:
        response = client.get(f"/api/v2/spoken-replies/{speech_id}/audio")
    assert response.status_code == 200 and response.content == audio
    assert provider.calls == gateway.claim_count == 0


def test_owned_pdf_export_and_download_stay_free_with_broken_cohort_file(tmp_path):
    from tests.test_real_ai_resources import USER_TOKEN

    scenario = SavedPdfScenario("en")
    app, checks, ledger, before = app_with_closed_ai(tmp_path, scenario, "exhausted")
    configure(app, tmp_path / "does-not-exist.json")
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {USER_TOKEN}"}
        created = client.post(f"/api/v2/story-drafts/{scenario.draft['draft_id']}/export",
            json={"expected_revision": 1}, headers=headers)
        downloaded = client.get(f"/api/v2/story-exports/{scenario.export_id}/download", headers=headers)
    assert created.status_code == 201 and downloaded.status_code == 200
    assert downloaded.content == created.content and downloaded.content.startswith(b"%PDF-")
    assert checks == [] and ledger.read_bytes() == before
