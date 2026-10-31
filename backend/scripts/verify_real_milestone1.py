"""Staged real-v2 API acceptance, with durable keys and no automatic paid retry.

Only the caller supplies existing development user tokens. This module never
reads env credentials, changes Auth, creates users, or calls a provider directly.
Run through a budget-gated development backend. Evidence is sanitized; original
transcripts, stories, audio, tokens and passwords never enter the journal/report.
"""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import getpass
import hashlib
from io import BytesIO
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import wave
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from pydantic import SecretStr, ValidationError

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.schemas.real_ai import (  # noqa: E402
    RealDraft, RealExportMetadata, RealMemory, RealMessage, RealOperation,
    RealSpeech, RealTranscript, RealTurn,
)
from app.schemas.story_projects import ConversationSessionResponse, StoryProjectResponse  # noqa: E402
from app.schemas.story_drafts import StoryEditResponse  # noqa: E402

Stage = Literal["transcription", "conversation", "story", "speech", "full"]
_STAGES = {"transcription", "conversation", "story", "speech", "full"}
_SAFE_CODE = re.compile(r"^[A-Z0-9_]{1,80}$")
_MODELS = {"transcription": RealTranscript, "conversation": RealTurn,
           "generation": RealDraft, "speech": RealSpeech}


class VerificationFailure(Exception):
    """Only a predefined code and sanitized partial evidence may escape."""

    def __init__(self, code: str, report: dict | None = None):
        self.code = code if _SAFE_CODE.fullmatch(code) else "VERIFICATION_FAILED"
        self.report = report or {}
        super().__init__(self.code)


def _require(condition, code="INVALID_RESPONSE"):
    if not condition:
        raise VerificationFailure(code)


def _uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise VerificationFailure("INVALID_RESOURCE_ID") from None


def _json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise VerificationFailure("INVALID_JSON_RESPONSE") from None


def _model(model, value):
    try:
        return model.model_validate(value).model_dump(mode="json")
    except (ValueError, TypeError, ValidationError):
        raise VerificationFailure("INVALID_RESPONSE_CONTRACT") from None


def _origin(value):
    try:
        parsed = urlsplit(value)
        _require(not (parsed.username or parsed.password or parsed.query or parsed.fragment), "INVALID_BACKEND_URL")
        _require(parsed.path in {"", "/"} and parsed.hostname is not None, "INVALID_BACKEND_URL")
        if parsed.scheme == "http":
            _require(parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_private,
                     "INSECURE_BACKEND_URL")
        else:
            _require(parsed.scheme == "https", "INVALID_BACKEND_URL")
    except (ValueError, TypeError):
        raise VerificationFailure("INVALID_BACKEND_URL") from None
    return value.rstrip("/")


def _verify_pdf(data):
    try:
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(data),strict=True)
        _require(not reader.is_encrypted and 1 <= len(reader.pages) <= 100,"INVALID_PDF")
    except VerificationFailure:
        raise
    except Exception:
        raise VerificationFailure("INVALID_PDF") from None


