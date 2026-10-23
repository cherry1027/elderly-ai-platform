# Memy mobile API contract

Backend snapshot: branch `codex/day-7-mobile-integration`, commit
`c2decb430be46e9e2d1c1f332e65315a18c9945b`, FastAPI `0.8.1`
API prefix: `/api/v1`  
Intended client: Tarun's Expo/React Native application

Day 11 adds verified story/edit/export/Continue journey coverage without changing
this runtime or schema. Use the [Expo story guide](day-11-story-integration.md)
and [current acceptance report](day-11-status.md).

Day 12 adds [gated OpenAI evaluation adapters](day-12-ai-integration.md) and
[release safeguards](day-12-status.md), not live mobile endpoints. No paths or
response fields change. Keep the current mock setup; public FastAPI refuses
OpenAI evaluation mode until a reviewed live provenance/persistence contract exists.

Day 13 adds security guards without changing paths, success bodies or version:
all 23 private operations document `429 RATE_LIMITED` with `Retry-After:60`.
Per-worker admission can return `503 API_BUSY` with `Retry-After:1` before
reading a body; no-store/no-sniff/no-referrer headers apply to API failures.
Default user allowance is 120/minute across business routes, after online Auth.
Do not log tokens or blindly retry non-idempotent creation. See
[Day 13 handoff and release gates](day-13-status.md). `/ready` may use a locally
cached result for two seconds or reject a concurrent cold probe as unavailable.
The header pin includes Day 13 runtime hardening and audit tooling; later
documentation commits do not change its runtime. Record `git rev-parse HEAD`.

This document describes the backend that exists at the snapshot above. The
route implementations and strict response models are authoritative. It does
not promise public hosting, production readiness, real speech recognition, or
real AI generation.

## 1. Current capability boundary

- Project, session, transcript, memory, draft, revision-history, PDF-export,
  and continuation persistence are implemented against Supabase.
- All user resources are private. The backend validates a Supabase **user
  access token**, forwards that same token to PostgREST, and relies on Row
  Level Security (RLS), with additional owner/parent checks in the gateway.
- The ordinary backend starts with transcription, conversation generation,
  and story generation disabled.
- `run_mobile_dev.py --simulate-transcription` explicitly enables a fictional,
  permanently labelled transcript fixture. It validates real audio bytes but
  does **not** recognize what the speaker said.
- Conversation extraction and story writing are deterministic mock modes. No
  external AI service or paid provider is called.
- PDF rendering is implemented locally and returns a real PDF, but PDFs are
  generated on demand. The database stores immutable export metadata/hash;
  the selected story revision remains in the draft/history records rather
  than as a stored PDF object.
- No subscription, payment, family-sharing, production object-storage, or
  public-hosting contract exists in this API.

## 2. Transport rules

### Base URL

Use one configured base URL and append the paths in this document. Examples:

```text
Local simulator: http://127.0.0.1:8000
Physical phone on a trusted private LAN: http://<developer-computer-LAN-IP>:8000
```

Do not hard-code a developer IP in source. Public HTTPS hosting is not part of
this snapshot.

### Authentication

`GET /health` and `GET /ready` are public. Every `/api/v1/...` operation needs:

```http
Authorization: Bearer <current Supabase user access token>
```

This is the signed-in user's short-lived access token, not the Supabase
publishable key and never a service-role/secret key. Obtain a current session
from the mobile Supabase client immediately before the request. On `401`,
refresh/re-authenticate through the SDK and retry only according to the retry
rules below.

Missing authentication returns:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
Cache-Control: no-store
Content-Type: application/json

{"error":{"code":"AUTHORIZATION_REQUIRED","message":"Bearer authentication is required."}}
```

An invalid or expired token returns the same headers with:

```json
{"error":{"code":"INVALID_ACCESS_TOKEN","message":"A valid access token is required."}}
```

### JSON requests

Unless an operation explicitly says multipart or PDF:

```http
Accept: application/json
Content-Type: application/json
```

Request models are strict: unknown fields, wrong scalar types, explicit JSON
`null` where not allowed, malformed UUIDs, and out-of-range values return `422
VALIDATION_ERROR`. The non-audio API body limit is 256 KiB and the body-read
timeout is 30 seconds.

`Accept-Language` is CORS-allowed but does not select persisted story content.
Use the explicit body language where required; it must match the immutable
project/session language.

The body may be omitted only where this document says it may be omitted.
`Content-Type: application/json` with a literal `null` body is not equivalent
to an omitted body.

### Errors

Every `/api/v1` JSON error has the same safe envelope (public `/ready` has the
separate readiness shape shown later):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed."
  }
}
```

Do not parse upstream/Supabase messages. Branch on the HTTP status and the
documented `error.code`; show the safe `message` or a localized client string.

Common errors are:

| Status | Code | Client action |
|---:|---|---|
| 401 | `AUTHORIZATION_REQUIRED` | Obtain a user session; do not retry anonymously. |
| 401 | `INVALID_ACCESS_TOKEN` | Refresh/re-authenticate once, then repeat only if otherwise safe. |
| 403 | `ACCESS_DENIED` | Stop; the database denied access. |
| 404 | resource-specific `*_NOT_FOUND` or `RESOURCE_NOT_FOUND` | Treat missing and foreign-owned resources identically. |
| 408 | `REQUEST_TIMEOUT` or `UPLOAD_TIMEOUT` | Retry under the operation's retry rules. |
| 409 | operation-specific conflict | Reload/reconcile before choosing a new action. |
| 413 | `REQUEST_TOO_LARGE` or `RECORDING_TOO_LARGE` | Reduce the request/recording; do not blind-retry. |
| 415 | audio media/format error | Re-encode or select a supported recording. |
| 422 | `VALIDATION_ERROR` or a specific validation code | Correct the request; do not blind-retry. |
| 429 | `AUDIO_BUSY` | Back off and retry the same transcription key. |
| 429 | `RATE_LIMITED` | Honor `Retry-After:60`; preserve mutation state and follow the operation's retry rules. |
| 500 | `INTERNAL_ERROR` | Treat the result as unknown; reconcile before retrying a non-idempotent mutation. |
| 503 | `API_BUSY` | Honor `Retry-After:1`; preserve local state and follow the operation's retry rules. |
| 503 | feature disabled, busy, or dependency unavailable | Preserve local UI state and retry later only when appropriate. |
| 504 | provider/render timeout | Reconcile idempotent operations before retrying. |

