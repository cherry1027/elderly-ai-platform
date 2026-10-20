# Mobile Task 3C — Complete-flow audit and navigation corrections

2026-10-20. Worktree: `memy-mobile-story-details`.
Branch: `feat/mobile-story-details`.
Unchanged HEAD/base: `eb95476a9e735358964595b75f761dec7de21fc5`.
The existing uncommitted Task 3C implementation was preserved. Nothing was staged,
committed, pushed, merged or deployed. No other worktree was edited.

The final preview/startup correction is documented at the end of this report.
The 1,440-test table below is the navigation checkpoint before that correction;
the latest startup results supersede its source-correspondence claim.

## Reported behavior and confirmed causes

USER-REPORTED: sample-preview Sign Out displayed “The sample preview is closed”
with only “Restart sample preview” and prominent English/Svenska buttons. The
source confirms both belonged to `StoryPreview`, not the normal application.
That isolated root intentionally mounted no Auth, Registration or preference
providers. It could not return to a real account's Welcome via Router safely.

The correction reuses the real Welcome presentation inside the same isolated
sample root. It starts at Welcome; View sample stories opens fictional examples.
Exit Preview / Return to Welcome and all sample Sign Out buttons discard drafts
and return there. Login, registration and Guest are visibly disabled in this mode.
There is no transition from a sample identity into actual account state.

The repeated language radios were sample-banner controls. They were removed from
that banner. Change language on sample Welcome opens the existing Language screen,
and returns to sample Welcome. Its choice lasts only in memory. Normal language
preferences and sessions are never read, changed or removed by samples.

Additional source-confirmed gaps corrected:

- Replay scene-zero Back used to open Language, even when launched from Welcome.
- Returning language selection used completion alone, ignoring the existing
  in-memory Welcome eligibility after a verified account visit without preferences.
- Old Welcome/Login/Language history could remain beneath My Stories, producing a
  Back → Welcome → authenticated redirect bounce. This was a source-supported
  risk, not a physically reproduced iPhone failure.
- A cold expired/blocked session without onboarding preferences could fall into
  Language or return there after cleanup. Session recovery now remembers Welcome
  eligibility in memory, without claiming onboarding was completed.
- Sample views had no Android Back handling for their local view state.

The navigation root helper collapses history only on a ready, active, focused
Welcome or verified authenticated destination. It preserves the focused route key
and state. It never grants authentication, signs out, changes preferences or runs
while checking/busy/backgrounded. Explicit Login, registration, language and Replay
navigation remain deliberate user actions.

## Screen-by-screen audit

“Restart” below describes a new JavaScript/application mount in normal mode,
not merely bringing a still-running Expo Go experience to the foreground.

