# Mobile Task 2B — verification and self-review

Date: 2026-10-20.
Worktree: memy-mobile-login. Branch: feat/mobile-auth-login.
Verified clean base/HEAD before editing: 22e7a4a70a64356af3116927bc8286d34aa9855c
(Mobile Task 2A). Remote: cherry1027/elderly-ai-platform.
All implementation changes are under apps/mobile. Nothing staged/committed/pushed.

## Results

The final navigation regression run passed 384 tests across 17 suites, with no
failures or skips. TypeScript, ESLint, Expo public configuration and the offline
dependency check passed. Android and iOS JavaScript exports both passed on this
final source. Expo configuration kept authentication disabled for verification;
the dependency check retains Expo's offline-validation limitation. Whitespace
and archive/source SHA-256 checks are part of the fresh review package.
Focused routing/native-intent verification also passed 47 tests across 2 suites.
Launch/auth tests use mocks or a router adapter, not a real native launch or
authentication request.

An earlier navigation rerun passed 382 tests; self-review then found the
missing-preferences sign-out edge below. Two regressions were added before the
384-test rerun. The earlier validation sequence was stopped before exports so only
the final source would be bundled.

### Previous 33-file version

The previous complete suite passed: 16 suites, 345 tests, 0 failures, 0 skipped,
19.671 seconds. This includes all existing Mobile Task 1/2A regressions and native
auth/storage/configuration/routing tests. Machine-readable results are ignored at
.verification/mobile-login-results.json.

The following checks then ran sequentially on the same application source:

| Check | Actual result |
| --- | --- |
| TypeScript, npm run typecheck | PASS, exit 0 |
| Full ESLint, npm run lint | PASS, exit 0, no warnings/errors |
| Expo public config | PASS; development authentication disabled in verification mode |
| Expo offline dependency check | Reported up to date, exit 0; offline validation limitation |
| Android JavaScript export | PASS, 1,437 modules, exit 0 |
| iOS JavaScript export | PASS, 1,299 modules, exit 0 |
| Tracked/new-file Git whitespace checks | PASS |

No tests were skipped. Exports used --no-bytecode; these are compilation checks,
not native builds or device tests. Expo's no-bytecode advisory and console-color
warnings are informational. Offline dependency validation is not an online audit.
No development server or website was started. Real authentication, native Keychain
and physical-device behavior were not independently tested by Codex.

During development, two test-fixture assertions, a React Native mock event type,
and a hook dependency warning were corrected. A preliminary full run overlapped
with exports and exceeded the five-second limit in two router tests; that run was
stopped and is not counted as a passing run. The final full suite runs separately
from bundle exports, with the original timeout unchanged.

A subsequent complete run had 316 passing / 24 failing tests (all 24 failures in
the storage suite). Its obsolete virtual dependency mock conflicted with Jest's
cached real module identity after earlier suites imported the adapter. Removing
that virtual flag and asserting the mocked native call corrected the focused
33-test suite. No application behavior or cache was changed to hide those failures.

Actual pinned-SDK tests use mocked transport for sign-in, refresh-token rotation,
server user verification, logout and sanitized error-code classification. Review
found that removing API-version response headers would lose modern SDK error codes.
The transport now emits only allowlisted codes in both supported SDK fields, keeping
incorrect-credential, unconfirmed-email and rate-limit messages useful without
passing through raw server details.

## Navigation follow-up

Confirmed code defects: index ran only for the root route; direct Login had no
Welcome-action guard; signed-out protected-route entry redirected to Login.
Cold Welcome also skipped the first-use decision. These are verified application
gaps, not proof that Expo Go restored the user's last route.

The fix adds ephemeral Login intent, set only by Welcome's Log In action. It is
not persisted, is not an auth credential, and cannot be granted by query parameters.
Cold/restored Login and protected routes return through the entrance. Readiness,
background state and ongoing authentication are respected before choosing screens.
Back/route departure and fresh entry clear UI intent; ordinary background/foreground
does not cancel intentional Login. Failed secure sign-out stays blocked with a
localized alert and retry on Welcome; it does not automatically open Login.

SDK 57's supported +native-intent hook normalizes cold/new external native links
to the root entrance. In-app Replay and language navigation do not use this hook.
No recovery, registration or content deep links are implemented in this task;
future callbacks need an explicit policy before this normalization is reused.
If Expo Go merely resumes a live experience without a URL event, JavaScript cannot
distinguish that from an ordinary return to intentional Login. Physical QR behavior
and standalone startup remain unverified for this revision.

Auth service, provider, secure storage, environment protections, dependencies and
onboarding preferences/artwork are unchanged by this routing correction. No session
or preference is cleared to force a screen; valid verified sessions take priority.
When a verified account has no onboarding record, an ephemeral returning-visit
marker preserves Welcome after sign-out or verification loss in that runtime.
The marker never creates a completed preference and cannot grant authentication.
On a new launch with no preferences and no valid session, first-use rules apply.
The old direct-Welcome regression test now supplies completed synthetic preferences,
so it still tests Back navigation without bypassing first-use rules.

