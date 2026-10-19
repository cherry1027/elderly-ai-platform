# Frontend integration handoff for Tarun

Updated for backend 0.4.0 on 19 October 2026. Tarun's complete backend integration
sign-off has not been obtained.

## Environment and URLs

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

Store one configurable `EXPO_PUBLIC_API_BASE_URL` without a trailing slash.
For phone access run Uvicorn with `--host 0.0.0.0 --port 8000`. A computer's
loopback URL does not reach it from another device. Local HTTP is for development.

## Authentication approach

1. Sign in directly with Supabase Auth in the NEW development project.
2. Obtain/refresh the user's session access token through the Supabase SDK.
3. Protected API calls send `Authorization: Bearer <user-access-token>`.
4. FastAPI validates that specific token through Supabase Auth `getUser`.
5. FastAPI forwards the same user token plus its publishable key to the Data API,
   so RLS evaluates the signed-in user's `auth.uid()`.

Do not trust an unverified decoded JWT, or use service-role credentials for
ordinary user requests. The app must refresh expired sessions through the
Supabase SDK; the backend never accepts a refresh token.

```ts
const { data, error } = await supabase.auth.getSession();
if (error || !data.session) throw new Error("Sign in is required");

const response = await fetch(`${API_BASE_URL}/api/v1/story-projects`, {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
```

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

## Language contract

Supported codes are `sv` and `en`. User choice controls the experience.
Profiles store preferred_language; projects and sessions store language.
Existing records default to Swedish. New project clients should choose
language explicitly; future localized requests can send Accept-Language: sv/en.

Detected speech must never silently change UI, project/session or output
language. Audio upload's declared language must equal the session language;
the API does not translate or silently change it. Full English UI, live speech
recognition, AI, retained audio and extracted-facts features remain later work.

## Project schema and original source material

story_projects is an invoker-security view over books; project ID equals book
ID. It exposes id, user_id, title, description, language, status, created_at,
updated_at and excludes soft-deleted books. Existing ownership RLS applies.
A project can have multiple conversation_sessions.

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
