# Tarun — Day 14 iPhone rehearsal

Prepared for a later authorized device run; **all 12 cases are pending**.
Use fictional stories only. This checklist does not approve a personal-data pilot.

## 1. Use the reviewed pair and trusted transport

- Backend: `codex/day-7-mobile-integration`, runtime baseline
  `c67687ec4b392dbf0e4f73fc8451ac6f0da05560` (FastAPI 0.8.1).
- Native app: `feat/mobile-autobiography-continuation` at
  `1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e`, `apps/mobile/`.
- Keep the two checkouts separate. Later backend docs/tooling commits may be
  present; record actual SHAs. Any later mobile/runtime change needs a new
  reviewed evidence pin, not a manually invented success label.
- Use a trusted personal hotspot/private LAN, not shared student-housing Wi-Fi.
  Plain HTTP still carries an unencrypted Bearer token. No public tunnel,
  port-forwarding, firewall disabling or production environment.
- The current mobile URL guard accepts a private RFC1918 IPv4 origin, not a new
  HTTPS DNS host. New shared staging requires separately reviewed configuration.

Follow the [Windows/Expo quickstart](backend-mobile-quickstart.md) for Python
3.13, dependencies and the two ignored mobile JSON configuration files. Do not
copy the backend `.env`, passwords or service-role/OpenAI keys into Expo. From
the configured backend checkout in PowerShell:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\diagnose_supabase.py
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
```

Use the Windows machine's current approved LAN IP in
`apps/mobile/development.api.local.json`; leave the auth project at
`https://edbkuunyeyxnyenmmqud.supabase.co` with its client-safe publishable key.
Check `/health` and `/ready` on both Windows and iPhone Safari before signing in.
Restart the correct Metro app after configuration changes, as in the quickstart.
These probes alone are not authenticated acceptance.

The launcher enables only fixed simulated transcription, mock conversation and
mock story writing. No speech is interpreted and no paid provider is called.
Never present the fixture transcript as transcription accuracy evidence.

## 2. Record the twelve mandatory cases

Use one authorized development account; the cross-user case needs a second
existing authorized account. Do not share credentials or change Auth settings.
For EN and SV, retain the selected project language even if a recording contains
another language. Repeat the content journey in both languages; use Å/Ä/Ö in
fictional titles/manual edits when checking the Swedish PDF.

| Evidence case | Observe on the actual iPhone before marking pass |
| --- | --- |
| `supabase-login` | Real development login succeeds; no publishable key is used as an API user Bearer token. |
| `create-project-dashboard` | Explicit create appears once in dashboard; reopen and confirm saved title/language. Start/Continue uses the returned session and repeated actions do not create duplicate active sessions. |
| `real-m4a-upload` | Grant microphone access and record a short fictional memory; actual valid M4A bytes upload to the correct session after explicit consent. Check denied permission, cancel and background/foreground recovery separately. |
| `labelled-simulated-transcript` | Permanent fictional/simulation notice is visible; saved original is separate from assistant replies and editable memory corrections. No claim that the words were recognized. |
| `confirm-correct-memory` | Confirm one supported fact, correct another and reject one; reread preserves selected statuses/correction and original evidence. Pending/rejected facts do not silently become confirmed. |
| `explicit-autobiography-generation` | No generation before explicit action; user-approved confirmed context produces a labelled mock draft. Refresh/Continue does not silently generate another version. |
| `edit-new-revision` | Manual edit saves a new revision marked for review; history keeps earlier wording. Stale edit produces a controlled conflict, not silent overwrite. |
| `open-pdf-on-iphone` | A real PDF opens with the selected saved revision/title, readable Swedish glyphs/pagination; historical export remains available after editing. Test the actual share sheet/return, not just an HTTP 200. |
| `continue-preserves-revisions` | Continue reuses the active session, restores context, preserves earlier edits/export and reports no automatic generation; new confirmed context needs a new explicit generation. |
| `signout-signin-restores-data` | Sign out hides prior user data; sign back in restores only that user's resources. Check background/session-expiry UX and native PDF cache/account-switch behavior. |
| `cross-user-access-denied` | With a second authorized account, User A's project/session/source/memory/draft/export cannot be read or modified. No private content appears in UI/logs. Missing/foreign resource behavior must not leak ownership. |
| `network-interruption-recovery` | Interrupt network during read/upload/save and restore it. UI gives controlled feedback; reconcile uncertain saves before explicit retry. Same logical upload/turn/generation reuses its original key and payload; no duplicate source/revision/session. |

Also inspect VoiceOver focus and announcements, largest text settings/clipping,
button reachability, visible loading/error states, microphone indicator/cleanup,
return from PDF share and expired-session recovery. Source inspection and
backend tests cannot certify native accessibility or OS lifecycle behavior.
An iPhone pass is not an Android pass.

## 3. Frontend follow-up discovered in source review

At the reviewed native commit, unknown 429/503 safely become generic errors but
explicit backoff is not implemented. Add reviewed handling for:

- `429 RATE_LIMITED`, `Retry-After:60`;
- `503 API_BUSY`, `Retry-After:1`, plus safe non-JSON outer-server 503 handling.

Parse only a bounded delay, use localized feedback and disable manual retry
until the deadline. Preserve captured versions, payloads and original keys.
Do not add automatic POST/PATCH retries. Creation and export-audit operations
are not universally idempotent: after an uncertain result, reread/reconcile
first. Backend CORS now exposes `Retry-After` for approved browser origins;
native clients still need their own parsing/UX. See the
[source review](day-14-mobile-code-review.md) for exact files and boundaries.

## 4. Share content-free results

Copy [the pending template](fixtures/day14-device-evidence.example.json) to a
local report and change only case status (`pending`, `pass`, `fail`) and the
three factual attestations after actually observing the run. No tokens,
passwords, emails, story prose, screenshots, LAN IPs or cache paths in the JSON.

From the backend directory on Windows:

```powershell
.\.venv\Scripts\python.exe scripts\validate_day14_evidence.py
.\.venv\Scripts\python.exe scripts\validate_day14_evidence.py '<LOCAL_REPORT_PATH>'
```

Default result is `PENDING` (12 pending cases). Exit 0 only means structurally
valid input, **not acceptance passed**. A fully completed file is only
`SELF_REPORTED_COMPLETE`, never independently verified or pilot approved.
Send the sanitized summary and actual revision IDs; discuss failed stages
without private content. Keep hosted two-issued-user JWT testing separately
labelled pending until it has actually run.

Stop the backend/Metro after the run. Do not delete hosted data or accounts as
part of this checklist; any cleanup needs exact, separately authorized targets.
