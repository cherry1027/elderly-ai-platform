# Memy Mobile Task 3B — Create My Story

My Stories now opens a native Swedish/English form for a title and story language.
Creation uses the existing authenticated API transport. The development API URL
remains unconfigured: the form validates locally and clearly says saving is
unavailable, without a POST, fake success or fabricated dashboard row.

See [CREATE_STORY.md](CREATE_STORY.md) for current scope and safe Windows/iPhone
instructions and [CREATE_STORY_VERIFICATION.md](CREATE_STORY_VERIFICATION.md) for
actual test results, security/accessibility review and exact changed files.
Live signup, Guest and paid AI remain disabled. The following Task 3A/2C/2B notes
are historical; statements about creation being unavailable describe those bases.

# Preserved Task 3A — My Stories dashboard

The verified signed-in destination now lists story projects in Swedish/English.
It supports loading, empty/error states, refresh and existing secure sign-out.
The backend URL is deliberately unconfigured; no project requests can run until
an approved private LAN address is explicitly configured. Automated verification
uses synthetic mocked services, not real accounts or a backend.

See [STORY_DASHBOARD.md](STORY_DASHBOARD.md) for current setup, iPhone checks,
backend prerequisites and limitations, and
[STORY_DASHBOARD_VERIFICATION.md](STORY_DASHBOARD_VERIFICATION.md) for actual results.
Live registration and Guest/AI remain disabled. The following Task 2C/2B notes
are historical; their references to stories being unavailable describe that base.

# Preserved Task 2C — Gated native registration

Branch: feat/mobile-auth-registration. Base: a4807c0e8703ba3b8d5ed4a04fcb4b10b576a16b
(completed Task 2B). All changes remain inside apps/mobile.

## What works now

Welcome's Create Account action opens the native EN/SV registration form. It
validates required fields, email format, matching passwords and a six-character
minimum. Only email is trimmed in the form; password characters are preserved.
Both password fields have independent accessible visibility controls. Back to
Welcome, Go to Log In, hardware Back, onboarding and Replay remain available.

**Live signup and confirmation are deliberately NOT enabled.** The ordinary
preview offers **Check details**, which validates locally while retaining entered
values in memory, and explicitly says no account or email was created. It does not show fake signup
success. SDK signup/confirmation behavior is exercised only with mocked transport
in automated tests. There is no environment, URL, key or user switch to enable it.

Existing normal login still uses its separate, previously approved development
configuration/session store. Registration cannot replace it or auto-sign-in.
Guest, password recovery, Story Projects, microphone and AI remain unavailable.

## Safe PowerShell / iPhone form verification

The prepared local dependencies require no new installation. From PowerShell:

~~~powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-registration\apps\mobile'
npm start -- --port 8084
~~~

If port 8084 is already occupied, stop this command and choose an unused port;
do not stop another project's process. This is Expo Go on local LAN, not a tunnel.
Codex has not started this server or opened a microphone.

1. Scan this worktree's QR code in Expo Go. On first use, choose a language and
   view/skip the introduction. Returning signed-out users should reach Welcome.
2. Tap Create Account. Read the notice that live registration is not enabled.
   No development auth file is needed for these form-only checks.
3. Use synthetic values such as person@example.test. Check empty/invalid email,
   a five-character password, and mismatched confirmation. No email is sent.
4. Enter matching six-or-more-character synthetic passwords. In Password, Next
   moves to Confirm Password. In Confirm Password, press the iPhone keyboard's
   checkmark/Done: it must dismiss the keyboard without checking or submitting
   the form, and both values must remain. Use Show/Hide to confirm the retained
   synthetic values, then mask them again.
5. Tap Check details. Expect a local-check result explicitly saying no account/email
   was created; both values must remain, masked unless you selected Show. Repeating
   the check must work without retyping. Change only Confirm Password, press Done,
   then Check details: expect a mismatch. Correct it and check again: expect success.
   Results must never repeat either password. Never use a real password here.
