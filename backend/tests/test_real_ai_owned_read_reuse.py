"""Request-local ownership reads; synthetic HTTP only, no Auth/provider cache."""

import asyncio
from collections import Counter

import httpx
from pydantic import SecretStr
import pytest

from app.core.errors import APIError
from app.services.auth import AuthenticatedUser
from app.services.real_ai_resources import RealAIGateway, read_together
from tests.test_real_ai_resources import (
    OWNER, OTHER, PROJECT, SESSION, USER_TOKEN, assert_user_headers,
    project_row, session_row, settings, use_gateway,
)


def test_repeated_context_ownership_reads_drop_from_five_gets_to_two():
    counts = Counter()

    def handler(request):
        assert_user_headers(request)
        relation = request.url.path.rsplit("/", 1)[-1]
        counts[relation] += 1
        if relation == "story_projects":
            assert request.url.params["user_id"] == "eq." + str(OWNER)
            return httpx.Response(200, json=[project_row()])
        if relation == "conversation_sessions":
            return httpx.Response(200, json=[session_row()])
        assert relation in {"real_memories", "real_memory_clarifications", "real_conversation_messages"}
        assert request.url.params["owner_id"] == "eq." + str(OWNER)
        return httpx.Response(200, json=[])

    async def action(gateway):
        await gateway.get_owned_session(SESSION, active=True)
        assert await read_together(gateway.project_memories(PROJECT), gateway.messages(SESSION)) == [[], []]

    asyncio.run(use_gateway(handler, action))
    assert counts == {"story_projects": 1, "conversation_sessions": 1,
                      "real_memories": 1, "real_memory_clarifications": 1, "real_conversation_messages": 1}


@pytest.mark.parametrize("kind", ["project", "session"])
def test_concurrent_callers_coalesce_and_get_fresh_mutation_safe_copies(kind):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        counts = Counter()

        async def handler(request):
            assert_user_headers(request)
            relation = request.url.path.rsplit("/", 1)[-1]
            counts[relation] += 1
            if relation == "conversation_sessions" or kind == "project":
                entered.set()
                await release.wait()
            return httpx.Response(200, json=[project_row() if relation == "story_projects" else session_row()])

        async def action(gateway):
            call = (lambda: gateway.get_project(PROJECT)) if kind == "project" else (lambda: gateway.get_owned_session(SESSION))
            first = asyncio.create_task(call())
            await entered.wait()
            second = asyncio.create_task(call())
            await asyncio.sleep(0)
            release.set()
            a, b = await asyncio.gather(first, second)
            assert a == b and a is not b
            a["status"] = "caller-mutated"
            a["nested-caller-data"] = {"secret": "never-cache"}
            c = await call()
            assert c == b and c is not b and "nested-caller-data" not in c
        await use_gateway(handler, action)
        assert counts["story_projects"] == 1
        assert counts["conversation_sessions"] == (kind == "session")
    asyncio.run(scenario())


def test_completed_session_is_rechecked_for_each_active_caller_without_refetch():
    counts = Counter()
    def handler(request):
        relation = request.url.path.rsplit("/", 1)[-1]
        counts[relation] += 1
        row = project_row() if relation == "story_projects" else {
            **session_row(), "status": "completed", "ended_at": session_row()["created_at"]}
        return httpx.Response(200, json=[row])

    async def action(gateway):
        saved = await gateway.get_owned_session(SESSION)
        saved["status"] = "active"  # A caller cannot poison the cached snapshot.
        for _ in range(2):
            with pytest.raises(APIError) as denied:
                await gateway.get_owned_session(SESSION, active=True)
            assert denied.value.code == "SESSION_COMPLETED"
        assert (await gateway.get_owned_session(SESSION))["status"] == "completed"
    asyncio.run(use_gateway(handler, action))
    assert counts == {"conversation_sessions": 1, "story_projects": 1}


@pytest.mark.parametrize("failure", ["network", "missing", "foreign-owner", "wrong-id", "malformed"])
def test_unsuccessful_or_unvalidated_project_rows_are_never_cached(failure):
    count = 0
    def handler(request):
        nonlocal count
        assert_user_headers(request)
        count += 1
        if count == 1:
            if failure == "network":
                raise httpx.ReadTimeout("synthetic", request=request)
            if failure == "missing":
                return httpx.Response(200, json=[])
            row = project_row()
            row[{"foreign-owner": "user_id", "wrong-id": "id", "malformed": "language"}[failure]] = (
                "unsupported" if failure == "malformed" else str(OTHER))
            return httpx.Response(200, json=[row])
        return httpx.Response(200, json=[project_row()])

    async def action(gateway):
        with pytest.raises(APIError):
            await gateway.get_project(PROJECT)
        assert (await gateway.get_project(PROJECT))["id"] == str(PROJECT)
        await gateway.get_project(PROJECT)
    asyncio.run(use_gateway(handler, action))
    assert count == 2


