"""Owned mixed-history hydration, using offline HTTPX transports only."""

from copy import deepcopy
from uuid import uuid4

import httpx
import pytest

from app.core.errors import APIError
from tests.test_real_ai_resources import (
    OWNER, OTHER, PROJECT, SESSION, OPERATION, message_row, project_row, session_row,
    run, assert_user_headers,
)
from tests.test_real_text_chat import ORIGINAL

TEXT_OPERATION = str(uuid4())


def typed_rows():
    rows = []
    for role in ("user", "assistant"):
        row = message_row(role)
        row.update(operation_id=TEXT_OPERATION, source_transcript_id=None, sequence=3 if role == "user" else 4)
        if role == "user":
            row.update(id=TEXT_OPERATION, text="  I remember Malmö.\n", provenance=deepcopy(ORIGINAL))
        rows.append(row)
    return rows


def source():
    return {"input_id": TEXT_OPERATION, "operation_id": TEXT_OPERATION, "project_id": str(PROJECT),
            "session_id": str(SESSION), "language": "en", "text": "  I remember Malmö.\n"}


def transport(rows, sources, requests):
    def handler(request):
        assert_user_headers(request)
        requests.append(request)
        if request.url.path.endswith("/conversation_sessions"):
            return httpx.Response(200, json=[session_row()])
        if request.url.path.endswith("/story_projects"):
            return httpx.Response(200, json=[project_row()])
        if request.url.path.endswith("/real_conversation_messages"):
            assert request.url.params["owner_id"] == f"eq.{OWNER}"
            if "id" in request.url.params:
                selected = [row for row in rows if request.url.params["id"] == "eq." + row["id"]]
            else:
                assert request.url.params["session_id"] == f"eq.{SESSION}"
                selected = rows
            return httpx.Response(200, json=selected)
        assert request.url.path.endswith("/rpc/get_real_text_chat_sources")
        assert request.method == "POST"
        import json
        assert json.loads(request.content) == {"p_session_id": str(SESSION), "p_operation_ids": [TEXT_OPERATION]}
        return httpx.Response(200, json={"sources": sources})
    return handler


def test_existing_voice_only_rows_need_no_new_column_or_rpc():
    requests = []
    result = run(transport([message_row("user"), message_row()], [], requests), lambda g: g.messages(SESSION))
    assert len(requests) == 3 and all(r.method == "GET" for r in requests)
    assert len(result) == 2 and all(row["source_text_input_id"] is None for row in result)
    assert all("operation_id" not in row and "owner_id" not in row for row in result)


def test_mixed_history_adds_only_one_batched_owned_read_and_preserves_original():
    requests = []; rows = [message_row("user"), message_row()] + typed_rows(); untouched = deepcopy(rows)
    result = run(transport(rows, [source()], requests), lambda g: g.messages(SESSION))
    assert len(requests) == 4 and sum(r.method == "POST" for r in requests) == 1
    assert [row["sequence"] for row in result] == [1, 2, 3, 4]
    assert result[2]["text"] == source()["text"] and result[2]["provenance"] == ORIGINAL
    assert result[2]["source_text_input_id"] == result[3]["source_text_input_id"] == TEXT_OPERATION
    assert all("operation_id" not in row and "owner_id" not in row for row in result)
    assert rows == untouched


@pytest.mark.parametrize("change,value", [("project_id", str(OTHER)), ("session_id", str(OTHER)), ("language", "sv"),
    ("operation_id", str(OPERATION)), ("input_id", str(OTHER)), ("text", "changed original"),
    ("text", []), ("text", "\0"), ("text", "x" * 4001)])
def test_malformed_or_foreign_source_fails_closed(change, value):
    altered = {**source(), change: value}
    with pytest.raises(APIError) as error:
        run(transport(typed_rows(), [altered], []), lambda g: g.messages(SESSION))
    assert error.value.status_code == 503


@pytest.mark.parametrize("sources", [[], [source(), source()], [{**source(), "owner_id": str(OWNER)}]])
def test_incomplete_duplicate_or_unexpected_source_map_fails_closed(sources):
    with pytest.raises(APIError) as error:
        run(transport(typed_rows(), sources, []), lambda g: g.messages(SESSION))
    assert error.value.status_code == 503


def test_foreign_message_owner_fails_before_any_typed_source_read():
    requests = []; rows = typed_rows(); rows[0]["owner_id"] = str(OTHER)
    with pytest.raises(APIError) as error:
        run(transport(rows, [source()], requests), lambda g: g.messages(SESSION))
    assert error.value.status_code == 503 and len(requests) == 3


@pytest.mark.parametrize("role", ["user", "assistant"])
def test_typed_history_rejects_a_message_id_inconsistent_with_its_original(role):
    rows = typed_rows()
    if role == "user":
        rows[0]["id"] = str(uuid4())
    else:
        rows[1]["id"] = TEXT_OPERATION
    with pytest.raises(APIError) as error:
        run(transport(rows, [source()], []), lambda g: g.messages(SESSION))
    assert error.value.status_code == 503


def test_newest_context_rows_are_returned_chronologically_after_hydration():
    requests = []
    result = run(transport(list(reversed(typed_rows())), [source()], requests), lambda g: g.messages(SESSION, limit=12, recent=True))
    assert [row["sequence"] for row in result] == [3, 4]
    assert requests[2].url.params["order"] == "sequence.desc"


def test_single_typed_assistant_hydrates_source_for_listen_and_recovery():
    requests = []; row = typed_rows()[1]
    from uuid import UUID
    result = run(transport([row], [source()], requests),
                 lambda g: g.one("real_conversation_messages", "id", UUID(row["id"])))
    assert result["source_text_input_id"] == TEXT_OPERATION and result["source_transcript_id"] is None
    assert "operation_id" not in result and "owner_id" not in result
    assert sum(request.url.path.endswith("/rpc/get_real_text_chat_sources") for request in requests) == 1


def test_single_voice_assistant_preserves_published_shape_and_read_count():
    requests = []; row = message_row()
    from uuid import UUID
    result = run(transport([row], [], requests),
                 lambda g: g.one("real_conversation_messages", "id", UUID(row["id"])))
    assert "source_text_input_id" not in result and result["source_transcript_id"] == row["source_transcript_id"]
    assert len(requests) == 2 and all(request.method == "GET" for request in requests)
