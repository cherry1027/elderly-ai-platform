# Memy Web Task 3C — development registration and login integration

Current branch: `feat/web-registration`.
Current base: `b35fe3ddb84c0d6d091aa5c1a6685438592c0ac5` (approved Task 3B).

Task 3C extends the existing isolated development entrance with Swedish/English
email/password registration. Create Account is enabled only when the development
entry supplies its handler. Continue as Guest remains disabled; standalone
onboarding/entrance previews still have inert account actions. The legacy
registration, invite, premium, AuthContext and application routes are not used.

**Do not submit a real registration until Charan confirms all development Auth
settings below.** No real signup, email, confirmation link, Supabase setting or
backend operation is performed by the automated checks. This guide contains no
credentials. The Task 3B details and dated verification record below are retained
as history; their counts are not Task 3C test results.

Task 3B branch: `feat/web-login-integration`.
Task 3B base: `770d927dba45d80b05b591bb2277a93d399ff9d0` (approved Task 3A).
Reviewed Story Projects/recovery source: `b2830f2f49e3a6bbfd51cbf83bdb86e9e4dc6f6c`.

This development entry uses the real shared Memy Entrance/Welcome component,
originally enabled only its Login action, and reuses the reviewed My Story Projects,
password-recovery, development Auth and typed API implementation. Ten necessary
source/test files were copied from the reviewed commit into this worktree;
there was no branch merge/cherry-pick and no other worktree was changed.

The original legacy main/bootstrap/App/auth/routes remain unchanged. The separate
Task 3A port 5176 configuration still has its inert destinations. Use the new
configuration below for the functional login integration; it deliberately never
loads the legacy application graph, root environment or Lovable/MCP plugin.

## Windows setup — do not share credentials

Use an existing approved synthetic development test account. No account
creation, recovery email sending, backend setup, data writes or production
connection is performed automatically.

1. Open Windows PowerShell and select the new worktree:

   ```powershell
   Set-Location "C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-web-registration"
   git branch --show-current
   ```

   Expected: `feat/web-registration`. Existing installed dependencies have
   been copied into this worktree's ignored node_modules; nothing was installed
   and package/lock files were not changed.

2. Create the separate local settings only if they do not already exist:

   ```powershell
   if (Test-Path '.\development\login\.env.local') {
     Write-Host 'Local settings already exist. Do not overwrite them.'
   } else {
     Copy-Item '.\development\login\.env.example' '.\development\login\.env.local'
   }
   notepad '.\development\login\.env.local'
   ```

   Keep the approved project URL and local API URL. Fill only the publishable
   `sb_publishable_...` key from development project **edbkuunyeyxnyenmmqud**:

   ```dotenv
   VITE_LOGIN_SUPABASE_URL=https://edbkuunyeyxnyenmmqud.supabase.co
   VITE_LOGIN_SUPABASE_PUBLISHABLE_KEY=
   VITE_LOGIN_API_BASE_URL=http://127.0.0.1:8000
   ```

   Save locally; this actual env file is Git-ignored. Never use the legacy root
   env, a service-role/secret key, user token or account password here. Do not
   paste real values into chat or screenshots. Only these three exposed variable
   names are accepted. Wrong project/key format/API origin stops preview startup;
   missing values allow the introduction but Login shows a safe setup message.

3. Check port 5173 without stopping anything:

   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
   ```

   If occupied, use Ctrl+C only in a preview terminal you recognize (for example,
   your separate Story Projects preview). Do not kill an unfamiliar process.
   This server fails rather than choosing another port.

4. Start only this frontend:

   ```powershell
   node .\node_modules\vite\bin\vite.js --config vite.login.config.ts --mode login
   ```

   Open **http://127.0.0.1:5173/** in Chrome. Keep PowerShell open; stop this
   preview with Ctrl+C. Do not use `npm run dev`, original Vite config, a normal
   production build, Docker, or an unapproved backend startup command.

## Local backend and CORS requirements

Project reads need an **already prepared** FastAPI backend on this Windows PC at
`http://127.0.0.1:8000` (or explicitly configured `http://localhost:8000`). Charan's
computer's loopback address is not reachable as your PC's loopback. No remote or
LAN backend is allowed in this task.

Before using it, have Charan confirm that its effective Supabase settings target
**edbkuunyeyxnyenmmqud**, with its own publishable key. The backend supports legacy
env fallbacks, and process variables can override dotenv settings, so a file
name alone is not proof of the effective project. Do not copy legacy settings
or start a backend with uncertain configuration. This frontend does not inspect
or change the backend process or its environment.

The repository's default backend CORS list includes exactly
`http://127.0.0.1:5173` and `http://localhost:5173` (also ports 8080). Port 5176
is not in that default. Confirm the running development backend has not
overridden that list and permits the Authorization header. If it needs an
override, ask Charan to adjust only his development `CORS_ORIGINS` to include the
exact frontend origin; no backend code or configuration was changed here.
Wrong CORS, an offline backend and a blocked request can all appear as the
sanitized network error. Browser authentication alone does not prove CORS/RLS.

