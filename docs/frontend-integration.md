# Frontend integration handoff for Tarun

Updated for backend 0.7.0 on 20 October 2026. This is the shared contract for
Tarun's Expo mobile app and the development web preview. The backend supports
the fictional autobiography workflow through private PDF export and continuation.
Real Expo/device acceptance still needs Tarun's confirmation; backend harness
checks are not evidence of a successful iPhone integration.

Day 8 reviewed Tarun's actual `feat/mobile-story-details` branch at `59762f2`
against backend `374b1dd`. Its four project metadata operations match this API.
Tarun reports successful Windows diagnostics and iPhone Safari `/health` and
`/ready` probes. Authenticated iPhone create/list/detail/update acceptance remains
pending. See [Day 8 status](day-8-status.md) for the exact verification scope.

Use the pushed branch `codex/day-7-mobile-integration`. It builds on the
verified `backend/day-6-pdf-continuation` branch; do not substitute an older
`main` checkout or merge/deploy without a separate team decision.

Start with the [Windows and iPhone quickstart](backend-mobile-quickstart.md) for
copyable setup commands, client configuration, the existing fictional dashboard
fixtures and the first device acceptance checklist. Use the detailed contracts
below when wiring individual screens.

Day 5 adds explicit **Create My Story**, source-verified mock drafts, read/edit,
version history and verification reports. Use the [Day 5 contract](story-drafts-api.md)
for all six routes, request/response examples and the Create → Preview → Edit
acceptance flow. Start the backend with both `CONVERSATION_MODE=mock` and
`STORY_GENERATION_MODE=mock` for that simulation. Both defaults remain disabled;
neither flag enables a paid provider or live transcription.

Day 6 adds [private PDF export and Continue My Story](pdf-export-api.md). POST export
returns PDF bytes, not JSON. Export history retains the selected saved revision;
continuation never regenerates or overwrites manual work. The handoff includes
all four routes, headers, audit schema, loading/error states, fictional PDFs and
web/Expo download guidance. Real frontend/device acceptance remains pending.

## Development setup and reachable URLs

New Expo/backend work uses Supabase project `edbkuunyeyxnyenmmqud`:
https://edbkuunyeyxnyenmmqud.supabase.co (Ireland, Free).
Obtain its publishable key from the dashboard. Never put a service-role key,
database password or server secret in an EXPO_PUBLIC_* variable.

The legacy web app's root VITE_SUPABASE_* values still target
`pxejznayegywcctnssxb`; do not copy them into the new mobile integration.

| Client | API base URL |
| --- | --- |
| Developer Mac / iOS simulator | http://127.0.0.1:8000 |
| Android Studio emulator | http://10.0.2.2:8000, with suitable host/network reachability |
| Physical phone on same LAN | http://<developer-machine-LAN-IP>:8000 |
| Shared remote development | Not deployed; team decision pending |

The actual Expo branch does **not** read `EXPO_PUBLIC_*` variables. Its protected
launcher disables dotenv and strips those variables. In the separate mobile
checkout, configure these two ignored local files instead:

`apps/mobile/development.auth.local.json`:

```json
{
  "supabaseUrl": "https://edbkuunyeyxnyenmmqud.supabase.co",
  "publishableKey": "<development-publishable-key>"
}
```

`apps/mobile/development.api.local.json`:

```json
{"baseUrl": "http://<WINDOWS_PRIVATE_LAN_IPV4>:8000"}
```

