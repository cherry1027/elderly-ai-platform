"""Opt-in, two-user hosted acceptance of the free Days 2–6 mock workflow.

This executes the real FastAPI application in-process against the dedicated
development Supabase project. It is not a deployed-server, email, mobile, real
speech recognition, or paid-AI test. No Auth users or Auth settings are changed.

Run ``.venv/bin/python scripts/verify_day7.py --run`` from a real terminal.
Use two existing, authorized disposable development accounts. Credentials are
read without echo and tokens stay in memory. Automation may explicitly select
``--tokens-from-env`` with MEMY_DAY7_USER_A_TOKEN / MEMY_DAY7_USER_B_TOKEN set by
an external private environment; never put tokens in command-line arguments.
Synthetic rows are retained by default. ``--cleanup`` authorizes deletion only
of the exact projects created by this invocation, including their child rows.
"""

from __future__ import annotations

import argparse
import getpass
import io
import os
from pathlib import Path
import sys
from typing import Any, Callable, IO, Mapping
from uuid import UUID, uuid4
import warnings
import wave

import httpx
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.conversation_provider import MockConversationProvider  # noqa: E402
from app.services.story_writer import MockStoryWriter  # noqa: E402
from scripts.verify_two_users import (  # noqa: E402
    DEV_SUPABASE_URL, SafeFailure, _authenticate_existing_user, _is_tty,
)


class FictionalTranscriptionProvider:
    """Explicit test-only fixture; ignores silent WAV bytes, never calls AI."""

    enabled = True
    mode = "mock"
    calls = 0
    texts = {
        "sv": "Fiktivt test. Jag tror att jag växte upp i Malmö.",
        "en": "Fictional test. I think I grew up in Malmö.",
    }

    async def transcribe(self, path: Path, language: str) -> str:
        if not path.is_file() or language not in self.texts:
            raise ValueError("Invalid fictional recording")
        self.calls += 1
        return self.texts[language]


def silent_wav() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(8000)
        recording.writeframes(b"\0\0" * 8000)
    return output.getvalue()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafeFailure(message)


def json_response(response: httpx.Response, expected: int, stage: str) -> Any:
    require(response.status_code == expected,
            f"{stage}: expected HTTP {expected}, received {response.status_code}.")
    try:
        return response.json()
    except ValueError as exc:
        raise SafeFailure(f"{stage}: invalid JSON response.") from exc