## Scope and source review

Native Login is enabled from Welcome; registration and guest remain disabled.
Recovery, Story Projects, database changes, AI, recording and backend features are absent.
Existing introduction vectors/copy, EN/SV, motion, first-use and Replay are preserved.

Only explicit approved development client settings can enable auth. The launcher
retains disabled dotenv/client-env injection, strips inherited EXPO_PUBLIC values
and forces verification mode for checks. A mobile-local ignored JSON file supplies
only the fixed project URL and publishable client key to development Expo extra.
No root/web .env file is opened or copied. This navigation fix did not read, create
or modify the actual mobile-local configuration.

The supported SDK and URL polyfill use native SecureStore for sessions. Chunked,
bounded, device-only storage has atomic publication and a shared native-operation
queue. Closed clients cannot overwrite or delete replacement account sessions.
Authentication errors and bodies are sanitized before SDK processing; no passwords,
session tokens or raw errors are logged or exposed to UI.

Session restore and login require server getUser verification, matching issuer,
subject/role/expiry and a confirmed non-anonymous user. Cached user metadata alone
does not grant a signed-in screen. Refresh is foreground-only, expiry hides stale
identity, callbacks defer SDK operations, and late results are fenced. Background
screens hide account/form content; sign-out immediately removes visible identity.
Bounded server local-scope revocation is attempted; explicit local secret deletion
is mandatory. Failed local cleanup stays blocked with a retry action.

Self-review corrected the expiry/no-event case, background refresh-start races,
queued foreground revalidation, Android hardware-Back cancellation, stale
writes/deletes, callback scheduling, SDK error-code compatibility and
password-toggle semantics. Native
inputs/buttons have minimum 56-unit height, scalable text, labels, readable colors,
focus styles, native keyboard avoidance and safe-area/scroll support.

All automated auth traffic is mocked or blocked. There were no real login, signup,
recovery, Supabase, FastAPI, AI, database or microphone requests. Public npm packages
were obtained with lifecycle scripts disabled; no other worktrees were modified.

## Known limitations / manual status

- USER-REPORTED before this routing fix: approved development login, authenticated
  screen, valid session restoration after reopening, Sign Out and remaining signed
  out after reopening succeeded on a real iPhone in Expo Go. Codex did not perform
  those five checks. They do not verify the current navigation correction.
- Current iPhone QR/cold/warm routing, token rotation, native cleanup failure paths,
  keyboard/VoiceOver and large-text layout still need manual verification.
- The prior Task 2A iPhone graphics/navigation success was USER-REPORTED and predates
  this login addition. It is not end-to-end login evidence.
- Native secure operations cannot be cancelled. Hung/rejected cleanup blocks login;
  failed device storage removal cannot be claimed successful.
- iOS Keychain can survive uninstall; valid server verification is always required.
- Remote logout/revocation is best effort offline and does not sign out other devices.
- Strict token/SDK expiry matching fails closed if the metadata differs.
- Expo Go native behavior, long-running physical-device refresh, cloud account isolation,
  native/release builds and production readiness are not proved by mocks/exports.
- Expo Go supplies SecureStore natively; standalone build/plugin/backup configuration
  must be reviewed before a later release. No native build or configuration was deployed.
- No online vulnerability audit/doctor was run. Existing deprecated transitive tooling
  was not upgraded as an unrelated task.
- The previous 33-file authentication package received user-reported independent
  review with no critical auth security defect. The navigation revision still needs
  manual verification and independent review. No Task 2C.

See README.md for exact safe development setup and iPhone test instructions.

## Exact source inventory

36 changed files: 14 modified and 22 added. Every path below is relative to
apps/mobile; no root/web/backend files are changed. The mobile package lock is
part of this feature; unrelated package locks and MCP work were not touched.

Modified:

- .gitignore
- README.md
- VERIFICATION.md
- package-lock.json
- package.json
- scripts/run.cjs
- src/app/_layout.tsx
- src/app/index.tsx
- src/app/welcome.tsx
- src/components/Screen.tsx
- src/screens/WelcomeScreen.tsx
- test/launcher.test.ts
- test/routing.test.tsx
- test/safety.test.ts

Added:

- app.config.cjs
- development.auth.example.json
- scripts/auth-config.cjs
- src/app/+native-intent.tsx
- src/app/authenticated.tsx
- src/app/login.tsx
- src/auth-copy.ts
- src/auth/AuthProvider.tsx
- src/auth/client.ts
- src/auth/config.ts
- src/auth/errors.ts
- src/auth/secure-storage.ts
- src/navigation/LoginNavigation.tsx
- src/screens/AuthenticatedScreen.tsx
- src/screens/LoginScreen.tsx
- test/auth-client.test.ts
- test/auth-config.test.ts
- test/auth-provider.test.tsx
- test/auth-routing.test.tsx
- test/auth-screens.test.tsx
- test/auth-storage.test.ts
- test/native-intent.test.ts