All `/api/v1` JSON responses use `Cache-Control: no-store`. PDF responses use
`Cache-Control: private, no-store` plus the binary headers documented below.

Check status and Content-Type before parsing: network/ingress failures and the
development launcher's Uvicorn concurrency rejection occur outside the API
error handlers. An overload can return `503 text/plain` without JSON, no-store
or CORS headers. The application envelope is not a guarantee for those failures.

### Pagination

Every list route accepts the same query parameters:

```text
?limit=50&offset=0
```

- `limit`: integer, default `50`, minimum `1`, maximum `100`
- `offset`: integer, default `0`, minimum `0`, maximum `100000`
- responses are plain JSON arrays; there is no `items`, total, or cursor field
- an empty page is `[]`
- load the next page when the returned array length equals `limit`

Stable order is route-specific and stated below. Offset pagination is a
snapshot-like UI convenience, not a synchronization protocol; refresh from
offset zero after a mutation.

### Idempotency-Key

Only these three POST operations require it:

1. `POST /story-sessions/{session_id}/transcribe`
2. `POST /story-sessions/{session_id}/messages`
3. `POST /story-projects/{project_id}/generate`

The value must be a UUID generated once for one logical user action:

```http
Idempotency-Key: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

Persist it with the pending mobile action. If the request times out or loses
its response, retry the exact same input with the same key. Never assign a new
key merely because a response was lost. A key reused with different input
returns a conflict.

Project creation, session creation, draft editing, memory resolution, PDF
export, and Continue do **not** use or require this header. Their individual
retry rules matter.

## 3. Complete operation catalog (25 operations)

All paths below are relative to the base URL.

| # | Method and path | Auth | Extra input | Success |
|---:|---|---|---|---|
| 1 | `GET /health` | Public | none | `200` liveness JSON |
| 2 | `GET /ready` | Public | none | `200` database-readiness JSON |
| 3 | `POST /api/v1/story-projects` | Bearer | project JSON | `201` project |
| 4 | `GET /api/v1/story-projects` | Bearer | pagination | `200` project array |
| 5 | `GET /api/v1/story-projects/{project_id}` | Bearer | none | `200` project |
| 6 | `PATCH /api/v1/story-projects/{project_id}` | Bearer | title/description JSON | `200` project |
| 7 | `POST /api/v1/story-projects/{project_id}/sessions` | Bearer | omitted body or `{}` | `201` session |
| 8 | `GET /api/v1/story-projects/{project_id}/sessions` | Bearer | pagination | `200` session array |
| 9 | `POST /api/v1/story-sessions/{session_id}/transcribe` | Bearer | Idempotency-Key + multipart | `200` transcript |
| 10 | `GET /api/v1/story-sessions/{session_id}/transcripts` | Bearer | pagination | `200` transcript array |
| 11 | `POST /api/v1/story-sessions/{session_id}/messages` | Bearer | Idempotency-Key + message JSON | `201` atomic turn |
| 12 | `GET /api/v1/story-sessions/{session_id}/messages` | Bearer | pagination | `200` message array |
| 13 | `GET /api/v1/story-sessions/{session_id}/memories` | Bearer | pagination | `200` memory array |
| 14 | `GET /api/v1/story-sessions/{session_id}/clarifications` | Bearer | pagination | `200` open-clarification array |
| 15 | `PATCH /api/v1/memories/{fact_id}` | Bearer | status/version JSON | `200` memory |
| 16 | `POST /api/v1/story-projects/{project_id}/generate` | Bearer | Idempotency-Key + generation JSON | `201` draft |
| 17 | `GET /api/v1/story-projects/{project_id}/drafts` | Bearer | pagination | `200` draft array |
| 18 | `GET /api/v1/story-drafts/{draft_id}` | Bearer | none | `200` draft |
| 19 | `PATCH /api/v1/story-drafts/{draft_id}` | Bearer | content/revision JSON | `200` draft |
| 20 | `GET /api/v1/story-projects/{project_id}/verification` | Bearer | none | `200` project verification |
| 21 | `GET /api/v1/story-drafts/{draft_id}/history` | Bearer | pagination | `200` edit array |
| 22 | `POST /api/v1/story-drafts/{draft_id}/export` | Bearer | optional export JSON; **no key** | `201` PDF bytes |
| 23 | `GET /api/v1/story-projects/{project_id}/exports` | Bearer | pagination | `200` metadata array |
| 24 | `GET /api/v1/story-exports/{export_id}/download` | Bearer | none | `200` historical PDF bytes |
| 25 | `POST /api/v1/story-projects/{project_id}/continue` | Bearer | omitted body or `{}`; **no key** | `200` continuation |

## 4. Shared example identifiers

Examples use these syntactically valid, fictional IDs:

All timestamps, content, hashes, byte/page counts and PDF headers shown in
examples are illustrative contracts, not fresh responses from a real user.

```text
project_id       11111111-1111-4111-8111-111111111111
session_id       22222222-2222-4222-8222-222222222222
user/transcript  33333333-3333-4333-8333-333333333333
assistant        44444444-4444-4444-8444-444444444444
memory/fact      55555555-5555-4555-8555-555555555555
clarification    66666666-6666-4666-8666-666666666666
draft            77777777-7777-4777-8777-777777777777
export           88888888-8888-4888-8888-888888888888
edit history     99999999-9999-4999-8999-999999999999
request key      aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

