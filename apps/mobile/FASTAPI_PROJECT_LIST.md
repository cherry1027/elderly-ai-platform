# Mobile Task 3D-1 — real development project list

Frontend branch: `feat/mobile-fastapi-project-list`.
Base: `59762f2f8413b7f328421fb158489594511a1e06`.
Read-only backend reference: `codex/day-7-mobile-integration`, commit
`374b1dd04e3295e0dc3b5e868779a0bf450433ae`, backend 0.7.0.
References: that checkout's `docs/frontend-integration.md` and
`docs/backend-mobile-quickstart.md`. No backend source was changed.

## Existing implementation reused

The normal authenticated route mounts `StoriesHome` only for a verified account.
Its `StoryDashboard` reads the explicit native development API settings and calls
the existing `listStoryProjects` adapter. The auth service supplies the current,
unexpired, expected-account session already verified with Supabase `getUser`.
Automatic refresh/foreground verification remain in the existing auth service.
A failed or expired verification does not grant project access.

The request is:

```text
GET /api/v1/story-projects?limit=50&offset=0
Authorization: Bearer <current verified user's access token>
Accept: application/json
```

No publishable key, service-role key, refresh token, owner ID or request body is
sent to FastAPI. The API prefix is appended once. Ownership is enforced by the
backend's verified JWT and RLS; a mobile user-ID check is not proof of ownership.

Success is HTTP 200 with a plain array of objects containing `id`, `title`,
nullable `description`, `language` (`en`/`sv`), string `status`, `created_at` and
`updated_at`. The first 50 records retain backend order. Unknown statuses receive
a generic translated label. Empty arrays show the translated empty state.
The adapter rejects malformed/non-JSON success, unexpected status, duplicate IDs
and oversized responses. Error bodies and arbitrary exceptions are not displayed.
HTTP authentication failures require normal sign-out/sign-in; there is no
publishable-key fallback, automatic login or unbounded request retry.

The existing dashboard clears old rows for refresh/errors and fences requests by
owner/revision. Sign-out, account change, route departure and background session
verification hide/unmount private views; cancellation and late-response guards
prevent old results appearing for another account. Project data is not persisted.

No runtime rewrite is required for this contract. This task adds composition
regressions exercising real auth, configuration, list transport and dashboard
with synthetic credentials/network responses, plus this current setup handoff.
Existing onboarding, artwork, EN/SV copy, accessibility, creation and editing
remain intact.

## 1. Configure this worktree privately — no services start

Both `development.auth.local.json` and `development.api.local.json` were absent
at inspection. They are Git-ignored and deliberately not copied automatically.
In Windows PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-fastapi-project-list\apps\mobile'
if (-not (Test-Path -LiteralPath '.\development.auth.local.json')) {
  Copy-Item -LiteralPath '.\development.auth.example.json' -Destination '.\development.auth.local.json'
}
if (-not (Test-Path -LiteralPath '.\development.api.local.json')) {
  Copy-Item -LiteralPath '.\development.api.example.json' -Destination '.\development.api.local.json'
}
notepad .\development.auth.local.json
notepad .\development.api.local.json
```

Auth settings must retain exactly these fields: `supabaseUrl` fixed to
`https://edbkuunyeyxnyenmmqud.supabase.co`, and `publishableKey` set privately to
Charan's approved development `sb_publishable_...` client key. Never insert a
password, service-role/provider key or access/refresh token. Do not copy a web/root
`.env` or another worktree's ignored settings. Do not paste keys into chat.

In the API file, set only:

```json
{"baseUrl":"http://172.20.10.3:8000"}
```

This is the explicitly approved current personally controlled iPhone hotspot
address, not a permanent host or production default. Reconfirm it when the
network changes. Use the root origin without `/api/v1`. No address is inferred.
The empty example and missing/invalid settings continue to fail closed, without
a request or fake success. General `EXPO_PUBLIC_*` and dotenv loading remain
disabled; use these JSON files instead of the backend guide's illustrative
public environment-variable examples.