def auth_headers(token: str, *, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if key is not None:
        result["Idempotency-Key"] = key
    return result


def verified_token(client: httpx.Client, key: str, token: str, label: str) -> UUID:
    require(bool(token.strip()), f"Development user {label} token is missing.")
    try:
        response = client.get(f"{DEV_SUPABASE_URL}/auth/v1/user", headers={
            "apikey": key, **auth_headers(token),
        })
        payload = json_response(response, 200, f"Development user {label} verification")
        return UUID(str(payload.get("id")))
    except SafeFailure:
        raise
    except Exception as exc:
        raise SafeFailure(f"Development user {label} verification failed.") from exc


def build_mock_app(settings: Settings):
    """Bind all three providers explicitly before the first application write."""
    config = settings.model_copy(update={
        "conversation_mode": "mock", "story_generation_mode": "mock",
    })
    transcription = FictionalTranscriptionProvider()
    app = create_app(config, transcription_provider=transcription,
                     conversation_provider=MockConversationProvider(), story_writer=MockStoryWriter())
    require(str(app.state.settings.supabase_url).rstrip("/") == DEV_SUPABASE_URL,
            "Refusing to test a different Supabase project.")
    require(app.state.settings.conversation_mode == app.state.settings.story_generation_mode == "mock"
            and app.state.conversation_provider.mode == app.state.story_writer.mode == "mock"
            and type(app.state.transcription_provider) is FictionalTranscriptionProvider,
            "All acceptance providers must be explicit free mock fixtures.")
    return app, transcription


def verify_edit_retries(client: TestClient, draft_path: str, headers: dict[str, str],
                        edit: dict[str, Any], edited: dict[str, Any]) -> None:
    """Identical retries are idempotent; different content with a stale revision is not."""
    repeated = json_response(client.patch(draft_path, headers=headers, json=edit),
                             200, "Identical manual-edit retry")
    require(repeated["revision"] == edited["revision"]
            and repeated["content"] == edited["content"]
            and repeated["original_content"] == edited["original_content"],
            "Identical manual-edit retry created another revision or changed content.")
    stale_edit = {**edit, "content": edit["content"] + "\n\nDifferent stale synthetic edit."}
    json_response(client.patch(draft_path, headers=headers, json=stale_edit),
                  409, "Different-content stale-revision rejection")


def verify_language(client: TestClient, token_a: str, token_b: str, language: str,
                    created: list[tuple[str, str]], run_id: str,
                    provider: FictionalTranscriptionProvider) -> None:
    """One synthetic source→clarification→v1→edit→PDF→continue→v2 journey."""
    owner, other = auth_headers(token_a), auth_headers(token_b)
    prefix = "/api/v1"
    result = client.post(f"{prefix}/story-projects", headers=owner, json={
        "title": f"Synthetic Day 7 {language} {run_id}", "language": language,
        "description": "Disposable fictional acceptance fixture; no real personal data.",
    })
    project = json_response(result, 201, "Create synthetic project")
    project_id = str(UUID(project["id"]))
    created.append((project_id, token_a))
    project_path = f"{prefix}/story-projects/{project_id}"
    require(project["language"] == language, "Project language was not preserved.")
    json_response(client.get(project_path, headers=other), 404, "Cross-user project isolation")
    json_response(client.get(project_path), 401, "Missing-auth rejection")
    json_response(client.get(project_path, headers=auth_headers("invalid-development-token")),
                  401, "Invalid-auth rejection")
    json_response(client.patch(project_path, headers=owner, json={"title": " "}),
                  422, "Invalid-title rejection")
    json_response(client.get(f"{prefix}/story-projects/not-a-uuid", headers=owner),
                  422, "Invalid-UUID rejection")
    json_response(client.get(f"{prefix}/story-projects/{uuid4()}", headers=owner),
                  404, "Missing-project rejection")
    listed = json_response(client.get(f"{prefix}/story-projects?limit=100", headers=other),
                           200, "Other-user project list")
    require(all(item["id"] != project_id for item in listed), "Project leaked through another user's list.")

    session = json_response(client.post(f"{project_path}/sessions", headers=owner, json={}),
                            201, "Create session")
    session_id = str(UUID(session["id"]))
    session_path = f"{prefix}/story-sessions/{session_id}"
    require(session["language"] == language, "Session language changed unexpectedly.")
    json_response(client.get(f"{project_path}/sessions", headers=other), 404, "Cross-user session list")
    upload_key = str(uuid4())

    def upload(headers):
        return client.post(f"{session_path}/transcribe", headers={**headers, "Idempotency-Key": upload_key},
                           files={"file": ("synthetic-silence.wav", silent_wav(), "audio/wav")},
                           data={"language": language, "consent": "true"})

    calls_before = provider.calls
    json_response(upload(other), 404, "Cross-user audio isolation")
    original = json_response(upload(owner), 200, "Fictional audio fixture persistence")
    require(original["text"] == provider.texts[language], "Fictional transcription fixture differs.")
    require(json_response(upload(owner), 200, "Audio idempotency") == original
            and provider.calls == calls_before + 1, "Audio retry was not idempotent.")
    turn_key = str(uuid4())
    turn_request = {"source_message_id": original["transcript_id"], "language": language}
    turn = json_response(client.post(f"{session_path}/messages", headers=auth_headers(token_a, key=turn_key),
                                     json=turn_request), 201, "Process immutable transcript")
    repeated = json_response(client.post(f"{session_path}/messages", headers=auth_headers(token_a, key=turn_key),
                                         json=turn_request), 201, "Conversation idempotency")
    require(turn == repeated and turn["mode"] == "mock", "Mock conversation retry changed the turn.")
    require(len(turn["memories"]) == 1 and turn["requires_clarification"] is True,
            "The uncertain synthetic source did not require clarification.")
    memory = turn["memories"][0]
    require(memory["value"] == "Malmö" and memory["status"] == "pending",
            "Source evidence was not kept pending.")
    for suffix in ("messages", "memories", "clarifications", "transcripts"):
        json_response(client.get(f"{session_path}/{suffix}", headers=other),
                      404, f"Cross-user {suffix} isolation")
    questions = json_response(client.get(f"{session_path}/clarifications", headers=owner),
                              200, "Read clarification")
    require(any(row["fact_id"] == memory["id"] for row in questions), "Clarification was not persisted.")
    confirm_payload = {"status": "confirmed", "expected_version": memory["version"], "corrected_value": "Lund"}
    memory_path = f'{prefix}/memories/{memory["id"]}'
    json_response(client.patch(memory_path, headers=other, json=confirm_payload),
                  404, "Cross-user memory modification")
    resolved = json_response(client.patch(memory_path, headers=owner, json=confirm_payload),
                             200, "Resolve clarification without overwriting source")
    require(resolved["value"] == memory["value"] and resolved["evidence"] == memory["evidence"]
            and resolved["corrected_value"] == "Lund", "Memory correction overwrote original evidence.")
    require(json_response(client.get(f"{session_path}/clarifications", headers=owner),
                          200, "Resolved clarification list") == [], "Clarification did not resolve.")

    def generate():
        return client.post(f"{project_path}/generate", headers=auth_headers(token_a, key=str(uuid4())),
                           json={"language": language, "confirm_generation": True})

    first = json_response(generate(), 201, "Generate v1 from confirmed sources")
    require(first["version"] == 1 and first["revision"] == 1
            and first["verification"]["status"] == "passed" and "Lund" in first["content"],
            "Initial draft did not use the confirmed corrected source.")
    draft_path = f'{prefix}/story-drafts/{first["draft_id"]}'
    manual = first["content"] + ("\n\nManuell fiktiv granskningsrad." if language == "sv"
                                    else "\n\nManual fictional review sentence.")
    edit = {"content": manual, "expected_revision": first["revision"]}
    json_response(client.patch(draft_path, headers=other, json=edit), 404, "Cross-user draft editing")
    edited = json_response(client.patch(draft_path, headers=owner, json=edit), 200, "Save manual revision")
    require(edited["original_content"] == first["content"] and edited["revision"] == 2
            and edited["verification"]["status"] == "needs_review", "Manual edit lost original/review state.")
    verify_edit_retries(client, draft_path, owner, edit, edited)
    json_response(client.post(f"{draft_path}/export", headers=other, json={}), 404, "Cross-user export isolation")
    exported = client.post(f"{draft_path}/export", headers=owner, json={})
    require(exported.status_code == 201 and exported.content.startswith(b"%PDF-")
            and exported.content.rstrip().endswith(b"%%EOF")
            and exported.headers.get("cache-control") == "private, no-store",
            "PDF export failed or was not private.")
    export_id = str(UUID(exported.headers["x-memy-export-id"]))
    json_response(client.get(f"{project_path}/exports", headers=other), 404, "Cross-user export list")
    audits = json_response(client.get(f"{project_path}/exports", headers=owner), 200, "Export metadata")
    require(any(row["export_id"] == export_id and row["draft_revision"] == 2 for row in audits),
            "Export audit was not persisted.")
    json_response(client.post(f"{project_path}/continue", headers=other, json={}),
                  404, "Cross-user continuation")
    resumed = json_response(client.post(f"{project_path}/continue", headers=owner, json={}),
                            200, "Continue existing autobiography")
    require(resumed["generation_triggered"] is False and resumed["session_created"] is False
            and resumed["latest_draft"]["content"] == manual, "Continue modified a draft or generated content.")
    text = "Jag kände mig glad." if language == "sv" else "I felt happy."
    second_turn = json_response(client.post(f"{session_path}/messages", headers=auth_headers(token_a, key=str(uuid4())),
                                           json={"text": text, "language": language}), 201, "Append new confirmed memory")
    require(len(second_turn["memories"]) == 1, "Second fixture did not create one supported memory.")
    second_memory = second_turn["memories"][0]
    json_response(client.patch(f'{prefix}/memories/{second_memory["id"]}', headers=owner,
                               json={"status": "confirmed", "expected_version": second_memory["version"]}),
                  200, "Confirm continuation memory")
    drafts_before = json_response(client.get(f"{project_path}/drafts", headers=owner), 200, "Draft list before explicit regeneration")
    require(len(drafts_before) == 1, "New memory caused implicit regeneration.")
    second = json_response(generate(), 201, "Explicitly generate v2")
    require(second["version"] == 2 and second["draft_id"] != first["draft_id"] and text in second["content"],
            "Explicit regeneration did not create a new sourced version.")
    old = json_response(client.get(draft_path, headers=owner), 200, "Preserve edited historical v1")
    require(old["content"] == manual and old["original_content"] == first["content"] and old["revision"] == 2,
            "New version overwrote an older manual draft.")
    original_rows = json_response(client.get(f"{session_path}/transcripts", headers=owner), 200, "Read immutable original after edits")
    require(original_rows == [original], "Workflow changed an original transcript.")
    download_path = f"{prefix}/story-exports/{export_id}/download"
    json_response(client.get(download_path, headers=other), 404, "Cross-user PDF download")
    downloaded = client.get(download_path, headers=owner)
    require(downloaded.status_code == 200 and downloaded.content == exported.content
            and downloaded.headers.get("x-memy-draft-version") == "1"
            and downloaded.headers.get("x-memy-draft-revision") == "2",
            "Historical PDF no longer matches the exported revision.")


def cleanup_created(client: httpx.Client, key: str, created: list[tuple[str, str]]) -> bool:
    """Only exact UUIDs created now; each deletion uses its owner's token."""
    complete = True
    for project_id, token in created:
        try:
            UUID(project_id)
            response = client.delete(f"{DEV_SUPABASE_URL}/rest/v1/story_projects",
                                     params={"id": f"eq.{project_id}"}, headers={
                                         "apikey": key, **auth_headers(token),
                                     })
            if response.status_code not in (200, 204):
                complete = False
                continue
            # PostgREST can return 204 when RLS matched zero rows. Confirm the
            # current owner's exact project is actually gone before claiming cleanup.
            check = client.get(f"{DEV_SUPABASE_URL}/rest/v1/story_projects",
                               params={"id": f"eq.{project_id}", "select": "id"},
                               headers={"apikey": key, **auth_headers(token)})
            complete &= check.status_code == 200 and check.json() == []
        except Exception:
            complete = False
    return complete


def run_verification(*, run: bool = False, tokens_from_env: bool = False, cleanup: bool = False,
                     languages: tuple[str, ...] = ("sv", "en"),
                     environ: Mapping[str, str] | None = None,
                     stdin: IO[str] | None = None, stdout: IO[str] | None = None,
                     stderr: IO[str] | None = None,
                     secret_reader: Callable[..., str] = getpass.getpass,
                     settings_factory: Callable[[], Settings] = Settings,
                     client_factory: Callable[..., httpx.Client] = httpx.Client,
                     app_factory: Callable = build_mock_app,
                     test_client_factory: Callable = TestClient,
                     journey_runner: Callable = verify_language) -> int:
    output, error = stdout or sys.stdout, stderr or sys.stderr
    input_stream = stdin or sys.stdin
    if not run:
        error.write("No changes made. Pass --run to authorize synthetic development-only acceptance writes.\n")
        return 2
    if not languages or any(language not in ("sv", "en") for language in languages):
        error.write("Only en and sv acceptance fixtures are supported.\n")
        return 2
    if not tokens_from_env and (not _is_tty(input_stream) or not _is_tty(error)):
        error.write("Hidden credential input requires a real terminal; or explicitly use --tokens-from-env.\n")
        return 2
    created: list[tuple[str, str]] = []
    credentials: list[str] = []
    key = ""
    result = 1
    try:
        settings = settings_factory()
        require(settings.supabase_configured, "Development Supabase configuration is incomplete.")
        require(str(settings.supabase_url).rstrip("/") == DEV_SUPABASE_URL,
                "Refusing to run: only the dedicated Memy development Supabase project is allowed.")
        key = settings.supabase_publishable_key.get_secret_value().strip()
        app, provider = app_factory(settings)
        # Check again at the write boundary, even when a caller supplies a factory.
        require(str(app.state.settings.supabase_url).rstrip("/") == DEV_SUPABASE_URL
                and app.state.settings.conversation_mode == app.state.settings.story_generation_mode == "mock"
                and type(app.state.conversation_provider) is MockConversationProvider
                and type(app.state.story_writer) is MockStoryWriter
                and type(app.state.transcription_provider) is FictionalTranscriptionProvider,
                "Refusing to run without explicit free mock providers and the exact development project.")
        with client_factory(timeout=15, follow_redirects=False) as upstream:
            tokens, ids = [], []
            for label in ("A", "B"):
                if tokens_from_env:
                    token = (environ if environ is not None else os.environ).get(f"MEMY_DAY7_USER_{label}_TOKEN", "")
                    user_id = verified_token(upstream, key, token, label)
                else:
                    with warnings.catch_warnings():
                        warnings.simplefilter("error", getpass.GetPassWarning)
                        email = secret_reader(f"Disposable development user {label} email (hidden): ", stream=error).strip()
                        password = secret_reader(f"Disposable development user {label} password: ", stream=error)
                    require(bool(email and password), "Both disposable account credentials are required.")
                    credentials.extend((email, password))
                    token, user_id = _authenticate_existing_user(
                        upstream, base_url=DEV_SUPABASE_URL, publishable_key=key,
                        email=email, password=password, label=label,
                    )
                credentials.append(token)
                tokens.append(token)
                ids.append(user_id)
            require(ids[0] != ids[1], "Use two different existing disposable development accounts.")
            output.write("Using exact development project and fictional mock providers; no paid calls or Auth changes.\n")
            try:
                with test_client_factory(app) as client:
                    json_response(client.get("/health"), 200, "Health check")
                    json_response(client.get("/ready"), 200, "Development database readiness")
                    run_id = str(uuid4())
                    for index, language in enumerate(languages):
                        # Each account owns a full journey; also exercise both isolation directions.
                        first, second = (tokens[0], tokens[1]) if index % 2 == 0 else (tokens[1], tokens[0])
                        journey_runner(client, first, second, language, created, run_id, provider)
                        output.write(f"PASS {language}: immutable source, clarification, v1/edit/PDF, continuation/v2, and cross-user denial.\n")
                result = 0
            finally:
                if cleanup:
                    complete = cleanup_created(upstream, key, created)
                    if complete:
                        output.write("Deleted only this run's synthetic projects and their dependent rows. Auth users were not deleted.\n")
                        created.clear()
                    else:
                        error.write("Synthetic cleanup incomplete; review the retained project IDs below.\n")
                        result = 1
        if result == 0:
            output.write("PASS hosted two-user mock API acceptance; real AI, mobile, email and deployed-server acceptance remain separate.\n")
        return result
    except (KeyboardInterrupt, EOFError):
        error.write("Verification cancelled. No credentials have been printed.\n")
        return 130
    except getpass.GetPassWarning:
        error.write("Secure hidden input unavailable. Use a real terminal.\n")
        return 2
    except SafeFailure as exc:
        # All SafeFailure messages in this module and the shared auth helper are fixed,
        # local strings. Upstream bodies, URLs with tokens, and raw exceptions are never printed.
        error.write(f"Verification stopped: {exc}\n")
        return 1
    except Exception:
        error.write("Verification stopped safely after an unexpected local/network failure; credential details suppressed.\n")
        return 1
    finally:
        for project_id, _token in created:
            output.write(f"Retained synthetic project: {project_id}\n")
        credentials.clear()  # Best effort only: immutable Python strings cannot be securely zeroed.
        key = ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Authorize synthetic writes to the dedicated development project.")
    parser.add_argument("--tokens-from-env", action="store_true", help="Read two existing user tokens from private external environment variables.")
    parser.add_argument("--cleanup", action="store_true", help="Delete only projects created in this invocation, including dependent rows.")
    parser.add_argument("--language", choices=("en", "sv"), help="Run just one fixture language (default: both).")
    args = parser.parse_args(argv)
    return run_verification(run=args.run, tokens_from_env=args.tokens_from_env, cleanup=args.cleanup,
                            languages=(args.language,) if args.language else ("sv", "en"))


if __name__ == "__main__":
    raise SystemExit(main())