| Screen | Entry and actions | Back, Cancel and Sign Out | Restart, expiry and safety |
| --- | --- | --- | --- |
| Language Selection | First clean launch without completed preferences; or Welcome → Change language. EN/SV selection is saved by the existing preference writer. | Initial Continue opens scene 1. Returning Continue/Back returns to Welcome (or its signed-in dashboard redirect). No misleading Cancel: selection takes effect immediately. | Completed preferences remain true; language edits do not alter Auth. Returning users are not repeatedly prompted. If device preference storage fails, persistence cannot be guaranteed and the existing notice remains. |
| Animated Introduction, all 3 scenes | First language Continue, or Welcome Replay. Existing artwork/reduced-motion behavior is reused. | Next/Back moves scene; initial scene-zero Back returns to Language, Replay Back returns to Welcome. Skip/Enter completes the intro and opens Welcome. | Completed preferences are preserved. A completed normal restart skips intro. No recording, AI, account or story operation. |
| Welcome | Completed returning signed-out entrance, finished intro, Back, Sign Out or session recovery. Log In, gated Create Account, Replay and Change language. | It is a navigation root. Native Back can leave to the app host rather than uncover an old form/intro. Guest remains disabled. Cleanup failure offers retry and disables account actions. | Verified signed-in users go to My Stories. Cold expired/blocked sessions can recover here without fabricated onboarding completion. |
| Log In | Only an explicit Welcome/login action sets in-memory intent. Direct/restored Login without that intent uses the guarded entrance. | Visible/Android Back cancels login intent and pending login work, then Welcome. Success opens verified My Stories. | Cold start loses UI intent but preserves legitimate secure sessions. Foreground revalidation hides private state until verified; failure returns safely to entrance. |
| Create Account | Explicit Welcome action; native form/check-details only. | Back cleans up the separate temporary registration service before Welcome. Log In transition also waits for cleanup; failure shows an actionable error instead of escaping cleanup. | Real signup/confirmation remain gated. Temporary registration identity cannot open My Stories. No emails were sent. |
| Confirmation callback | Strict bounded confirmation-link intake; no raw credentials in router params. | Existing result/error/login/back handling remains gated and uses separate temporary registration cleanup. | No live link verification occurred; native redirect/development-build approval remains pending. Ordinary external paths return to the entrance. |
| Authenticated route | Only ready, active, verified Auth with user. Account-keyed StoriesHome. | Canonical single root prevents old Login/Welcome history beneath it. On Sign Out, private content is immediately unmounted while local credential cleanup runs; Welcome follows. | Cold verified sessions open dashboard. Checking/background hides content; expiry removes it; changing accounts mounts fresh private views. Cleanup failure remains private-data-free with retry on Welcome. |
| My Stories | Verified authenticated route; fresh current-account list if configured. Refresh, Create and Open story. | Create/Details are contained views. Sign Out returns to Welcome after cleanup. At the authenticated root, native Back leaves to host rather than replaying login history. | Missing API configuration shows unavailable, never fictional account data. Only first 50 projects are requested. Session changes clear private state. |
| Create My Story | Dashboard → Create. Shared Unicode-safe title validation and EN/SV project-language choice. | Back returns to a fresh dashboard; Sign Out discards draft and cancels/ignores pending work. Done dismisses keyboard without erasing/submitting. | Empty/invisible/overlong errors remain inline/scrollable/announced. Missing URL means no POST or fake successful save. Background, expiry and account switch discard private view state. |
| Story Details | Intentional UUID selection; authenticated fresh GET, not an old list row. Language is read-only; unknown status is neutral. | Back returns to fresh dashboard; Edit opens form; Sign Out cancels pending operations and clears details. | Missing/invalid ID/configuration cannot start a request. Errors offer safe Back/Sign Out; no cross-account cached display. |
| Edit Story | Loaded details → Edit; existing title/description prefilled. Only supported PATCH fields. | Cancel/Android Back discards draft and reconciles via fresh details GET. Sign Out cancels/ignores pending work and clears draft. Multiline description and Done typing work separately. | Failed/uncertain saves retain appropriate draft but never claim success or blindly retry. Session/account changes unmount drafts. Abort cannot undo a server-accepted update. |
| Sign Out | Available on dashboard, Create, Details and Edit. | Clears private view state before awaiting local credential cleanup; ordinary success goes to Welcome, cleanup failure shows retry there. | Never clears onboarding/language preferences to force navigation. No real sign-out request was made in this audit; service and route cases use mocks. |
| Replay Introduction | Welcome → Replay → all three existing scenes. | Scene-zero Back, Skip and Enter return to Welcome; later Back goes one scene back. | Does not reset completed preferences or language. Scene cleanup/reduced-motion tests remain included. |
| Sample Stories preview | Explicit native debug launcher + exact disabled service settings. Isolated Welcome → fictional stories. | Exit/Sign Out → isolated Welcome. Back: Edit → Details → list → Welcome; Language/Replay also have predictable Back. Welcome Back leaves to host. | Fresh sample mount starts Welcome with its own English default. Background drops drafts and returns Welcome; no storage/session/network activity. It cannot be enabled in release or by URL parameters. |

## Authentication, language and error boundaries

Normal EN/SV controls appear on Language Selection, reached through initial flow
or one Change language action on Welcome. Project-language choices on Create are
the language of that story, not a repeated application-language selector. The
shared LanguageProvider preserves completion and authentication while changing
copy; no new Settings/product feature was added.

Auth expiry/revalidation is still owned by the existing authentication service.
API 401 errors locally remove rows/lock writes and retain Back/Sign Out; they do
not automatically discard a valid Supabase session merely because the separate
backend rejected it. Real global Auth expiry removes the entire private subtree.
The server remains responsible for ownership enforcement.

No Supabase client/session storage, token validation, backend allowlist, API
contract, signup gate, legacy environment protection, Guest or AI feature was
weakened. Approved live API URL remains absent; no real local Auth configuration
was copied. Invalid story titles still cannot reach POST. Sample Create/PATCH
attempts show unavailable and never mutate examples or real account rows.

## Blue floating icon and Expo Go limits

