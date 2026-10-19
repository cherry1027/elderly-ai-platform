# Day 4 simulated conversation API

This development API lets Tarun build conversation history and memory review
without a paid AI service. Replies and extraction are deterministic simulations,
not a general language model. Unsupported wording can produce no extracted facts;
it must not be treated as an accurate real-AI autobiography engine.

## Enable the free demonstration

Apply the Day 4 repository migration to the dedicated development project, then
start FastAPI with `CONVERSATION_MODE=mock`. The default is `disabled`; only those
two values are accepted. No OpenAI adapter, API key or external AI call exists.
Day 3 speech transcription remains separately disabled.

On macOS/Linux, from `backend/`:

```sh
CONVERSATION_MODE=mock .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On Windows PowerShell:

```powershell
$env:CONVERSATION_MODE = "mock"
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Use the same dedicated Supabase project for Auth and FastAPI. Every route below
requires `Authorization: Bearer <Supabase user access token>`. The API forwards
that user token to PostgreSQL's ownership policies; it never uses a service-role
key. Do not expose the mock feature as a real AI capability in the pilot UI.

## Routes

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/v1/story-sessions/{session_id}/messages` | 201 mock conversation turn |
| GET | `/api/v1/story-sessions/{session_id}/messages` | 200 ordered history array |
| GET | `/api/v1/story-sessions/{session_id}/memories` | 200 memory array, including review states |
| GET | `/api/v1/story-sessions/{session_id}/clarifications` | 200 unresolved clarification array |
| PATCH | `/api/v1/memories/{fact_id}` | 200 reviewed memory |

These paths follow the existing `/story-sessions` audio convention, not the
proposed `/sessions` alias. GET routes accept `limit` (1–100, default 50) and
`offset` (0–100000, default 0). Messages are ordered by ascending sequence;
memories and questions use `created_at.asc,id.asc`. Completed sessions remain
readable, but cannot accept new turns. Soft-deleted and foreign projects are
inaccessible.

## Submit typed text or an existing transcript

POST requires a new UUID `Idempotency-Key` header for each deliberate new turn.
Keep that same key and body when retrying after a lost response.

```json
{"text":"I moved to Malmö in 1974.","language":"en"}
```

Typed text is trimmed and limited to 1–4000 characters. Alternatively, process a
Day 3 original already in this session, without creating another user message:

```json
{"source_message_id":"11111111-1111-4111-8111-111111111111","language":"sv"}
```

Supply exactly one of `text` and `source_message_id`. The referenced source must
be an owned user message in this session, up to 32000 characters. It is never
rewritten. Neither request accepts client-owned IDs, role, status or timestamps.
The declared language must match the session's fixed project language. Speaking
briefly in another language never changes that setting.

A turn contains `user_message`, the assistant `message`, `memories`,
`clarifications`, `requires_clarification` and `mode: "mock"`. Each message has
`id`, `session_id`, `sequence`, `role`, `text`, `language` and `created_at`.
All candidate memories start `pending`; simulation is not user confirmation.

Example response with synthetic IDs and timestamps:

```json
{
  "user_message": {
    "id": "11111111-1111-4111-8111-111111111111",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 1,
    "role": "user",
    "text": "I moved to Malmö in 1974.",
    "language": "en",
    "created_at": "2026-10-19T10:00:00Z"
  },
  "message": {
    "id": "33333333-3333-4333-8333-333333333333",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 2,
    "role": "assistant",
    "text": "Thank you for sharing that memory. What do you remember most about that time?",
    "language": "en",
    "created_at": "2026-10-19T10:00:00Z"
  },
  "memories": [{
    "id": "44444444-4444-4444-8444-444444444444",
    "project_id": "55555555-5555-4555-8555-555555555555",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "source_message_id": "11111111-1111-4111-8111-111111111111",
    "fact_type": "event",
    "value": "Malmö",
    "evidence": "I moved to Malmö in 1974",
    "year": 1974,
    "slot": "move",
    "uncertain": false,
    "status": "pending",
    "corrected_value": null,
    "version": 1,
    "created_at": "2026-10-19T10:00:00Z",
    "updated_at": "2026-10-19T10:00:00Z"
  }],
  "clarifications": [],
  "requires_clarification": false,
  "mode": "mock"
}
```

Writes are atomic: both messages, candidates, questions and the stored replay
result commit together. Replaying the same key returns the original response,
including after generation is disabled;
it does not reflect later memory confirmations. Refresh GET memories for current
states. Reusing a key for different input conflicts. If another turn changes the
loaded messages or a memory's version, retry rather than silently storing a reply
against stale context. An existing source cannot generate a second turn under
another request key, including a typed message already processed by this API.

## Review memories without editing originals

A memory includes `id`, `project_id`, `session_id`, `source_message_id`,
`fact_type`, `value`, `evidence`, `year`, `slot`, `uncertain`, `status`,
`corrected_value`, `version`, `created_at` and `updated_at`.
`fact_type` is `person`, `relationship`, `date`, `location`, `event` or `emotion`.
The original `value` and exact source quotation `evidence` are preserved.

Yes:

```json
{"status":"confirmed","expected_version":1}
```

No:

```json
{"status":"rejected","expected_version":1}
```

Confirm a correction separately from the original:

```json
{"status":"confirmed","corrected_value":"1975","expected_version":1}
```

Always use the most recently returned version. A stale, different update returns
409; an exact retry is safe. A review appends an audit revision and resolves that
fact's questions without changing the original message, quotation or extracted
value. Display `corrected_value` when present; `year` remains original extraction
metadata, not a parsed corrected date. Review related conflicting facts separately:
confirming one does not silently erase or reject another statement.

Confirming an already corrected memory without a new `corrected_value` preserves
that correction. Rejection clears the active correction, while the audit revision
retains it.

Clarifications expose `id`, `fact_id`, `session_id`,
`conflicts_with_fact_id`, `question`, `status`, `resolution`, `created_at` and
`resolved_at`. Only open questions are returned by the clarification list.
The assistant asks at most one question in a reply, even if several candidates
need review.

## Failure and accuracy handling

Errors retain the existing `{"error":{"code":"...","message":"..."}}`
contract. Missing/invalid authentication is 401; missing and foreign resources
are indistinguishable 404s. Invalid UUIDs, bodies and pagination are 422.
`LANGUAGE_MISMATCH` is 422. `SESSION_COMPLETED`, `IDEMPOTENCY_CONFLICT` and
`CONVERSATION_CHANGED` are 409. `CONTEXT_LIMIT` is 409 when the project's
non-rejected fact context exceeds 200; it is not silently truncated.
`CONVERSATION_DISABLED` and unusable provider results are 503; provider timeout
is 504. Database failures are sanitized 503s. Protected responses are `no-store`.

The mock recognizes a deliberately small set of explicit English/Swedish
statements. It preserves literal emotion intensity and does not add relatives,
dates or locations absent from the source. A date correction can reference an
earlier sourced candidate but remains pending review. Passing deterministic tests
validates this workflow, not real-model accuracy. Real AI, spending, privacy and
quality evaluations require a separate approved implementation.