UUIDs and timestamps are JSON strings. Timestamps are RFC 3339 values.

## 5. Health and readiness

### 1. `GET /health`

No authentication. This proves only that the FastAPI process responds.

```http
GET /health HTTP/1.1
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","service":"memy-ai-backend"}
```

### 2. `GET /ready`

No authentication. This checks backend configuration and a zero-row Supabase
REST read using the configured publishable key; it does not prove user login,
RLS ownership, every migration, or every feature mode.

```http
GET /ready HTTP/1.1
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","service":"memy-ai-backend","database":"ok"}
```

Failure is `503` with `SUPABASE_NOT_CONFIGURED` or `SUPABASE_UNAVAILABLE`:

```json
{
  "status": "unavailable",
  "service": "memy-ai-backend",
  "error": {
    "code": "SUPABASE_UNAVAILABLE",
    "message": "Database is not ready."
  }
}
```

## 6. Projects and sessions

### Project representation

The API never exposes `user_id`:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "title": "Investor demo - My Childhood (fictional)",
  "description": "AI simulation with fictional details.",
  "language": "en",
  "status": "active",
  "created_at": "2026-10-23T08:00:00Z",
  "updated_at": "2026-10-23T08:00:00Z"
}
```

### 3. `POST /api/v1/story-projects`

```json
{
  "title": "Investor demo - My Childhood (fictional)",
  "language": "en",
  "description": "AI simulation with fictional details."
}
```

- `title`: trimmed string, 1..120 characters
- `language`: required, exactly `en` or `sv`
- `description`: optional string or `null`, maximum 4000 characters
- success: `201` and one project representation
- ownership is derived from the token; never send `user_id`
- no idempotency contract: after an ambiguous failure, list projects before
  offering another create, or the retry can make a duplicate

### 4. `GET /api/v1/story-projects?limit=50&offset=0`

Returns a plain array ordered by `created_at DESC, id DESC`:

```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "title": "Investor demo - My Childhood (fictional)",
    "description": "AI simulation with fictional details.",
    "language": "en",
    "status": "active",
    "created_at": "2026-10-23T08:00:00Z",
    "updated_at": "2026-10-23T08:00:00Z"
  }
]
```

### 5. `GET /api/v1/story-projects/{project_id}`

Returns `200` with one project representation. Missing and another user's
project both return `404 PROJECT_NOT_FOUND`; the client cannot use this route
to discover another user's IDs.

### 6. `PATCH /api/v1/story-projects/{project_id}`

Send at least one supported field:

```json
{
  "title": "My Early Years",
  "description": null
}
```

- only `title` and `description` are mutable
- `title` has the create bounds and cannot be `null`
- `description` may be set to `null`
- `language`, `status`, `user_id`, and unknown fields are rejected
- success: `200` with the full project representation
- no expected-version or idempotency contract: an exact-body retry normally
  converges, but concurrent edits are last-write-wins; reload after ambiguity

### Session representation

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "language": "en",
  "status": "active",
  "created_at": "2026-10-23T08:01:00Z",
  "updated_at": "2026-10-23T08:01:00Z",
  "ended_at": null
}
```

### 7. `POST /api/v1/story-projects/{project_id}/sessions`

Omit the body or send exactly:

```json
{}
```

Literal `null` and any field are invalid. The server derives the language from
the owned project. Success is `201` with one session. This route has no
idempotency contract and can create another active session after a blind
retry. For Start/Continue UI, prefer operation 25, which atomically resumes an
existing active session or creates one.

### 8. `GET /api/v1/story-projects/{project_id}/sessions?limit=50&offset=0`

Returns session representations ordered by `created_at DESC, id DESC`:

```json
[
  {
    "id": "22222222-2222-4222-8222-222222222222",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "language": "en",
    "status": "active",
    "created_at": "2026-10-23T08:01:00Z",
    "updated_at": "2026-10-23T08:01:00Z",
    "ended_at": null
  }
]
```

## 7. Audio transcripts

### 9. `POST /api/v1/story-sessions/{session_id}/transcribe`

Required headers and multipart fields:

```http
POST /api/v1/story-sessions/22222222-2222-4222-8222-222222222222/transcribe HTTP/1.1
Authorization: Bearer <user access token>
Idempotency-Key: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
Content-Type: multipart/form-data; boundary=<generated by FormData>
```

```text
file=<binary recording with filename and MIME type>
language=en
consent=true
```

In React Native, append the URI object to `FormData` and let `fetch` set the
multipart boundary; do not manually set `Content-Type`.

Accepted filename/MIME pairs:

| Extension | Accepted MIME types |
|---|---|
| `.wav` | `audio/wav`, `audio/x-wav`, `audio/wave` |
| `.mp3` | `audio/mpeg`, `audio/mp3` |
| `.m4a` | `audio/mp4`, `audio/m4a`, `audio/x-m4a` |
| `.webm` | `audio/webm` |

Limits and checks:

- `consent` is the multipart text value `true`, not omitted and not JSON bool
- language must match the session
- filename length is at most 128 and cannot contain slash, backslash, or NUL
- file bytes are at most 25,000,000; entire request at most 25,016,384
- decoded duration must be greater than zero and at most 90 seconds
- authentication and ownership are checked before upload bytes are consumed
- raw bytes use a temporary directory and are deleted after processing
- at most two recordings process concurrently; saturation is `429 AUDIO_BUSY`

Success (`200`):