class _Journal:
    """One caller-provided, ignored private file; lock the entire acceptance run."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = None
        self.data = {}

    def __enter__(self):
        try:
            _require(self.path.is_absolute() and ".." not in self.path.parts, "PRIVATE_MANIFEST_REQUIRED")
            for directory in self.path.parents:
                _require(not directory.is_symlink(), "PRIVATE_MANIFEST_REQUIRED")
            info = self.path.parent.stat()
            _require(info.st_uid == os.getuid() and not info.st_mode & 0o077, "PRIVATE_MANIFEST_REQUIRED")
            lock_path = self.path.with_name(self.path.name + ".lock")
            self.lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            lock_info = os.fstat(self.lock)
            _require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1
                     and lock_info.st_uid == os.getuid() and not lock_info.st_mode & 0o077,
                     "PRIVATE_MANIFEST_REQUIRED")
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if self.path.exists() or self.path.is_symlink():
                descriptor = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(descriptor, "r") as stream:
                    info = os.fstat(stream.fileno())
                    _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                             and info.st_uid == os.getuid() and not info.st_mode & 0o077
                             and info.st_size <= 128_000, "PRIVATE_MANIFEST_REQUIRED")
                    self.data = _json(stream.read())
                _require(type(self.data) is dict and self.data.get("schema") == 1, "INVALID_MANIFEST")
                _uuid(self.data.get("run_id"))
                _require(type(self.data.get("resources")) is dict and type(self.data.get("actions")) is dict,
                         "INVALID_MANIFEST")
            else:
                self.data = {"schema":1, "run_id":str(uuid4()), "resources":{}, "actions":{}}
                self.save()
            return self
        except VerificationFailure:
            self.__exit__(None, None, None)
            raise
        except (OSError, ValueError, TypeError, KeyError):
            self.__exit__(None, None, None)
            raise VerificationFailure("PRIVATE_MANIFEST_UNAVAILABLE") from None

    def save(self):
        encoded = json.dumps(self.data, sort_keys=True, separators=(",", ":")).encode()
        _require(len(encoded) <= 128_000, "MANIFEST_LIMIT")
        descriptor, name = tempfile.mkstemp(prefix=".memy-acceptance-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def __exit__(self, *_):
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None


def _audio(path):
    _require(isinstance(path, Path) and path.suffix.lower() in {".wav", ".mp3", ".m4a", ".webm"}, "INVALID_RECORDING")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= 25_000_000,
                     "INVALID_RECORDING")
            data = stream.read(25_000_001)
        _require(len(data) <= 25_000_000, "INVALID_RECORDING")
    except OSError:
        raise VerificationFailure("INVALID_RECORDING") from None
    mime = {".wav":"audio/wav", ".mp3":"audio/mpeg", ".m4a":"audio/mp4", ".webm":"audio/webm"}[path.suffix.lower()]
    return data, mime, "recording" + path.suffix.lower()


class _Runner:
    def __init__(self, client, journal, tokens, report, *, replay):
        self.client, self.journal, self.tokens, self.report = client, journal, tokens, report
        self.replay = replay

    async def call(self, owner, method, path, *, expected=(200,), limit=2_000_000, **options):
        headers = {"Accept":"application/json", **options.pop("headers", {})}
        if owner is not None:
            headers["Authorization"] = "Bearer " + self.tokens[owner].get_secret_value()
        try:
            async with self.client.stream(method, path, headers=headers, **options) as response:
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    _require(len(data) <= limit, "RESPONSE_LIMIT")
                if response.status_code not in expected:
                    code = "UNEXPECTED_HTTP_STATUS"
                    try:
                        candidate = _json(data).get("error", {}).get("code")
                        if isinstance(candidate, str) and _SAFE_CODE.fullmatch(candidate):
                            code = candidate
                    except (VerificationFailure, AttributeError, TypeError):
                        pass
                    self.report["last_http_status"] = response.status_code
                    raise VerificationFailure(code)
                return response.status_code, bytes(data), dict(response.headers)
        except httpx.HTTPError:
            raise VerificationFailure("NETWORK_RESULT_UNCERTAIN") from None

    async def json(self, owner, method, path, **options):
        _, body, _ = await self.call(owner, method, path, **options)
        return _json(body)

    async def denied(self, owner, method, path, **options):
        await self.call(owner, method, path, expected=(403,404), **options)
        self.report["cross_user_denials_checked"] += 1

    async def paid(self, owner, language, kind, path, *, payload=None, audio=None):
        action_name = f"{language}:{kind}"
        entry = self.journal.data["actions"].get(action_name)
        if entry is not None:
            key = _uuid(entry["action_key"])
            operation = _model(RealOperation, await self.json(owner, "GET", f"/api/v2/operations/by-key/{kind}/{key}"))
            _require(operation["kind"] == kind and operation["status"] == "completed"
                     and operation["result"] is not None, "ACTION_REQUIRES_RECONCILIATION")
            return _model(_MODELS[kind], operation["result"])
        key = str(uuid4())
        entry = {"action_key":key, "kind":kind, "status":"submitted"}
        self.journal.data["actions"][action_name] = entry
        self.journal.save()  # Durable BEFORE the first possible paid request.
        kwargs = {"headers":{"Idempotency-Key":key}}
        if audio is not None:
            data, mime, filename = audio
            kwargs.update(data={"language":language,"consent":"true"}, files={"file":(filename,data,mime)})
        else:
            kwargs["json"] = payload
        started = time.monotonic()
        _, body, _ = await self.call(owner, "POST", path, expected=(200,201), **kwargs)
        result = _model(_MODELS[kind], _json(body))
        entry.update(status="completed", elapsed_ms=round((time.monotonic()-started)*1000))
        self.journal.save()
        operation = _model(RealOperation, await self.json(owner,"GET",f"/api/v2/operations/by-key/{kind}/{key}"))
        _require(operation["kind"] == kind and operation["status"] == "completed", "OPERATION_NOT_COMPLETED")
        entry["operation_id"] = operation["operation_id"]
        self.journal.save()
        if self.replay:
            _, second_body, _ = await self.call(owner,"POST",path,expected=(200,201),**kwargs)
            second = _model(_MODELS[kind],_json(second_body))
            _require(second == result, "IDEMPOTENT_REPLAY_CHANGED")
            self.report["saved_result_replays_checked"] += 1
        return result

    async def project(self, owner, other, language):
        resources = self.journal.data["resources"].setdefault(language, {})
        if "project_id" not in resources:
            title = f"Memy real acceptance {language.upper()} {self.journal.data['run_id'][:8]}"
            rows = await self.json(owner,"GET","/api/v1/story-projects?limit=100&offset=0")
            _require(isinstance(rows,list),"INVALID_PROJECT_LIST")
            matches = [_model(StoryProjectResponse,row) for row in rows if row.get("title") == title]
            _require(len(matches) <= 1,"DUPLICATE_ACCEPTANCE_PROJECT")
            if not matches:
                matches = [_model(StoryProjectResponse,await self.json(owner,"POST","/api/v1/story-projects",
                    json={"title":title,"language":language},expected=(201,)))]
            resources["project_id"] = matches[0]["id"]
            self.journal.save()
        project_id = _uuid(resources["project_id"])
        project = _model(StoryProjectResponse,await self.json(owner,"GET",f"/api/v1/story-projects/{project_id}"))
        _require(project["language"] == language,"PROJECT_LANGUAGE_CHANGED")
        await self.denied(other,"GET",f"/api/v1/story-projects/{project_id}")
        continued = await self.json(owner,"POST",f"/api/v1/story-projects/{project_id}/continue",json={})
        session = _model(ConversationSessionResponse,continued.get("session"))
        _require(session["project_id"] == project_id and session["language"] == language
                 and session["status"] == "active","INVALID_SESSION_SCOPE")
        if "session_id" in resources:
            _require(resources["session_id"] == session["id"],"CONTINUATION_SESSION_CHANGED")
        resources["session_id"] = session["id"]
        self.journal.save()
        repeated = await self.json(owner,"POST",f"/api/v1/story-projects/{project_id}/continue",json={})
        _require(repeated.get("session",{}).get("id") == session["id"],"DUPLICATE_CONTINUE_SESSION")
        for resource in ("transcripts","messages","memories"):
            await self.denied(other,"GET",f"/api/v2/story-sessions/{session['id']}/{resource}")
        return project_id, session["id"], resources


async def run_acceptance(*, base_url: str, token_a: SecretStr, token_b: SecretStr,
    recordings: dict[str, Path], manifest_path: Path, stage: Stage = "transcription",
    languages: tuple[str,...] = ("en","sv"), expected_terms: dict[str,list[str]] | None = None,
    review_plan: dict[str,dict[str,dict]] | None = None,
    transport: httpx.AsyncBaseTransport | None = None, verify_replay: bool = True) -> dict:
    """Run explicit stages; root owns credentials, provider authorization and budget.

    English belongs to user A and Swedish to user B, so a two-language run tests
    nonempty resources under each owner. review_plan is an explicit human plan
    keyed by language and memory UUID; unplanned pending facts are never approved.
    """
    _require(stage in _STAGES and languages and len(set(languages)) == len(languages)
             and all(language in {"en","sv"} for language in languages),"INVALID_STAGE")
    _require(isinstance(token_a,SecretStr) and isinstance(token_b,SecretStr)
             and token_a.get_secret_value() and token_b.get_secret_value()
             and token_a.get_secret_value() != token_b.get_secret_value(),"TWO_DISTINCT_TOKENS_REQUIRED")
    origin = _origin(base_url)
    if stage in {"story","full"}:
        try:
            import pypdf  # noqa: F401 - fail before paid work if validation tools are absent.
        except ImportError:
            raise VerificationFailure("PDF_VALIDATOR_REQUIRED") from None
    report = {"result":"RUNNING","stage":stage,"languages":{},"cross_user_denials_checked":0,
              "saved_result_replays_checked":0,"paid_billing_evidence":"EXTERNAL_PROVIDER_OR_LEDGER_REQUIRED",
              "physical_phone_acceptance":"NOT_ESTABLISHED_BY_THIS_SCRIPT"}
    try:
        with _Journal(manifest_path) as journal:
            report["run_id"] = journal.data["run_id"]
            async with httpx.AsyncClient(base_url=origin,transport=transport,timeout=180,
                                         follow_redirects=False,trust_env=False) as client:
                runner = _Runner(client,journal,(token_a,token_b),report,replay=verify_replay)
                caps = await runner.json(None,"GET","/api/v2/capabilities")
                _require(caps.get("contract") == "real-v2" and caps.get("mode") == "real"
                         and caps.get("enabled") is True,"REAL_AI_NOT_ENABLED")
                for language in languages:
                    owner = 0 if language == "en" else 1
                    other = 1-owner
                    pid,sid,resources = await runner.project(owner,other,language)
                    scope = {"project_id":pid,"session_id":sid,"language":language}
                    evidence = {"owner_label":"A" if owner == 0 else "B",**scope}
                    report["languages"][language] = evidence
                    # Existing completed action is reconciled read-only; no audio reread is needed.
                    action_exists = f"{language}:transcription" in journal.data["actions"]
                    recording = None if action_exists else _audio(recordings.get(language))
                    transcript = await runner.paid(owner,language,"transcription",f"/api/v2/story-sessions/{sid}/transcribe",audio=recording)
                    _require(all(transcript[k] == v for k,v in scope.items()),"TRANSCRIPT_SCOPE_MISMATCH")
                    terms = (expected_terms or {}).get(language,[])
                    _require(all(isinstance(term,str) and term and term.casefold() in transcript["text"].casefold()
                                 for term in terms),"REFERENCE_TERMS_MISMATCH")
                    stored = await runner.json(owner,"GET",f"/api/v2/story-sessions/{sid}/transcripts?limit=100&offset=0")
                    originals = [_model(RealTranscript,row) for row in stored]
                    _require(transcript in originals,"ORIGINAL_NOT_PERSISTED")
                    resources["transcript_id"] = transcript["transcript_id"]
                    journal.save()
                    evidence.update(transcript_id=transcript["transcript_id"],transcript_characters=len(transcript["text"]),
                        transcript_sha256=hashlib.sha256(transcript["text"].encode()).hexdigest(),
                        reference_terms_checked=len(terms),reference_accuracy="TERMS_MATCHED" if terms else "HUMAN_REVIEW_PENDING",
                        transcription_model=transcript["provenance"]["model"])
                    if stage == "transcription":
                        continue
                    turn = await runner.paid(owner,language,"conversation",f"/api/v2/story-sessions/{sid}/messages",
                        payload={"source_transcript_id":transcript["transcript_id"],"language":language})
                    _require(all(turn["message"][k] == v for k,v in scope.items())
                             and turn["user_message"]["text"] == transcript["text"]
                             and turn["message"]["source_transcript_id"] == transcript["transcript_id"],"TURN_SCOPE_MISMATCH")
                    assistant = turn["message"]
                    resources["assistant_message_id"] = assistant["id"]
                    journal.save()
                    evidence.update(assistant_message_id=assistant["id"],interview_model=assistant["provenance"]["model"],
                        memory_ids=[m["id"] for m in turn["memories"]],pending_memory_candidates=len(turn["memories"]))
                    for memory in turn["memories"]:
                        _require(memory["value"] in transcript["text"] and memory["evidence"] in transcript["text"],"UNGROUNDED_MEMORY_CANDIDATE")
                        await runner.denied(other,"PATCH",f"/api/v2/memories/{memory['id']}",
                            json={"expected_version":memory["version"],"status":"confirmed"})
                    await runner.denied(other,"POST",f"/api/v2/conversation-messages/{assistant['id']}/speech",
                        json={"language":language},headers={"Idempotency-Key":str(uuid4())})
                    if stage in {"story","full"}:
                        memories = [_model(RealMemory,row) for row in await runner.json(owner,"GET",f"/api/v2/story-sessions/{sid}/memories?limit=100&offset=0")]
                        for memory in memories:
                            plan = (review_plan or {}).get(language,{}).get(memory["id"])
                            if plan is not None:
                                if memory["status"] == "pending":
                                    _require(plan.get("expected_version") == memory["version"],"MEMORY_REVIEW_VERSION_CHANGED")
                                    checked = _model(RealMemory,await runner.json(owner,"PATCH",f"/api/v2/memories/{memory['id']}",json=plan))
                                    _require(checked["id"] == memory["id"] and checked["status"] == plan.get("status")
                                             and checked["corrected_value"] == plan.get("corrected_value"),"MEMORY_REVIEW_CHANGED")
                                else:
                                    _require(memory["status"] == plan.get("status")
                                             and memory["corrected_value"] == plan.get("corrected_value"),"MEMORY_REVIEW_CHANGED")
                        reviewed = [_model(RealMemory,row) for row in await runner.json(owner,"GET",f"/api/v2/story-sessions/{sid}/memories?limit=100&offset=0")]
                        confirmed = [m for m in reviewed if m["status"] == "confirmed"]
                        _require(confirmed and not any(m["clarification_question"] for m in reviewed),"MEMORY_REVIEW_REQUIRED")
                        evidence["confirmed_memories"] = len(confirmed)
                        draft = await runner.paid(owner,language,"generation",f"/api/v2/story-projects/{pid}/generate",
                            payload={"language":language,"style":"warm","confirm_generation":True})
                        _require(draft["project_id"] == pid and draft["language"] == language
                                 and draft["verification"]["status"] != "passed","DRAFT_SCOPE_MISMATCH")
                        did = draft["draft_id"]
                        resources["draft_id"] = did
                        journal.save()
                        await runner.denied(other,"GET",f"/api/v2/story-drafts/{did}")
                        await runner.denied(other,"PATCH",f"/api/v2/story-drafts/{did}",json={"expected_revision":draft["revision"],"content":"Unauthorized test"})
                        current = _model(RealDraft,await runner.json(owner,"GET",f"/api/v2/story-drafts/{did}"))
                        original = current["original_content"]
                        if "edited_revision" not in resources:
                            marker = "Granskad i utvecklingstest." if language == "sv" else "Reviewed in development acceptance."
                            changed = _model(RealDraft,await runner.json(owner,"PATCH",f"/api/v2/story-drafts/{did}",
                                json={"expected_revision":current["revision"],"content":current["content"]+"\n\n"+marker}))
                            _require(changed["original_content"] == original and changed["verification"]["method"] == "manual_unverified",
                                     "ORIGINAL_DRAFT_CHANGED")
                            resources["edited_revision"] = changed["revision"]
                            journal.save()
                            current = changed
                        history = [_model(StoryEditResponse,row) for row in await runner.json(owner,"GET",f"/api/v2/story-drafts/{did}/history")]
                        _require(any(row["revision"] == resources["edited_revision"] for row in history),"EDIT_HISTORY_MISSING")
                        _,pdf,headers = await runner.call(owner,"POST",f"/api/v2/story-drafts/{did}/export",expected=(201,),
                            json={"expected_revision":current["revision"],"include_title_page":True,"include_page_numbers":True})
                        _require(pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
                                 and headers.get("x-memy-draft-revision") == str(current["revision"]),"INVALID_PDF")
                        _verify_pdf(pdf)
                        exported_revision = current["revision"]
                        eid = _uuid(headers.get("x-memy-export-id"))
                        metadata = [_model(RealExportMetadata,row) for row in await runner.json(owner,"GET",f"/api/v2/story-projects/{pid}/exports")]
                        _require(any(row["export_id"] == eid and row["draft_revision"] == current["revision"] for row in metadata),"EXPORT_AUDIT_MISSING")
                        await runner.denied(other,"GET",f"/api/v2/story-exports/{eid}/download")
                        if "post_export_revision" not in resources:
                            marker = "Historisk export bevarad i utvecklingstest." if language == "sv" else "Historical export preserved in development acceptance."
                            current = _model(RealDraft,await runner.json(owner,"PATCH",f"/api/v2/story-drafts/{did}",
                                json={"expected_revision":current["revision"],"content":current["content"]+"\n\n"+marker}))
                            _require(current["original_content"] == original,"ORIGINAL_DRAFT_CHANGED")
                            resources["post_export_revision"] = current["revision"]
                            journal.save()
                        _,historical,_ = await runner.call(owner,"GET",f"/api/v2/story-exports/{eid}/download",limit=2_000_000)
                        _require(hashlib.sha256(historical).digest() == hashlib.sha256(pdf).digest(),"EXPORT_SNAPSHOT_CHANGED")
                        evidence.update(draft_id=did,draft_revision=current["revision"],exported_revision=exported_revision,pdf_export_id=eid,
                            pdf_bytes=len(pdf),pdf_sha256=hashlib.sha256(pdf).hexdigest(),story_verification=current["verification"]["status"])
                    if stage in {"speech","full"}:
                        spoken = await runner.paid(owner,language,"speech",f"/api/v2/conversation-messages/{assistant['id']}/speech",payload={"language":language})
                        _require(spoken["assistant_message_id"] == assistant["id"] and spoken["language"] == language,"SPEECH_SCOPE_MISMATCH")
                        await runner.denied(other,"GET",f"/api/v2/spoken-replies/{spoken['speech_id']}/audio")
                        _,wav,headers = await runner.call(owner,"GET",f"/api/v2/spoken-replies/{spoken['speech_id']}/audio",limit=8_000_000)
                        _require(wav.startswith(b"RIFF") and wav[8:12] == b"WAVE" and len(wav) == spoken["audio_size"]
                                 and hashlib.sha256(wav).hexdigest() == spoken["audio_sha256"],"INVALID_SPOKEN_AUDIO")
                        try:
                            with wave.open(BytesIO(wav),"rb") as stream:
                                _require(stream.getnchannels() == 1 and stream.getsampwidth() == 2
                                         and stream.getframerate() == 24000 and 0 < stream.getnframes() <= 45*24000,
                                         "INVALID_SPOKEN_AUDIO")
                        except (wave.Error,EOFError):
                            raise VerificationFailure("INVALID_SPOKEN_AUDIO") from None
                        evidence.update(speech_id=spoken["speech_id"],speech_bytes=len(wav),speech_sha256=spoken["audio_sha256"],
                            human_voice_quality="LISTENING_REVIEW_REQUIRED")
                    # Read once more after downstream work: exact original still persists.
                    originals = [_model(RealTranscript,row) for row in await runner.json(owner,"GET",f"/api/v2/story-sessions/{sid}/transcripts?limit=100&offset=0")]
                    _require(transcript in originals,"ORIGINAL_TRANSCRIPT_CHANGED")
                report["result"] = "PASS"
                return report
    except VerificationFailure as error:
        report.update(result="FAIL",failure_code=error.code)
        error.report = report
        raise
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        report.update(result="FAIL",failure_code="INVALID_ACCEPTANCE_STATE")
        raise VerificationFailure("INVALID_ACCEPTANCE_STATE",report) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url",required=True)
    parser.add_argument("--manifest",type=Path,required=True)
    parser.add_argument("--audio-en",type=Path)
    parser.add_argument("--audio-sv",type=Path)
    parser.add_argument("--stage",choices=sorted(_STAGES),default="transcription")
    parser.add_argument("--languages",nargs="+",choices=("en","sv"),default=["en","sv"])
    parser.add_argument("--review-plan",type=Path,help="Private JSON: explicit memory UUID review plans; never tokens.")
    args = parser.parse_args(argv)
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print('{"result":"FAIL","failure_code":"INTERACTIVE_TERMINAL_REQUIRED"}')
        return 2
    try:
        token_a = SecretStr(getpass.getpass("Existing development user A access token (hidden): "))
        token_b = SecretStr(getpass.getpass("Existing development user B access token (hidden): "))
        plan = _json(args.review_plan.read_bytes()) if args.review_plan else None
        result = asyncio.run(run_acceptance(base_url=args.base_url,token_a=token_a,token_b=token_b,
            recordings={"en":args.audio_en,"sv":args.audio_sv},manifest_path=args.manifest,
            stage=args.stage,languages=tuple(args.languages),review_plan=plan))
        print(json.dumps(result,sort_keys=True))
        return 0
    except VerificationFailure as error:
        print(json.dumps(error.report or {"result":"FAIL","failure_code":error.code},sort_keys=True))
        return 1
    except (Exception,KeyboardInterrupt):
        print('{"result":"FAIL","failure_code":"ACCEPTANCE_STOPPED"}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