## Registration approval checklist — Charan

Before a real Create Account submission, confirm privately that:

- The development project is **edbkuunyeyxnyenmmqud**, signup is enabled, and
  email confirmation is required. Actual backend/environment settings are not
  established by source inspection.
- The exact password length and any required character types are known. The
  form checks required fields, email format and password equality; Supabase
  enforces its actual policy. No unknown minimum is invented.
- The exact redirect **http://127.0.0.1:5173/auth/callback** is allowlisted,
  the Site URL/email template produces the supported implicit signup callback,
  and it does not point to the legacy application or production.
- Email delivery, permitted test recipients, rate limits and CAPTCHA/anti-abuse
  requirements are approved. This narrow form has no CAPTCHA integration; do
  not disable project protection merely to make a test pass.
- Existing account/profile/settings triggers are healthy in development. This
  frontend adds no profile writes, schema changes, backend registration route
  or project/session creation.

No project configuration is changed by this feature. Real email delivery,
password policy, redirect compatibility and database triggers remain pending
until separately verified. The UI language remains an interface preference,
not a promise of a persisted profile language.

## Task 3C manual verification — only after approval above

1. Start the isolated frontend using the Windows steps above, then open
   **http://127.0.0.1:5173/** in a fresh Chrome Incognito session. At Welcome,
   Login and Create Account are enabled; Continue as Guest is disabled. Check
   keyboard navigation and both Swedish/English. Back to Welcome preserves the
   interface language and motion choice.
2. Open Create Account. Check required fields, malformed email and mismatched
   passwords without submitting valid credentials. Errors should be announced,
   translated and contain no upstream detail. Switch languages while focused
   on the language selector; focus should stay there.
3. Only after Charan approves, use a disposable development email and a password
   meeting the confirmed policy. Submit once. Expect the generic check-email
   notice, not automatic sign-in or story projects. Do not retry rapidly or
   infer whether an account exists from this message. Never share passwords,
   request payloads, confirmation URLs, access tokens or refresh tokens.
4. Open the fresh development confirmation email once. It must land at the exact
   approved callback above, bypass onboarding and show confirmation checking.
   Confirmation success requires Supabase validation and safe temporary-session
   cleanup; URL parameters alone cannot show success. It must not display the
   new-password form or load project data. After success, choose Go to sign in
   and sign in normally using the confirmed disposable account.
5. A newly registered account can legitimately have no story projects. Project
   loading occurs only after fresh password sign-in and requires the separately
   approved local FastAPI backend described below. No backend is started here.
6. Test an expired/used/invalid development confirmation link privately. Expect
   helpful generic guidance, no URL/token display and no project requests. A
   plain `?type=signup` is not proof of confirmation. Unsupported code-only
   PKCE links fail safely; this in-memory flow has no persisted PKCE verifier.
7. Test Offline mode before a disposable signup request. Errors must be safe.
   A timeout may mean Supabase received the request, so check email before any
   retry and reload when instructed. Failed temporary-session cleanup permits
   reload only. Back/exit during a pending request must not leave usable auth.
8. Retest ordinary login, sign-out and the existing approved development recovery
   callback. Recovery must still require validated PASSWORD_RECOVERY, show the
   new-password form only for recovery, and block project loading until normal
   sign-in. Perform the real two-user authorization test separately with Charan;
   one account does not establish cross-user isolation.

Inspect methods/hosts only, never request credentials. Registration adds only
POST `/auth/v1/signup` to the approved development Auth transport. The existing
local backend GET list remains the only business API operation. No AI,
microphone, uploads, guest signup, invite or premium operation is introduced.
Unexpected immediate signup sessions are not accepted as ordinary sign-in;
they are invalidated and cleaned up before returning to password sign-in.

Automated checks use mocked services and fake data with network guards. They
are not evidence of live email delivery, deployed Auth settings, real callback
compatibility, production readiness or full end-to-end operation. Self-review
does not replace your manual verification and independent review.

## Existing login and recovery manual regression checks

1. Start in a fresh Chrome Incognito session. Check the three scenes, Next/Back,
   Skip, Enter, Replay and Animations/reduced motion. Completion remains local
   to profile/origin; ports 5173 and 5176 have separate flags. No Auth client is
   created until Login, Create Account or a supported callback is opened.
2. At Welcome, Login and Create Account are enabled. Continue as Guest remains
   disabled. Choose Swedish or English; Login inherits it. Back to Welcome
   preserves language and the mounted introduction's motion choice.
