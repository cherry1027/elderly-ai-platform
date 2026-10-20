# Mobile Task 3D-3 — native Start / Continue Conversation

Frontend: `feat/mobile-story-continue`, base
`05f36d240bcb37055a59dd0dfc4b3c0220af5452`.
Read-only backend reference: `codex/day-7-mobile-integration`, Day 8 commit
`61c45c4dd0c0a35e6f54ad9d399d63bb4360b783`.

## Scope and exact contract

A verified user opens a saved story, selects **Start / Continue Conversation**
(**Starta / Fortsätt samtal**), and reaches a minimal native landing screen.
It confirms only a real active session and its saved story language. Voice,
messages, microphone, transcripts, AI stories and PDF actions are absent. No
fictional conversation or completed memory is inserted into an account.

The existing shared authenticated API transport handles both new operations:

```text
GET /api/v1/story-projects/{project_id}/sessions?limit=50&offset=0
POST /api/v1/story-projects/{project_id}/continue
Content-Type: application/json
Body: {}
Authorization: Bearer <current verified Supabase user access token>
```

GET returns HTTP 200 with a plain array of sessions, newest first. Session fields
are `id`, `project_id`, `language`, `status` (`active`/`completed`), `created_at`,
`updated_at`, and nullable `ended_at`. POST returns **200**, preserving the
existing project-creation POST's **201** requirement:

```text
{project_id, language, session, session_created, latest_draft, generation_triggered:false}
```

The returned session must be active, have null `ended_at`, and match the selected
project UUID and language. IDs, timestamps, flags, duplicate IDs and response
types are checked. `latest_draft` is null or saved-draft metadata; prose, source
memories and reports are discarded, never rendered by this feature. There is no
individual public session GET endpoint. The unconditional POST `/sessions` is
not used. No client user ID is supplied as ownership proof.

The inspected contracts are in `docs/frontend-integration.md`,
`backend/app/api/exports.py`, `backend/app/api/story_projects.py`,
`backend/app/schemas/exports.py`, `backend/app/schemas/story_projects.py`,
`backend/app/services/export_resources.py` and the continuation SQL function.
No backend file, migration or database was changed or executed.

## Resume, duplicate prevention and uncertain results

Every intentional entry and explicit retry first GETs saved sessions with the
current account's verified token. A returned active session is resumed without
a POST. Completed sessions are not reopened. If the first page has no active
session, the canonical `/continue` endpoint decides which session to use: the
mobile app does not assume that no older active session exists beyond that page.

The inspected backend RPC locks the owned project, selects its newest active
session across all records, or creates one if none is active. Concurrent
`/continue` requests serialize through that lock. This protection does not cover
other clients using direct POST `/sessions`; legacy multiple active sessions may
exist. Backend order identifies the newest active session deterministically.
Actual deployment of these source guarantees still requires live acceptance.

Repeated taps are synchronously fenced while work is pending. Timeout, network,
malformed response or server failure never schedules an automatic write retry.
An uncertain dispatched POST shows a warning. Only **Try again** starts a fresh
GET reconciliation, followed by canonical POST if needed. A failed reconciliation
GET cannot send a POST, and its warning does not erase the earlier uncertainty.
Aborting a phone request does not prove that the server rolled back its work.

Back, Android hardware Back, Sign Out, account changes, background verification
and route departure cancel/fence private work. Late results cannot enter another
account or selected story. Session IDs are not persisted locally; the server is
reconciled again on returning/reopening. Auth failures stop retries and direct
the user to ordinary Sign Out / Log In. Existing secure storage, token refresh
and foreground verification are reused unchanged.

Sample Stories uses its separate presentation flow without the new authenticated
action. It cannot send synthetic project/session IDs to these endpoints.
Native EN/SV text, 56-unit controls, scalable text, safe areas and iOS/Android
error announcements follow the existing design. No permissions were added.

## Safe setup in this new worktree

At inspection, both ignored files were **missing**:

- `apps/mobile/development.auth.local.json`
- `apps/mobile/development.api.local.json`

They were not copied from another worktree or created by Codex. Without them,
live authentication/API work fails closed. Checks/exports force verification
mode and do not open actual local settings.