The provided attachment contains text only; no screenshot is available in this
request. No matching floating blue settings/development control exists in Memy's
mobile source or palette. Absolute artwork positioning is not a floating control.
The icon could belong to Expo Go/native development tooling or device UI, but that
origin cannot be confirmed from the repository. No framework/device controls were
disabled on an assumption. Sample controls are explicitly gated out of release.

Expo Go may resume an existing experience and React Fast Refresh can preserve
state. That is distinct from a cold JavaScript mount. A genuine normal cold start
uses preference/session restoration; an external route uses the native-intent
guard; unrequested Login is rejected. A still-live intentionally opened Login may
resume there. Tests can exercise Router entry/history and AppState, not control
Expo Go/iOS host restoration. No standalone-app/device claim is made.

## Safe iPhone retest

1. Stop only this worktree's previous Expo terminal with Ctrl+C. Do not terminate
   other projects or clear Expo Go/application storage. Use the startup instructions
   in STORY_DETAILS.md; the launcher now selects a free port automatically.
2. On the same trusted Wi-Fi, scan the new QR code. Confirm the fictional-sample
   banner and Welcome. No large EN/SV buttons should appear in the banner. If an
   old closed page appears, reload this experience or fully close/reopen Expo Go
   using this QR; do not erase account/preferences. No firewall changes/tunnel.
3. View sample stories → Create. Check empty/spaces/invisible/121-character title
   feedback with keyboard open, Done retention and corrected title. Valid Create
   reports unavailable, never saved. Back returns to sample stories.
4. Open a sample → Edit. Change title/description, check multiline/Done/validation.
   Save reports unavailable and preserves draft; Cancel returns original details.
   Details Back returns list. Sign Out from list/Create/Details/Edit must return
   Welcome; View sample stories must show unchanged fictional examples.
5. Welcome → Change language → Svenska → Continue/Back. Repeat key checks. Welcome
   Replay → Next/Back/Skip/Enter; scene-zero Back must return Welcome. Test Larger
   Text, VoiceOver and smaller layout. Background must drop a sample draft and
   return Welcome, without reading or changing normal app preferences.
6. To inspect the NORMAL app, stop only this preview terminal, fully close Expo Go
   without clearing its data, then run `npm start` in this worktree's apps/mobile.
   Confirm MEMY NORMAL APP and scan its NEW QR rather than opening Recents.
   This does not enable samples. Current local Auth/API configs are absent: initial
   language/intro, saved returning Welcome, Replay, language change, gated account
   form and login configuration errors can be inspected without service access.
   Do not copy credentials/configuration from another worktree to make login work.
7. A real development-account login/sign-out/restore test requires separately
   approved mobile Auth setup in THIS worktree. It was not performed here. Real
   stories also require an explicitly approved backend URL. With no backend, do
   not expect real account stories or successful saves. Do not enable signup,
   configure an invented URL or use the sample preview as an authentication test.

Existing completed onboarding preferences must not be reset to force a first-run
test. Fresh-first-run and expired/account-switch flows are covered with mocks;
the existing completed device can use Replay instead. Device tests remain pending.

## Verification results and inventory

This document is a self-review; independent review and manual iPhone approval
remain pending. No live Supabase/FastAPI/AI, email, microphone or production
operation is part of these checks.

All tests use synthetic accounts and mocked services; global fetch/XHR/WebSocket
guards reject accidental service access. Checks use the protected launcher, with
legacy dotenv/public-env loading and live auth/API configuration disabled. Nothing
was installed. JavaScript exports are offline validation, not device execution or
release builds.