6. Check Show/Hide for both fields, Back, Android hardware Back, and Go to Log In.
   Merely opening Login must not sign in. Guest must remain disabled.
7. Repeat in Svenska; check large system text, VoiceOver/TalkBack, small-screen
   scrolling, keyboard avoidance, Reduce Motion and Replay. Background/reopen:
   passwords must be concealed and cleared.

For the keyboard-fix retest, stop only this worktree's existing Expo terminal with
Ctrl+C, then run `npm start -- --port 8084 --clear` from the folder above and reload
this project in Expo Go. `--clear` clears Metro's cache, not saved app preferences
or login sessions. Do not stop other projects or clear phone storage.

Done, blur, refocus, Show/Hide and local checks retain controlled password values
in React memory only. Leaving the form, backgrounding or an actual mocked signup
attempt still follows the existing credential cleanup rules. No passwords are
written to AsyncStorage, SecureStore, logs or files. The actual signup gate is
unchanged. Codex's regression tests reproduce JS events, not physical UIKit.

The known Expo Go QR/resume issue that sometimes reopens an intentional Login
remains pending physical-device verification. Source guards and mock router tests
do not prove Expo Go or standalone cold-start behavior. Do not clear sessions or
onboarding preferences just to force a different screen.

## Confirmation design and activation requirements

The provisional callback base is memy-foundation://auth/confirm. Each pending
signup adds a cryptographically random public state; the return link must carry
that state plus the SDK code. State must match the pending registration BEFORE
any code exchange. An old/different attempt cannot erase the current verifier.
Exact callback-shaped links go to a separate confirmation screen, with codes
kept out of router params and logs. Unrelated links retain the entrance policy. Direct route/query
claims alone cannot verify an account. The in-memory inbox is bounded, one-use and
expires after 60 seconds; this is not the server's email-link/code expiry policy.

The isolated SDK test harness uses PKCE/S256, strict approved-development Auth
paths, finite request/body deadlines and sanitized errors. Expected email, state and a
bounded PKCE record use a separate device-only SecureStore namespace; SDK sessions
remain in memory. One pending signup is allowed. Confirmation verifies the user,
requires a confirmed non-anonymous identity matching that pending signup, cleans
temporary material, then offers normal password login. No main-session promotion
or backend/database writes are added. Remote scoped logout is best effort; local
cleanup is mandatory. The local pending-record TTL is one hour; expired material
is physically deleted on the next read or explicit cancellation, not by a native
background timer. Server expiry is authoritative and may be shorter. Native
storage operations cannot be cancelled.

Before any real signup/confirmation is activated, obtain separate approval for:

- Charan's exact additional mobile redirect and email-template RedirectTo behavior,
  including preservation of the random state and returned SDK code;
  preserve current web allowlisting/Site URL. No broad wildcard is proposed.
- iOS/Android application identifiers, custom-scheme ownership, native development
  build/distribution and physical callback checks. Expo Go is not proof that this
  custom scheme works; opening the old web localhost URL on a phone is insufficient.
- An SDK-compatible native cryptographic provider for secure randomness and SHA-256.
  No crypto/dev-client package was installed here. The SDK's weak/plain fallback is
  rejected; actual SDK tests assert S256. The native provider is still unverified.
- Review and implementation of the gated activation path. This preview cannot be
  unlocked merely by adding a key/configuration or changing an environment value.

User-confirmed development settings: signup enabled, confirmation required,
minimum six characters, no required character classes, CAPTCHA disabled, triggers
and permissions checked. Email delivery is limited to **two emails/hour across
the project**, shared with other signup/recovery testing. No automatic resend or
ambiguous timeout retry is provided. Later live testing must coordinate one approved
disposable recipient/slot, confirm on the initiating device, then log in normally.
Cross-device/missing-verifier and expired/reused links fail safely; if the email
was already confirmed on the server, ordinary login may still succeed.

Self-review and mocked tests do not constitute independent review or live
Supabase/native verification. See VERIFICATION.md for actual check results.

