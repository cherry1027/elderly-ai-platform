# Mobile Task 3B — Create My Story

Branch: feat/mobile-create-story.
Verified clean base: 0d2bb7be6e0b6b98ddbd954167522bd91471ef27 (completed dashboard).
Only this worktree's apps/mobile files are changed. No new dependencies are needed.

## What this feature does

Verified Login → My Stories → Create My Story → title + story language.
The initial language follows the chosen interface language; English and Swedish
are the only choices. Titles are trimmed before validation/submission and must
contain 1–120 Unicode code points. An empty/overlong title is retained for correction;
the app does not silently truncate it. Keyboard Done dismisses without submitting
or clearing the title. Story language cannot be edited after creation.

### Unicode validation correction and deferred feedback issue

Boundary trimming includes JavaScript whitespace plus U+0085 and U+001C–U+001F
to match Python's additional strip characters. Titles consisting only of spaces,
invisible formatting/control characters, combining marks or blank fillers are
rejected before token acquisition or POST. This is a content-presence check,
not removal of internal characters: Swedish accents, decomposed text, internal
spacing and complete emoji/joiner sequences remain unchanged. No NFC/NFKC
normalization is applied. All code points in the trimmed title count toward 120.
The same validated title is used in the request body and success-response check.

**USER-REPORTED, unresolved:** on iPhone, tapping Create My Story with an ordinary
empty title did not produce a sufficiently visible error. Component tests proving
an alert exists do not establish keyboard/viewport visibility or VoiceOver output.
The user explicitly defers this UI correction to the first small Mobile Task 3C
subtask: clear English/Swedish errors for empty, whitespace-only and overlong
titles; keyboard-safe visibility; screen-reader accessibility; and no invalid POST.
The Unicode validation correction does not resolve that visible-feedback issue.

The form reuses Memy's native artwork, cream/forest colors, safe-area scrolling,
large text, large controls, visible focus and Swedish/English translations.
It remains inside the existing protected authenticated route rather than adding
a new public/deep-link destination. Cancel and Android hardware Back return to
My Stories. Sign Out still uses the existing secure cleanup path.

**Saving is unavailable until an approved development API address is configured.**
No actual API or authentication settings were copied into this worktree. Opening
or validating the form does not create a project. Without API configuration,
submission shows a translated service-unavailable message, obtains no token,
sends no POST and shows no success or fabricated dashboard row. There is no
demo account, auth bypass, local fake project store or user-facing mock mode.

The automated development test environment is explicitly synthetic. A successful
mocked POST does not establish a real service connection or create real data.

## Existing API contract

The mobile branch has no backend source/docs. The available backend README,
frontend-integration handoff, StoryProjectCreate/Response schemas and resource
gateway were inspected read-only in the existing web-registration reference.
That repository snapshot and Charan's user-confirmed contract establish:

- POST /api/v1/story-projects, with JSON containing only trimmed title and
  language (en or sv). Description, ownership IDs and status are not submitted.
- The existing Supabase SDK's verified current user access token is sent as
  Authorization: Bearer. No service-role/publishable API key, cookie or refresh
  token is sent to the backend. The backend derives ownership and must enforce RLS.
- Success requires HTTP 201 and the seven documented fields: id, title,
  description, language, status, created_at, updated_at. The client validates
  these, requires the requested title/language and initial draft status, and
  removes unrelated fields. It does not invent legacy book metadata.
- Both listing and creation use one shared authenticated transport with the
  same URL guard, error sanitization, deadline, response parser and cancellation.
  The list keeps its first-page limit=50/offset=0; creation has no pagination query.
  Origin and /api/v1 configuration forms never duplicate the prefix.

No backend, schema, migration, deployment or database setting was changed.
The available repository handoff is not evidence about a currently running server.

## Failure, cancellation and account safety

Duplicate native events are locked synchronously. Saving disables fields and
Create; no automatic retries occur. 401 requires Sign Out/normal sign-in. Safe
localized messages handle 403/409/422/503, malformed responses, offline errors and
timeouts without exposing upstream bodies, access tokens or credentials.

The same 10-second deadline covers token acquisition, request and response body.
Cancel, leaving the route, background/auth revalidation, account change and sign-out
abort or fence the request, discard the draft/response, and cannot display success
in a different account. No title, response project or request token is written to
AsyncStorage, SecureStore, logs or a project cache by this feature. The existing
SDK secure session store remains unchanged; it still stores authentication sessions.

Cancellation cannot undo a POST already accepted by a server. After a dispatched
network/timeout/5xx/malformed-success failure, the form explains that saving could
not be confirmed and disables another save. Return to My Stories and refresh
before considering a new explicit creation. Pending-save Cancel warns about this
too. There is no invented idempotency header: exactly-once behavior across retries,
crashes or devices needs a separately agreed server idempotency contract.

