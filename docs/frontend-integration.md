# Frontend integration handoff for Tarun

Prepared and technically verified on 16 October 2026. Tarun's review/sign-off
has not been obtained.

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
3. Future protected API calls send `Authorization: Bearer <user-access-token>`.
4. FastAPI must verify it through Auth getUser or cryptographically against the
   project's JWKS, including issuer/audience/expiry as applicable.
5. Forward that same user token with the publishable key to the Data API so RLS
   evaluates the user's identity.

Do not trust an unverified decoded JWT, or use service-role credentials for
ordinary user requests. No protected FastAPI routes exist today; their 401/403
contract will be introduced with the first protected feature.

## Implemented API and response handling

| Request | Authentication | Result |
| --- | --- | --- |
| GET /health | None | 200 process liveness |
| GET /ready | None | 200 Supabase probe, or sanitized 503 |

```json
{"status":"ok","service":"memy-ai-backend"}
```

Readiness adds `"database":"ok"` on success. Failure:

```json
{"status":"unavailable","service":"memy-ai-backend","error":{"code":"SUPABASE_UNAVAILABLE","message":"Database is not ready."}}
```

The code is SUPABASE_NOT_CONFIGURED or SUPABASE_UNAVAILABLE. Branch on status
and stable codes, not English message text. /ready is operational diagnostics,
not an authorization check. Unknown routes return 404 with
`{"detail":"Not Found"}`; unsupported methods return 405 with
`{"detail":"Method Not Allowed"}`. Future business responses should use typed
resource objects and a documented error envelope; these endpoints are not built.

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
transcription and AI features are later work, not Day 1 implementations.

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

- Confirm new-project Auth configuration and token refresh/verification approach.
- Test one configurable API base URL from Expo and a physical phone.
- Confirm 200/503/404/405 handling and explicit sv/en behavior.
- Agree on a hosted shared development URL when deployment is scheduled.

This is the prepared handoff; no message has been sent or agreement claimed.