def test_bad_session_scope_never_caches_an_authorization_result():
    counts = Counter()
    def handler(request):
        relation = request.url.path.rsplit("/", 1)[-1]
        counts[relation] += 1
        if relation == "story_projects":
            return httpx.Response(200, json=[project_row()])
        row = session_row()
        if counts[relation] == 1:
            row["id"] = str(OTHER)
        return httpx.Response(200, json=[row])
    async def action(gateway):
        with pytest.raises(APIError):
            await gateway.get_owned_session(SESSION)
        assert (await gateway.get_owned_session(SESSION))["id"] == str(SESSION)
    asyncio.run(use_gateway(handler, action))
    assert counts == {"conversation_sessions": 2, "story_projects": 1}


def test_new_requests_and_tokens_never_share_cached_rows():
    async def scenario():
        reads = []
        def handler(request):
            reads.append((request.headers["authorization"], request.url.params["user_id"]))
            if request.url.params["user_id"] == "eq." + str(OTHER):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{**project_row(), "title": f"Fresh read {len(reads)}"}])
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = RealAIGateway(settings(), client, AuthenticatedUser(OWNER, SecretStr(USER_TOKEN)))
            second = RealAIGateway(settings(), client, AuthenticatedUser(OWNER, SecretStr("different-synthetic-token")))
            other = RealAIGateway(settings(), client, AuthenticatedUser(OTHER, SecretStr("other-owner-token")))
            a = await first.get_project(PROJECT)
            assert (await first.get_project(PROJECT)) == a
            b = await second.get_project(PROJECT)
            assert a["title"] != b["title"]
            with pytest.raises(APIError) as denied:
                await other.get_project(PROJECT)
            assert denied.value.status_code == 404
        assert len(reads) == 3 and reads[0][0] != reads[1][0]
    asyncio.run(scenario())


@pytest.mark.parametrize("change", ["owner", "token", "headers", "origin"])
def test_gateway_identity_mutation_cannot_reuse_cached_authorization(change):
    calls = 0
    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[project_row()])
    async def action(gateway):
        await gateway.get_project(PROJECT)
        if change == "owner":
            gateway.user = AuthenticatedUser(OTHER, SecretStr(USER_TOKEN))
        elif change == "token":
            gateway.user = AuthenticatedUser(OWNER, SecretStr("new-synthetic-token"))
        elif change == "headers":
            gateway.headers["Authorization"] = "Bearer changed-header"
        else:
            gateway.base_url = "https://other.example.com"
        with pytest.raises(APIError):
            await gateway.get_project(PROJECT)
    asyncio.run(use_gateway(handler, action))
    assert calls == 1


def test_cancelled_loader_finishes_cleanup_and_later_call_reads_again():
    async def scenario():
        entered, cleaned = asyncio.Event(), asyncio.Event()
        calls = 0
        async def handler(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                try:
                    await asyncio.Future()
                finally:
                    cleaned.set()
            return httpx.Response(200, json=[project_row()])
        async def action(gateway):
            first = asyncio.create_task(gateway.get_project(PROJECT))
            await entered.wait()
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert cleaned.is_set() and not gateway._owned_read_cache
            assert (await gateway.get_project(PROJECT))["id"] == str(PROJECT)
        await use_gateway(handler, action)
        assert calls == 2
    asyncio.run(scenario())


def test_cancelled_waiter_does_not_cancel_the_actual_inflight_read():
    async def scenario():
        entered, release, cleaned = asyncio.Event(), asyncio.Event(), asyncio.Event()
        calls = 0
        async def handler(request):
            nonlocal calls
            calls += 1
            entered.set()
            try:
                await release.wait()
            finally:
                cleaned.set()
            return httpx.Response(200, json=[project_row()])
        async def action(gateway):
            first = asyncio.create_task(gateway.get_project(PROJECT))
            await entered.wait()
            waiting = asyncio.create_task(gateway.get_project(PROJECT))
            await asyncio.sleep(0)
            waiting.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiting
            assert not cleaned.is_set() and not first.done()
            release.set()
            assert (await first)["id"] == str(PROJECT)
        await use_gateway(handler, action)
        assert calls == 1 and cleaned.is_set()
    asyncio.run(scenario())


def test_read_together_failure_still_cancels_and_joins_coalesced_owned_reads():
    async def scenario():
        entered, cleaned = asyncio.Event(), asyncio.Event()
        async def handler(request):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cleaned.set()
        async def action(gateway):
            async def fail():
                await entered.wait()
                raise APIError(503, "SUPABASE_UNAVAILABLE", "Synthetic failure")
            with pytest.raises(APIError):
                await read_together(gateway.get_project(PROJECT), gateway.get_project(PROJECT), fail())
            assert cleaned.is_set() and not gateway._owned_read_cache
            assert not any(lock.locked() for lock in gateway._owned_read_locks.values())
        await use_gateway(handler, action)
    asyncio.run(scenario())