The publishable key is client-public and appears in the Expo development
manifest; passwords/session tokens must never be configuration. Use only the
approved private development network. These settings do not enable a release
build, registration, Guest, microphone, transcription or paid AI.

## 2. Backend and connectivity — deliberate development service use

If the approved backend is already running, leave it alone. Otherwise, after
Charan's correct development URL/publishable key are privately configured in its
own terminal, use the already-prepared backend environment:

```powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-backend-day7\backend'
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan
```

Do not install packages, copy legacy environment files, run migrations or edit
the backend for this task. The launcher pins the approved project, suppresses
access logs, keeps transcription disabled and supports only free mock AI modes.
Its `--lan` option binds all local interfaces: use only the expressly approved
personally controlled hotspot, never a public/shared network or public tunnel.
If port 8000 is occupied or Windows blocks access, stop and report it; do not kill
another listener or alter firewall/security settings. LAN HTTP exposes Bearer
tokens to the network and is approved here only for this limited development
test; it is not production transport security.

On the iPhone, Safari should reach `http://172.20.10.3:8000/health`. This is only
process liveness. Optionally check `/ready` as Charan's handoff directs: **that
probe contacts the approved development Supabase project** with a zero-row
profiles HEAD. Neither probe proves account authorization or RLS isolation.
No such probe was performed during automated verification.

## 3. Normal Expo startup and iPhone acceptance

Back in the mobile PowerShell terminal:

```powershell
npm start
```

Expect `MEMY NORMAL APP`. Scan this terminal's **new** QR code with the iPhone
camera. Do not use `preview:stories` or an old Expo Go recent entry. When changing
from a prior preview, stop only its own terminal with Ctrl+C and fully close Expo
Go without clearing its data, onboarding preferences or secure session storage.

Use the existing authorized, confirmed development account; no signup, recovery
email or new account is needed. Never share its password/token or a network dump.

1. Complete/replay onboarding as desired. Normal Welcome has no SAMPLE STORIES
   banner. A returning verified session may go directly to My Stories.
2. Choose Log In and sign in normally. My Stories first shows loading and then
   real HTTP 200 records from the configured FastAPI server. Expected fictional
   fixtures documented by Charan are `Fictional Childhood - Dashboard Test`
   (English) and `Minnen fran Malmo - Testprojekt` (Swedish). Their current presence
   and ownership are a manual check, not guaranteed by mocked tests.
3. Tap Refresh stories. Loading replaces the previous list, then the same owned
   records return once each. Check English/Swedish labels and generous controls.
4. Sign Out. Rows and account identity disappear and Welcome returns. Signing in
   again must request the current account's records, with no synthetic examples.
5. If a request fails, expect the translated connection/authentication/service
   error, never fabricated projects or a success message. A 401 asks for Sign Out
   and ordinary login again. Do not repeatedly retry incorrect credentials.

This acceptance is **list-only**: do not tap Create My Story, save/edit projects,
start sessions or invoke any audio/generation/PDF action. The shared API setting
also serves the already-preserved intentional create/edit screens; configuring
it is not evidence that those writes were tested or approved in this task.

## Verification and limitations

Automated network is blocked by default; composition tests inject only synthetic
Auth and FastAPI responses. They are not live integration, device, Keychain or
two-user cloud RLS verification. Exact executed results accompany the review ZIP.
No real login, backend request, readiness probe or email is sent by these checks.
Config checks and exports force verification mode and never open local settings.

The explicit Sample Stories preview remains separate: auth/API settings are
disabled and the fictional-data banner stays visible. Its in-memory examples
never populate the real authenticated dashboard. The prior physical Expo Go
startup/banner concern still requires checking with this worktree's fresh normal
QR; source checks alone cannot prove what an already-open phone experience loaded.

Actual iPhone retrieval/refresh, expired-session/device behavior and two-account
cloud ownership testing remain pending. This task does not approve production
use, a hosted URL or additional features. Stop after manual list acceptance and
independent review; no commit/push/merge/deployment is included.
