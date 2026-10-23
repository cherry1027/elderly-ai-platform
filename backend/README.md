# Memy AI FastAPI backend

Python 3.13 is the verified runtime. From the repository root:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --only-binary=av -r requirements-dev.txt
# New checkout only: copy .env.example to .env and fill its project URL/key.
python -m pytest -q -m 'not integration'
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger: http://127.0.0.1:8000/docs

Backend version 0.8.1 includes [Day 5 Create My Story](../docs/story-drafts-api.md):
explicit generation, confirmed-memory evidence, immutable originals, versioned
drafts, manual editing/history and conservative verification. For the free local
simulation, set `CONVERSATION_MODE=mock STORY_GENERATION_MODE=mock` before the
Uvicorn command (PowerShell examples are in that contract). Both defaults stay
disabled. No model key or paid AI provider is involved.

[Day 6 PDF export and continuation](../docs/pdf-export-api.md) adds four protected
operations, pinned ReportLab and bundled Unicode fonts. Reinstall the updated
requirements. No system PDF executable or font installation is required for the
server; PDFs are rendered in memory with private/no-store download headers. The
audit stores metadata only and retains the selected historical saved revision.
Continuation resumes or creates a session but never generates a draft automatically.

## Day 7 mobile development and acceptance

Use the cumulative `codex/day-7-mobile-integration` review branch. From this
directory, start the safe development launcher:

```sh
.venv/bin/python scripts/run_mobile_dev.py         # loopback only
.venv/bin/python scripts/run_mobile_dev.py --lan   # trusted local network only
```

On Windows use `.venv\Scripts\python.exe`. The launcher refuses legacy/unknown
Supabase projects, enables only the free conversation/story mocks, keeps real
transcription disabled, disables access logs/proxy trust, and caps concurrent
connections at 32. No public tunnel, deployment or paid provider is configured.
Use the backend computer's LAN IP from a same-network phone; `0.0.0.0` is not a
client URL and another computer's private address is not reachable across separate
home networks. Stop the launcher with Ctrl+C after testing.

Non-audio business API bodies are limited to 256 KiB and 30 seconds before JSON
parsing. Safe failures are `413 REQUEST_TOO_LARGE`, `408 REQUEST_TIMEOUT`, and
`500 INTERNAL_ERROR`; they never expose exception text and retain configured CORS
and no-store. Audio keeps its separate authentication-before-read and 25 MB limit.
PDF success bodies are binary, but their documented error responses are JSON.

For authorized **disposable** existing development accounts only:

```sh
.venv/bin/python scripts/verify_day7.py --run --cleanup
```

This prompts privately for both account credentials, obtains/validates their
access tokens online, then executes real FastAPI routes in-process against only
`edbkuunyeyxnyenmmqud`. It injects a clearly fictional WAV transcription fixture
and the existing free mock conversation/story providers; no speech/AI API is
called. It verifies both languages, RLS denial, immutable originals, clarification,
draft/edit/retry behavior, actual PDFs and historical versions. `--cleanup`
deletes and verifies only this invocation's synthetic projects and children;
without it data is retained and exact project IDs are reported. It never changes
Auth settings or creates/deletes Auth users. Automated operators may explicitly
use `--tokens-from-env` with two privately supplied `MEMY_DAY7_USER_A_TOKEN` /
`MEMY_DAY7_USER_B_TOKEN` values; never place secrets in CLI arguments or chat.

The authorized hosted Day 7 run passed for Swedish and English. This is backend
acceptance, not proof that Tarun's Expo client, email confirmation or real iPhone
download UX works. The four older opt-in live pytest cases remain skipped/pending.
See the [single frontend handoff](../docs/frontend-integration.md) and
[Day 7 evidence and limitations](../docs/day-7-status.md).

For Day 8, use the [actual Expo configuration and device checklist](../docs/backend-mobile-quickstart.md)
and [integration status](../docs/day-8-status.md). The reviewed mobile revision
`59762f2` uses ignored local JSON files, not `EXPO_PUBLIC_*`. Existing project
contracts match; authenticated iPhone acceptance and native session integration
remain pending. Do not send Bearer tokens over shared Wi-Fi HTTP.

An optional Node 24+ check runs the pinned real TypeScript project client against
FastAPI in-process with synthetic Auth/Data API fixtures:

```sh
.venv/bin/python scripts/verify_mobile_contract.py
```

