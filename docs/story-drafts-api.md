# Day 5 — Create My Story

Day 11 reuses these existing backend **0.8.1** routes with no new fields or
migration. Use the [current story/Expo guide](day-11-story-integration.md) and
[verification report](day-11-status.md) for generation/edit/export/Continue
acceptance. Real iPhone PDF/share remains pending.

Backend 0.5.0. This is a **deterministic mock**, not a live AI writer. An explicit
user action assembles first-person paragraphs from confirmed, supported memories.
It does not invent scenery, emotion, relatives or dates to make the story warmer.
No OpenAI key, provider request or paid service is used.

## Run and authenticate

Use the existing dedicated development Supabase configuration in `backend/.env`.
Do not copy the legacy web project's Supabase values or share server secrets.

```sh
cd backend
source .venv/bin/activate
CONVERSATION_MODE=mock STORY_GENERATION_MODE=mock python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

PowerShell, after activating the Windows virtual environment:

```powershell
$env:CONVERSATION_MODE="mock"
$env:STORY_GENERATION_MODE="mock"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Both flags default to `disabled`. These modes do not enable live speech recognition
or AI. They gate FastAPI provider operations, not database RPC availability:
authenticated users can invoke the narrowly granted canonical-only mock RPC for
their own project; PostgreSQL independently checks consent, sources and content.
Swagger is `http://127.0.0.1:8000/docs`. For a physical phone, use the
developer machine's reachable LAN IP and bind to `0.0.0.0`; phone localhost is not
the developer computer. A shared hosted FastAPI URL has not been deployed.

Every operation below requires `Authorization: Bearer <Supabase user access token>`.
The backend validates the token and forwards that same user's JWT to PostgreSQL.
Ownership comes from the parent project, never a request `user_id`.

## Routes

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/v1/story-projects/{project_id}/generate` | 201 draft |
| GET | `/api/v1/story-projects/{project_id}/drafts` | 200 draft array, newest generation first |
| GET | `/api/v1/story-drafts/{draft_id}` | 200 draft |
| PATCH | `/api/v1/story-drafts/{draft_id}` | 200 current draft |
| GET | `/api/v1/story-projects/{project_id}/verification` | 200 latest generation's report |
| GET | `/api/v1/story-drafts/{draft_id}/history` | 200 edit array, newest revision first |

Lists use `limit` (default 50, 1–100) and `offset` (default 0, 0–100000).
Responses are plain JSON objects/arrays and include `Cache-Control: no-store`.
IDs are UUIDs. Dates are ISO-8601 timestamps.

## Explicit generation

Only call POST when the user taps **Create My Story**, not on screen load, a new
message or polling. Require confirmation in the UI. Generate a UUID once per
action and reuse it for network retries in the `Idempotency-Key` header:

```http
POST /api/v1/story-projects/PROJECT_UUID/generate
Authorization: Bearer USER_ACCESS_TOKEN
Idempotency-Key: ACTION_UUID
Content-Type: application/json