Prepare settings privately in PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-story-continue\apps\mobile'
if (-not (Test-Path -LiteralPath '.\development.auth.local.json')) {
  Copy-Item -LiteralPath '.\development.auth.example.json' -Destination '.\development.auth.local.json'
}
if (-not (Test-Path -LiteralPath '.\development.api.local.json')) {
  Copy-Item -LiteralPath '.\development.api.example.json' -Destination '.\development.api.local.json'
}
notepad .\development.auth.local.json
notepad .\development.api.local.json
```

Auth must use exactly `supabaseUrl` =
`https://edbkuunyeyxnyenmmqud.supabase.co` and `publishableKey` = the privately
approved development client key. The API file has only `baseUrl`, set to the
currently approved private-LAN root of the existing development backend, without
`/api/v1`. No LAN address is inferred, hardcoded or copied automatically. Retain
the proven development setup; if the current address is uncertain, ask Charan
before making a request. Do not use root/web `.env`, `EXPO_PUBLIC_*` injection,
service-role keys, provider keys, passwords or session tokens as configuration.

Keep the existing verified Day 8 backend running separately. This task does not
install/start/update it, run migrations or change its AI/transcription flags.
Do not introduce firewall changes or tunnels. HTTP is appropriate only on the
separately approved personally controlled development network; it is not secure
production transport. No new development or production URL is provisioned.

## Exact iPhone acceptance — authorized fictional data only

In the mobile directory above, start only normal Expo:

```powershell
npm start
```

Expect **MEMY NORMAL APP** and scan its new QR. Do not use `preview:stories` or an
old Expo Go recent item. If switching modes, stop only that worktree's terminal
with Ctrl+C and close Expo Go without deleting preferences or secure sessions.

1. Log in with the existing confirmed development account. Open an owned English
   fictional project through My Stories. Check the fresh story details.
2. Select **Start / Continue Conversation**. Expect a loading announcement, then
   the story title, English conversation language and confirmed session-ready
   message. A new session says it was started; an existing one says it was opened.
   No transcript, microphone, fabricated AI response or generated biography appears.
3. Tap Back to My Story, then Start / Continue again. Expect the existing session
   message. Repeat quick taps; only one landing operation should remain active.
4. Return to My Stories, open the same story and continue again. Close Expo Go
   without signing out/clearing data, reopen the normal QR, and repeat. The server
   session should persist; the app must not announce a new session on each visit.
5. Repeat for an owned Swedish fictional project. Change the UI language too:
   controls follow EN/SV preference, while conversation language stays equal to
   the language saved with that project.
6. Sign Out from the landing/loading screen. Private content disappears and
   Welcome returns. Log in again and continue the same project. Do not create
   new accounts, send emails or alter token lifetimes for this test.
7. Optional controlled network interruption after the bundle has loaded: if
   opening cannot be confirmed, expect a safe error, not a ready/new-session
   claim. Restore connectivity and tap Try again once; reconciliation must find
   any session already created. Do not rapidly toggle connectivity or rerun POSTs
   through a separate tool.

Visible navigation alone cannot prove the exact session UUID or cross-user RLS.
Ask Charan to compare the selected fictional project's session IDs/counts through
approved read-only backend checks before/after repeated starts and reopening.
Use a second existing authorized account only when separately arranged: it must
not list/open the first account's project/session. Do not copy UUIDs/tokens into
public reports or paste credentials/network dumps into chat. Report only safe
status/path templates and redacted reproduction steps.

USER-REPORTED baseline: project listing, refresh, creation, details and editing
already passed on iPhone in EN/SV before this task. This is not evidence that the
new start/resume flow passed. New iPhone/session acceptance remains **pending**.

## Verification and release limits

Automated tests use fictional values, mocked Auth/API transport and blocked
network defaults. They do not contact Supabase, FastAPI or AI providers. Exact
commands, counts and failure/correction logs accompany the independent-review ZIP.
TypeScript/lint/config/export checks do not prove native device behavior.

Independent review, new iPhone acceptance, backend RPC deployment/concurrency,
real session identity persistence and cross-account cloud isolation remain
unverified. No production readiness, commit, push, merge or deployment is claimed.