| Check | Actual evidence |
| --- | --- |
| Initial preview-focused run | 52 passed, 8 failed, 2 suites: test mock subscription cleanup failure; `.verification/navigation-audit/preview-initial-results.json` / `preview-initial.log` |
| Preview retest | 60 passed, 2 suites; `.verification/navigation-audit/preview-retest-results.json` / `preview-retest.log` (later listener-cleanup case and keyboard dismissal are covered by complete rerun) |
| Language/onboarding/screens focused | 97 passed, 4 suites; `.verification/navigation-audit/screens-navigation-results.json` / `screens-navigation.log` |
| Auth routes focused | First 36 passed/6 assertion failures, then 42 passed. Child tool-output evidence only, no saved focused log/JSON. Final complete-run JSON also includes these cases. |
| Initial TypeScript | Failed with 7 diagnostics in navigation generic/test event/index typings; `.verification/navigation-audit/typecheck-initial.log` |
| Corrected TypeScript | Passed, exit 0; `.verification/navigation-audit/typecheck-final.log`, repeated successfully against the final test file in `typecheck-retest.log` |
| ESLint | Passed, exit 0; `.verification/navigation-audit/lint-final.log`, repeated successfully in `lint-retest.log` |
| First complete run | 1,439 passed, 1 failed, 41 suites; exact SDK type-subpath missing from import allowlist. `.verification/navigation-audit/full-final-results.json` / `full-final.log` |
| Complete retest | **1,440 passed, 0 failed, 0 skipped; 41 suites; exit 0**. `.verification/navigation-audit/full-retest-results.json` / `full-retest.log` |
| Expo configuration | Passed, exit 0; Auth/API disabled and preview false by default. `.verification/navigation-audit/config-final.log` |
| Offline dependency check | Exit 0, up to date; Expo warns validation is unreliable offline. `.verification/navigation-audit/dependencies-final.log` |
| iOS JavaScript export | Passed, exit 0; `.verification/navigation-audit/ios-final.log`, `.verification/ios` |
| Android JavaScript export | Passed, exit 0; `.verification/navigation-audit/android-final.log`, `.verification/android` |
| Whitespace | Tracked `git diff --check` and no-index inspection of all added files passed; ordinary LF/CRLF notices are not whitespace errors. |
| PowerShell manual instructions | One block parsed without syntax errors; startup commands were not executed. |

The preview failures came from test mocks returning no removable subscription after
restoration; the fixture now supplies realistic subscriptions and asserts their
cleanup. Auth route assertion failures read the test harness's outer `__root` rather
than the nested real app stack; correcting traversal made those checks pass.
TypeScript fixes use published Expo Router navigation types and correctly typed
synthetic native events, without `any` casts or compiler bypasses. The full-suite
allowlist fix permits only the exact supported `expo-router/react-navigation`
subpath; authentication, environment, transport and production restrictions remain
unchanged. No failed check was skipped or converted into an assertion-free test.

The 109 runtime/test/config SHA-256 records in
`.verification/navigation-audit/runtime-before-retest.json` matched the final
working files after checks. The earlier iOS export differs only in the subsequent
test allowlist entry, with no application/config source change. Validation logs
and inventories are ignored local artifacts under `.verification/navigation-audit`.
Previous 1,406-test evidence is historical and does not
substitute for these new checks. Actual iPhone keyboard/VoiceOver, Expo Go host
restoration, native Back, real auth and live API behavior remain unverified here.

Final security/accessibility self-review found no remaining blocking defect in
this development-only scope. Native touch targets remain at least 56 units,
scalable text/safe areas and existing artwork are preserved, and no repeated
language selector was added to normal screens. Completion is still subject to
manual iPhone approval and independent review. No real backend, signup, Guest,
microphone or paid AI service was enabled or contacted. No dependencies changed.

## Exact file inventory

Navigation follow-up: 19 files changed relative to the preserved pre-audit Task 3C files.
The complete uncommitted Task 3C scope is 45 files: 27 modified and 18 added, all
under apps/mobile. No deleted/renamed or staged files. No dependency or lockfile changes.

Navigation follow-up paths (repository-relative):

```text
apps/mobile/README.md
apps/mobile/src/app/authenticated.tsx
apps/mobile/src/app/index.tsx
apps/mobile/src/app/introduction.tsx
apps/mobile/src/app/language.tsx
apps/mobile/src/app/welcome.tsx
apps/mobile/src/navigation/LoginNavigation.tsx
apps/mobile/src/screens/LanguageScreen.tsx
apps/mobile/src/screens/WelcomeScreen.tsx
apps/mobile/test/auth-routing.test.tsx
apps/mobile/test/routing.test.tsx
apps/mobile/test/screens.test.tsx
apps/mobile/test/safety.test.ts
apps/mobile/NAVIGATION_AUDIT.md
apps/mobile/STORY_DETAILS.md
apps/mobile/STORY_DETAILS_VERIFICATION.md
apps/mobile/src/development/StoryPreview.tsx
apps/mobile/src/navigation/entrance.ts
apps/mobile/test/story-preview.test.tsx
```

Complete modified files against the Task 3C base:

