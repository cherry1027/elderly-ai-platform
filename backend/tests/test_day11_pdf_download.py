"""Real in-memory PDF bytes through the owned HTTP contract, without cloud I/O.

PostgREST/Auth are explicit doubles. Rendering, parsing, worker capacity and
binary/error responses are real. These are not Expo/iPhone acceptance checks.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from threading import Event
from uuid import uuid4

from fastapi import Request
from fastapi.testclient import TestClient
import httpx
from pypdf import PdfReader
import pytest

from app.api import exports as export_api
from app.core.errors import APIError
from app.services.pdf_export import PdfRenderer
from test_exports_continuation import (
    ACCESS_TOKEN, DRAFT_ID, PROJECT_ID, Scenario, auth_headers,
    draft_row, export_metadata, make_app, project_row,
)


class RenderedExportStore(Scenario):
    """Store the exact render audit and revision selected by each HTTP request."""

    def __init__(self, language: str = "sv"):
        super().__init__()
        self.language = language
        self.title = "Minnen från Malmö och Öland" if language == "sv" else "Fictional memories"
        self.original = "Jag växte upp i Malmö." if language == "sv" else "I grew up in Malmö."
        self.manual = "Jag minns sjön och Åkes trädgård." if language == "sv" else "I remember the lake."
        self.current = draft_row(revision=1)
        self.current.update(language=language, content=self.original, original_content=self.original)
        self.current["source_memories"][0]["sentence"] = self.original
        self.current["source_memories"][0]["evidence"] = self.original.rstrip(".")
        self.saved: dict[str, dict] = {}

    def _rpc(self, name, request):
        payload = json.loads(request.content)
        if name == "load_story_export_context":
            self.results[name] = {"draft": deepcopy(self.current), "project_title": self.title}
        elif name == "record_story_export":
            assert payload["p_expected_revision"] == self.current["revision"]
            assert payload["p_expected_title"] == self.title
            metadata = export_metadata(
                title=self.title, revision=self.current["revision"], content=self.current["content"],
                include_title_page=payload["p_include_title_page"],
                include_page_numbers=payload["p_include_page_numbers"],
                filename=payload["p_filename"], byte_size=payload["p_byte_size"],
                page_count=payload["p_page_count"],
            )
            metadata.update(export_id=str(uuid4()), language=self.language)
            self.saved[metadata["export_id"]] = {
                "export": metadata, "content": self.current["content"],
            }
            self.results[name] = metadata
        elif name == "get_story_export":
            self.results[name] = self.saved[payload["p_export_id"]]
        elif name == "list_story_exports":
            self.results[name] = [row["export"] for row in reversed(self.saved.values())]
        return super()._rpc(name, request)

    def __call__(self, request):
        self.project_rows = [{**project_row(), "title": self.title, "language": self.language}]
        return super().__call__(request)

    def edit_and_rename(self):
        edited = draft_row(revision=2)
        edited.update(
            language=self.language, content=f"{self.original}\n\n{self.manual}",
            original_content=self.original, source_memories=deepcopy(self.current["source_memories"]),
        )
        self.current = edited
        self.title = "Ny titel med ä, å och ö" if self.language == "sv" else "New fictional title"


def assert_real_pdf(response, expected_content: str, *, status: int, revision: int):
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert int(response.headers["content-length"]) == len(response.content)
    assert response.headers["x-memy-draft-revision"] == str(revision)
    assert response.content.startswith(b"%PDF-")
    assert response.content.rstrip().endswith(b"%%EOF")
    reader = PdfReader(BytesIO(response.content))
    assert len(reader.pages) == int(response.headers["x-memy-page-count"])
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    for paragraph in expected_content.split("\n\n"):
        assert paragraph in text
    assert "simulerad" in text if "Jag " in expected_content else "Development mock export" in text
    return text


@pytest.mark.parametrize("language", ["en", "sv"])
def test_real_pdf_route_preserves_old_revision_after_edit_rename_and_new_export(language):
    store = RenderedExportStore(language)
    with TestClient(make_app(store, PdfRenderer())) as client:
        first = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers(), json={})
        old_text = assert_real_pdf(first, store.original, status=201, revision=1)
        old_id = first.headers["x-memy-export-id"]
        old_audit = deepcopy(store.saved[old_id])
        store.edit_and_rename()  # Represents the saved RPC state, not a manual-edit API test.
        second = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers(), json={})
        assert_real_pdf(second, store.current["content"], status=201, revision=2)
        assert second.headers["x-memy-export-id"] != old_id

        for _ in range(2):
            old = client.get(f"/api/v1/story-exports/{old_id}/download", headers=auth_headers())
            text = assert_real_pdf(old, store.original, status=200, revision=1)
            assert old.content == first.content  # Same-runtime deterministic rendering.
            assert text == old_text and store.manual not in text
            assert store.title not in text

        listed = client.get(f"/api/v1/story-projects/{PROJECT_ID}/exports", headers=auth_headers())
        assert listed.status_code == 200
        assert [row["draft_revision"] for row in listed.json()] == [2, 1]

    assert store.saved[old_id] == old_audit
    assert len(store.saved) == len(store.rpc_payloads["record_story_export"]) == 2
    assert old_audit["export"]["content_sha256"] == hashlib.sha256(store.original.encode()).hexdigest()
    assert old_audit["export"]["byte_size"] == len(first.content)


def test_failed_pdf_can_be_retried_without_returning_partial_bytes_or_creating_failed_audit():
    class FailsOnce(PdfRenderer):
        failures = 1

        def render(self, **options):
            if self.failures:
                self.failures -= 1
                raise RuntimeError("private story or token " + ACCESS_TOKEN)
            return super().render(**options)

    store = RenderedExportStore()
    with TestClient(make_app(store, FailsOnce())) as client:
        failed = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers(), json={})
        assert failed.status_code == 503
        assert failed.headers["content-type"] == "application/json"
        assert failed.headers["cache-control"] == "no-store"
        assert failed.json()["error"]["code"] == "PDF_GENERATION_FAILED"
        assert ACCESS_TOKEN not in failed.text and "private story" not in failed.text
        assert "content-disposition" not in failed.headers
        assert not store.saved and not store.rpc_payloads["record_story_export"]
        retried = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers(), json={})
        assert_real_pdf(retried, store.original, status=201, revision=1)
    assert len(store.saved) == 1


def test_upstream_historical_download_failure_is_safe_and_retry_does_not_create_an_export():
    store = RenderedExportStore()
    with TestClient(make_app(store, PdfRenderer())) as client:
        first = client.post(f"/api/v1/story-drafts/{DRAFT_ID}/export", headers=auth_headers(), json={})
        export_id = first.headers["x-memy-export-id"]
        store.errors["get_story_export"] = httpx.ConnectError("private network detail " + ACCESS_TOKEN)
        failed = client.get(f"/api/v1/story-exports/{export_id}/download", headers=auth_headers())
        assert failed.status_code == 503
        assert failed.headers["content-type"] == "application/json"
        assert failed.json()["error"]["code"] == "SUPABASE_UNAVAILABLE"
        assert ACCESS_TOKEN not in failed.text and "private network" not in failed.text
        del store.errors["get_story_export"]
        recovered = client.get(f"/api/v1/story-exports/{export_id}/download", headers=auth_headers())
        assert_real_pdf(recovered, store.original, status=200, revision=1)
        assert recovered.content == first.content
    assert len(store.saved) == len(store.rpc_payloads["record_story_export"]) == 1


@pytest.mark.parametrize("ending", ["timeout", "cancel"])
def test_interrupted_render_keeps_its_capacity_until_worker_finishes(monkeypatch, ending):
    """A client retry cannot bypass bounded CPU capacity after timeout/cancel."""
    started, release = Event(), Event()

    class BlockingRenderer(PdfRenderer):
        def render(self, **options):
            started.set()
            if not release.wait(timeout=5):
                raise RuntimeError("test worker was not released")
            return super().render(**options)

    if ending == "timeout":
        monkeypatch.setattr(export_api, "PDF_RENDER_TIMEOUT_SECONDS", 0.01)

    async def exercise():
        app = make_app(RenderedExportStore(), BlockingRenderer())
        async with app.router.lifespan_context(app):
            app.state.pdf_slots = asyncio.Semaphore(1)
            request = Request({"type": "http", "app": app})
            options = dict(title="Fictional story", content="I grew up in Malmö.", language="en",
                           draft_version=1, draft_revision=1, include_title_page=True,
                           include_page_numbers=True)
            task = asyncio.create_task(export_api.render_document(request, **options))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                if ending == "cancel":
                    task.cancel()
                    with pytest.raises(asyncio.CancelledError):
                        await task
                else:
                    with pytest.raises(APIError) as timed_out:
                        await task
                    assert (timed_out.value.status_code, timed_out.value.code) == (504, "PDF_GENERATION_TIMEOUT")
                assert app.state.pdf_slots.locked() and len(app.state.pdf_tasks) == 1
                with pytest.raises(APIError) as busy:
                    await export_api.render_document(request, **options)
                assert (busy.value.status_code, busy.value.code) == (503, "PDF_BUSY")
            finally:
                release.set()
                await asyncio.gather(*tuple(app.state.pdf_tasks), return_exceptions=True)
            assert not app.state.pdf_slots.locked()
            app.state.pdf_renderer = PdfRenderer()
            monkeypatch.setattr(export_api, "PDF_RENDER_TIMEOUT_SECONDS", 15)
            result = await export_api.render_document(request, **options)
            assert result.data.startswith(b"%PDF-")

    asyncio.run(exercise())