It requires the reviewed mobile Git object locally, opens no sockets and makes
no cloud requests. It does not prove device networking, real login or RLS.

## Day 11 story and PDF integration

The [Day 11 Expo guide](../docs/day-11-story-integration.md) connects explicit
generation, saved draft reading/editing/history, private PDF bytes and Continue
using the existing APIs. No migration/runtime change is needed. New route and
real-renderer tests plus the rollback-only bilingual database journey are in
the [verification report](../docs/day-11-status.md); native PDF/share acceptance
remains Tarun's device gate.

## Day 10 memory review

The [Day 10 handoff](../docs/day-10-memory-integration.md) covers current-memory
versions, explicit correction/rejection and project-scoped structured continuity.
Patch 0.8.1 rejects a stale implicit confirmation of a newer corrected value with
409 rather than reporting an unseen correction as approved. Existing valid
replays remain safe; no new database migration or API fields are needed.
See [verification scope and pending device checks](../docs/day-10-status.md).

## Day 9 native audio simulation

From this directory, explicitly opt into labelled fictional transcripts:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan --simulate-transcription
```

On Windows use `.\.venv\Scripts\python.exe`. The launcher pins the development
project and otherwise keeps transcription disabled; no environment variable or
model key enables it. Valid recording bytes are decoded and bounded, but their
speech is not interpreted. A permanent bilingual simulation notice is stored
with the fixed EN/SV transcript. Process its returned ID through `/messages`
using `source_message_id`, not copied text, to avoid a second original.

See the [native upload and memory-review handoff](../docs/day-9-mobile-audio.md)
and [Day 9 results](../docs/day-9-status.md). No new API paths, database migration,
retained-audio storage or paid provider is added. Physical-device recording,
upload and display still need Tarun's implementation/acceptance.

```sh
curl -i http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8000/ready
```

## Supabase configuration

The local ignored `backend/.env` is configured for the dedicated development
project `edbkuunyeyxnyenmmqud`, Ireland, Free:

```dotenv
SUPABASE_URL=https://edbkuunyeyxnyenmmqud.supabase.co
SUPABASE_PUBLISHABLE_KEY=<development-project-publishable-key>
```

No database password or service-role key is required for this foundation.
For a new checkout, create `backend/.env` from `backend/.env.example` and obtain
the publishable key from this project's dashboard. Never commit local env files.

Settings accept the legacy root `VITE_SUPABASE_*` aliases as a fallback. The root
web client still uses the older project; explicit `SUPABASE_*` values in
`backend/.env` select the new project. Process environment variables override
dotenv files. Paths are resolved from the code location, independently of cwd.

`CORS_ORIGINS` is a JSON array of exact HTTP(S) origins without trailing slashes.
Defaults cover localhost/127.0.0.1 ports 8080 and 5173. Add deployment origins
explicitly. `REQUEST_TIMEOUT_SECONDS` defaults to 5 and accepts values >0 to 30.

For a Windows readiness 503/upstream 401, run the read-only
`scripts/diagnose_supabase.py` helper (`.venv\Scripts\python.exe` on Windows).
It pins the development project, reports only a key fingerprint/configuration
hints and probes zero rows; it never prints keys, tokens or upstream bodies.
See [the readiness troubleshooting steps](../docs/backend-mobile-quickstart.md#diagnose-a-readiness-503-or-supabase-401)
before changing credentials or permissions. Dashboard membership is separate
from project-key validity and is not required for application API access.

## Current HTTP contract

The public operational routes are unchanged.

`GET /health` checks process liveness without contacting Supabase:

```json
{"status":"ok","service":"memy-ai-backend"}
```

`GET /ready` makes a bounded HEAD request to `profiles?select=id&limit=0`
using the publishable key, with redirects disabled. It fetches no records:

```json
{"status":"ok","service":"memy-ai-backend","database":"ok"}
```

Missing configuration returns HTTP 503 with code `SUPABASE_NOT_CONFIGURED`.
Invalid credentials, timeouts, redirects and upstream failures return HTTP 503:

```json
{"status":"unavailable","service":"memy-ai-backend","error":{"code":"SUPABASE_UNAVAILABLE","message":"Database is not ready."}}
```

Upstream bodies and credentials are not exposed. Readiness alone does not prove
RLS or schema deployment; these were checked separately in the new development
project. Framework 404/405 responses use `{"detail":"Not Found"}` and
`{"detail":"Method Not Allowed"}`.

### Authentication and RLS

Every `/api/v1` request requires:

```http
Authorization: Bearer <supabase-user-access-token>
```

FastAPI validates the token with `GET /auth/v1/user`. It then sends the same
Bearer token and the configured publishable key to PostgREST. The user JWT makes
PostgREST assume the `authenticated` role and lets ownership RLS evaluate
`auth.uid()`. Queries also include an explicit `user_id` filter as defense in
depth. Never substitute a publishable key for the user token and never use a
secret/service-role key for these routes.

### Story-project routes

| Method | Route | Request | Success |
| --- | --- | --- | --- |
| POST | `/api/v1/story-projects` | project-create JSON | 201 project |
| GET | `/api/v1/story-projects` | `limit`, `offset` query | 200 project array |
| GET | `/api/v1/story-projects/{project_id}` | none | 200 project |
| PATCH | `/api/v1/story-projects/{project_id}` | project-patch JSON | 200 project |
| POST | `/api/v1/story-projects/{project_id}/sessions` | no body or `{}` | 201 session |
| GET | `/api/v1/story-projects/{project_id}/sessions` | `limit`, `offset` query | 200 session array |

Create requires `title` (trimmed, 1–120 characters) and `language` (`en` or
`sv`). `description` is optional, nullable and limited to 4,000 characters.
Ownership, status, IDs and timestamps are server-owned:

```json
{"title":"Minnen från Malmö","language":"sv","description":"Barndomens berättelser"}
```

PATCH accepts only `title` and/or `description`; an empty object is invalid.
Project language is immutable after creation. Session creation accepts no input
fields and inherits the owned project's language, so a caller cannot choose a
foreign parent or override the language.

Project responses contain exactly `id`, `title`, `description`, `language`,
`status`, `created_at` and `updated_at`. Session responses contain exactly `id`,
`project_id`, `language`, `status`, `created_at`, `updated_at` and `ended_at`.
List endpoints return plain JSON arrays. Both use deterministic
`created_at.desc,id.desc` ordering; `limit` defaults to 50 and is bounded 1–100,
while `offset` defaults to 0 and is bounded 0–100000.

Protected responses include `Cache-Control: no-store`. Errors use one stable
shape and never echo request input, bearer tokens or upstream response bodies:

```json
{"error":{"code":"PROJECT_NOT_FOUND","message":"Story project was not found."}}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `AUTHORIZATION_REQUIRED` | Bearer header is missing or malformed |
| 401 | `INVALID_ACCESS_TOKEN` | Supabase rejected or could not use the user token |
| 403 | `ACCESS_DENIED` | Authenticated request lacks permission |
| 404 | `PROJECT_NOT_FOUND` | Missing, soft-deleted or another user's project |
| 409 | `CONFLICT` | Data conflicts with current state |
| 422 | `VALIDATION_ERROR` | Path, query or body validation failed |
| 503 | `SUPABASE_NOT_CONFIGURED` | Backend Supabase configuration is absent |
| 503 | `SUPABASE_UNAVAILABLE` | Auth/Data API, network or upstream payload failed |