References: [Expo native links](https://docs.expo.dev/linking/into-your-app/),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

---

## Preserved Task 2B reference (historical scope and verification)

The following describes the completed login foundation. Statements about
registration being absent apply to that earlier task; Task 2C behavior is above.

# Memy Mobile Task 2B — Development login

This worktree adds only native email/password login and a small signed-in screen.
The existing three-scene Memory Book introduction, EN/SV selection, local first-visit
preferences and Replay remain. Registration, recovery, Guest, stories and voice are absent.

## Set up only the approved development client configuration

Ask Charan for the approved development project's **publishable client key**.
It starts with sb_publishable_. Never use a service-role key, sb_secret_ key,
provider credential, account password or access/refresh token in configuration.
Do not copy any root/web .env file.

Use Windows PowerShell:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-login\apps\mobile'
if (-not (Test-Path -LiteralPath '.\development.auth.local.json')) {
  Copy-Item -LiteralPath '.\development.auth.example.json' -Destination '.\development.auth.local.json'
}
notepad .\development.auth.local.json
~~~

Leave the URL exactly https://edbkuunyeyxnyenmmqud.supabase.co and replace only the
placeholder with that project's publishable key. Save and close Notepad.
The local JSON is ignored by Git. The credential-free example is tracked.
The key is client-public, so it is visible in Expo's development manifest.
No password/session token belongs in that file or an EXPO_PUBLIC variable.

The loader accepts exactly supabaseUrl and publishableKey. A missing, invalid,
extra-field, oversized or wrong-project configuration disables login with a helpful
message. There is no legacy configuration or anonymous-key fallback.

## Start on Windows and open on iPhone

~~~powershell
npm start -- --port 8083 --clear
~~~

Use the same trusted Wi-Fi on PC/iPhone. Scan this terminal's new QR code with the
iPhone camera and open the compatible Expo Go. Keep PowerShell open; stop only this
preview with Ctrl+C. Do not reopen another worktree's saved QR.
If 8083 is occupied, select a free port; do not stop an unrelated process.
If LAN access fails, report the message. Do not change firewall rules or use a tunnel.

The launcher keeps EXPO_NO_DOTENV=1, EXPO_NO_CLIENT_ENV_VARS=1 and
EXPO_NO_TELEMETRY=1, removes every inherited EXPO_PUBLIC variable, and sets its own
MEMY_MOBILE_AUTH_MODE. Start/android read only the explicit mobile-local JSON;
all validation/export actions force verification mode and do not open that file.
Expo default dotenv loading and general public env injection remain disabled.
No root Vite/Lovable/MCP configuration executes. Native runtime accepts dev mode
and the approved project only; release exports leave authentication disabled.

LAN is development transport. Expo CLI may use its own metadata services.
The application itself permits only the approved development Auth token, user and
local-scope logout endpoints. It has no FastAPI, database, AI or microphone operations.

## Navigation policy and iPhone retest

The root entrance waits for saved preferences and verified authentication. First use
starts at Language, then the introduction and Welcome. Returning signed-out users
reach Welcome; verified signed-in users reach the authenticated screen.
An in-memory marker remembers a verified account visit so immediate sign-out or
verification loss still reaches Welcome when local onboarding preferences are
missing. It never writes a completed preference or grants authentication. On a new
launch with neither saved preferences nor a valid session, first-use rules apply.

Expo Router can select a file route directly without rendering index first. The
old signed-out authenticated route also redirected straight to Login. Login now
requires a non-persisted Welcome-button intent; URL parameters cannot grant it.
Direct Login/protected entries return through the entrance without signing out.
Welcome also waits for authentication and respects first-use preferences.

The supported +native-intent hook sends cold and newly received native links to
the root decision. It does not intercept internal navigation such as Replay.
Normal background/foreground events preserve an intentional Login visit.
Back, route departure, fresh entrance and successful authentication clear that
UI intent. A failed secure sign-out shows its alert/retry on Welcome and keeps
Login disabled until cleanup succeeds.

This fixes confirmed application route gaps. It does not establish whether the
reported device launch used an old link, Expo Go's active experience, Fast Refresh,
or a previously selected route. Expo Go uses development URLs with an optional
/--/ route; a standalone app uses its own launch/deep-link mechanism. No standalone
build has been tested. If Expo Go only resumes a living experience without a new
URL event, the app cannot distinguish that from returning to an intentional Login
visit. Force-closing Expo Go is the cold-start test; backgrounding is a separate test.

Use the existing approved local configuration; do not edit it or clear app data.
Stop only this worktree's Metro terminal with Ctrl+C, then run:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-login\apps\mobile'
npm start -- --port 8083 --clear
~~~

The --clear option clears the development bundler cache, not iPhone preferences or
secure sessions. Use the new QR code on the same trusted Wi-Fi:

1. If signed in, explicitly tap Sign Out and confirm Welcome. Swipe Expo Go away
   in the iPhone app switcher, scan the new QR and reopen. Expect Welcome, not Login.
2. Tap Log In, then Back: expect Welcome. Open Login again without submitting,
   force-close Expo Go and scan the QR again: expect Welcome. Repeat twice.
3. Open Login deliberately, go to the iPhone Home screen and return without a new
   QR: Login may remain open, with the password cleared. This is an existing visit.
   Separately scan the QR while that experience is alive: a delivered new native
   link should return through Welcome. Report if this differs; no credentials/URLs
   or tokens are needed in the report.
4. Log in using the one approved confirmed development account. Force-close Expo Go,
   rescan and reopen online: expect the authenticated screen after verification.
   Do not sign out or clear storage to make this test pass.
5. Sign Out: expect Welcome. Force-close, rescan and reopen: expect Welcome again.
6. Check Replay, all three scenes, Next/Back/Skip/Enter, and Swedish/English.
   Saved language/completion must remain. No account or preference reset is required.

First-use navigation is tested with fresh synthetic preferences in automated tests.
Do not delete your current preferences/Keychain to simulate it. A truly new-device
first-use test remains separate. The new navigation behavior still needs your
physical iPhone verification; the earlier five login/session checks were USER-REPORTED
before this fix and are not proof of this revised navigation.

References:
- https://docs.expo.dev/router/advanced/native-intent/
- https://docs.expo.dev/linking/into-your-app/

## Manual iPhone test — one approved development account

No real login has been performed by Codex. Do these steps only after Charan confirms
the account belongs to the approved development project and its email is confirmed.

1. First use: choose English or Svenska, inspect/skip the three scenes, then Welcome.
   Returning users reach Welcome; Replay still opens all three scenes.
2. Tap Log In. Check readable email/password labels, keyboard behavior, Show/Hide
   Password, Back and large controls. Registration and Guest must remain unavailable.
3. Use one approved development account. An incorrect password should show a generic
   error and clear/conceal the password. Avoid repeated attempts that could rate-limit
   the account. Do not create an account or send recovery emails.
4. Enter the correct credentials. Confirm the signed-in screen shows only that account's
   email and Sign Out. It must not load projects, recordings or generated stories.
5. Background and reopen: details are hidden while inactive and during fresh session
   validation. Close/reopen this Expo project without signing out: a valid stored
   session should restore after server verification. An offline/unverifiable session
   must not reveal the account.
6. Tap Sign Out: account details disappear, local credentials are removed and Welcome
   returns. Reload: the signed-out account must not return. A device cleanup failure
   keeps login blocked and offers Retry secure sign-out; do not bypass that warning.
7. Optional network failure test after the bundle is already loaded: disconnect the
   phone's Internet and attempt login without reloading the development bundle.
   Expect a safe network/timeout error, no authenticated screen, and a cleared password.
   Reconnect before continuing. A Metro load failure is not an authentication result.
8. Repeat labels/navigation in Swedish. Check large system text, small portrait width,
   landscape, VoiceOver, password-toggle announcements and focus. Confirm no clipping
   and that everything scrolls. Check Reduce Motion and Replay regression.

Do not paste passwords, session data or recovery URLs into logs, screenshots or chat.
Use one approved account for this manual task. Cross-account isolation is covered
only with synthetic mocked accounts; real multi-account/cloud verification is not claimed.
Do not change token lifetimes or Supabase settings to accelerate refresh testing.

## Authentication and storage behavior

The supported Supabase SDK is pinned at 2.118.0, with Expo SDK 57 SecureStore 57.0.4
and the documented React Native URL polyfill. No other existing package version
was intentionally upgraded. Tools are installed only within apps/mobile.

Sessions use SecureStore (Keychain/Keystore), not browser storage or AsyncStorage.
The fixed namespace is memy.auth.edbkuunyeyxnyenmmqud.v1. Size-bounded chunks and a
two-slot pointer avoid oversized native values and partial publication. Storage
errors are generic; there is no plaintext fallback. Device-only unlocked Keychain
access is used without biometrics. Native calls cannot be cancelled; a failed/hung
cleanup blocks account reuse. Keychain entries can survive iOS uninstall, so every
restored session is checked with the approved Auth server before showing identity.

Token issuer/role/subject/expiry checks are routing guards, not signature verification.
getUser verifies identity server-side. Anonymous or unconfirmed users, expiry
mismatches and user/session identity changes are rejected. UI sees only id/email;
access/refresh tokens stay inside the SDK/storage boundary. Passwords are never saved.

Automatic refresh runs only in the foreground. Foreground entry revalidates identity;
expiry also hides the account when refresh fails without a sign-out event. Logout
fences stale operations immediately, attempts bounded current-session server logout,
then clears local secure credentials. Remote revocation is best effort if the server
cannot be reached; logout does not sign out other devices. Local cleanup is mandatory.

Auth callbacks schedule SDK work outside the callback cycle. Requests and body reads
have deadlines, fixed-origin/path checks, redirects rejected, cookies omitted,
caching disabled and sanitized SDK errors. There are no raw credential logs.

Onboarding separately retains only version, language and completion in AsyncStorage
under memy.onboarding.preferences.v1. It is non-sensitive, unencrypted display state,
never an authentication/authorization gate. Failure may repeat the intro next launch.

## Visual reuse and accessibility

The original 760x650 web vector book, memory symbols, microphone-to-writing/keyboard
concept, autobiography draft/paragraphs and pencil remain native SVG artwork.
Finite native-driver 1.2-second animations stop on leave; OS reduced motion shows
settled static artwork. Nothing records speech or creates an actual autobiography.
The existing Memy wordmark/sprout/book and cream/forest/sage palette remain unchanged.

Login adapts the reviewed web development-project restrictions, email/password flow,
safe errors and EN/SV wording. No DOM component, CSS, URL recovery parser, browser
session storage or web project code is imported. Large native inputs/buttons are at
least 56 units high, text scales, safe areas and scroll layouts remain, keyboard
avoidance is native, and password visibility has a labeled selected state.

## Safe offline checks

~~~powershell
npm test -- --silent
npm run typecheck
npm run lint
npm run check:config
npm run check:dependencies
npm run check:bundle
npm run check:bundle:ios
~~~

Checks use local tools, synthetic settings and blocked/mocked application transport.
The actual SDK is exercised with fake requests for login, refresh and logout.
Config and exports do not read developer settings. Exports are JavaScript compilation
only, not native builds or proof of real iPhone authentication/Keychain behavior.
No dependency installation is required to rerun checks in this prepared worktree.
Ignore caches/exports under .verification. No Docker or backend startup is needed.

See VERIFICATION.md for actual results, exact changed files and remaining limitations.
Self-review is not independent review. No commit/push/deployment or Task 2C.

Implementation references:
- https://supabase.com/docs/guides/auth/quickstarts/react-native
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json