3. Select Login and use the approved development account privately. Expect
   loading then My Story Projects, or a safe empty/error state. Only project
   titles/languages/statuses are shown. This interface cannot create or edit.
   Inspect request methods/paths only: Auth goes to the approved project's
   `/auth/v1/`; the local backend receives GET `/api/v1/story-projects` with one
   API prefix. Never copy headers, request payloads or token values.
4. Refresh projects, sign out and confirm titles disappear **immediately**.
   Successful sign-out allows normal sign-in again. Reloading the browser always
   requires fresh sign-in; sessions are in memory, never persistent storage.
5. Test a wrong password once with your disposable account. The safe error must
   reveal no upstream detail. To test network errors, use Chrome Offline mode
   then restore Online. With a signed-in list, Offline + Refresh should show a
   backend error; Offline + Sign out must remove rows even if remote logout
   fails. Use the offered Reload to discard memory afterward.
6. Auth/SDK and Auth HTTP waits are bounded to approximately 10 seconds; a
   project read can use up to 10 seconds for token acquisition plus 10 seconds
   for HTTP. After an auth timeout or failed logout, reload before signing in:
   late operations are deliberately fenced from becoming usable sessions.
   A timed-out password update has an uncertain server outcome; do not treat it
   as success. Obtain a fresh link or verify privately with the development
   account after reloading.
7. Test keyboard focus, labels, error announcements and language changes on the
   login/list/recovery views. Use Chrome device emulation/zoom for narrow screens.
   Loopback is restricted to this PC; do not expose the preview on the LAN.

## Password recovery

Use only a fresh development recovery email requested from Charan manually.
The existing approved redirect **http://127.0.0.1:5173/story-projects.html** is
served by this new configuration and goes directly to development recovery,
without onboarding or legacy auth. The root and `/aterstall-losenord` callback
paths are also handled by this entry, but Supabase allowlisting for any new
redirect requires separate confirmation; no project setting was changed here.

The reviewed flow remains implicit recovery: SDK user validation and its valid
`PASSWORD_RECOVERY` event are required before displaying the new-password form.
`?type=recovery` alone is invalid; URL markers never authenticate anyone. Recovery
checking/ready/finishing/cleanup failure cannot load story projects. Code-only
PKCE callbacks cannot be redeemed by this memory-only flow without a verifier;
they fail safely rather than fall back to legacy authentication.

Open the fresh action link once, enter matching acceptable new passwords and
expect confirmed success followed by normal sign-in. Supabase enforces the
actual project password policy; no unknown minimum/character policy is invented.
Recovery credentials are removed by the SDK/approved cleanup, never logged or
displayed. Project requests must remain absent until a fresh password sign-in.
Invalid/expired/used links show safe fresh-email guidance. Cleanup failure offers
Reload to sign in. This code sends no recovery emails automatically.

## Security and release limits

- The exact development project URL, publishable-key format, user-token issuer
  and authenticated role are guarded. Issuer parsing is routing protection,
  not signature verification. FastAPI/Supabase still perform actual validation.
- No permanent sessions, credentials in source, project/session writes,
  guest, microphone, transcription, AI, payment or subscription feature is
  introduced. Auth signup/confirmation/login/refresh/logout/password update are
  development Auth operations; GET projects is the only business API call.
- The preview allowlist blocks the legacy graph and MCP generation. CSP permits
  the approved Auth namespace and loopback API only, forbids forms/frames/remote
  assets, and Permissions Policy blocks microphone/camera. Auth transport further
  restricts methods/routes and refuses redirects, cookies and caching.
- SDK callbacks remain synchronous. Public async operations and HTTP/body waits
  have deadlines. Local invalidation, request generations and immediate read
  cancellation prevent abandoned login/refresh or logout responses restoring
  private project rows. Real bearer tokens cannot be revoked before their
  server-enforced expiry merely by clearing the UI.
- Real account login/refresh, effective backend configuration/CORS, recovery
  delivery/redirect settings, RLS/two-user authorization, rendered accessibility
  and complete legacy application regression remain unverified in this task.
  Mocked checks do not establish production readiness.
- Code self-review is not independent review. Manual verification and external
  review/approval are still required before committing. No merge/deployment is
  approved. Separate existing feature worktrees remain unchanged.

## Safe automated commands

```powershell
node .\node_modules\vitest\vitest.mjs run --config vitest.login.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism
node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.login.json
node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.app.json
node .\node_modules\eslint\bin\eslint.js src/entry/Entrance.tsx src/features/login src/features/onboarding/OnboardingExperience.tsx src/features/onboarding/copy.ts src/features/onboarding/onboarding-state.ts src/development/story-projects src/development/login src/lib/api/story-projects.ts src/lib/api/story-projects.test.ts vite.login.config.ts vitest.login.config.ts --max-warnings 0
```