Confirmed success is displayed only after a valid 201. Returning to My Stories
always remounts the dashboard and, when configured, reloads the authoritative GET
list, including after Cancel; the
POST response is never inserted optimistically. A fast refresh might precede a
server's eventual commit after cancellation, so later live verification must
coordinate reconciliation before retrying an uncertain operation.

## Safe Windows startup and iPhone checks now

Codex does not start this preview, sign in, send emails or create real records.
The original mobile environment protections remain: root/legacy .env loading and
general EXPO_PUBLIC injection stay disabled. Checks/exports force verification
mode and do not open local developer settings. API settings remain absent.

From Windows PowerShell:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-create-story\apps\mobile'
if (Get-NetTCPConnection -State Listen -LocalPort 8086 -ErrorAction SilentlyContinue) {
  throw 'Port 8086 is occupied. Choose another unused port; do not stop another project.'
}
npm start -- --port 8086 --clear
~~~

Use the same trusted Wi-Fi on PC/iPhone. Scan this terminal's fresh QR code and
open this worktree in Expo Go. Stop only this terminal with Ctrl+C. Do not change
firewall rules, use a public tunnel or clear legitimate sessions/preferences.
The known Expo Go QR/resume navigation limitation still needs device retesting.

If normal Login reports missing development settings, obtain Charan's approved
development publishable client key (sb_publishable_) for the fixed project
edbkuunyeyxnyenmmqud. Configure manually from this worktree's safe example:

~~~powershell
if (-not (Test-Path -LiteralPath '.\development.auth.local.json')) {
  Copy-Item -LiteralPath '.\development.auth.example.json' -Destination '.\development.auth.local.json'
}
notepad .\development.auth.local.json
~~~

Keep the example's approved development URL unchanged and replace only its key
placeholder. Never use a service-role/provider key, password or session token.
This ignored file is not automatically copied from another worktree. Restart
this Expo preview after manual configuration, then use one approved existing
development account. Do not create accounts or send recovery/signup emails here.
Leave development.api.local.json absent. Do not configure a guessed backend URL.

Manual iPhone checks (not yet performed by Codex):

1. Verify the existing introduction, Replay and normal Login still work. Open
   My Stories, then Create My Story. Expect the clear saving-unavailable notice.
2. Submit an empty/space-only title, then a title longer than 120 characters.
   Expect readable validation, with the input available for correction.
3. Enter a synthetic title such as My childhood. Change Swedish/English story
   language and confirm the selected radio marker/announcement changes. Read the
   note that language cannot change after creation.
4. Press keyboard Done. It must dismiss the keyboard and preserve the title and
   language without submitting. Refocus and verify the retained value.
5. Tap Create My Story with valid details. Expect a translated unavailable
   message, no success and no saved project. Repeated taps must not create fake
   rows or contact a backend while settings are missing.
6. Back/Cancel must return to My Stories without adding the synthetic title.
   Reopening Create must show an empty title. Sign Out must return to Welcome.
7. Repeat in Svenska. Check VoiceOver, large text, narrow portrait/landscape,
   scrolling, keyboard avoidance, readable errors, contrast and large targets.
   Android hardware Back/TalkBack require Android verification separately.
8. Background/reopen and session revalidation must discard the draft/form and
   return through verified authentication to the dashboard. No automatic POST.

For repeatable safe automated checks, use the existing protected scripts:

~~~powershell
npm test -- --silent --testTimeout=15000
npm run typecheck
npm run lint
npm run check:config
npm run check:dependencies
npm run check:bundle
npm run check:bundle:ios
~~~

Run checks sequentially, not alongside bundling/other test jobs. The 15-second
Jest case budget accommodates the existing multi-screen Replay test on Windows;
application HTTP deadlines remain 10 seconds. No dependencies are installed by
these checks. Test requests are mocked, and exports/config force auth/API disabled.

## Live verification remains pending

Do not enable the API until Charan explicitly approves the reachable development
address and backend settings. The existing ignored development.api.local.json
mechanism is reused unchanged; its example remains empty, and no address is guessed.
Only canonical approved private-LAN IPv4 HTTP(S) origins are supported currently.
No hosted URL, public tunnel or broad firewall/transport exception is introduced.
Private IPs do not prove server identity. HTTP exposes a development bearer token
on the network; later testing requires a trusted private LAN/disposable approved
account or a separately reviewed secure development transport.

After approval, coordinate a disposable story with Charan and verify one actual
201, title/language/draft, then authoritative GET after Back. Check only the
authenticated account's projects. Test real 401/403/409/422/503, expiry, network
failure/cancellation/uncertain outcomes and two-account ownership isolation.
Do not deliberately retry an uncertain POST or alter token lifetimes/database
settings. This feature adds no delete action; coordinate test-data cleanup with
Charan separately. Success with one account does not prove cross-user RLS.

No live signup, Guest, story editing/details, conversation sessions, microphone,
AI, PDF, backend endpoint or schema changes are included. Manual device verification
and external independent review remain required before commit approval.