Replace the placeholders; the mobile validator requires an explicit private LAN
IPv4 address. It rejects loopback, public addresses and DNS names, so the generic
simulator/hosted addresses in the table above are not all supported by this
particular mobile client. It accepts a root URL or `/api/v1` suffix and appends
the API prefix once. Use `npm start` inside `apps/mobile/`, not
`npm run preview:stories`; the latter has sample data and no live API saves.
The [quickstart](backend-mobile-quickstart.md#configure-the-separate-expo-app)
has copyable PowerShell instructions. No merge is required to run the mobile
and backend processes in separate checkouts.

Install the backend requirements in its virtual environment. The Day 7 launcher
pins the dedicated development project, enables both free mock modes, leaves
transcription disabled, disables access logs and limits concurrent connections.
It binds only loopback unless LAN exposure is explicitly requested. From
`backend/`, use:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan
```

On Windows, replace `.venv/bin/python` with `.venv\Scripts\python.exe`.
For direct Uvicorn operation, the equivalent mock flags and LAN bind are:

```sh
CONVERSATION_MODE=mock STORY_GENERATION_MODE=mock .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

On PowerShell, set the two environment variables first and use
`.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000`.
The machine running FastAPI and the phone must be on a mutually reachable trusted
network, with inbound port 8000 allowed. Opening `http://<host>:8000/health` and
`/ready` on the phone tests reachability before debugging authenticated screens.
`0.0.0.0` is a bind address, not a URL to enter on the phone.

The Mac's latest observed LAN address on 20 October was `192.168.110.103`;
the earlier `192.168.0.21` address is stale. Neither is a permanent shared URL.
If Tarun runs this backend on Windows, use his
Windows machine's LAN IP instead. Separate home networks cannot reach each
other's private LAN address. Local HTTP is for development only; no public tunnel
or shared hosted server has been provisioned. Do not disable platform transport
security broadly or expose this development server publicly to solve connectivity.
The agreed device-test option is a trusted personal hotspot/private network.
Do not send Bearer tokens over HTTP on BTH/student-housing shared Wi-Fi, even
when the public health probes work. Recheck the Windows IP after changing networks.

## Authentication approach

1. Sign in directly with Supabase Auth in the NEW development project.
2. Obtain/refresh the user's session access token through the Supabase SDK.
3. Protected API calls send `Authorization: Bearer <user-access-token>`.
4. FastAPI validates that specific token through Supabase Auth's user endpoint.
5. FastAPI forwards the same user token plus its publishable key to the Data API,
   so RLS evaluates the signed-in user's `auth.uid()`.

Do not trust an unverified decoded JWT, or use service-role credentials for
ordinary user requests. The app must refresh expired sessions through the
Supabase SDK; the backend never accepts a refresh token.

```ts
// Reuse the existing verified, account-scoped Auth provider in the Expo app.
const accessToken = await getAccessToken(expectedUserId);
if (!accessToken) throw new Error("Sign in is required");

const response = await fetch(`${API_BASE_URL}/api/v1/story-projects`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

This illustrates the wire header, not a replacement API client. Keep the
reviewed mobile transport's token callback, foreground/refresh/sign-out guards,
timeouts and cancellation handling; do not add a second session lookup or SDK client.

Configure the native Supabase client with persistent session storage compatible
with Tarun's installed SDK; refresh sessions while the app is active and stop
background refresh when appropriate. Treat 401 as a sign-in/refresh condition,
not permission to use a different user's token. Never log tokens, passwords,
PKCE codes/verifiers, request bodies containing private memories or full Auth
callback URLs. Clear user-specific UI/query state on sign-out.

### Native email confirmation coordination

The proposed development redirect is `memy-foundation://auth/confirm`. It is not
yet confirmed as allowlisted. Do not assume web confirmation readiness means this
native callback is ready. Preserve both working web redirects and the Site URL
when the exact mobile redirect is separately approved.

Tarun must register `memy-foundation` in the Expo native scheme configuration and
route that exact URL. For auth-code PKCE, configure `flowType: 'pkce'`, pass the
mobile `emailRedirectTo`, persist the verifier and exchange the callback's code
using `exchangeCodeForSession`. Complete the flow in the same app installation
that initiated it. Keep the shared `{{ .ConfirmationURL }}` email template;
do not replace it with a token-hash template or assume the existing implicit web
callback already implements native code exchange.

Use a development build with its registered custom scheme for this test, not
Expo Go. Scheme changes require a new native build. The app's production bundle
identifier is a separate decision. Apple Developer/signing/TestFlight access is
not confirmed. The reviewed mobile branch declares the scheme, but registration
is gated off and no native signing/build configuration was found; coordinate
activation before scheduling physical-device confirmation tests. No native
test email or paid build is required merely to run backend contract checks.
See [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and
[Expo app linking](https://docs.expo.dev/linking/into-your-app/).

## Web registration readiness (Task 3C)

The dedicated development project's redirect allowlist now includes the exact
`http://127.0.0.1:5173/auth/callback` URL. The existing
`http://127.0.0.1:5173/story-projects.html` recovery redirect and Site URL are
unchanged. Registration must explicitly supply the callback as `emailRedirectTo`.
The default confirmation template uses `{{ .ConfirmationURL }}` and is compatible
with the frontend's implicit flow; this change does not enable PKCE callbacks.

Email/password signup and email confirmation are enabled. The inspected policy
requires at least six password characters with no required character classes;
CAPTCHA is off. These policies were not weakened or otherwise changed. Custom
SMTP is not configured: the existing development sender has a project-wide
two-emails/hour limit and recipient restrictions. Use one authorized test email,
keep the local frontend running and open only the newest confirmation email.
No confirmation or recovery email was sent for this permissions fix.

Migration `20261019000000_registration_settings_access.sql` restores settings
access without granting broad table privileges. Authenticated users can select
the six current settings columns and update only `email_notifications`,
`deletion_reminders`, `newsletter` and `inspiration_frequency`. RLS restricts both
reads and updates to `auth.uid() = user_id`. Clients cannot insert/delete rows,
change ownership or overwrite `created_at`; anonymous access remains denied.
Column-scoped grants mean `has_table_privilege(..., 'SELECT')` remains false even
though `SELECT *` on the six current columns works. Future columns are not
automatically exposed. The existing SECURITY DEFINER signup trigger creates
settings; clients should update that row, not upsert it.

The missing grants affected account preference reads/saves, not normal Auth
signup/login: trigger inserts use the function owner's privileges. Profile and
settings trigger creation is tested separately from client permissions. The two
historical orphan settings rows match the disposable Day 3 verification users
and contain default preferences. They were inspected and left unchanged. There
is no settings-to-auth-user foreign key; any narrow cleanup or cascade migration
requires a separately reviewed and approved change.

Verification on 19 October: migration applied to `edbkuunyeyxnyenmmqud`;
hosted rollback-only two-user checks passed for trigger creation, owner reads and
updates, cross-user denial and restricted mutations. The two original orphan
rows remained; synthetic rows did not persist. Local regression checks passed:
202 backend tests (four live checks skipped) and 21 embedded PostgreSQL tests.

The remaining frontend acceptance step is Tarun's real signup, email confirmation
and login with one authorized development account. Database role tests are not
evidence that this complete browser/email flow has already passed.

## Implemented API and response handling

| Request | Authentication | Result |
| --- | --- | --- |
| GET /health | None | 200 process liveness |
| GET /ready | None | 200 Supabase probe, or sanitized 503 |
| POST /api/v1/story-projects | Bearer | 201 project |
| GET /api/v1/story-projects | Bearer | 200 project array |
| GET /api/v1/story-projects/:id | Bearer | 200 project |
| PATCH /api/v1/story-projects/:id | Bearer | 200 project |
| POST /api/v1/story-projects/:id/sessions | Bearer | 201 session |
| GET /api/v1/story-projects/:id/sessions | Bearer | 200 session array |
| POST /api/v1/story-sessions/:id/transcribe | Bearer + Idempotency-Key | Audio upload; currently disabled-provider 503 |
| GET /api/v1/story-sessions/:id/transcripts | Bearer | 200 audio transcript array |
| POST /api/v1/story-sessions/:id/messages | Bearer + Idempotency-Key | 201 atomic mock turn |
| GET /api/v1/story-sessions/:id/messages | Bearer | 200 ordered message array |
| GET /api/v1/story-sessions/:id/memories | Bearer | 200 memory array |
| GET /api/v1/story-sessions/:id/clarifications | Bearer | 200 unresolved question array |
| PATCH /api/v1/memories/:id | Bearer | 200 confirmed/rejected/corrected memory |
| POST /api/v1/story-projects/:id/generate | Bearer + Idempotency-Key | 201 draft after explicit confirmation |
| GET /api/v1/story-projects/:id/drafts | Bearer | 200 draft array |
| GET /api/v1/story-drafts/:id | Bearer | 200 saved draft |
| PATCH /api/v1/story-drafts/:id | Bearer | 200 saved manual revision |
| GET /api/v1/story-projects/:id/verification | Bearer | 200 latest verification report |
| GET /api/v1/story-drafts/:id/history | Bearer | 200 edit array |
| POST /api/v1/story-drafts/:id/export | Bearer | 201 PDF bytes, not JSON |
| GET /api/v1/story-projects/:id/exports | Bearer | 200 export metadata array |
| GET /api/v1/story-exports/:id/download | Bearer | 200 historical PDF bytes |
| POST /api/v1/story-projects/:id/continue | Bearer | 200 active session and nullable latest draft |

This inventory contains 25 operations: two public and 23 authenticated. `:id`
denotes the corresponding UUID path parameter, not a literal colon in the URL.
There are no duplicate `/sessions` aliases, public PDF URLs, delete endpoints or
standalone clarification-submit endpoint. Swagger at `/docs` and JSON schema at
`/openapi.json` describe the actual implementation and include request examples.

```json
{"status":"ok","service":"memy-ai-backend"}
```

Readiness adds `"database":"ok"` on success. Failure:

```json
{"status":"unavailable","service":"memy-ai-backend","error":{"code":"SUPABASE_UNAVAILABLE","message":"Database is not ready."}}
```

The business API error shape is
`{"error":{"code":"...","message":"..."}}`. Branch on the HTTP status and
stable code, not English message text. Codes are `AUTHORIZATION_REQUIRED`,
`INVALID_ACCESS_TOKEN`, `ACCESS_DENIED`, `PROJECT_NOT_FOUND`, `CONFLICT`,
`VALIDATION_ERROR`, `SUPABASE_NOT_CONFIGURED` and `SUPABASE_UNAVAILABLE`.
Protected responses are `no-store`; 401 responses include a Bearer challenge.
`/ready` remains operational diagnostics, not an authorization check.

Create requires a trimmed 1–120 character title and explicit `en`/`sv` language;
description is optional/nullable up to 4,000 characters. PATCH accepts only title
and description, and language is immutable. Session POST accepts no fields and
inherits project language. List responses are plain arrays with `limit=50` and
`offset=0` defaults (`limit` maximum 100, `offset` maximum 100000).

Browser CORS defaults cover localhost/127.0.0.1 ports 8080 and 5173 and allow
Authorization, Accept-Language and Idempotency-Key. Native mobile requests do not depend on
browser CORS. Add real web deployment origins explicitly.

## Request and response examples

All examples use fictional content. Replace uppercase ID placeholders in paths
with returned UUIDs. Dates are ISO-8601; unknown request fields are rejected.
The feature guides contain the full field definitions and larger examples:
[audio](audio-api.md), [conversation](conversation-api.md),
[drafts](story-drafts-api.md) and [PDF and continuation](pdf-export-api.md).

Create a project with `POST /api/v1/story-projects`:

```json
{"title":"My Childhood","language":"sv","description":"Fictional development project"}
```

HTTP 201 returns a project object; list returns an array of the same objects:

```json
{
  "id":"72000000-0000-4000-8000-000000000001",
  "title":"My Childhood",
  "description":"Fictional development project",
  "language":"sv",
  "status":"draft",
  "created_at":"2026-10-20T10:00:00Z",
  "updated_at":"2026-10-20T10:00:00Z"
}
```

PATCH that project with `{"title":"My Early Years"}`. Do not send `user_id`,
language or status. Create a session with POST `/story-projects/PROJECT_ID/sessions`
and `{}` (all abbreviated paths here still sit under `/api/v1`):

```json
{
  "id":"73000000-0000-4000-8000-000000000001",
  "project_id":"72000000-0000-4000-8000-000000000001",
  "language":"sv",
  "status":"active",
  "created_at":"2026-10-20T10:00:00Z",
  "updated_at":"2026-10-20T10:00:00Z",
  "ended_at":null
}
```

### Audio and the simulated conversation

POST `/story-sessions/SESSION_ID/transcribe` needs a UUID `Idempotency-Key` and
multipart fields `file`, `language` (`sv`/`en`) and `consent` (string `"true"`
only after the user explicitly agrees). Native FormData needs a local URI,
filename and matching MIME type; do not set multipart Content-Type manually:

```ts
const form = new FormData();
form.append("file", { uri: recordingUri, name: "memory.m4a", type: "audio/mp4" } as any);
form.append("language", "sv");
form.append("consent", "true"); // only after explicit consent
const response = await fetch(`${API_BASE_URL}/api/v1/story-sessions/${sessionId}/transcribe`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Idempotency-Key": uploadKey },
  body: form,
});
```

Match the file descriptor typing to Tarun's React Native version. M4A accepts
`audio/mp4`, `audio/m4a` or `audio/x-m4a`; WAV accepts `audio/wav`, `audio/x-wav`
or `audio/wave`. MP3 and WebM are also supported as documented. Limits are
25,000,000 file bytes, 90 seconds, 8–96 kHz, no more than two channels and no video.
The server validates decoded audio, not just extension/MIME. It checks ownership
before reading the upload and removes temporary files on normal success/error
paths. Abrupt host failure requires deployment-level cleanup.

Normal FastAPI still returns `503 TRANSCRIPTION_DISABLED` for valid uploads.
Only the integration harness injects an explicitly fictional transcription
provider; there is no selectable fake speech-recognition mode in the running
application. The tested successful response shape is:

```json
{
  "transcript_id":"74000000-0000-4000-8000-000000000001",
  "session_id":"73000000-0000-4000-8000-000000000001",
  "language":"sv",
  "text":"Jag flyttade till Malmö 1975.",
  "status":"completed",
  "created_at":"2026-10-20T10:01:00Z"
}
```

`transcript_id` identifies the immutable original message. With the same session,
POST `/messages` with `{"source_message_id":"TRANSCRIPT_UUID","language":"sv"}`
to process that existing source without copying it. Alternatively send typed
fictional text with a fresh UUID `Idempotency-Key`:

```json
{"text":"Jag flyttade till Malmö 1975.","language":"sv"}
```

HTTP 201 returns `user_message`, assistant `message`, `memories`,
`clarifications`, `requires_clarification` and `mode:"mock"`. A message contains
`id`, `session_id`, ascending `sequence`, `role`, original `text`, `language`
and `created_at`. The assistant must be visibly labelled simulated. A typical
memory in the returned array is:

```json
{
  "id":"75000000-0000-4000-8000-000000000001",
  "project_id":"72000000-0000-4000-8000-000000000001",
  "session_id":"73000000-0000-4000-8000-000000000001",
  "source_message_id":"74000000-0000-4000-8000-000000000001",
  "fact_type":"event","value":"Malmö","evidence":"Jag flyttade till Malmö 1975",
  "year":1975,"slot":"move","uncertain":false,"status":"pending",
  "corrected_value":null,"version":1,
  "created_at":"2026-10-20T10:01:00Z","updated_at":"2026-10-20T10:01:00Z"
}
```

Clarifications contain `id`, `fact_id`, `session_id`, `conflicts_with_fact_id`,
`question`, `status`, `resolution`, `created_at`, `resolved_at`. The GET list
returns only open questions. Use PATCH `/memories/FACT_ID` for Yes/No/correction:

```json
{"status":"confirmed","expected_version":1}
```

```json
{"status":"rejected","expected_version":1}
```

```json
{"status":"confirmed","corrected_value":"1976","expected_version":1}
```

Use the latest memory version, and refresh memories after replaying a turn because
its stored response predates subsequent reviews. Display `corrected_value` when
present; `year` and evidence remain original extraction metadata. Related
conflicts require their own reviews; one confirmation does not silently reject
another fact. These operations never overwrite the original transcript/message.

### Draft generation and revision

Only after an explicit Create My Story action, send POST
`/story-projects/PROJECT_ID/generate` with a UUID `Idempotency-Key`:

```json
{"language":"sv","style":"warm","confirm_generation":true}
```

HTTP 201 returns `draft_id`, `project_id`, `status`, `language`, `style`,
generation `version`, manual `revision`, `content`, immutable `original_content`,
`mode:"mock"`, `source_memories`, `verification`, `created_at`, `updated_at`.
`source_memories` snapshots include the memory/version, source message, value,
evidence, correction and canonical sentence. A new unedited draft has version1,
revision1 and status `ready_for_review`. Its verification resembles:

```json
{
  "status":"passed","unsupported_claims":[],"method":"deterministic_mock_v1",
  "checked_revision":1,"checked_at":"2026-10-20T10:02:00Z",
  "sources_current":true,"reason":null
}
```

`passed` checks the deterministic source templates, not real AI or historical
truth. Pending/rejected memories are excluded; unsupported memories cannot be
guessed into prose and unresolved contradictions block generation. An empty
project verification report has null `draft_id`, `version`, `revision` and
`verification.status:"not_generated"`.

Save an edit using PATCH `/story-drafts/DRAFT_ID`:

```json
{"content":"Jag flyttade till Malmö 1975. Min egen formulering.","expected_revision":1}
```

A changed save increments revision, preserves the original and appends history.
Status becomes `edited`, verification `needs_review` / `manual_unverified`.
Stale different edits return 409: reload and let the user reconcile, never
silently overwrite. Source changes can mark unedited drafts `stale_sources`.
GET drafts/history returns newest generation/revision first.

### PDF download and continuation

Save editor changes before POST `/story-drafts/DRAFT_ID/export` with
`{"format":"pdf","include_title_page":true,"include_page_numbers":true}`.
The201 response is PDF bytes with `Content-Disposition` and
`X-Memy-Export-Id`, `X-Memy-Draft-Version`, `X-Memy-Draft-Revision`,
`X-Memy-Page-Count`. Export history contains metadata, not public storage URLs.
Authenticated GET `/story-exports/EXPORT_ID/download` reconstructs that historical
saved revision, even after later edits. Private PDF responses use no-store.

For Expo, use authenticated fetch, verify `response.ok` and `application/pdf`
before writing bytes to app cache, then offer sharing only on user request.
Use the SDK-compatible `expo-file-system` / `expo-sharing` pattern in the
[PDF guide](pdf-export-api.md#frontend-download-patterns); do not upgrade Expo
implicitly. Check sharing availability. Clear private cached PDFs on sign-out
according to the app's retention policy. Do not put tokens in URLs, upload PDFs
to a public service or save documents to service-worker/localStorage caches.
Web uses Blob/object URLs and revokes them after download instead.

POST `/story-projects/PROJECT_ID/continue` with `{}` returns:

```json
{
  "project_id":"PROJECT_UUID","language":"sv",
  "session":{"id":"SESSION_UUID","project_id":"PROJECT_UUID","language":"sv",
    "status":"active","created_at":"ISO_TIMESTAMP","updated_at":"ISO_TIMESTAMP","ended_at":null},
  "session_created":false,"latest_draft":null,"generation_triggered":false
}
```

IDs/timestamps above are placeholders; `latest_draft` is null or the complete
saved draft object. Continuation resumes the latest active session or creates
one if none exists; it never reopens completed sessions or triggers generation.
Confirm new memories and explicitly generate a second version. Earlier edited
drafts/exports remain available, and manual prose is not auto-merged into new
canonical prose; show both versions for reconciliation.

## Reliability and error handling

Handle `{"error":{"code":"...","message":"..."}}` by status and code, not
English message text. Protected responses are no-store, including safe errors.
Non-audio business requests are bounded to 256 KiB and 30 seconds to read the
body; oversized/slow requests return `413 REQUEST_TOO_LARGE` or
`408 REQUEST_TIMEOUT`. Audio retains its separate multipart/processing limits.
Unexpected server errors return sanitized `500 INTERNAL_ERROR`, not traces,
tokens, database error bodies or private text. Configured CORS remains available
on application error responses. Always check HTTP status and Content-Type before
parsing JSON: Uvicorn's launcher concurrency cap can reject an overloaded request
with `503 text/plain` before the application middleware, without the JSON/CORS/
cache headers above. Proxy/network failures can also lack the API envelope.
Show a safe transient-unavailable message rather than crashing the client parser.

| Condition | Client action |
| --- | --- |
| 401 missing/invalid/expired token | Refresh through Supabase once when appropriate, otherwise sign in |
| 403 permissions or 404 missing/foreign resource | Stop; do not reveal or probe another user's data |
| 409 revision/context conflict | Reload current state and ask the user to reconcile |
| 409 transcription in progress | Wait, retry identical bytes and the same UUID key |
| 422 invalid fields/language/audio/PDF characters | Correct input; do not blindly retry |
| 429 audio busy or 503 PDF busy | Bounded backoff; disable repeated taps |
| 503 transcription/provider disabled | Show unavailable/simulation instructions, not false success |
| 503 database unavailable or 504 timeout | Bounded retry with the same action key when supported |

Audio upload, message submission and story generation require one UUID action
key retained with the identical payload/bytes across uncertain network retries.
A different deliberate action needs a new key. Do not generate a new UUID for
every retry. Key/content mismatch returns 409. Memory/draft review instead uses
the returned optimistic version/revision; an exact completed retry is safe.

Project and direct session creation have **no idempotency key support**. After an
ambiguous lost response, list/reconcile before creating another; do not enable
generic automatic retries for every POST. Continue My Story safely reuses its
active session. Export naturally reuses the audit for the same saved revision,
title/options/renderer; it does not require an idempotency header. GET retries
should still be bounded, and cancellation/sign-out must not display stale data.

## Language contract

Supported codes are `sv` and `en`. User choice controls the experience.
Profiles store preferred_language; projects and sessions store language.
Existing records default to Swedish. New project clients should choose
language explicitly; `Accept-Language: sv/en` does not override stored language.

Detected speech must never silently change UI, project/session or output
language. Audio upload's declared language must equal the session language;
the API does not translate or silently change it. Deterministic English and
Swedish memory extraction and story writing are available in explicit mock mode.
Live speech recognition, real AI accuracy, retained audio and complete mobile
localization are not established by that simulation.

## Project schema and original source material

story_projects is an invoker-security view over books; project ID equals book
ID. It exposes id, user_id, title, description, language, status, created_at,
updated_at and excludes soft-deleted books. Existing ownership RLS applies.
A project can have multiple conversation_sessions. The public FastAPI project
response deliberately omits `user_id`; ownership is derived from the verified
token rather than accepted from the frontend.

conversation_messages.original_text stores append-only user/assistant source
text, with sequence ordering. Corrections append new messages. Original text is
separate from generated/edited pages.content and stories.content; it is not
automatically a confirmed memory. Project/session erasure cascades source rows.

Day 3 uses temporary audio only, with explicit per-upload processing consent.
There is no retained-audio bucket or permanent recording URL. The running app
returns `TRANSCRIPTION_DISABLED` until a real provider is explicitly enabled;
it never returns a fake transcript. See [the audio API](audio-api.md) before
implementing a recording screen. Additional retention/provider policy approval
is needed before real pilot-user recordings.

## Complete fictional integration walkthrough

Use the dedicated development project, not the old Lovable project or real
user memories. The runtime flags enable typed simulated conversation and story
generation; they do not enable audio transcription.

1. Start the backend, open `/health` and `/ready` from the target client and sign
   in through development Supabase. Get the current SDK access token.
2. Create `My Childhood` with language `sv`, list projects, retrieve it and rename
   it. Retain the returned project UUID, not a single hard-coded current story.
3. Create a session and verify its inherited Swedish language.
4. If testing normal runtime audio, upload a valid fictional short M4A/WAV with
   consent and verify sanitized `TRANSCRIPTION_DISABLED`, not a fabricated
   transcript. The backend integration harness separately injects fictional
   transcription to verify successful upload, persistence, replay and cleanup.
5. For the app's free typed flow, submit `Jag flyttade till Malmö 1975.` with a
   UUID action key. Read the messages, memories and open clarification lists.
6. Confirm each intended sourced candidate with its current version. Also test
   rejection and a correction on a separate fictional candidate. Pending facts
   do not become confirmed merely because a simulated assistant extracted them.
7. Tap Create My Story, send the explicit confirmation and stable UUID key, then
   read the draft/verification. Show the simulated label and source references.
8. Save a manual edit using the returned revision. Fetch it and its history;
   confirm `needs_review` rather than a false factual-verification pass.
9. Export the saved revision, validate PDF headers/content, save privately to
   cache and offer download/share. Record its returned export UUID.
10. Continue the project, confirm another fictional supported memory such as
    `Jag kände mig glad.`, then explicitly generate a second version. The earlier
    edited draft and historical export must remain retrievable and unchanged.
11. Repeat the flow with language `en` and English fictional statements. A
    mismatched message/upload/generation language must fail without mutating the
    stored project/session language.
12. With a second authorized development account, attempt the first account's
    project/session/message/memory/draft/export reads and writes. Expect denied
    or indistinguishable missing responses; lists must not leak foreign data.

While testing, repeat the same logical message/generation action and verify
no duplicate. Submit a stale different draft edit and verify 409. Test an expired
or invalid token, invalid UUID, invalid/oversized audio, failed PDF and unavailable
database. Do not change ownership, weaken RLS, send test emails or create
disposable cloud accounts without the corresponding approval.

## Verification status and mobile acceptance

The Day 6 baseline was 519 passing Python tests plus 54 PostgreSQL checks; four
opt-in live tests were skipped. Day 7 adds focused mobile-contract/reliability
checks and an authenticated backend workflow harness. The final regression/live
results and remaining limitations are recorded in [Day 7 status](day-7-status.md).
Keep the four skipped checks visibly pending unless they are actually executed;
mock HTTP or SQL role checks do not silently turn them into passed real-login
tests.

For an explicitly authorized repeat using two existing development accounts,
run this in a real terminal from `backend/`:

```sh
.venv/bin/python scripts/verify_day7.py --run --cleanup
```

It prompts privately for credentials, verifies the dedicated project and executes
the real FastAPI routes in-process against hosted Supabase. The transcription
provider is injected fictional test data, not speech recognition. `--cleanup`
deletes only the exact synthetic projects that invocation created and their
children; no existing accounts or unrelated data are deleted. Do not paste
passwords/tokens into chat or command arguments. The optional
`--tokens-from-env` input is for an already prepared private automation environment,
not permission to print or save access tokens. This harness does not change
Auth settings or create users.

Tarun reports public health/readiness reachability from the iPhone. Real Expo
authenticated project persistence, confirmation, SDK session refresh across app
lifecycle, recording permissions/format and native PDF sharing still need device
acceptance. The reviewed mobile branch has project list/create/detail/metadata
editing, not native session, conversation, draft, PDF or continuation screens.
For the next Start/Resume integration, use the existing
`POST /api/v1/story-projects/{project_id}/continue` contract: it resumes an active
owned session atomically rather than creating another session on every tap.
A Python integration client
using genuine development JWTs can verify the backend independently, but cannot
prove those device behaviors. Real speech/provider quality, privacy approvals,
public deployment and AI spending remain outside this free mock integration.

## Review items for Tarun

Day 4 adds five authenticated text/history/memory-review routes under the existing
`/api/v1/story-sessions` and `/api/v1/memories` conventions. Use the
[conversation API guide](conversation-api.md) for the exact paths, full sample
response, UUID retry headers, pending/confirmed/rejected states and correction
versioning. Set backend `CONVERSATION_MODE=mock` for the free demo and visibly label
the assistant as simulated. Voice transcription and real AI remain disabled.

- Sign two test accounts into the new project and verify SDK token refresh.
- Test one configurable API base URL from Expo and a physical phone.
- Confirm the nested error contract and explicit sv/en behavior.
- Replace any legacy single-current-draft assumption with project IDs from the
  new list/create API before connecting the old UI to these routes.
- Agree on a hosted shared development URL when deployment is scheduled.

This is the prepared handoff; no message has been sent or agreement claimed.