```json
{
  "transcript_id": "33333333-3333-4333-8333-333333333333",
  "session_id": "22222222-2222-4222-8222-222222222222",
  "language": "en",
  "text": "[SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — FICTIONAL / FIKTIVT. Not derived from uploaded audio / Inte baserat på uppladdat ljud.]\nI moved to Malmö in 1974. I worked as a teacher.",
  "status": "completed",
  "created_at": "2026-10-23T08:02:00Z"
}
```

`transcript_id` is also the immutable user-message ID. Pass it as
`source_message_id` to operation 11; do not post the returned text as a new
typed message.

Idempotency binds the key to session/project, audio SHA-256, and language. The
same key and bytes return the completed transcript. The same key with changed
input is `409 TRANSCRIPTION_CONFLICT`; a current lease is `409
TRANSCRIPTION_IN_PROGRESS`. Retry with the same key after uncertainty.

Important mode behavior:

- ordinary startup returns `503 TRANSCRIPTION_DISABLED`
- explicit development simulation validates the audio but returns a fixed,
  fictional EN/SV fixture, permanently marked as an AI simulation
- no current mode performs speech recognition

Other specific errors include `CONSENT_REQUIRED`, `LANGUAGE_MISMATCH`,
`INVALID_RECORDING`, `RECORDING_TOO_LONG`, `AUDIO_PROCESSING_LIMIT`,
`RECORDING_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UNSUPPORTED_AUDIO_FORMAT`,
`UPLOAD_TIMEOUT`, `AUDIO_PROCESSING_UNAVAILABLE`, `TRANSCRIPTION_UNAVAILABLE`,
`TRANSCRIPTION_INVALID_RESPONSE`, `TRANSCRIPTION_TIMEOUT`, and
`SESSION_COMPLETED`.

### 10. `GET /api/v1/story-sessions/{session_id}/transcripts?limit=50&offset=0`

Returns immutable transcript representations ordered by `created_at ASC,
transcript_id ASC`:

```json
[
  {
    "transcript_id": "33333333-3333-4333-8333-333333333333",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "language": "en",
    "text": "[SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — FICTIONAL / FIKTIVT. Not derived from uploaded audio / Inte baserat på uppladdat ljud.]\nI moved to Malmö in 1974. I worked as a teacher.",
    "status": "completed",
    "created_at": "2026-10-23T08:02:00Z"
  }
]
```

## 8. Simulated conversations, memories, and clarifications

### 11. `POST /api/v1/story-sessions/{session_id}/messages`

Requires `Idempotency-Key`. Send exactly one source form.

Typed text:

```json
{
  "text": "I moved to Lund in 1975.",
  "language": "en"
}
```

Existing transcript/user source (the mobile voice path):

```json
{
  "source_message_id": "33333333-3333-4333-8333-333333333333",
  "language": "en"
}
```

- `text` is trimmed, 1..4000 characters
- `source_message_id` must identify an owned user message in this session
- exactly one of `text` and `source_message_id` is required
- language must match the session
- a new turn requires explicit mock mode; otherwise `503
  CONVERSATION_DISABLED`
- every extracted candidate begins as `pending`; generation cannot use it
  until operation 15 confirms it

Example `201` turn:

```json
{
  "user_message": {
    "id": "33333333-3333-4333-8333-333333333333",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 1,
    "role": "user",
    "text": "I moved to Lund in 1975.",
    "language": "en",
    "created_at": "2026-10-23T08:02:00Z"
  },
  "message": {
    "id": "44444444-4444-4444-8444-444444444444",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 2,
    "role": "assistant",
    "text": "Thank you for sharing that memory. What do you remember most about that time?",
    "language": "en",
    "created_at": "2026-10-23T08:02:01Z"
  },
  "memories": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "project_id": "11111111-1111-4111-8111-111111111111",
      "session_id": "22222222-2222-4222-8222-222222222222",
      "source_message_id": "33333333-3333-4333-8333-333333333333",
      "fact_type": "event",
      "value": "Lund",
      "evidence": "I moved to Lund in 1975",
      "year": 1975,
      "slot": "move",
      "uncertain": false,
      "status": "pending",
      "corrected_value": null,
      "version": 1,
      "created_at": "2026-10-23T08:02:01Z",
      "updated_at": "2026-10-23T08:02:01Z"
    }
  ],
  "clarifications": [],
  "requires_clarification": false,
  "mode": "mock"
}
```

If the mock detects a contradiction or uncertainty, `clarifications` contains:

```json
{
  "id": "66666666-6666-4666-8666-666666666666",
  "fact_id": "55555555-5555-4555-8555-555555555555",
  "session_id": "22222222-2222-4222-8222-222222222222",
  "conflicts_with_fact_id": null,
  "question": "Could you confirm this memory?",
  "status": "open",
  "resolution": null,
  "created_at": "2026-10-23T08:02:01Z",
  "resolved_at": null
}
```

Then `requires_clarification` is `true`.

The same key with the same bound input returns the already committed turn,
including if mock mode was later disabled. The same key with different input
returns `409 IDEMPOTENCY_CONFLICT`. A source already processed under another
key also conflicts. Other errors include `404 SOURCE_NOT_FOUND`, `409
SESSION_COMPLETED`, `409 CONTEXT_LIMIT`, `504 CONVERSATION_TIMEOUT`, and `503
CONVERSATION_INVALID_RESPONSE`.

### 12. `GET /api/v1/story-sessions/{session_id}/messages?limit=50&offset=0`

Returns message objects from the turn example, ordered by `sequence ASC`.
Audio originals are user messages in the same history and remain immutable.

```json
[
  {
    "id": "33333333-3333-4333-8333-333333333333",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 1,
    "role": "user",
    "text": "I moved to Lund in 1975.",
    "language": "en",
    "created_at": "2026-10-23T08:02:00Z"
  },
  {
    "id": "44444444-4444-4444-8444-444444444444",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "sequence": 2,
    "role": "assistant",
    "text": "Thank you for sharing that memory. What do you remember most about that time?",
    "language": "en",
    "created_at": "2026-10-23T08:02:01Z"
  }
]
```

