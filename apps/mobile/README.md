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
