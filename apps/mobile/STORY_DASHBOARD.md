# Mobile Task 3A — My Stories (development only)

Branch: feat/mobile-story-dashboard. Verified base:
630abac0fd9e71c0f2052db81ce351db6de10beb, the committed Task 2C registration
feature and local origin/feat/mobile-auth-registration reference. No fetch or
cloud verification was needed to establish that local relationship.

## Implemented scope

Language → Introduction/Welcome → intentional Log In → **My Stories**.
Returning verified sessions reach My Stories after the existing Auth verification.
The page uses the existing Memy palette/wordmark, scalable native text, safe areas,
56-unit controls, readable story cards, and English/Swedish translations.
Refresh clears old rows and replaces the first page; it never appends duplicates.
There are no create/edit/delete/detail actions, new database operations, AI, voice,
microphone or Guest features. Registration remains gated exactly as in Task 2C.

The available backend reference was inspected read-only in the existing web
registration worktree: backend/README.md, docs/frontend-integration.md,
app/schemas/story_projects.py, app/api/story_projects.py and
app/services/resources.py. The reviewed web typed API client was also inspected.
Those files are not present on this mobile branch; no backend files were copied.
The available handoff describes backend 0.2.0, dated 17 October 2026. We did not
check a live server or fetch a newer backend version.