Tests combine the 227 Task 3A cases, reviewed core Story Projects/recovery/API
cases and new integration/auth/configuration cases. The old standalone Story
Projects HTML/configuration files are not copied or executed. Tests block real
browser and Node network/device APIs; SDK protocol cases use synthetic accounts
and fake HTTP with the actual installed SDK. No test starts services or uses a
real account. See the final task report for actual totals and any failures.

Suggested Task 3C commit message after manual and independent approval:
`feat: add development account registration and email confirmation`

## Task 3C automated verification — 18 October 2026

After the final application/test changes, the full isolated login suite passed
**586 tests in 16 files, zero failures** (including the existing regression
cases). The final run used `--pool=threads --maxWorkers=1 --no-file-parallelism`.
Both `tsconfig.login.json` (strict) and `tsconfig.app.json` passed TypeScript
checks with `--noEmit --incremental false`. Scoped ESLint with `--max-warnings 0`
and `git diff --check` passed. No packages were installed or dependency files
changed: preinstalled node_modules were copied from the reviewed login worktree
only after confirming identical package-lock hashes.

All Auth/confirmation protocol checks used the actual installed Supabase SDK
with injected synthetic HTTP responses and blocked real network access. No real
signup, email, backend, database or production verification was executed.
Accessibility checks cover labels, error announcements/focus, language-selector
focus and keyboard-operable native controls; graphical and assistive-technology
browser verification remains manual. Code review here was self-review, not
independent review.

Self-review corrected the Windows component/helper filename collision, the SDK's
deferred confirmation event, temporary-session cleanup, timeout/reload guidance
and callback navigation. The helper is named `registration-auth.ts` so Windows
does not resolve it instead of the `Registration.tsx` component. No blocking
finding remains for the mocked development scope; all Charan configuration gates
and real end-to-end checks above remain pending.

## Final verification record — 18 October 2026

- Final full test run: **510 passed, 0 failed**, 14 files, exit 0. This includes
  all 227 existing Task 3A cases plus reviewed core Story Projects/recovery/API
  cases and the new auth, localization, routing, configuration and race tests.
- Strict TypeScript (`tsconfig.login.json`), existing whole-application TypeScript
  (`tsconfig.app.json`) and scoped ESLint with zero warnings all passed, exit 0.
  Git diff whitespace check passed. No dependencies were installed or upgraded.
- Vite transformed 20 actual runtime modules in middleware mode without a
  listening HTTP server. Both automatic JSX runtimes resolved; `jsxDEV` was a
  function, the Supabase SDK bundle resolved without creating a client, and no
  legacy App/bootstrap/AuthContext/Supabase client/MCP module entered the graph.
  The temporary compiler cache was removed afterward.
- Initial checks exposed a logout focus-timing regression and the new HTML
  alias incorrectly entering the passive callback view. Both were fixed and
  retested. Self-review also fixed the retained Login click guard, repeated
  logout-event busy-state race, old-client callback cleanup, and SDK refresh
  restart after abandoned initialization. Regression cases cover these fixes.
  Test `act` warnings and the mixed component/helper-export lint warnings were
  corrected; final checks have no failures or warnings.
- Self-review, including a second internal reader, found no remaining blocking
  defect. This is not external independent review. No Task 3B manual browser or
  live development-auth/backend check was performed by Codex. There is no
  claimed end-to-end, real CORS, production or two-user authorization result.
- Main/bootstrap, legacy routes/authentication, graphic SVG, original Vite/MCP
  configuration, package/lock files, backend and Supabase files are unchanged.
  No other worktree, staging area or Git HEAD was changed. Nothing was committed,
  pushed, merged or deployed. Registration and Guest remain disabled.

## Exact feature file list

Four existing files modified:

```text
src/entry/Entrance.tsx
src/features/onboarding/OnboardingExperience.tsx
src/features/onboarding/copy.ts
src/features/onboarding/onboarding-state.ts
```

Twenty-four files added (including reviewed files reused from `b2830f2`):

```text
development/login/.env.example
docs/web-login-integration.md
login-review.html
src/development/login/main.tsx
src/development/login/preview-config.test.ts
src/development/story-projects/MyStoryProjects.test.tsx
src/development/story-projects/MyStoryProjects.tsx
src/development/story-projects/PasswordRecovery.tsx
src/development/story-projects/auth-safety.test.ts
src/development/story-projects/development.test.ts
src/development/story-projects/development.ts
src/development/story-projects/login-ui.test.tsx
src/development/story-projects/recovery.test.tsx
src/development/story-projects/recovery.ts
src/development/story-projects/test-network.ts
src/features/login/LoginApplication.test.tsx
src/features/login/LoginApplication.tsx
src/features/login/login-runtime.ts
src/features/login/login.css
src/lib/api/story-projects.test.ts
src/lib/api/story-projects.ts
tsconfig.login.json
vite.login.config.ts
vitest.login.config.ts
```
