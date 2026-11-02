"""Offline request-count and overlap regressions, never live latency evidence."""

import asyncio
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
import pytest

from app.core.errors import APIError
from app.services.real_ai_resources import read_together
from tests.test_real_ai_resources import (
    OWNER, OTHER, PROJECT, SESSION, MEMORY, TRANSCRIPT, OPERATION, STAMP, PROVENANCE,
    assert_user_headers, project_row, session_row, run, use_gateway,
)
from tests.test_real_ai_api import harness, PROJECT as API_PROJECT, SESSION as API_SESSION, TRANSCRIPT as API_TRANSCRIPT


def source():
    return {"memory_id": str(MEMORY), "memory_version": 1, "source_message_id": str(TRANSCRIPT),
            "fact_type": "location", "value": "Malmö", "evidence": "Malmö", "corrected_value": None,
            "year": None, "slot": "home", "sentence": "Malmö"}


def context():
    return {"project_id": str(PROJECT), "language": "en", "context_token": "a" * 64,
            "confirmed_count": 1, "source_memories": [source()], "excluded_memories": [],
            "blocking_clarifications": [], "canonical_content": "Malmö"}


def draft_row(version):
    return {"draft_id": str(uuid4()), "owner_id": str(OWNER), "operation_id": str(OPERATION),
            "project_id": str(PROJECT), "language": "en", "style": "warm", "status": "needs_review",
            "version": version, "revision": 1, "content": "Malmö", "original_content": "Malmö",
            "source_memories": [source()], "verification": {"status": "needs_review", "method": "model_review_v1",
                "unsupported_claims": [], "checked_revision": 1, "checked_at": STAMP,
                "sources_current": True, "reason": "Review your story."},
            "mode": "real", "provenance": deepcopy(PROVENANCE), "created_at": STAMP, "updated_at": STAMP}


def draft_transport(rows, snapshot, requests):
    def handler(request):
        assert_user_headers(request)
        requests.append(request.url.path)
        if request.url.path.endswith("/story_projects"):
            return httpx.Response(200, json=[project_row()])
        if request.url.path.endswith("/real_story_drafts"):
            assert request.url.params["owner_id"] == f"eq.{OWNER}"
            assert request.url.params["project_id"] == f"eq.{PROJECT}"
            assert request.url.params["limit"] == "50" and request.url.params["offset"] == "7"
            assert request.url.params["order"] == "version.desc"
            return httpx.Response(200, json=rows)
        assert request.url.path.endswith("/rpc/get_real_story_context")
        return httpx.Response(200, json=snapshot)
    return handler


@pytest.mark.parametrize("count", [0, 1, 20])
def test_draft_list_uses_one_source_snapshot_and_constant_owned_request_count(count):
    rows = [draft_row(i) for i in range(count, 0, -1)]
    untouched = deepcopy(rows)
    requests = []
    result = run(draft_transport(rows, context(), requests), lambda g: g.drafts(PROJECT, 50, 7))
    assert len(requests) == (3 if count else 2)
    assert sum(path.endswith("/rpc/get_real_story_context") for path in requests) == bool(count)
    assert [r["version"] for r in result] == list(range(count, 0, -1))
    assert all(r["verification"]["sources_current"] is True for r in result)
    assert all("owner_id" not in r and "operation_id" not in r for r in result)
    assert rows == untouched


@pytest.mark.parametrize("change", ["source", "question"])
def test_shared_snapshot_preserves_stale_source_marking_and_original_snapshots(change):
    rows = [draft_row(2), draft_row(1)]
    snapshot = context()
    if change == "source":
        snapshot["source_memories"][0]["memory_version"] = 2
    else:
        snapshot["blocking_clarifications"] = [str(MEMORY)]
    result = run(draft_transport(rows, snapshot, []), lambda g: g.drafts(PROJECT, 50, 7))
    assert all(r["verification"]["status"] == "stale_sources" for r in result)
    assert all(r["verification"]["sources_current"] is False for r in result)
    assert all(r["source_memories"] == [source()] and r["content"] == r["original_content"] for r in result)
    assert all(r["verification"]["sources_current"] is True for r in rows)


@pytest.mark.parametrize("field,value", [("owner_id", str(OTHER)), ("project_id", str(OTHER)), ("language", "sv")])
def test_batched_drafts_fail_closed_for_wrong_owner_parent_or_language(field, value):
    rows = [{**draft_row(1), field: value}]
    with pytest.raises(APIError) as caught:
        run(draft_transport(rows, context(), []), lambda g: g.drafts(PROJECT, 50, 7))
    assert caught.value.status_code == 503