The exact request is GET /api/v1/story-projects?limit=50&offset=0 with
Authorization: Bearer (current verified user's access token). The plain-array
response contains id, title, description, language, status, created_at and
updated_at. The client validates these fields, strips unrelated fields, rejects
duplicate IDs/malformed responses and preserves server order. The backend
reference orders by created_at.desc,id.desc. No book metadata is invented.
The only established project status localized here is draft; unfamiliar statuses
show a generic label, rather than raw server text or a session status assumption.
Only the first 50 projects are supported; further pagination is out of scope.

## Safety and configuration

**No approved backend address is available. The API is left unconfigured.**
No real login or project request was made during implementation. Tests inject
fake transports; global application network access is blocked in the test setup.
The app does not contain a demo login, bypass verification or fabricate saved
projects for a real account. With missing API settings, verified users see a
helpful setup message and Sign Out; no token is requested and no GET occurs.

Existing development.auth.local.json is still the only supported auth file.
It must be configured by the developer with Charan's approved publishable client
key and the fixed URL https://edbkuunyeyxnyenmmqud.supabase.co. This worktree
does not automatically copy that ignored file from another worktree. Use the
credential-free development.auth.example.json if a new file is needed; never copy
the root/web .env or put service-role/provider/session/password values in settings.

API settings are separate: development.api.local.json, ignored by Git. The
credential-free example has an empty baseUrl. It accepts only one field, baseUrl,
and only an explicit private LAN IPv4 HTTP(S) origin, optionally ending /api/v1.
No URL is inferred. Public/DNS/loopback/link-local addresses, credentials,
query/fragment/other paths and ambiguous IP spellings fail closed. A hosted
development backend will require a separately reviewed configuration change.
Private IP validation is a destination restriction, not proof of server identity;
Charan must approve the actual machine/address. Never point it at a legacy proxy.

Both settings are read only for interactive protected start/android commands.
Tests, config inspection, dependency checks and exports force verification mode
and do not open either local settings file. General Expo dotenv/public-variable
loading remains disabled; inherited EXPO_PUBLIC variables remain stripped.
Release exports do not enable auth or the API. No package or lockfile changed.

The token accessor returns only a current, unexpired, foreground session already
verified with getUser against the approved development Auth project. Tokens are
not React state, rendered values, logs or API settings. The GET has no apikey,
service-role credential, cookie or client-supplied owner ID. Ownership remains
the backend's responsibility through token verification and RLS.

Requests have a 10-second deadline covering token acquisition, fetch and body
read, plus cancellation. No automatic retry occurs. Status 401 requires sign-out
and normal sign-in; 403/404/422/503 and network failures use local safe messages.
Raw error bodies are never rendered. Backgrounding, auth revalidation, sign-out,
route unmount or account changes hide/drop rows and cancel work. Owner fencing
also ignores late completions from transports that do not obey cancellation.
There is no persistent project cache. Abort cannot undo an already received GET;
this feature adds no writes.

## Windows and iPhone checks now (no backend)

No server was started by Codex. Existing installed dependencies were reused only
after the mobile package-lock hashes matched; nothing was installed or upgraded.

~~~powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-story-dashboard\apps\mobile'
Get-NetTCPConnection -State Listen -LocalPort 8085 -ErrorAction SilentlyContinue
npm start -- --port 8085 --clear
~~~

Run the read-only port check first. If it reports another listener, choose an
unused port instead of stopping that process. Keep existing projects untouched.
Scan this terminal's new QR code in Expo Go on the same trusted Wi-Fi.
Stop only this preview with Ctrl+C. Do not use tunnels or change firewall rules.

Without local auth configuration, Login should show the existing configuration
message. Do not add real credentials just to view fake projects. With a separately
approved existing development account/configuration, normal login can be tested
manually: expect My Stories and the setup message while the API URL is absent.
Sign Out must return to Welcome. Onboarding, Replay, both languages and locally
gated Check details registration should remain available. No email is sent by
Check details; do not enable live signup or confirmation.

## Later: approve the real address before enabling a GET

These instructions are deferred until Charan supplies the approved backend
checkout, existing Python environment, development publishable key and private
PC LAN IPv4 address. Do not invent an address or reuse localhost on an iPhone.
An Android emulator is not the physical-phone target of this configuration.
Do not install dependencies automatically if the backend environment is absent.

From the mobile directory, only after approval:

~~~powershell
if (-not (Test-Path -LiteralPath '.\development.api.local.json')) {
  Copy-Item -LiteralPath '.\development.api.example.json' -Destination '.\development.api.local.json'
}
notepad .\development.api.local.json
~~~

Set baseUrl to the exact approved private LAN origin and port (or that origin
with /api/v1). Do not put credentials, tokens or a guessed/production URL in it.
Restart this worktree's Expo terminal after changing config. The prefix is added
exactly once by the client. Nothing is enabled by the empty example.

## Later: safely starting Charan's backend

The mobile branch has no backend directory. Use the separate **Charan-approved
backend checkout**, never another web worktree or the legacy root launcher.
Have Charan verify the available settings code still matches the reference above.
That reference normally reads both the root and backend .env and has legacy
VITE_SUPABASE fallbacks. The following runtime-only launch disables dotenv reads
before importing the app and supplies explicit approved development values.
It does not modify backend files or run migrations. Do not run it yet.

~~~powershell
$memyBackendDirectory = Read-Host 'Full path of the Charan-approved backend folder'
Set-Location -LiteralPath $memyBackendDirectory
if (-not (Test-Path -LiteralPath '.\app\core\config.py')) { throw 'Check the approved backend folder.' }
if (-not (Test-Path -LiteralPath '.\.venv\Scripts\python.exe')) { throw 'Ask Charan to prepare the backend environment.' }
$memyBackendIp = Read-Host 'Charan-approved PC private LAN IPv4 address'
if ($memyBackendIp -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -or
    $memyBackendIp -notin (Get-NetIPAddress -AddressFamily IPv4).IPAddress) { throw 'Use an approved address on this PC.' }
if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { throw 'Port 8000 is occupied; do not stop another project.' }
$memyDevelopmentKey = Read-Host 'Approved DEVELOPMENT publishable client key (sb_publishable_)'
if ($memyDevelopmentKey -notmatch '^sb_publishable_[A-Za-z0-9_-]{20,200}$') { throw 'Use only the approved development publishable key.' }
$env:SUPABASE_URL = 'https://edbkuunyeyxnyenmmqud.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = $memyDevelopmentKey
$env:MEMY_BACKEND_BIND_ADDRESS = $memyBackendIp
try {
  $memyBackendLaunch = @'
from app.core.config import Settings
Settings.model_config["env_file"] = None
from app.main import app
import os
import uvicorn
if str(app.state.settings.supabase_url).rstrip("/") != "https://edbkuunyeyxnyenmmqud.supabase.co":
    raise SystemExit("The approved development project is required.")
uvicorn.run(app, host=os.environ["MEMY_BACKEND_BIND_ADDRESS"], port=8000)
'@
  $memyBackendLaunch | & .\.venv\Scripts\python.exe -
} finally {
  Remove-Item Env:\SUPABASE_URL, Env:\SUPABASE_PUBLISHABLE_KEY, Env:\MEMY_BACKEND_BIND_ADDRESS -ErrorAction SilentlyContinue
  $memyDevelopmentKey = $null
}
~~~

Use a fresh PowerShell window for this deferred backend step so existing shell
configuration is not overwritten. The selected private address is the only bind
address; this does not listen on all interfaces, create a tunnel or alter firewall
rules. If Windows/network/iOS blocks access, stop and report it. No broad security
exceptions are added. Plain HTTP exposes a development bearer token to observers
on that LAN: use only a trusted private network and disposable development account.
Do not reuse this transport/configuration for production or public Wi-Fi.

After both approved services are running, sign in normally on iPhone. Confirm
the dashboard displays Charan's existing projects for that account and correct
English/Swedish labels; refresh must replace, not duplicate. The backend access
log should show only GET /api/v1/story-projects?limit=50&offset=0 returning 200.
Do not print/copy Authorization headers or paste tokens into curl, screenshots or
chat. Confirm project IDs/ownership with Charan through an approved procedure.
One account's successful list does not establish cross-user cloud isolation.

Try offline refresh only after the bundle is loaded: old rows must disappear and
a clear error/timeout appear; reconnect and refresh. Test Sign Out while loading,
background/foreground revalidation, valid session restoration and language/layout
regressions. With a second approved test account, Sign Out first, sign in normally,
and confirm no old rows appear even briefly. Do not create/edit/delete data here.
Live RLS, two-account isolation, server policy and iPhone transport remain pending.

## Verification limitations

Jest exercises actual client/controller/routes with mocked auth/transports and
synthetic projects; it is not live FastAPI/Supabase verification. Expo exports are
JS compilation, not device/native/network testing. VoiceOver/TalkBack, enlarged
text, long titles, small screens and actual LAN reachability require manual review.
The existing Expo Go QR/resume Login limitation remains documented from Task 2B;
do not clear legitimate sessions/preferences to force navigation.
Self-review does not replace independent review or authorize a commit/deployment.
