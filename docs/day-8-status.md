# Day 8 mobile backend integration status

20 October 2026. The existing mobile project APIs match backend 0.7.0. The
configuration handoff is corrected, and the team has selected a trusted private
network for device testing. **Day 8 is not fully accepted until the authenticated
iPhone workflow succeeds.** No paid provider, new database migration, production
configuration change or merge to `main` is required for the current project flow.

## Reviewed source and configuration

- Backend baseline: `codex/day-7-mobile-integration` at `374b1dd`.
- Actual Expo source: `feat/mobile-story-details` at
  `59762f2f8413b7f328421fb158489594511a1e06`, under `apps/mobile/`.
- Development Supabase: `https://edbkuunyeyxnyenmmqud.supabase.co`.
- The mobile launcher reads ignored `development.auth.local.json` and
  `development.api.local.json` files. It deliberately ignores `EXPO_PUBLIC_*`.
  Use the [corrected Windows and iPhone quickstart](backend-mobile-quickstart.md).
- Separate backend and mobile checkouts communicate over HTTP; neither a merge
  nor replacing the existing mobile UI is necessary for integration.

The reviewed native app implements project list, creation, detail retrieval and
title/description editing. Its request bodies, response parsing, Bearer header
and immutable project language match the current FastAPI contract. Its dashboard
currently loads only the first 50 projects, and concurrent edits are last-write-wins.

## Checklist and acceptance

| Duty | Current result |
| --- | --- |
| Review backend and actual mobile branches | Complete for the pinned revisions above. |
| Reachable API | Tarun reports Windows diagnostics and iPhone Safari `/health` and `/ready` passing. Repeat after switching networks. |
| Expo authentication accepted by FastAPI | Offline coverage exists; current real iPhone Bearer-token acceptance remains pending. |
| Create Story integration | Request/response contracts match; real iPhone save in Supabase remains pending. |
| Dashboard and detail retrieval | Contracts match; real owned-project display and refresh remain pending. |
| Conversation session integration | Backend routes exist. The reviewed native branch has no session screen/client yet. |
| Errors and security | Automated auth, validation, ownership and mobile cancellation/retry guards are covered. Device offline/sign-out and two-account acceptance remain pending. |
| Regression and handoff | Regression results and reproducible checks below; corrected setup and acceptance instructions are included. |

Tarun supplied a passing readiness report with key fingerprint `7dbc1add8497`
and `head_status=200`. That resolves the reported readiness blocker, but a
public health check does not prove authenticated data access. No raw key, token
or account password is part of this report.

## Safe device test

The user approved a **trusted personal hotspot/private network**, not sending
Bearer tokens over shared BTH/student-housing Wi-Fi HTTP. Tarun must move both
devices, confirm reachability, find the Windows host's new private IPv4 address
and update `development.api.local.json`. No shared HTTPS endpoint has been
deployed. The current mobile URL guard rejects DNS/public origins; do not bypass
it, disable the firewall or broadly relax iOS transport security.

Use `npm start` and the new QR code with `MEMY NORMAL APP`, not the sample preview.
Keep the existing Auth provider and account-scoped token accessor. First sign in
and load My Stories. Then create one clearly fictional English project and one
Swedish project, for example `Minnen från Malmö — Day 8 test`. Confirm each
appears once after refresh, opens correctly, retains its language after rename,
and remains available after closing/reopening the screen.

Test sign-out, unavailable backend and a second authorized account separately.
Record only commit IDs, action, status/error code, fictional project IDs and
visible outcome—never passwords, tokens or full callback URLs. Do not create
accounts, delete existing data or change Auth settings just to complete a test.

## Duplicate requests and sessions

The existing mobile create controller blocks repeated taps and concurrent
submissions. It performs no automatic write retries. An interrupted POST may
have committed, so reconcile with an authoritative list before another create.
**The backend project/session POSTs are not idempotent:** submitting the same
request twice directly creates two resources. No new idempotency guarantee or
schema change is claimed by Day 8.

For a future Start/Resume button, use the existing
`POST /api/v1/story-projects/{project_id}/continue` with `{}`. It atomically
resumes an active owned session or creates one, inherits the project language,
returns `session`, `session_created` and `generation_triggered: false`, and
does not regenerate a story. Direct `POST .../{project_id}/sessions` intentionally
creates a new session. Native conversation, memory, draft and PDF screens remain
later mobile work, not completed screens in `59762f2`.

## Verification

The final backend regression passed **660 Python tests** (31 new Day 8 checks),
with **4 opt-in live tests skipped**, and **54 PostgreSQL checks**. The read-only
development Supabase
diagnostic returned `head_status=200` and `result=OK` on this Mac as well.

The exact mobile revision was extracted into an isolated temporary directory;
its lockfile was installed without lifecycle scripts. **All 1,499 tests in 41
mobile suites**, TypeScript and lint checks passed. No local Auth/API JSON was
supplied to that test copy, and no Expo server was started.

The new cross-language check passed **17 scenarios and 15 requests** using the
actual pinned `story-projects.ts` module against the real FastAPI routes and
serialization. Auth and Data API responses are synthetic, owner-scoped HTTPX
fixtures; the injected mobile fetch bridges over process pipes. It opens no
socket, uses no real credentials and makes no Supabase or paid-provider request.
This verifies the client/backend HTTP contract, not phone networking, actual
token expiry or PostgreSQL RLS. Reproduce it from `backend/` with Node 24+:

```sh
.venv/bin/python scripts/verify_mobile_contract.py
```

On Windows, from the backend checkout:

```powershell
.\.venv\Scripts\python.exe scripts\verify_mobile_contract.py
```

The exact mobile Git object must exist locally. For a shallow/backend-only
checkout, explicitly fetch `feat/mobile-story-details` before this optional
check; the helper never fetches or switches branches itself. It verifies the
source digest before executing the self-contained module. The standard Python
suite can run without this optional Node/source prerequisite.

The four skipped live pytest cases are not relabelled as passed by offline tests.
Normal transcription and paid AI remain disabled; the existing demo launcher
offers only explicitly labelled conversation/story simulations.