@pytest.mark.parametrize("field,value", [("project_id", str(OTHER)), ("language", "sv")])
def test_batched_drafts_reject_mismatched_context_scope(field, value):
    with pytest.raises(APIError) as caught:
        run(draft_transport([draft_row(1)], {**context(), field: value}, []), lambda g: g.drafts(PROJECT, 50, 7))
    assert caught.value.status_code == 503


def test_batched_drafts_require_owned_parent_before_any_draft_or_context_read():
    paths = []
    def handler(request):
        assert_user_headers(request)
        paths.append(request.url.path)
        assert request.url.path.endswith("/story_projects")
        return httpx.Response(200, json=[])
    with pytest.raises(APIError) as caught:
        run(handler, lambda g: g.drafts(PROJECT))
    assert caught.value.status_code == 404 and len(paths) == 1


@pytest.mark.parametrize("method", ["memories", "project_memories"])
def test_owned_memory_and_question_reads_overlap_after_parent_authorization(method):
    async def scenario():
        both_started = asyncio.Event()
        started = set()
        authorized = False

        async def handler(request):
            nonlocal authorized
            assert_user_headers(request)
            if request.url.path.endswith("/conversation_sessions"):
                return httpx.Response(200, json=[session_row()])
            if request.url.path.endswith("/story_projects"):
                authorized = True
                return httpx.Response(200, json=[project_row()])
            assert authorized
            started.add(request.url.path.rsplit("/", 1)[-1])
            if len(started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), 1)
            return httpx.Response(200, json=[])

        identifier = SESSION if method == "memories" else PROJECT
        assert await use_gateway(handler, lambda g: getattr(g, method)(identifier)) == []
        assert started == {"real_memories", "real_memory_clarifications"}
    asyncio.run(scenario())


def test_failed_parallel_read_cancels_and_joins_its_sibling_before_returning():
    async def scenario():
        started, cleaned = asyncio.Event(), asyncio.Event()
        failure = APIError(503, "SUPABASE_UNAVAILABLE", "Unavailable.")
        async def fail():
            await started.wait()
            raise failure
        async def sibling():
            started.set()
            try:
                await asyncio.Future()
            finally:
                cleaned.set()
        with pytest.raises(APIError) as caught:
            await read_together(fail(), sibling())
        assert caught.value is failure and cleaned.is_set()
    asyncio.run(scenario())


def test_cancelling_parallel_read_waits_for_both_child_cleanups():
    async def scenario():
        started, cleaned = set(), set()
        ready = asyncio.Event()
        async def child(index):
            started.add(index)
            if len(started) == 2:
                ready.set()
            try:
                await asyncio.Future()
            finally:
                cleaned.add(index)
        task = asyncio.create_task(read_together(child(1), child(2)))
        await ready.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned == {1, 2}
    asyncio.run(scenario())


def test_conversation_context_reads_overlap_before_any_provider_dispatch(harness):
    app, gateway, provider = harness()
    started = set()
    ready = None
    async def context_read(name):
        nonlocal ready
        if ready is None:
            ready = asyncio.Event()
        assert provider.calls == gateway.claim_count == 0
        started.add(name)
        if len(started) == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 1)
        return []
    gateway.project_memories = lambda *a, **k: context_read("memories")
    gateway.messages = lambda *a, **k: context_read("messages")
    with TestClient(app) as client:
        response = client.post(f"/api/v2/story-sessions/{API_SESSION}/messages",
            json={"source_transcript_id": str(API_TRANSCRIPT), "language": "en"},
            headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200, response.text
    assert started == {"memories", "messages"} and provider.calls == 1


def test_draft_list_route_uses_batched_owned_gateway_with_requested_page(harness):
    app, gateway, provider = harness()
    reads = []
    async def drafts(project_id, limit, offset):
        reads.append((project_id, limit, offset))
        return []
    gateway.drafts = drafts
    with TestClient(app) as client:
        response = client.get(f"/api/v2/story-projects/{API_PROJECT}/drafts?limit=12&offset=100")
    assert response.status_code == 200 and response.json() == []
    assert reads == [(API_PROJECT, 12, 100)] and provider.calls == 0
