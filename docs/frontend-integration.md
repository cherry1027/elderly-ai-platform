# Frontend integration handoff for Tarun

Updated for backend 0.2.0 on 17 October 2026. Tarun's review/sign-off has not
been obtained.

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
Authorization and Accept-Language. Native mobile requests do not depend on
browser CORS. Add real web deployment origins explicitly.

## Language contract

Supported codes are `sv` and `en`. User choice controls the experience.
Profiles store preferred_language; projects and sessions store language.
Existing records default to Swedish. New project clients should choose
language explicitly; future localized requests can send Accept-Language: sv/en.

Detected speech must never silently change UI, project/session or output
language. Prompt for an explicit switch when needed. Full English UI,
transcription, AI, audio retention and extracted-facts features remain later work.

## Project schema and original source material

story_projects is an invoker-security view over books; project ID equals book
ID. It exposes id, user_id, title, description, language, status, created_at,
updated_at and excludes soft-deleted books. Existing ownership RLS applies.
A project can have multiple conversation_sessions.

conversation_messages.original_text stores append-only user/assistant source
text, with sequence ordering. Corrections append new messages. Original text is
separate from generated/edited pages.content and stories.content; it is not
automatically a confirmed memory. Project/session erasure cascades source rows.

Raw audio is optional. Retention/consent and transcript visibility remain product
decisions. Do not promise permanent audio storage or enable default uploads
before the team agrees on retention and deletion behavior.

## Review items for Tarun

- Sign two test accounts into the new project and verify SDK token refresh.
- Test one configurable API base URL from Expo and a physical phone.
- Confirm the nested error contract and explicit sv/en behavior.
- Replace any legacy single-current-draft assumption with project IDs from the
  new list/create API before connecting the old UI to these routes.
- Agree on a hosted shared development URL when deployment is scheduled.

This is the prepared handoff; no message has been sent or agreement claimed.