### 13. `GET /api/v1/story-sessions/{session_id}/memories?limit=50&offset=0`

Returns memory objects ordered by `created_at ASC, id ASC`. The source fields
(`source_message_id`, `value`, `evidence`) remain unchanged when the user
reviews a memory.

```json
[
  {
    "id": "55555555-5555-4555-8555-555555555555",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "source_message_id": "33333333-3333-4333-8333-333333333333",
    "fact_type": "event",
    "value": "Lund",
    "evidence": "I moved to Lund in 1975",
    "year": 1975,
    "slot": "move",
    "uncertain": false,
    "status": "pending",
    "corrected_value": null,
    "version": 1,
    "created_at": "2026-10-23T08:02:01Z",
    "updated_at": "2026-10-23T08:02:01Z"
  }
]
```

### 14. `GET /api/v1/story-sessions/{session_id}/clarifications?limit=50&offset=0`

Returns **only open** clarification objects, ordered by `created_at ASC, id
ASC`. After memory resolution, a clarification disappears from this list; the
source message is not edited.

```json
[
  {
    "id": "66666666-6666-4666-8666-666666666666",
    "fact_id": "55555555-5555-4555-8555-555555555555",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "conflicts_with_fact_id": null,
    "question": "Could you confirm this memory?",
    "status": "open",
    "resolution": null,
    "created_at": "2026-10-23T08:02:01Z",
    "resolved_at": null
  }
]
```

### 15. `PATCH /api/v1/memories/{fact_id}`

Confirm exactly as extracted:

```json
{"status":"confirmed","expected_version":1}
```

Confirm with a correction:

```json
{
  "status": "confirmed",
  "corrected_value": "moved to Lund in 1976",
  "expected_version": 1
}
```

Reject:

```json
{"status":"rejected","expected_version":1}
```

- status is only `confirmed` or `rejected`
- `expected_version` is required and at least 1
- `corrected_value` is trimmed, non-null, 1..1000, and allowed only with
  `confirmed`
- omitting a correction while re-confirming preserves an existing correction
  only at its current observed version; a mismatched version with a stored
  correction returns `409 CONVERSATION_CHANGED` in 0.8.1 rather than inheriting
  unseen newer wording
- rejecting clears an existing correction
- success is `200` with the full memory and its incremented/current `version`
- an exact immediate replay using the prior version and same desired state is
  safe; otherwise a stale version is `409 CONVERSATION_CHANGED`
- on conflict, reload the memory and ask the user how to reconcile; do not
  silently overwrite
- this route does not use `Idempotency-Key`

## 9. Draft generation, editing, verification, and history

`version` and `revision` are different:

- `version` identifies a generated story based on one confirmed-memory context
- `revision` identifies manual edits within that generated version
- a fresh generated draft starts at revision 1
- manual editing increments revision and preserves `version`,
  `original_content`, and `source_memories`
- changed confirmed-memory context can create a new draft `version`
- merely using a new generation request key with unchanged context does not
  force a new version

### Creating the next version without losing earlier work

1. Call Continue and use the returned active `session.id`.
2. Add new transcript-linked or typed turns with their own message keys.
3. Confirm/reject/correct every new memory and resolve blocking
   clarifications.
4. On a separate explicit **Generate my story** action, create one new
   generation key and call operation 16.
5. If the reviewed source context changed, the database atomically creates the
   next `version` at revision 1. If it did not change, the existing matching
   version is returned rather than making a duplicate.
6. Earlier draft versions, their `original_content`, edit history, source
   snapshots, and export audit IDs remain addressable and are not overwritten.

Do not call generation implicitly from Continue, and do not create a new key
to force a cosmetic duplicate of unchanged source context.

### Draft representation

```json
{
  "draft_id": "77777777-7777-4777-8777-777777777777",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "status": "ready_for_review",
  "language": "en",
  "style": "warm",
  "version": 1,
  "revision": 1,
  "content": "I moved to Lund in 1975.",
  "original_content": "I moved to Lund in 1975.",
  "mode": "mock",
  "source_memories": [
    {
      "memory_id": "55555555-5555-4555-8555-555555555555",
      "memory_version": 2,
      "source_message_id": "33333333-3333-4333-8333-333333333333",
      "fact_type": "event",
      "value": "Lund",
      "evidence": "I moved to Lund in 1975",
      "corrected_value": null,
      "year": 1975,
      "slot": "move",
      "sentence": "I moved to Lund in 1975."
    }
  ],
  "verification": {
    "status": "passed",
    "unsupported_claims": [],
    "method": "deterministic_mock_v1",
    "checked_revision": 1,
    "checked_at": "2026-10-23T08:04:00Z",
    "sources_current": true,
    "reason": null
  },
  "created_at": "2026-10-23T08:04:00Z",
  "updated_at": "2026-10-23T08:04:00Z"
}
```

### 16. `POST /api/v1/story-projects/{project_id}/generate`

Requires a UUID `Idempotency-Key` and explicit user confirmation:

```json
{
  "language": "en",
  "style": "warm",
  "confirm_generation": true
}
```

- `language` must match the project
- `style` may be omitted and defaults to the only current value, `warm`
- `confirm_generation` must be literal boolean `true`; string `"true"`, false,
  omission, and null are invalid
- requires at least one supported confirmed memory and no blocking open
  clarification
- a new operation requires explicit mock story mode; ordinary startup returns
  `503 STORY_GENERATION_DISABLED`
- the deterministic verifier rejects unsupported content before save with
  `422 DRAFT_VERIFICATION_FAILED`