{"language":"sv","style":"warm","confirm_generation":true}
```

`language` is required and must match the project's immutable `en`/`sv` language.
`style` supports only `warm` (the default). `confirm_generation` must be the actual
boolean `true`, not `1`, a string or an omitted field. Unknown fields are rejected.

The backend excludes pending, rejected, unresolved and unsupported memories.
Unresolved conflicts block generation, including conflicting confirmed claims
whose questions were closed without actually reconciling the values. A supported
memory must retain its owned original user-message evidence. Only narrow,
deterministic templates are supported; arbitrary prose corrections can require
further review rather than being guessed at. A project can contain at most 200
memory facts for this bounded demonstration; large contexts fail rather than
silently truncating the autobiography.

The example below is fictional. Malmö appears only if a matching sourced memory
was confirmed. An unconfirmed year is not added from nearby source text.

```json
{
  "draft_id": "95000000-0000-4000-8000-000000000001",
  "project_id": "95200000-0000-4000-8000-000000000001",
  "status": "ready_for_review",
  "language": "sv",
  "style": "warm",
  "version": 1,
  "revision": 1,
  "content": "Jag växte upp i Malmö.",
  "original_content": "Jag växte upp i Malmö.",
  "mode": "mock",
  "source_memories": [{
    "memory_id": "95400000-0000-4000-8000-000000000001",
    "memory_version": 2,
    "source_message_id": "95300000-0000-4000-8000-000000000001",
    "fact_type": "location",
    "value": "Malmö",
    "evidence": "Jag växte upp i Malmö",
    "corrected_value": null,
    "year": null,
    "slot": "grew_up_location",
    "sentence": "Jag växte upp i Malmö."
  }],
  "verification": {
    "status": "passed",
    "unsupported_claims": [],
    "method": "deterministic_mock_v1",
    "checked_revision": 1,
    "checked_at": "2026-10-19T10:00:00Z",
    "sources_current": true,
    "reason": null
  },
  "created_at": "2026-10-19T10:00:00Z",
  "updated_at": "2026-10-19T10:00:00Z"
}
```

`version` is the generation number within the project. `revision` is the manual
edit counter within that generation. Same-key retries return the current draft,
including later edits. A fresh key with unchanged context also reuses that draft;
it does not overwrite edits. A changed memory context can create a new generation.
Keys are bound to language/style; invalid or project-mismatched options are
rejected before lookup, and the database also rejects a changed key binding. Source versions and
clarifications are rechecked atomically before save; stale generation context is
rejected. A failed verification creates no ready/verified draft.

## Read, edit and preserve history

PATCH only accepts these fields:

```json
{"content":"Jag växte upp i Malmö. Detta är min egen formulering.","expected_revision":1}
```

Content is trimmed, nonblank and limited to 20000 characters. Revision must be a
positive integer. On a changed edit, `revision` increments, `status` becomes
`edited`, and verification becomes `needs_review` / `manual_unverified`. Manual
text is never automatically labelled fact-checked. `original_content` and source
snapshots stay immutable. Each changed edit records previous and new text:

```json
[{
  "id":"95600000-0000-4000-8000-000000000001",
  "draft_id":"95000000-0000-4000-8000-000000000001",
  "revision":2,
  "previous_content":"Jag växte upp i Malmö.",
  "content":"Jag växte upp i Malmö. Detta är min egen formulering.",
  "created_at":"2026-10-19T10:05:00Z"
}]
```

A stale, different edit returns 409; reload and let the user reconcile it. An
exact retry of the immediately completed edit returns the stored result without
duplicating history. An unchanged save does not create an edit.

## Verification states and limits

| Report status | Meaning |
| --- | --- |
| `passed` | Original mock text exactly matches supported confirmed source sentences |
| `needs_review` | Manually edited; no automatic factual guarantee |
| `stale_sources` | An unedited original's memory context changed since generation |
| `not_generated` | No draft exists; project report has null draft/version/revision |

Edited drafts remain `needs_review` if memories change and then report
`sources_current:false`. Verification does not overwrite the draft. The project
report returns `{project_id,draft_id,version,revision,verification}` for the latest
generation; older generations keep their own reports on read/list.

The writer and independent verifier run before persistence. PostgreSQL independently
rebuilds canonical content and refuses unsupported text even through a direct RPC.
The result is a conservative demonstration of enforcement, **not proof that a
future live AI model cannot hallucinate**. UI must visibly label it simulated.
Drafts preserve snapshots separately from immutable transcripts, extracted
memories and user corrections. Source deletion makes verification stale, while
project deletion cascades draft/audit data through the existing ownership model.

## Errors

Standard shape: `{"error":{"code":"...","message":"..."}}`. No raw database
messages, tokens or source text are echoed in errors.

| HTTP | Representative code | Frontend action |
| --- | --- | --- |
| 401 | `AUTHORIZATION_REQUIRED`, `INVALID_ACCESS_TOKEN` | Sign in / refresh session |
| 403 | `ACCESS_DENIED` | Stop the unauthorized operation |
| 404 | `PROJECT_NOT_FOUND`, `RESOURCE_NOT_FOUND` | Missing or not owned; reveal no foreign data |
| 409 | `NO_CONFIRMED_MEMORIES`, `NO_SUPPORTED_MEMORIES` | Show memory review / empty state |
| 409 | `CLARIFICATION_REQUIRED` | Resolve conflicts first |
| 409 | `STORY_CONTEXT_CHANGED`, `IDEMPOTENCY_CONFLICT` | Reload; reconcile action/revision |
| 409 | `CONTEXT_LIMIT` | Demonstration context too large |
| 422 | `VALIDATION_ERROR`, `LANGUAGE_MISMATCH` | Correct request |
| 422 | `DRAFT_VERIFICATION_FAILED` | Unsafe output blocked and not saved |
| 503 | `STORY_GENERATION_DISABLED` | Enable explicit local mock mode if intended |
| 503 | `STORY_WRITER_INVALID_RESPONSE`, `SUPABASE_UNAVAILABLE` | Retry later; do not show a false success |
| 504 | `STORY_WRITER_TIMEOUT` | Retry the same action key |

## Tarun's acceptance flow

1. Sign in to the development project. Create an `en` or `sv` story and session.
2. Use the [Day 4 API](conversation-api.md) to submit a fictional supported memory
   such as `Jag växte upp i Malmö.` and confirm the candidate with
   `PATCH /api/v1/memories/{fact_id}` and
   `{"status":"confirmed","expected_version":1}`.
   Use FastAPI for review rather than calling legacy database review RPCs directly;
   the API preserves an existing correction when it is omitted from the request.
3. Tap Create My Story, send explicit confirmation and a UUID action key.
4. Display Story Preview, mock label, source references and verification state.
5. Edit with the current revision, read it back and show preserved history.
6. Retry generation and confirm no duplicate or lost edit. Verify a second user
   cannot read, list or edit the first user's drafts.

Frontend screens, real-login acceptance, public hosting, PDF export, photos,
subscriptions and live model/voice integration are outside this backend change.
