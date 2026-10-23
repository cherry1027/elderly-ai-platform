# Memy backend handoff for mobile integration

Use this setup to connect Tarun's Expo app to backend 0.8.1 without public hosting or
paid AI. The backend code and API contract are on
[`codex/day-7-mobile-integration`](https://github.com/cherry1027/elderly-ai-platform/tree/codex/day-7-mobile-integration).
The Day 10 runtime patch is `a00df98` (0.8.1). Paths and schemas remain compatible
with the earlier `8375ada`/`73094c7` baselines; stale implicit memory confirmation
is now rejected with the documented 409. The [full integration guide](frontend-integration.md) contains
all 25 operations, request/response examples and error handling.

The initial reported integration pair is backend `374b1dd` on
`codex/day-7-mobile-integration` and mobile
`59762f2f8413b7f328421fb158489594511a1e06` on
[`feat/mobile-story-details`](https://github.com/cherry1027/elderly-ai-platform/tree/59762f2f8413b7f328421fb158489594511a1e06/apps/mobile).
Record the actual commit IDs again after any update; branch names can advance.
The mobile configuration below was checked against that exact mobile source,
not inferred from a generic Expo environment-variable convention.

The later reviewed mobile revision is `ed05ebd` on `feat/mobile-story-continue`;
it adds native Start/Continue but no recorder/upload/conversation messages. Day 9
keeps the API paths compatible and adds explicit `--simulate-transcription` to
the backend launcher. Use the [Day 9 audio guide](day-9-mobile-audio.md) for that
opt-in; it does not enable real speech recognition or microphone access itself.

Those are historical checkpoints. Tarun's latest reported mobile branch is
`feat/mobile-draft-editor` at `eb4eaa8`, including recording, simulated conversation,
memory review and draft editing. See the [current consolidated handoff](mobile-backend-handoff.md)
and [Day 10 acceptance](day-10-status.md); the full iPhone workflow was not rerun
by this backend audit. Restart the backend after updating and check version
0.8.1 at `/openapi.json`, not an invented version field on `/health`.

This handoff requires an iPhone and a Windows backend on the same **trusted,
privately controlled network**. The old Mac address `192.168.0.21` is stale;
its latest observed address was `192.168.110.103`, not a remotely hosted API.
Tarun must use his own Windows host's current address. There is no shared public
HTTPS endpoint. Use fictional development
data only; LAN HTTP does not encrypt the Bearer token.

**Current network gate:** Tarun reports that the backend diagnostic returned
`result=OK`/`head_status=200`, and that both `/health` and `/ready` opened on his
iPhone with the pair above. These are user-reported public-probe results, not an
authenticated mobile acceptance test. The reported shared `BTHWiFi` network is
not approved for HTTP Bearer-token traffic. Do not start authenticated project
requests there. The agreed test option is a trusted personal hotspot/private
network; moving the devices and retesting still needs Tarun's confirmation.
A future shared connection needs a separately reviewed HTTPS setup; an HTTPS DNS
origin is not currently accepted by
this mobile client's LAN-only URL policy. Recheck the Windows IP and both phone
probes after changing networks. Do not weaken firewall, transport or URL guards.

## Start the backend on Windows

Keep the backend checkout separate from Tarun's Expo project. These PowerShell
commands create a new directory; they do not reset or overwrite an existing
frontend branch. If `memy-backend-demo` already exists, use a different new name
or inspect that checkout before updating it.

```powershell
git clone --branch codex/day-7-mobile-integration https://github.com/cherry1027/elderly-ai-platform.git memy-backend-demo
cd memy-backend-demo\backend
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=av -r requirements-dev.txt

$env:SUPABASE_URL = "https://edbkuunyeyxnyenmmqud.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "<development-publishable-key-shared-privately>"
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan
```

Replace the publishable-key placeholder with the client-safe development key
provided by Charan. The verified runtime is Python 3.13; if `py -3.13` is absent,
install/select that runtime before continuing. No virtual-environment activation
or PowerShell execution-policy change is needed. Keep this terminal running.

The launcher pins `edbkuunyeyxnyenmmqud`, enables mock conversation/story writing,
leaves live transcription disabled and suppresses access logs. It refuses an
unconfigured or different Supabase project. It does not read or require an
OpenAI key, database password or service-role key.

In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/ready
ipconfig
```

Both probes should return status `ok`; readiness also returns database `ok`.
Find the IPv4 address of the active Wi-Fi/Ethernet adapter, not a disconnected
adapter or VPN. If Windows asks for Python network access, restrict it to the
trusted Private network; do not disable the firewall or allow Public networks.

From iPhone Safari on the same network, open:

```text
http://<WINDOWS_LAN_IP>:8000/health
http://<WINDOWS_LAN_IP>:8000/ready
```

Replace `<WINDOWS_LAN_IP>`, including the brackets. `localhost`, `127.0.0.1` and
`0.0.0.0` are not the Windows server address from an iPhone. If Safari cannot
reach these URLs, solve network isolation/firewall/VPN routing before debugging
the mobile API client. Do not port-forward, publish an unauthenticated tunnel or
broadly disable iOS transport security. Shared/remote access needs a separately
approved HTTPS deployment. Stop the backend with Ctrl+C when testing ends.

## Diagnose a readiness 503 or Supabase 401

On 20 October, the current publishable key was compared with the exact
`edbkuunyeyxnyenmmqud` Dashboard API Keys page. The same zero-row profiles HEAD
probe returned 200, and the real FastAPI `/ready` route returned 200 against
hosted Supabase with conversation, story generation and transcription disabled.
No key rotation, database grant, RLS policy or production-setting change was
needed. A failure on another computer still needs that computer's configuration
checked; these results do not establish its cause remotely.

Update the clean backend checkout on `codex/day-7-mobile-integration` without
resetting local work. From `backend/`, run:

```powershell
.\.venv\Scripts\python.exe scripts\diagnose_supabase.py
```

Expected safe output includes:

```text
configured_project=edbkuunyeyxnyenmmqud
key_outer_whitespace=false
key_sha256_12=7dbc1add8497
head_status=200
result=OK
```

The helper prints a comparison fingerprint, not the key, password, token,
response body or arbitrary exception text. It sends only read-only requests to
the pinned development project and refuses secret/service-role or legacy JWT
keys. It does not sign in, modify users or call an AI provider. It uses the same
configured header as readiness rather than silently repairing whitespace.

If the fingerprint differs, recopy the current development **publishable** key
from the exact project's Dashboard and check for copied quotes, line breaks,
outer spaces or placeholder text. A differing key can also be a separately
created valid key, so the fingerprint alone is not proof of rejection; use the
HTTP result as well. Do not send the raw key or tokens in a diagnostic report.

Backend-process `SUPABASE_*` and `VITE_SUPABASE_*` environment variables take precedence
over dotenv files. Within the same source, `SUPABASE_*` wins over the Vite alias.
`backend/.env` takes precedence over the legacy root `.env`. `EXPO_PUBLIC_*` is
not read by backend Settings and is deliberately stripped by Tarun's current
mobile launcher; it configures neither side of this integration. Editing a file
or a different terminal does not replace configuration already loaded by FastAPI.

Stop the existing backend with Ctrl+C. In the **same PowerShell terminal** that
will restart it, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as in the setup
above, using the verified key shared privately. Run the diagnostic there, then
restart the launcher and retest `/ready`. Do not change RLS, grant anonymous data
access, use a secret key or substitute the publishable key for a user's JWT.

The optional GET classification after HEAD 401 still uses `select=id&limit=0`.
Known results such as `INVALID_API_KEY`, `API_KEY_MISSING`, `42501` or `PGRST301`
help distinguish gateway/permission/token problems. `HEAD_REJECTED_GET_OK`
means the two methods behaved differently, not that the key was invalid.
Unclassified/dependency/network errors stay generic. If the expected fingerprint
still gets 401, send only the helper output, backend commit ID and whether proxy
or VPN routing is involved; do not bypass network protections automatically.

Supabase Dashboard organization membership and application Auth accounts are
separate. A Dashboard invitation gives management access after acceptance; it is
not required to call this API with a valid project key/user session and does not
fix an invalid key. The existing profiles probe checks Data API/key/relation
reachability without fetching records; it does not certify authenticated RLS.
See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
and [Dashboard access control](https://supabase.com/docs/guides/platform/access-control).

## Configure the separate Expo app

Keep the backend and Expo checkouts separate: they communicate over HTTP; a Git
merge is not needed to connect them. Do not switch the backend checkout to the
mobile branch, overwrite Tarun's work, or run this checkout's legacy React/Vite
client as a substitute for his Expo application.

The verified mobile launcher (`apps/mobile/scripts/run.cjs` at `59762f2`) disables
dotenv loading and removes inherited `EXPO_PUBLIC_*` variables. **Do not create
an Expo `.env` or use the previously suggested `EXPO_PUBLIC_API_BASE_URL` variables
for this branch.** Its supported settings are two ignored, mobile-local JSON
files. They contain client-public configuration only, never account credentials.

From Tarun's **mobile checkout** in PowerShell:

```powershell
Set-Location -LiteralPath '<YOUR_MOBILE_CHECKOUT>\apps\mobile'
if (-not (Test-Path -LiteralPath '.\development.auth.local.json')) {
  Copy-Item -LiteralPath '.\development.auth.example.json' -Destination '.\development.auth.local.json'
}
if (-not (Test-Path -LiteralPath '.\development.api.local.json')) {
  Copy-Item -LiteralPath '.\development.api.example.json' -Destination '.\development.api.local.json'
}
notepad .\development.auth.local.json
notepad .\development.api.local.json
```

Replace the checkout-path placeholder with the existing mobile checkout's path.
The conditional copies preserve any existing local files. In
`development.auth.local.json`, use exactly these two fields:

```json
{
  "supabaseUrl": "https://edbkuunyeyxnyenmmqud.supabase.co",
  "publishableKey": "<development-publishable-key-shared-privately>"
}
```

In `development.api.local.json`, use exactly one field, after the trusted-network
gate above is satisfied:

```json
{
  "baseUrl": "http://<WINDOWS_LAN_IP>:8000"
}
```

Replace the key and IP placeholders. The IP must be the approved Windows machine's
current private LAN IPv4 address, not the Mac, phone, loopback or an invented
address. The client accepts a root origin or optional `/api/v1`, normalizes to the
origin and appends `/api/v1` exactly once. Use the root form above. Public/DNS
origins, other paths, credentials, queries, fragments and additional JSON fields
are rejected. A future HTTPS hostname needs reviewed mobile support, not removal
of these checks.

Save both local files, then stop only this mobile checkout's existing Metro
terminal with Ctrl+C. Fully close Expo Go without clearing its data and run:

```powershell
npm start
```

Confirm the terminal says `MEMY NORMAL APP`, wait for its **new** QR code and scan
that code. The protected launcher chooses an unused port and clears Metro's bundle
cache; this is not deletion of saved preferences or secure sessions. An old QR can
open another running experience. Do not use `npm run preview:stories` for live
integration: that isolated, labelled sample mode disables Auth/API operations and
cannot save data. Verification/config/export commands also intentionally disable
Auth/API and do not read the local files; they are not a live-startup check.

Reuse the mobile app's existing verified Auth provider and
`getAccessToken(expectedUserId)` accessor. The existing project transport obtains
that current account's token and sends `Authorization: Bearer <access-token>`;
it does not send an `apikey` or a client-supplied owner ID to FastAPI. Do not add
a second SDK client, bypass the accessor with an unverified stored session, or
replace Tarun's foreground/refresh/sign-out safeguards.

Never use the publishable key as the user's Bearer token. Never share the
backend `.env`, passwords, refresh/access tokens, secret/service-role keys or
provider keys. Clear user-specific cached state on sign-out. Refresh an expired
session through the SDK rather than substituting another user's credentials.
Normal existing-user login does not depend on activating native registration;
the mobile registration provider remains deliberately gated off at `59762f2`.

## Use the existing account and fictional data

On 20 October, the existing authorised development account was checked directly:
its email is confirmed, a password is configured, and it is not banned. Account
details are shared privately; use the password its owner already set. No password
was read, reset or sent, and no new invitation/recovery email is needed for this
handoff. Successful password login still needs to be confirmed by the account
owner in the actual app.

Two owned fictional dashboard projects already exist:

- `Fictional Childhood - Dashboard Test` (`en`).
- `Minnen fran Malmo - Testprojekt` (`sv`).

They are dashboard fixtures, not completed biographies; neither had a session
when checked. No existing project, user, password or auth configuration was
changed. Use a fresh clearly named fictional project for the complete workflow,
or keep those two dashboard fixtures intact until the team agrees otherwise.

[`fixtures/investor-demo.json`](fixtures/investor-demo.json) supplies English and
Swedish project/message examples recognised by the deterministic mock provider.
These examples are local data, not automatically inserted into Supabase or the
mobile UI. Submit the messages with the normal authenticated APIs, review the
returned pending facts, and explicitly request generation. Do not use real
family histories or imply the fictional profile represents a real person.

Send the scenario's `project` object to the project API. For each message send
only `{"text": message.text, "language": scenario.project.language}` with a fresh
UUID action key. `expected_fact`, `fictional` and the other fixture labels are
QA/display metadata, not accepted API fields. Use returned project/session/fact
IDs; never invent or hard-code another user's IDs.

## First integration acceptance

Record the frontend and backend Git commit IDs and the actual API root used.
Record the network type without sharing its password. Tarun reports successful
login, public probes and Start/Continue testing at `ed05ebd`. The 21 October
read-only database check found two owned projects and two sessions, one per
language, with no duplicates. This does not prove recording/upload or replace
device evidence for the entire create-to-dashboard flow. On the trusted network,
use this acceptance sequence after updating either checkout:

1. `/health` and `/ready` are reachable. The backend version in `/openapi.json`
   is 0.8.1; Swagger is at `/docs`.
2. The existing account signs in through the development Supabase project.
3. A project-list request without a Bearer token is rejected with 401; the
   signed-in request returns 200 and owned projects only.
4. Create a fictional project, list/retrieve it, rename it and verify the selected
   `en`/`sv` language is preserved. The pinned mobile branch implements these
   project operations, including title/description editing; record each real
   server response and the visible result without capturing tokens or private data.
5. Start/Resume is implemented in `ed05ebd`: the client lists owned sessions and
   reuses an active ID, otherwise calls
   `POST /api/v1/story-projects/{project_id}/continue` with `{}`. It atomically
   returns an existing active session or creates one without generating a draft.
   Reuse the returned `session.id`; repeated direct session POSTs create separate
   sessions. Tarun reports this step passed on iPhone.

At the historical `59762f2`/`ed05ebd` mobile checkpoints, the following was later
integration work. Tarun now reports recording, conversation, memory review,
generation and draft editing implemented at `eb4eaa8`; those device results were
not independently rerun here. PDF/share integration and full workflow acceptance
remain pending, so use these as acceptance steps rather than a current UI gap list:

6. Follow the [Day 9 audio guide](day-9-mobile-audio.md) for explicitly simulated
   native uploads and source-linked messages. Confirm/review sourced facts, then tap
   Create My Story. Save a manual edit and show that it needs review.
7. Download the saved revision's PDF privately. Continue, add the continuation
   fixture message, confirm its memory and explicitly generate version two.
   The older edited draft and PDF must still be available.

For each audio/message/generation action, retain one UUID Idempotency-Key and
the same payload across uncertain retries. Project/session creation does not
have this protection: list/reconcile instead of blindly repeating a POST. Check
status and Content-Type before parsing responses; successful PDF routes return
binary data and server/proxy overload can return non-JSON errors.

Label the assistant/story as an **AI simulation**. Normal audio uploads do not
transcribe speech; default valid owned uploads return `503 TRANSCRIPTION_DISABLED`.
Day 9's explicit simulation flag instead returns permanently labelled fictional
fixtures after validation; see its audio guide before wiring that flow. The
complete Expo workflow and native email-confirmation callback remain separate
acceptance work; existing-user login does not require finishing registration.

Keep created fictional project UUIDs in the private test notes. There is no
public project-delete API; `verify_day7.py --cleanup` removes only its own run's
projects, not arbitrary mobile-created data. Arrange narrowly scoped cleanup
with the backend developer when needed.

## Report an integration problem

Send the backend developer the frontend/backend commit IDs, screen/action,
request method and path template, HTTP status, safe `error.code` if present,
expected result and reproduction steps. Say whether `/health` and `/ready` work
from the phone. Never send passwords, tokens, full callback URLs, private story
bodies or an unredacted network dump. This separates routing/authentication
problems from API contract or UI issues without leaking user information.