- success: `201` and a full draft representation

The same key/binding returns the current representation of the same draft,
including manual edits made since generation and even if mock mode is later
disabled. A different binding is `409 IDEMPOTENCY_CONFLICT`. Generation saves
the source snapshot and initial verification atomically. Other errors include
`409 CLARIFICATION_REQUIRED`, `409 NO_CONFIRMED_MEMORIES`, `409
NO_SUPPORTED_MEMORIES`, `504 STORY_WRITER_TIMEOUT`, and `503
STORY_WRITER_INVALID_RESPONSE`.

### 17. `GET /api/v1/story-projects/{project_id}/drafts?limit=50&offset=0`

Returns full draft representations ordered by `version DESC` (version is
unique within a project):

```json
[
  {
    "draft_id": "77777777-7777-4777-8777-777777777777",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "status": "ready_for_review",
    "language": "en",
    "style": "warm",
    "version": 1,
    "revision": 1,
    "content": "I moved to Lund in 1975.",
    "original_content": "I moved to Lund in 1975.",
    "mode": "mock",
    "source_memories": [
      {
        "memory_id": "55555555-5555-4555-8555-555555555555",
        "memory_version": 2,
        "source_message_id": "33333333-3333-4333-8333-333333333333",
        "fact_type": "event",
        "value": "Lund",
        "evidence": "I moved to Lund in 1975",
        "corrected_value": null,
        "year": 1975,
        "slot": "move",
        "sentence": "I moved to Lund in 1975."
      }
    ],
    "verification": {
      "status": "passed",
      "unsupported_claims": [],
      "method": "deterministic_mock_v1",
      "checked_revision": 1,
      "checked_at": "2026-10-23T08:04:00Z",
      "sources_current": true,
      "reason": null
    },
    "created_at": "2026-10-23T08:04:00Z",
    "updated_at": "2026-10-23T08:04:00Z"
  }
]
```

### 18. `GET /api/v1/story-drafts/{draft_id}`

Returns `200` with one full draft representation. Missing/foreign ownership is
hidden as `404 RESOURCE_NOT_FOUND`.

### 19. `PATCH /api/v1/story-drafts/{draft_id}`

```json
{
  "content": "I moved to Lund in 1975. It became a happy new chapter.",
  "expected_revision": 1
}
```

- content is trimmed, valid UTF-8, 1..20000 characters, with no NUL
- `expected_revision` is required and at least 1
- success returns the full draft with the same `version`, `revision: 2`,
  `status: "edited"`, unchanged `original_content`/sources, and:

```json
{
  "status": "needs_review",
  "unsupported_claims": [],
  "method": "manual_unverified",
  "checked_revision": 2,
  "checked_at": "2026-10-23T08:05:00Z",
  "sources_current": true,
  "reason": "Manual edits require review"
}
```

There is no endpoint that declares a manual edit automatically verified. An
exact immediate replay with the old expected revision and exactly the same
content returns the already-saved revision. A stale version with different
content returns `409 STORY_CONTEXT_CHANGED`; reload and let the user reconcile.
Sending the already-current content is a no-op. This route has no
`Idempotency-Key`.

### 20. `GET /api/v1/story-projects/{project_id}/verification`

With a draft:

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "draft_id": "77777777-7777-4777-8777-777777777777",
  "version": 1,
  "revision": 2,
  "verification": {
    "status": "needs_review",
    "unsupported_claims": [],
    "method": "manual_unverified",
    "checked_revision": 2,
    "checked_at": "2026-10-23T08:05:00Z",
    "sources_current": true,
    "reason": "Manual edits require review"
  }
}
```

Before any draft exists:

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "draft_id": null,
  "version": null,
  "revision": null,
  "verification": {
    "status": "not_generated",
    "unsupported_claims": [],
    "method": "none",
    "checked_revision": null,
    "checked_at": null,
    "sources_current": false,
    "reason": "No story has been generated"
  }
}
```

`sources_current` describes whether the saved generation context still matches
the project, independently of human wording review. An ordinary edit keeps it
true until source context changes; `needs_review` never means automatically
verified. For an edited draft whose context later changes, `needs_review` stays
and `sources_current` becomes false with an explanatory reason.

The backend may report `stale_sources` when confirmed source-memory versions no
longer match a generated revision. Do not label `needs_review` or
`stale_sources` as verified in the UI.

### 21. `GET /api/v1/story-drafts/{draft_id}/history?limit=50&offset=0`

Returns manual edit snapshots ordered by `revision DESC`:

```json
[
  {
    "id": "99999999-9999-4999-8999-999999999999",
    "draft_id": "77777777-7777-4777-8777-777777777777",
    "revision": 2,
    "previous_content": "I moved to Lund in 1975.",
    "content": "I moved to Lund in 1975. It became a happy new chapter.",
    "created_at": "2026-10-23T08:05:00Z"
  }
]
```

Revision 1 is represented by `original_content` on the draft; history rows
begin at revision 2.

## 10. Private PDF export and historical download

### 22. `POST /api/v1/story-drafts/{draft_id}/export`

Omit the body, send `{}`, or send:

```json
{
  "format": "pdf",
  "include_title_page": true,
  "include_page_numbers": true
}
```

`format` currently accepts only `pdf`; both flags are strict booleans and
default to true. Literal `null` and unknown fields are invalid.

This operation intentionally has **no `Idempotency-Key`**. It exports the
current owned draft revision and current project title, renders within a
two-worker bound, then records/revalidates the export audit before returning
any bytes. If the title or draft revision changes during rendering, it returns
`409 EXPORT_SOURCE_CHANGED` and sends no PDF.

Success is raw bytes, not JSON:

```http
HTTP/1.1 201 Created
Content-Type: application/pdf
Content-Disposition: attachment; filename="memy-investor-demo-my-childhood-fictional-v1-r2.pdf"
Content-Length: 45260
Cache-Control: private, no-store
Pragma: no-cache
Expires: 0
X-Content-Type-Options: nosniff
X-Memy-Export-Id: 88888888-8888-4888-8888-888888888888
X-Memy-Draft-Version: 1
X-Memy-Draft-Revision: 2
X-Memy-Page-Count: 2

%PDF-<binary bytes>...%%EOF
```

Read `arrayBuffer()`/blob bytes, never `response.json()`. Persist the export ID
from the response header before opening the native share sheet. The CORS
configuration exposes `Content-Disposition`, `Content-Length`, and all four
`X-Memy-*` headers.

The database deduplicates an audit for the same draft revision, title, export
options, and renderer; an exact repeat may return the same export ID but the
PDF is rendered again. Because the request selects the **current** revision,
a blind retry after an intervening edit can export a newer revision. After an
ambiguous result, first reload the draft and list exports, then ask the user to
export again if needed.

PDF-specific errors:

| Status | Code | Meaning |
|---:|---|---|
| 422 | `PDF_INVALID_REQUEST` | Invalid export data/options. |
| 422 | `PDF_EMPTY_DRAFT` | No renderable content. |
| 422 | `PDF_UNSUPPORTED_CHARACTER` | Current renderer cannot safely encode content. |
| 409 | `EXPORT_SOURCE_CHANGED` | Draft revision/title changed; reload. |
| 503 | `PDF_BUSY` | Both render slots are occupied; retry later. |
| 503 | `PDF_GENERATION_FAILED` | Renderer/output validation failed. |
| 504 | `PDF_GENERATION_TIMEOUT` | Rendering exceeded 15 seconds. |

### Export metadata representation

```json
{
  "export_id": "88888888-8888-4888-8888-888888888888",
  "project_id": "11111111-1111-4111-8111-111111111111",
  "draft_id": "77777777-7777-4777-8777-777777777777",
  "draft_version": 1,
  "draft_revision": 2,
  "language": "en",
  "title": "Investor demo - My Childhood (fictional)",
  "format": "pdf",
  "include_title_page": true,
  "include_page_numbers": true,
  "renderer_version": "memy_pdf_v1",
  "filename": "memy-investor-demo-my-childhood-fictional-v1-r2.pdf",
  "content_sha256": "29202ff519aa6834663ac151cc0b6da09cbfd1db11872d9e7a8518e17c50deb9",
  "byte_size": 45260,
  "page_count": 2,
  "created_at": "2026-10-23T08:06:00Z"
}
```

The hash is SHA-256 of the selected UTF-8 story content, not a promise that
two separately rendered PDF byte streams are byte-identical.

### 23. `GET /api/v1/story-projects/{project_id}/exports?limit=50&offset=0`

Returns export metadata ordered by `created_at DESC, export_id DESC`:

```json
[
  {
    "export_id": "88888888-8888-4888-8888-888888888888",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "draft_id": "77777777-7777-4777-8777-777777777777",
    "draft_version": 1,
    "draft_revision": 2,
    "language": "en",
    "title": "Investor demo - My Childhood (fictional)",
    "format": "pdf",
    "include_title_page": true,
    "include_page_numbers": true,
    "renderer_version": "memy_pdf_v1",
    "filename": "memy-investor-demo-my-childhood-fictional-v1-r2.pdf",
    "content_sha256": "29202ff519aa6834663ac151cc0b6da09cbfd1db11872d9e7a8518e17c50deb9",
    "byte_size": 45260,
    "page_count": 2,
    "created_at": "2026-10-23T08:06:00Z"
  }
]
```

### 24. `GET /api/v1/story-exports/{export_id}/download`

Returns `200` with the same PDF/security/audit headers as operation 22. It
privately re-renders the exact audited historical title, story revision, and
options, validates the saved content hash, and does not create another audit
row. Later title changes, story edits, or newer versions do not change what
this export ID selects.

The PDF bytes themselves are not stored, so byte-for-byte identity across two
downloads is not the contract. The selected historical content, metadata,
renderer version, and headers are the contract.

## 11. Start/Continue

### 25. `POST /api/v1/story-projects/{project_id}/continue`

Omit the body or send exactly:

```json
{}
```

Literal `null` and any field return `422`. There is no `Idempotency-Key`.

Example with an existing draft:

```json
{
  "project_id": "11111111-1111-4111-8111-111111111111",
  "language": "en",
  "session": {
    "id": "22222222-2222-4222-8222-222222222222",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "language": "en",
    "status": "active",
    "created_at": "2026-10-23T08:01:00Z",
    "updated_at": "2026-10-23T08:01:00Z",
    "ended_at": null
  },
  "session_created": false,
  "latest_draft": {
    "draft_id": "77777777-7777-4777-8777-777777777777",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "status": "ready_for_review",
    "language": "en",
    "style": "warm",
    "version": 1,
    "revision": 1,
    "content": "I moved to Lund in 1975.",
    "original_content": "I moved to Lund in 1975.",
    "mode": "mock",
    "source_memories": [
      {
        "memory_id": "55555555-5555-4555-8555-555555555555",
        "memory_version": 2,
        "source_message_id": "33333333-3333-4333-8333-333333333333",
        "fact_type": "event",
        "value": "Lund",
        "evidence": "I moved to Lund in 1975",
        "corrected_value": null,
        "year": 1975,
        "slot": "move",
        "sentence": "I moved to Lund in 1975."
      }
    ],
    "verification": {
      "status": "passed",
      "unsupported_claims": [],
      "method": "deterministic_mock_v1",
      "checked_revision": 1,
      "checked_at": "2026-10-23T08:04:00Z",
      "sources_current": true,
      "reason": null
    },
    "created_at": "2026-10-23T08:04:00Z",
    "updated_at": "2026-10-23T08:04:00Z"
  },
  "generation_triggered": false
}
```