The two 401 responses include `WWW-Authenticate: Bearer`. A cross-user project
is deliberately indistinguishable from a missing project.

### Curl examples

Set a real short-lived access token in the shell environment; do not commit it
or paste it into documentation:

```sh
: "${MEMY_TEST_USER_A_TOKEN:?set a Supabase user access token}"
curl -sS http://127.0.0.1:8000/api/v1/story-projects \
  -H "Authorization: Bearer ${MEMY_TEST_USER_A_TOKEN}"

curl -sS -X POST http://127.0.0.1:8000/api/v1/story-projects \
  -H "Authorization: Bearer ${MEMY_TEST_USER_A_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"title":"Minnen från Malmö","language":"sv","description":null}'

curl -sS -X POST \
  http://127.0.0.1:8000/api/v1/story-projects/PROJECT_UUID/sessions \
  -H "Authorization: Bearer ${MEMY_TEST_USER_A_TOKEN}"
```

## Verification

```sh
# From backend/
python -m pytest -q -m 'not integration'
python -m pip check

# From the repository root
npm --prefix supabase/tests test
```

The full Day 2 results and remaining live checks are recorded in
[the Day 2 status](../docs/day-2-status.md). Starlette currently emits a
non-failing httpx TestClient deprecation warning.

Two integration modules are opt-in. The original module probes public readiness.
The Day 2 module additionally needs access tokens for two real users in the exact
development project:

