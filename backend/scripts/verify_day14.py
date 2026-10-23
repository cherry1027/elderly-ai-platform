"""Offline Day 14 rehearsal through real FastAPI routes and local M4A decoding.

No cloud, model-provider, email, or phone is contacted. Auth/PostgREST state is an
explicit in-memory double reused from the developer test suite, NOT a PostgreSQL
or RLS emulator. The decoder, validators, routes, mock providers, and PDF renderer
are real. A PASS therefore never certifies hosted security or iPhone acceptance.

Run from backend: .venv/bin/python scripts/verify_day14.py
The developer test dependencies are required. No credentials are requested,
printed, or transmitted. As elsewhere in the test suite, importing app.main may
validate ambient startup configuration; the measured application is constructed
with fixed fictional configuration and explicitly disabled live-provider fields.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha256
import io
import json
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class RehearsalFailure(Exception):
    """Expose only a fixed stage identifier, never a response body or credential."""


class Checks:
    def __init__(self) -> None:
        self.results: list[dict[str, str]] = []

    def require(self, condition: bool, stage: str) -> None:
        self.results.append({"check": stage, "status": "PASS" if condition else "FAIL"})
        if not condition:
            raise RehearsalFailure(stage)

    def response(self, response, expected: int, stage: str):
        self.require(response.status_code == expected, stage)
        return response.json()


def silent_m4a() -> bytes:
    """Encode a real AAC/MP4 audio-only fixture in memory; not recorded speech."""
    from fractions import Fraction
    import av

    output = io.BytesIO()
    with av.open(output, mode="w", format="mp4") as container:
        stream = container.add_stream("aac", rate=8_000)
        stream.layout = "mono"
        for index in range(8):
            frame = av.AudioFrame(format="fltp", layout="mono", samples=1_024)
            frame.sample_rate = 8_000
            frame.pts = index * 1_024
            frame.time_base = Fraction(1, 8_000)
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return output.getvalue()


def new_store(language: str):
    """Compose the existing SQL-shaped lifecycle double with audio persistence.

    This deliberately models only the routes used below. Real constraint/RLS and
    parallel transaction behavior must be verified by the independent SQL suite
    and, separately, hosted acceptance. It never obtains a real access token.
    """
    import httpx
    from tests import test_mock_journey as base
    from tests.test_day11_story_journey import Day11JourneyStore

    class RehearsalStore(Day11JourneyStore):
        def __init__(self):
            super().__init__()
            self.language = language
            self.transcripts: list[dict[str, Any]] = []
            self.audio_claims: dict[str, dict[str, Any]] = {}
            self.audio_digest: str | None = None
            self.lose_completion_response_once = True
            self.session_creations = 0

        def _project_relation(self, request):
            if request.method == "POST":
                values = base.body(request)
                assert values["user_id"] == base.USER_ID
                assert values["language"] == language
                self.project = {"id": base.PROJECT_ID, **values, "status": "draft",
                                "created_at": base.CREATED_AT, "updated_at": base.CREATED_AT}
                return httpx.Response(201, json=[deepcopy(self.project)])
            assert request.method == "GET"
            assert request.url.params["user_id"] == f"eq.{base.USER_ID}"
            return httpx.Response(200, json=[] if self.project is None else [deepcopy(self.project)])

        def _session_relation(self, request):
            if request.method == "POST":
                values = base.body(request)
                assert values == {"project_id": base.PROJECT_ID, "language": language}
                self.session_creations += 1
                self.session = {"id": base.SESSION_ID, **values, "status": "active",
                                "created_at": base.CREATED_AT, "updated_at": base.CREATED_AT,
                                "ended_at": None}
                return httpx.Response(201, json=[deepcopy(self.session)])
            return httpx.Response(200, json=[] if self.session is None else [deepcopy(self.session)])

        def _sentence(self, memory):
            value = memory["corrected_value"] or memory["value"]
            if memory["slot"] == "move":
                return (f"Jag flyttade till {value} år {memory['year']}." if language == "sv"
                        else f"I moved to {value} in {memory['year']}.")
            if memory["fact_type"] == "emotion":
                return f"Jag kände mig {value}." if language == "sv" else f"I felt {value}."
            raise AssertionError("Unexpected fixture source type")

        def _story_context(self):
            result = super()._story_context()
            result["language"] = language
            return result

        def _conversation_rpc(self, name, payload):
            if name != "append_conversation_turn":
                return super()._conversation_rpc(name, payload)
            assert payload["p_expected_sequence"] == len(self.messages)
            source = next((row for row in self.messages if row["id"] == payload["p_source_message_id"]), None)
            if source is None:
                source = {"id": str(uuid4()), "session_id": base.SESSION_ID,
                          "sequence": len(self.messages) + 1, "role": "user",
                          "text": payload["p_text"], "language": language, "created_at": base.CREATED_AT}
                self.messages.append(source)
            assistant = {"id": str(uuid4()), "session_id": base.SESSION_ID,
                         "sequence": len(self.messages) + 1, "role": "assistant",
                         "text": payload["p_assistant_text"], "language": language,
                         "created_at": base.CREATED_AT}
            self.messages.append(assistant)
            memories = []
            for candidate in payload["p_facts"]:
                assert candidate["clarification_question"] is None
                memory = {"id": str(uuid4()), "project_id": base.PROJECT_ID,
                          "session_id": base.SESSION_ID, "source_message_id": source["id"],
                          **{key: candidate[key] for key in (
                              "fact_type", "value", "evidence", "year", "slot", "uncertain")},
                          "status": "pending", "corrected_value": None, "version": 1,
                          "created_at": base.CREATED_AT, "updated_at": base.CREATED_AT}
                self.memories.append(memory)
                memories.append(memory)
            result = {"user_message": deepcopy(source), "message": assistant,
                      "memories": memories, "clarifications": [],
                      "requires_clarification": False, "mode": "mock"}
            self.turns[payload["p_idempotency_key"]] = deepcopy(result)
            return httpx.Response(200, json=result)

        def _story_rpc(self, name, payload):
            if name != "save_story_generation":
                return super()._story_rpc(name, payload)
            identity = (payload["p_context_token"], payload["p_language"], payload["p_style"])
            if identity in self.context_drafts:
                draft = self.context_drafts[identity]
            else:
                context = self._story_context()
                assert payload["p_content"] == context["canonical_content"]
                assert payload["p_language"] == language
                draft = {"draft_id": base.DRAFT_IDS[len(self.drafts)], "project_id": base.PROJECT_ID,
                         "status": "ready_for_review", "language": language, "style": "warm",
                         "version": len(self.drafts) + 1, "revision": 1,
                         "content": payload["p_content"], "original_content": payload["p_content"],
                         "mode": "mock", "source_memories": deepcopy(context["source_memories"]),
                         "verification": self._passed_report(), "created_at": base.CREATED_AT,
                         "updated_at": base.CREATED_AT}
                self.drafts.append(draft)
                self.context_drafts[identity] = draft
            self.generations[payload["p_idempotency_key"]] = draft
            return httpx.Response(200, json=deepcopy(draft))

        def _export_rpc(self, name, payload):
            response = super()._export_rpc(name, payload)
            result = response.json()
            if name == "continue_story_project":
                result["language"] = language
            return httpx.Response(200, json=result)

        def _audio_rpc(self, name, payload, request):
            if name == "claim_audio_transcription":
                key = payload["p_idempotency_key"]
                assert payload["p_session_id"] == base.SESSION_ID
                if self.audio_digest is not None and self.audio_digest != payload["p_content_sha256"]:
                    return httpx.Response(409, json={"code": "23505"})
                self.audio_digest = payload["p_content_sha256"]
                if key not in self.audio_claims:
                    self.audio_claims[key] = {
                        "outcome": "claimed", "request_id": str(uuid4()), "claim_token": str(uuid4()),
                        "status": "processing", "transcript_id": None, "session_id": base.SESSION_ID,
                        "language": language, "text": None, "created_at": None, "attempt_count": 1,
                    }
                return httpx.Response(200, json=[deepcopy(self.audio_claims[key])])
            claim = next(row for row in self.audio_claims.values() if row["request_id"] == payload["p_request_id"])
            if name == "fail_audio_transcription":
                # A response can be lost after a committed completion. Never
                # turn that successful persisted result into a failed claim.
                return httpx.Response(200, json=[{"request_id": claim["request_id"],
                    "status": claim["status"], "attempt_count": 1}])
            assert name == "complete_audio_transcription"
            transcript = {"transcript_id": str(uuid4()), "session_id": base.SESSION_ID,
                          "language": language, "text": payload["p_original_text"],
                          "status": "completed", "created_at": base.CREATED_AT}
            self.transcripts.append(transcript)
            self.messages.append({"id": transcript["transcript_id"], "session_id": base.SESSION_ID,
                                  "language": language, "text": transcript["text"], "role": "user",
                                  "sequence": len(self.messages) + 1, "created_at": base.CREATED_AT})
            claim.update(outcome="completed", status="completed", claim_token=None,
                         transcript_id=transcript["transcript_id"], text=transcript["text"],
                         created_at=transcript["created_at"])
            if self.lose_completion_response_once:
                self.lose_completion_response_once = False
                raise httpx.ReadError("Synthetic lost completion response", request=request)
            return httpx.Response(200, json=[deepcopy(transcript)])

        def __call__(self, request):
            assert request.url.host == "journey.test.supabase.co"
            assert request.headers["apikey"] == base.PUBLISHABLE_KEY
            token = request.headers.get("authorization")
            owner = token == f"Bearer {base.ACCESS_TOKEN}"
            other = token == "Bearer fictional-other-user-token"
            if request.url.path == "/auth/v1/user":
                if not (owner or other):
                    return httpx.Response(401, json={"message": "Invalid synthetic auth"})
                return httpx.Response(200, json={"id": base.USER_ID if owner else
                    "71000000-0000-4000-8000-000000000002"})
            if not owner:
                if request.url.path.startswith("/rest/v1/rpc/"):
                    return httpx.Response(404, json={"code": "P0002"})
                return httpx.Response(200, json=[])
            path = request.url.path
            if path == "/rest/v1/audio_transcripts":
                return httpx.Response(200, json=deepcopy(self.transcripts))
            if path == "/rest/v1/memory_clarifications":
                return httpx.Response(200, json=[])
            if path.startswith("/rest/v1/rpc/"):
                name = path.rsplit("/", 1)[-1]
                if name in {"claim_audio_transcription", "complete_audio_transcription", "fail_audio_transcription"}:
                    return self._audio_rpc(name, base.body(request), request)
                if name == "list_story_drafts":
                    return httpx.Response(200, json=deepcopy(self.drafts[::-1]))
                if name == "list_story_exports":
                    return httpx.Response(200, json=[deepcopy(row["export"]) for row in self.exports.values()])
            return super().__call__(request)

    return RehearsalStore()


def rehearse_language(language: str, checks: Checks) -> None:
    import httpx
    from fastapi.testclient import TestClient
    from app.core.config import Settings
    from app.main import create_app
    from app.services.transcription import SIMULATED_TRANSCRIPTS, SIMULATED_TRANSCRIPT_NOTICE, SimulatedTranscriptionProvider
    from tests import test_mock_journey as base

    class CountedSimulation(SimulatedTranscriptionProvider):
        calls = 0
        paths: list[Path]

        def __init__(self):
            self.paths = []

        async def transcribe(self, path, selected_language):
            self.calls += 1
            self.paths.append(path)
            return await super().transcribe(path, selected_language)

    store = new_store(language)
    provider = CountedSimulation()
    settings = Settings(_env_file=None, supabase_url=base.SUPABASE_URL,
                        supabase_publishable_key=base.PUBLISHABLE_KEY, conversation_mode="mock",
                        story_generation_mode="mock", ai_provider_mode="disabled", openai_api_key=None,
                        openai_text_model="", openai_verifier_model="", live_ai_approval_path=None,
                        api_requests_per_minute=600)

    def app():
        return create_app(settings, transport=httpx.MockTransport(store), transcription_provider=provider)

    owner = base.auth_headers()
    other = {"Authorization": "Bearer fictional-other-user-token"}
    project_path = f"/api/v1/story-projects/{base.PROJECT_ID}"
    session_path = f"/api/v1/story-sessions/{base.SESSION_ID}"
    stage = lambda name: f"{language}:{name}"
    expect = lambda response, status, name: checks.response(response, status, stage(name))
    require = lambda value, name: checks.require(value, stage(name))
    recording = silent_m4a()
    upload_key = str(uuid4())

    def upload(client, credentials=owner, data=recording):
        return client.post(f"{session_path}/transcribe", headers={**credentials, "Idempotency-Key": upload_key},
                           files={"file": ("fictional-silence.m4a", data, "audio/mp4")},
                           data={"language": language, "consent": "true"})

    def generate(client, key):
        return client.post(f"{project_path}/generate", headers={**owner, "Idempotency-Key": key},
                           json={"language": language, "confirm_generation": True})

    with TestClient(app()) as client:
        expect(client.post("/api/v1/story-projects", headers=owner, json={"title": base.PROJECT_TITLE,
               "description": "Fictional offline rehearsal", "language": language}), 201, "create_project")
        expect(client.post(f"{project_path}/sessions", headers=owner, json={}), 201, "create_session")
        expect(client.get(project_path), 401, "missing_auth_denied")
        expect(client.get(project_path, headers={"Authorization": "Bearer invalid-fictional-token"}), 401, "invalid_auth_denied")
        expect(upload(client, other), 404, "foreign_audio_denied")
        require(provider.calls == 0, "foreign_audio_does_not_invoke_provider")
        bad = upload(client, data=b"Not an M4A recording")
        require(bad.status_code in {415, 422}, "invalid_m4a_rejected")
        require(provider.calls == 0, "invalid_m4a_does_not_invoke_provider")
        expect(upload(client), 503, "lost_commit_response_sanitized")
        transcript = expect(upload(client), 200, "recover_committed_upload_same_key")
        require(transcript["text"] == SIMULATED_TRANSCRIPTS[language]
                and transcript["text"].startswith(SIMULATED_TRANSCRIPT_NOTICE), "exact_persistent_simulation_notice")
        require(expect(upload(client), 200, "completed_upload_replay") == transcript
                and provider.calls == 1 and len(store.transcripts) == 1, "no_duplicate_upload_or_provider_call")
        require(store.audio_digest == sha256(recording).hexdigest(), "exact_validated_m4a_fingerprint")
        require(all(not path.exists() for path in provider.paths), "temporary_audio_removed")
        require(expect(client.get(f"{session_path}/transcripts", headers=owner), 200,
                       "retrieve_transcript") == [transcript], "immutable_transcript_round_trip")

        key = str(uuid4())
        request = {"source_message_id": transcript["transcript_id"], "language": language}
        submit = lambda: client.post(f"{session_path}/messages", headers={**owner, "Idempotency-Key": key}, json=request)
        turn = expect(submit(), 201, "process_stored_transcript")
        require(turn["user_message"]["id"] == transcript["transcript_id"]
                and turn["user_message"]["text"] == transcript["text"] and turn["mode"] == "mock",
                "source_and_mock_provenance_preserved")
        require(expect(submit(), 201, "conversation_same_key_retry") == turn and len(store.turns) == 1,
                "no_duplicate_conversation_turn")
        require(len(turn["memories"]) == 2 and all(row["status"] == "pending" for row in turn["memories"]),
                "extraction_pending_not_auto_confirmed")
        source = next(row for row in turn["memories"] if row["slot"] == "move")
        rejected = next(row for row in turn["memories"] if row["slot"] == "occupation")
        correction = {"status": "confirmed", "corrected_value": "Lund", "expected_version": 1}
        expect(client.patch(f"/api/v1/memories/{source['id']}", headers=other, json=correction), 404,
               "foreign_memory_edit_denied")
        corrected = expect(client.patch(f"/api/v1/memories/{source['id']}", headers=owner, json=correction), 200,
                           "correct_and_confirm_memory")
        require(corrected["value"] == source["value"] and corrected["evidence"] == source["evidence"]
                and corrected["corrected_value"] == "Lund", "correction_preserves_original_evidence")
        expect(client.patch(f"/api/v1/memories/{rejected['id']}", headers=owner,
                            json={"status": "rejected", "expected_version": 1}), 200, "reject_memory")
        require(store.drafts == [], "review_does_not_generate_story")
        require(expect(client.post(f"{project_path}/generate", headers={**owner, "Idempotency-Key": str(uuid4())},
                json={"language": language, "confirm_generation": False}), 422,
                "explicit_generation_consent_required")["error"]["code"] == "VALIDATION_ERROR", "consent_error_contract")
        generation_key = str(uuid4())
        first = expect(generate(client, generation_key), 201, "explicit_generate_v1")
        require(first["verification"]["status"] == "passed" and first["mode"] == "mock"
                and len(first["source_memories"]) == 1 and "Lund" in first["content"]
                and rejected["id"] not in [row["memory_id"] for row in first["source_memories"]],
                "only_confirmed_corrected_sources_generate")
        require(expect(generate(client, generation_key), 201, "generation_same_key_retry")["draft_id"] == first["draft_id"]
                and len(store.drafts) == 1, "no_duplicate_draft")
        require(expect(generate(client, str(uuid4())), 201, "same_context_new_generation_action")["draft_id"] == first["draft_id"]
                and len(store.drafts) == 1, "same_context_no_extra_story_version")
        draft_path = f"/api/v1/story-drafts/{first['draft_id']}"
        manual = first["content"] + ("\n\nFiktiv manuell granskningsrad." if language == "sv"
                                    else "\n\nFictional manual review sentence.")
        edit = {"content": manual, "expected_revision": 1}
        edited = expect(client.patch(draft_path, headers=owner, json=edit), 200, "manual_edit")
        require(edited["revision"] == 2 and edited["original_content"] == first["content"]
                and edited["verification"]["status"] == "needs_review", "manual_edit_marks_unverified")
        require(expect(client.patch(draft_path, headers=owner, json=edit), 200,
                       "edit_exact_replay")["revision"] == 2 and len(store.history) == 1, "edit_replay_no_extra_revision")
        expect(client.patch(draft_path, headers=owner, json={**edit, "content": manual + "different"}), 409,
               "stale_different_edit_denied")
        history = expect(client.get(f"{draft_path}/history", headers=owner), 200, "edit_history")
        require(len(history) == 1 and history[0]["previous_content"] == first["content"]
                and history[0]["content"] == manual, "exact_edit_history_preserved")
        exported = client.post(f"{draft_path}/export", headers=owner, json={})
        require(exported.status_code == 201 and exported.content.startswith(b"%PDF-")
                and exported.headers["cache-control"] == "private, no-store", "private_pdf_export")
        export_id = exported.headers["x-memy-export-id"]
        require(manual.split("\n\n")[-1] in base.pdf_text(exported.content), "pdf_contains_saved_manual_revision")

    # Recreate the ASGI app to model a client reconnect, reusing only the explicit
    # persistence double. This is not proof of a real process/database restart.
    with TestClient(app()) as client:
        require(expect(client.get(f"{session_path}/transcripts", headers=owner), 200,
                       "reconnect_transcript_read") == [transcript], "notice_survives_reconnect")
        for _ in range(2):
            resumed = expect(client.post(f"{project_path}/continue", headers=owner, json={}), 200, "continue_existing_session")
            require(resumed["session"]["id"] == base.SESSION_ID and resumed["session_created"] is False
                    and resumed["generation_triggered"] is False and resumed["latest_draft"]["content"] == manual,
                    "continue_reuses_session_preserves_draft")
        require(store.session_creations == 1 and len(store.drafts) == 1, "continue_no_duplicate_session_or_generation")
        emotion_text = "Jag kände mig glad." if language == "sv" else "I felt happy."
        second = expect(client.post(f"{session_path}/messages", headers={**owner, "Idempotency-Key": str(uuid4())},
                        json={"text": emotion_text, "language": language}), 201, "new_text_memory")
        emotion = second["memories"][0]
        expect(client.patch(f"/api/v1/memories/{emotion['id']}", headers=owner,
                            json={"status": "confirmed", "expected_version": 1}), 200, "confirm_without_correction")
        require(len(store.drafts) == 1, "new_confirmation_does_not_regenerate")
        next_draft = expect(generate(client, str(uuid4())), 201, "explicit_generate_v2")
        require(next_draft["version"] == 2 and next_draft["draft_id"] != first["draft_id"], "new_version_keeps_old_draft")
        old = expect(client.get(draft_path, headers=owner), 200, "old_draft_after_regeneration")
        require(old["content"] == manual and old["original_content"] == first["content"]
                and old["verification"]["sources_current"] is False, "historical_draft_is_unchanged_and_stale")
        downloaded = client.get(f"/api/v1/story-exports/{export_id}/download", headers=owner)
        require(downloaded.status_code == 200 and downloaded.content == exported.content
                and downloaded.headers["x-memy-draft-version"] == "1"
                and downloaded.headers["x-memy-draft-revision"] == "2", "historical_pdf_exact_bytes")
        for path in (project_path, f"{session_path}/messages", f"{session_path}/memories",
                     f"{session_path}/transcripts", f"{draft_path}/history",
                     f"/api/v1/story-exports/{export_id}/download"):
            expect(client.get(path, headers=other), 404, "foreign_read_denied")
        expect(client.post(f"{project_path}/continue", headers=other, json={}), 404, "foreign_continue_denied")
        expect(client.post(f"{session_path}/messages", headers={**owner, "Idempotency-Key": str(uuid4())},
                           json={"text": "Fictional language test", "language": "sv" if language == "en" else "en"}),
               422, "request_language_mismatch_denied")
        switched = expect(client.post(f"{session_path}/messages", headers={**owner, "Idempotency-Key": str(uuid4())},
                          json={"text": "Tack." if language == "en" else "Thank you.", "language": language}),
                          201, "brief_opposite_language_text")
        require(switched["user_message"]["language"] == switched["message"]["language"] == language,
                "brief_language_switch_keeps_selection")
        require(store.project["language"] == store.session["language"] == next_draft["language"] == language,
                "project_session_draft_language_stable")
        require(store.transcripts == [transcript] and provider.calls == 1, "original_audio_source_never_overwritten")


def run_rehearsal(languages: tuple[str, ...] = ("en", "sv")) -> dict[str, Any]:
    checks = Checks()
    failed_check = None
    try:
        if not languages or any(language not in {"en", "sv"} for language in languages):
            raise RehearsalFailure("invalid_language_selection")
        for language in languages:
            rehearse_language(language, checks)
    except RehearsalFailure as exc:
        failed_check = str(exc)
    except Exception:
        # Import/configuration/decoder/route failures must not dump a traceback,
        # local environment, response contents, tokens, or fictional prose.
        failed_check = "unexpected_rehearsal_failure"
    passed = failed_check is None
    return {
        "backend_offline": {
            "status": "PASS" if passed else "FAIL", "languages": list(languages),
            "auth_and_persistence": "in_memory_test_double_not_SQL_or_RLS",
            "audio": "locally_encoded_silent_AAC_M4A_real_route_decoder",
            "transcription": "fixed_labelled_simulation_not_speech_recognition",
            "paid_calls": 0, "checks_passed": sum(item["status"] == "PASS" for item in checks.results),
            "failed_check": failed_check, "checks": checks.results,
        },
        "hosted_supabase": {"status": "NOT_RUN", "reason": "Offline doubles do not certify hosted RLS, grants, or deployed configuration."},
        "real_iphone": {"status": "PENDING", "reason": "Requires Tarun's physical-device acceptance on the approved secure network."},
        "overall": "PENDING_HOSTED_AND_DEVICE_ACCEPTANCE" if passed else "FAIL",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=("both", "en", "sv"), default="both")
    args = parser.parse_args(argv)
    report = run_rehearsal(("en", "sv") if args.language == "both" else (args.language,))
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["backend_offline"]["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