If no draft exists, `latest_draft` is `null`. If no active session exists,
the server creates one and returns `session_created: true`. Otherwise it
returns the latest active session and `session_created: false`. Concurrent or
repeated calls are serialized so they reuse an active session; once a session
has been completed, a later call may create a new one.

Continue never calls a conversation provider, never generates a story, and
never edits, replaces, or verifies a draft. `generation_triggered` is always
literal `false`. The client must use the returned `session.id`; do not keep
using a stale locally guessed session. It may display `latest_draft`, then let
the user explicitly generate a later version only after new memories are
reviewed.

## 12. Mobile request and retry playbook

| User action | Safe mobile behavior |
|---|---|
| Create project | Disable duplicate taps. On lost response, list projects before a second create. |
| Start/Continue | Call operation 25 and always adopt its returned session ID. A retry reuses an active session. |
| Create raw session | Avoid for ordinary Start/Continue. On uncertainty, list sessions before another POST. |
| Transcribe | Persist one UUID key + local audio identity until completion; exact same-key retry. |
| Process transcript | Reuse `transcript_id` as `source_message_id`; persist a separate message key; exact same-key retry. |
| Typed message | Persist one message key with exact text/language; exact same-key retry. |
| Confirm/reject memory | Send displayed `version`; on 409 reload and ask, except the backend accepts an exact immediate replay. |
| Generate | Require an explicit tap/confirmation; persist one key; exact same-key retry. Do not assume a new key means a new version. |
| Edit draft | Send displayed `revision`; on 409 reload and reconcile. Never silently replace newer text. |
| Export current draft | No key. Record returned export ID; after ambiguity reload draft + export list before another export. |
| Download export | Safe read-only retry by the same export ID; it selects the audited historical revision. |

Never queue a mutation indefinitely while signed out. Never replace a lost
response with a new idempotency key. Never log the Bearer token, request audio,
story content, PDF bytes, or server response bodies that can contain user
memories.

## 13. Ownership and preservation guarantees

- Authentication validates the token with Supabase Auth. Resource requests
  forward the exact user token, so PostgreSQL RLS evaluates the real user.
- Direct REST requests include explicit owner/project filters. RPCs also check
  `auth.uid()` and owned, non-deleted parents.
- A missing UUID and another user's UUID produce the same not-found behavior.
- Transcript/user-message originals are immutable.
- Memory review changes status/correction/version, not the original source,
  extracted value, or evidence.
- Generated `original_content` and source snapshots are immutable.
- Manual draft edits append history and increment `revision`; they do not
  overwrite the generated original or earlier version.
- Export metadata is immutable and historical downloads select the recorded
  title/revision/options. PDF files are not stored.
- Continue does not overwrite or auto-generate content.

These are backend guarantees, but a local mock HTTP test is not itself proof
of hosted RLS. Live acceptance must use two genuine Supabase user sessions and
verify that each user's IDs are invisible to the other.

## 14. Implementation references

Current code is the source of truth:

- App wiring, version, no-store policy, CORS headers, and bounded workers:
  [`backend/app/main.py`](../backend/app/main.py#L44-L100)
- Body size/timeout and sanitized unexpected errors:
  [`backend/app/core/api_safety.py`](../backend/app/core/api_safety.py#L10-L94)
- Bearer authentication:
  [`backend/app/api/dependencies.py`](../backend/app/api/dependencies.py#L11-L29),
  [`backend/app/services/auth.py`](../backend/app/services/auth.py#L19-L47)
- Project/session routes and strict schemas:
  [`backend/app/api/story_projects.py`](../backend/app/api/story_projects.py#L43-L117),
  [`backend/app/schemas/story_projects.py`](../backend/app/schemas/story_projects.py#L17-L78)
- Audio route, upload bounds, transcript schema, and retry gateway:
  [`backend/app/api/audio.py`](../backend/app/api/audio.py#L30-L104),
  [`backend/app/services/audio_upload.py`](../backend/app/services/audio_upload.py#L23-L32),
  [`backend/app/services/audio_upload.py`](../backend/app/services/audio_upload.py#L275-L348),
  [`backend/app/services/audio_resources.py`](../backend/app/services/audio_resources.py),
  [`backend/app/schemas/audio.py`](../backend/app/schemas/audio.py)
- Conversation/memory/clarification routes and contracts:
  [`backend/app/api/conversations.py`](../backend/app/api/conversations.py#L35-L115),
  [`backend/app/services/conversation_resources.py`](../backend/app/services/conversation_resources.py),
  [`backend/app/schemas/conversations.py`](../backend/app/schemas/conversations.py)
- Draft/version/history routes and contracts:
  [`backend/app/api/story_drafts.py`](../backend/app/api/story_drafts.py#L36-L102),
  [`backend/app/services/story_draft_resources.py`](../backend/app/services/story_draft_resources.py),
  [`backend/app/schemas/story_drafts.py`](../backend/app/schemas/story_drafts.py)
- PDF and Continue routes/contracts:
  [`backend/app/api/exports.py`](../backend/app/api/exports.py#L44-L149),
  [`backend/app/services/export_resources.py`](../backend/app/services/export_resources.py),
  [`backend/app/schemas/exports.py`](../backend/app/schemas/exports.py#L19-L100),
  [`backend/app/services/pdf_export.py`](../backend/app/services/pdf_export.py)
- Database ownership, RLS, atomic RPC, history, export, and continuation rules:
  [`supabase/migrations`](../supabase/migrations)

When this document and generated OpenAPI disagree, stop integration and review
the exact backend commit before changing the mobile client. Do not loosen the
client to accept undocumented fields or bypass an ownership/version conflict.