```text
apps/mobile/README.md
apps/mobile/app.config.cjs
apps/mobile/package.json
apps/mobile/scripts/run.cjs
apps/mobile/src/api/story-projects.ts
apps/mobile/src/app/_layout.tsx
apps/mobile/src/app/authenticated.tsx
apps/mobile/src/app/index.tsx
apps/mobile/src/app/introduction.tsx
apps/mobile/src/app/language.tsx
apps/mobile/src/app/welcome.tsx
apps/mobile/src/components/Screen.tsx
apps/mobile/src/create-story-copy.ts
apps/mobile/src/navigation/LoginNavigation.tsx
apps/mobile/src/screens/CreateStoryScreen.tsx
apps/mobile/src/screens/LanguageScreen.tsx
apps/mobile/src/screens/MyStoriesScreen.tsx
apps/mobile/src/screens/WelcomeScreen.tsx
apps/mobile/src/stories-copy.ts
apps/mobile/src/stories/StoriesHome.tsx
apps/mobile/src/stories/StoryDashboard.tsx
apps/mobile/test/auth-routing.test.tsx
apps/mobile/test/create-story-screen.test.tsx
apps/mobile/test/launcher.test.ts
apps/mobile/test/routing.test.tsx
apps/mobile/test/safety.test.ts
apps/mobile/test/screens.test.tsx
```

Complete added files against the Task 3C base:

```text
apps/mobile/NAVIGATION_AUDIT.md
apps/mobile/STORY_DETAILS.md
apps/mobile/STORY_DETAILS_VERIFICATION.md
apps/mobile/src/development/StoryPreview.tsx
apps/mobile/src/development/story-preview-config.ts
apps/mobile/src/navigation/entrance.ts
apps/mobile/src/screens/EditStoryScreen.tsx
apps/mobile/src/screens/StoryDetailsScreen.tsx
apps/mobile/src/stories/StoryDetails.tsx
apps/mobile/src/story-details-copy.ts
apps/mobile/test/edit-story-screen.test.tsx
apps/mobile/test/open-story-card.test.tsx
apps/mobile/test/story-details-client.test.ts
apps/mobile/test/story-details-routing.test.tsx
apps/mobile/test/story-details-screen.test.tsx
apps/mobile/test/story-details.test.tsx
apps/mobile/test/story-preview-config.test.tsx
apps/mobile/test/story-preview.test.tsx
```

## Final preview/startup correction — latest verification

USER-REPORTED: on the real iPhone, Replay correctly displays all three original
animated Memory Book scenes. The sample banner appeared above the introduction,
including after attempting normal npm start. Codex did not perform these device
checks. The animations and all application src/ code remain unchanged in this
startup correction.

Confirmed cause of the banner inside sample Replay: RootLayout selects the entire
StoryPreview from the loaded Expo manifest, and its fictional-data banner wraps
all sample screens, including Replay. There is no ordinary-route/query fallback
that enables it. A fresh protected normal startup removes inherited sample flags,
sets development mode, and its new manifest has preview=false even when local
Auth/API configuration is missing. Missing configuration never substitutes samples.

The exact reason this iPhone continued showing the sample experience after the
normal-start attempt cannot be established from repository evidence. An old QR,
still-running preview server or already-loaded Expo Go experience is consistent
with the report. Those are possibilities, not a personally observed device cause.

Source-confirmed startup ambiguity was corrected: both modes previously shared
default port/name; an old process retains its own environment and starting another
terminal cannot change the phone's loaded manifest. Installed ordinary Expo start
does NOT silently reuse a busy same-app server in this path: it offers another
port; declining/aborting leaves the old preview untouched. Windows process lookup
is unavailable in that CLI helper. A successful new launch also does not rewrite
an already-running old experience.

Small changes:

- Interactive startup now supplies --port 0 and --clear once by default. Installed
  Expo explicitly supports port 0 as selection of an available port. Inherited
  RCT_METRO_PORT is removed case-insensitively. A single explicit --port N or
  --port=N override is validated; malformed/duplicate/short -p forms fail clearly.
- The terminal prints MEMY NORMAL APP or MEMY SAMPLE STORIES PREVIEW and asks for
  the NEW QR. It never logs secrets, environment values or arbitrary arguments.
- Only the explicit sample manifest gets display name Memy (Sample Stories).
  Normal remains Memy. Slug, scheme and application-defined preference/session
  keys stay unchanged. Installed scope-key code uses signing scope or slug plus
  CLI anonymous ID, not display name; Expo Go native host scoping still needs
  physical-device verification. No storage reset or sign-out was added.
- Preview gating, real routes, authentication and every screen/animation stay
  unchanged. Samples remain isolated with no account providers/network/persistence.
  The banner is deliberately retained throughout explicit sample Replay.