```sh
export RUN_SUPABASE_INTEGRATION=1
export RUN_MEMY_DAY2_INTEGRATION=1
export MEMY_TEST_USER_A_TOKEN='<short-lived-user-A-access-token>'
export MEMY_TEST_USER_B_TOKEN='<short-lived-user-B-access-token>'
python -m pytest -q -m integration
```

Obtain those JWTs by signing both test users into the application backed by
`edbkuunyeyxnyenmmqud` and reading each Supabase SDK session. They are not
dashboard keys or GitHub credentials. The live test is hard-gated to that project,
creates uniquely named rows owned by the test users, checks cross-user isolation,
and removes only its own synthetic projects; cascades remove their sessions.

## Expo development

For a physical phone on the same reachable LAN:

```sh
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Use `http://<developer-machine-LAN-IP>:8000`; phone loopback points to the phone.
A shared remotely accessible API URL has not been deployed.

See [the frontend handoff](../docs/frontend-integration.md).

## Day 4 simulated conversations

Backend 0.4.0 adds authenticated text turns, ordered message history, extracted
memory candidates, clarification questions and versioned confirmation/correction.
Existing Day 3 source messages can be processed without rewriting or duplicating
them. PostgreSQL owns atomic writes, retry replay and cross-user isolation.

`CONVERSATION_MODE` accepts only `disabled` (default) or `mock`. For the free
development demonstration, set `CONVERSATION_MODE=mock` when starting Uvicorn.
There is no live AI adapter, API key requirement or paid provider call. Mock
extraction recognizes limited explicit en/sv patterns; unsupported wording can
produce no facts. It does not establish real-model accuracy.

The [Day 4 conversation contract](../docs/conversation-api.md) includes all five
routes, source/text requests, example response, Yes/No/correction formats,
idempotency keys, errors and Windows/macOS launch commands. Deployment and
verification are recorded in [Day 4 status](../docs/day-4-status.md).

## Day 3 audio foundation

Backend version 0.3.0 adds bounded, authenticated audio upload and immutable
transcript retrieval. Live transcription remains disabled. Ordinary startup
does not return simulated transcripts; Day 9's explicit development launcher
flag is the only supplied runtime opt-in. [Audio API](../docs/audio-api.md) describes the
multipart contract, errors, privacy and retry rules.

The decoder uses PyAV's bundled FFmpeg libraries; a system `ffmpeg`/`ffprobe`
installation is not required. Python 3.13 and macOS are verified locally. Windows
and Linux need compatible PyAV wheels and should run the full suite before use.
The decoder subprocess has a 12-second wall limit on every platform, Unix CPU
limits, and an additional Linux heap limit. It receives no backend credentials.
Windows uses a threaded child-process controller so Uvicorn's selector loop under
`--reload` does not prevent audio probing. This branch is regression-tested here;
a native Windows acceptance run is still required before deployment.

Run the credential-safe hosted acceptance helper from a real local terminal:

```sh
cd backend  # omit this line if already in backend/
.venv/bin/python scripts/verify_two_users.py --day3
```

On Windows use `.venv\Scripts\python.exe scripts\verify_two_users.py --day3`.
Enter credentials only into its hidden terminal prompts, using two existing
dedicated-development users. It refuses piped/password-echoing input and keeps
tokens out of files and normal output. It creates only synthetic projects and
normally deletes their exact IDs afterward. A forced process/host termination
can interrupt cleanup; remove only its clearly labeled synthetic projects then.
Day 3's hosted HTTP test uses an explicit fictional provider, so it tests Auth,
RLS, persistence and retries without any paid calls, not speech recognition.

On 18 October, these three hosted HTTP cases passed using two disposable anonymous
Supabase Auth users. `scripts/verify_anonymous_users.py` supports that alternative
only with `RUN_MEMY_ANONYMOUS_ACCEPTANCE=1` and the exact development project.
It requires an operator to approve and temporarily enable anonymous sign-in,
restore the setting afterward, and delete the reported exact Auth user IDs.
Do not enable anonymous sign-in on a shared/production project just to run tests.

For database-only hosted checks, run `supabase/tests/cloud-audio.sql` in the
dedicated development SQL Editor. It rolls back all synthetic Auth/database rows;
it does not create login credentials. See [Day 3 status](../docs/day-3-status.md)
for the exact distinction between completed checks and remaining acceptance.