Installed-source evidence (node_modules excluded from feature changes):
`expo/node_modules/@expo/cli/build/src/utils/port.js` supports port zero and busy-port
handling; `start/resolveOptions.js` preserves zero and resolves ordinary startup;
`start/server/middleware/ExpoGoManifestHandlerMiddleware.js` supplies the Expo Go
manifest and scope key. `expo-constants/src/Constants.ts` captures the loaded native
manifest and exposes expoConfig. Clearing Metro is a bundle-cache operation, not
deletion of AsyncStorage/SecureStore or proof of a native manifest switch.

### Actual latest results

| Check | Actual result / local evidence |
| --- | --- |
| Launcher-focused mocks | 111 passed, 1 suite; `.verification/startup-correction/launcher-results.json`, `launcher.log` |
| Configuration/root-selection mocks | 55 passed, 1 suite; `.verification/startup-correction/preview-config-results.json`, `preview-config-run.log` |
| Complete regression suite | **1,499 passed, 0 failed, 0 skipped; 41 suites; exit 0**; `.verification/startup-correction/full-results.json`, `full.log` |
| TypeScript | Passed, exit 0; `.verification/startup-correction/typecheck.log` |
| ESLint | Passed, exit 0; `.verification/startup-correction/lint.log` |
| Expo public configuration | Passed, exit 0; normal name Memy, Auth/API disabled, preview=false; `.verification/startup-correction/config.log` |
| iOS JavaScript export | Passed, exit 0; `.verification/startup-correction/ios.log`, `.verification/ios` |
| Android JavaScript export | Passed, exit 0; `.verification/startup-correction/android.log`, `.verification/android` |
| Final source / whitespace | All 109 runtime/test/config hashes matched after exports; tracked and added-file whitespace checks passed. `.verification/startup-correction/final-audit.json` |
| PowerShell instructions | Both blocks passed syntax parsing; startup was not executed. |

The tests execute the actual launcher/app-config handoff in a VM with synthetic
filesystem/child-process settings. Normal root-selection tests use pass-through
provider mocks and a Stack marker; they do not claim real authentication occurred.
Existing real-provider/service tests use mocked SDK calls. A new actual Router/UI
test replays all three normal scenes and confirms no sample banner, with completed
preferences retained. Preview tests still prove no providers/stores/transports.
All global network guards remain enabled; no live Auth/FastAPI/AI/email was used.

No test failed in this startup-correction run. Source self-review found no new
blocking issue. No dependency, backend URL, other worktree, auth/onboarding storage
key, production configuration, signup gate or Guest/paid AI behavior was changed.
No interactive Expo server was started by Codex. Bundling does not prove physical
device behavior, native Expo Go cache/history, live sign-in or real story retrieval.
Those remain pending, along with independent review.

The exact matching source snapshot is
`.verification/startup-correction/runtime-before-full.json`. Logs, final inventory
and hashes are ignored local validation artifacts, excluded from source changes.
The previous complete Task 3C file inventory is unchanged (45 paths), with only
the eight paths below modified in this correction. Nothing is staged or committed.

Exact eight files changed during this startup correction (the overall Task 3C
inventory remains 45 files: 27 modified and 18 added):

```text
apps/mobile/app.config.cjs
apps/mobile/scripts/run.cjs
apps/mobile/test/launcher.test.ts
apps/mobile/test/story-preview-config.test.tsx
apps/mobile/test/routing.test.tsx
apps/mobile/README.md
apps/mobile/STORY_DETAILS.md
apps/mobile/NAVIGATION_AUDIT.md
```

### Repeatable iPhone procedure (not executed by Codex)

Follow the normal-versus-sample commands in STORY_DETAILS.md. Stop only this
worktree's old preview with Ctrl+C, fully close Expo Go without clearing its data,
start npm start in THIS worktree's apps/mobile, confirm MEMY NORMAL APP, wait for
its NEW QR and scan it with Camera rather than selecting Recents. Expect normal
Memy with no sample suffix/banner. Completed onboarding leads to Welcome, or
verified authentication to My Stories. A genuinely fresh normal experience still
follows Language/Introduction without a banner; no completion is fabricated.

Replay must have no banner in normal mode. For fictional samples, stop that
terminal, close Expo Go without deleting data, then run npm run preview:stories
and scan its NEW QR. Expect the Sample Stories name and banner, including Replay.
If a launch fails/aborts or produces no new QR, stop instead of opening an old QR.
Do not uninstall Expo Go, erase preferences, clear secure sessions, create tunnels,
change firewall rules or configure a backend to change the displayed mode.
