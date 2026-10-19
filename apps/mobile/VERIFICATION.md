# Mobile Task 2A — verification and self-review

Date: 2026-10-20. Worktree: memy-mobile-onboarding.
Branch: feat/mobile-animated-intro.
Verified initial clean HEAD/base: f621c7d1f82e00ec920d19e319571fe6ba6d5392.
Remote: https://github.com/cherry1027/elderly-ai-platform.git.
Only apps/mobile feature files are changed. No staging, commit, push, merge or deploy.

## Checks actually run

| Check | Final result |
| --- | --- |
| npm test -- --silent --json --outputFile=.verification/task2a-tests.json | PASS: 179 tests, 10 suites, 0 failed/skipped; 21.544 seconds |
| npm run typecheck | PASS, exit 0 |
| npm run lint | PASS, exit 0; no warnings/errors |
| npm run check:dependencies | PASS, exit 0; installed versions match local SDK expectations; offline validation caveat printed |
| npm run check:config | PASS, exit 0; Memy, Android/iOS, Router only; no application backend settings |
| npm run check:bundle | PASS, exit 0; Android JavaScript export, 1,376 modules |
| npm run check:bundle:ios | PASS, exit 0; iOS JavaScript export, 1,238 modules |
| npm start -- --help | PASS, exit 0; launcher/CLI load; no server or device started |
| Git whitespace checks | PASS for tracked changes and all 13 new files; Windows LF/CRLF notices only |

Raw final Jest results are stored locally in Git-ignored
.verification/task2a-tests.json. App source was unchanged after platform exports;
later corrections affected tests/documentation only. No preview service was started
for this task. No native build, simulator or device run is claimed.

Earlier runs exposed RN 0.86 type/lint compatibility issues, duplicate navigation
history, and test-only defects. All were corrected and retested. The focus test
initially expected a host fixture instead of RN Jest's Text composite ref; attempting
to format that mismatch exhausted Node's heap. A diagnostic run was stopped and
the assertion corrected to check the actual heading identity without serializing
its Fiber tree. The final full suite passes with the ordinary Node heap setting.
Competing per-file/global storage mocks also caused provider-test failures;
the tests now share the same controlled mock as the app. No tests remain failing
or skipped in the final run.

## Security and regression self-review

No auth SDK, application endpoint, environment reads, paid service, microphone
permission, browser state or web component was introduced. Only local preferences
are persisted. Tests block fetch, XMLHttpRequest and WebSocket. Source/configuration
boundary tests supplement actual route/component/storage tests; native APIs are
mocked by Expo/Jest. Mocked tests do not establish device behavior.

Task 1 tests remain with routing/storage assertions adapted to the explicitly
approved introduction and persistence behavior. Launcher safeguards remain tested,
including LAN/offline separation, disabled dotenv/client environment injection,
local tool resolution, invalid commands and child failures. No root web scripts run.

AsyncStorage reads accept only bounded version/language/completion records. Writes
snapshot those fields and serialize actual native operations. A timed-out read
cannot overwrite active state later; failed/hung writes cannot block navigation.
A warning explains that preferences may not survive a subsequent launch. Replay
never clears completion and language changes retain it. No personal content is saved.

Real vectors render in component tests. Animation tests check finite native-driver
timing, static reduced-motion art, updates and cleanup. Route tests exercise the
actual Expo Router and screens through first use, completion, skip, replay,
returning use and language changes. No screen advances automatically.
Repeated replay, language changes and scene-1 Back retain stable navigation
history instead of accumulating duplicate screens. Skip/Enter guard repeat presses.

Accessibility self-review: scalable localized text, safe areas, scrollable layouts,
56-unit controls, labeled radio/disabled button states, hidden decorative SVG,
OS reduced-motion monitoring and best-effort screen-reader heading focus.
Native Yoga layout, VoiceOver/TalkBack behavior and visual quality require hardware.

## Dependency/tooling record

One new runtime dependency: @react-native-async-storage/async-storage 2.2.0,
matching Expo SDK 57's bundled native module list. No existing dependency upgrade
was requested. The app-local lockfile records this addition.

Initial npm installation attempts returned Windows EPERM creating package
subdirectories. No permissions/ACLs, Git locks or other worktrees were changed.
After confirming writes in the authorized local dependency directory, a lockfile-only
refresh followed by npm ci succeeded (lifecycle scripts disabled; no audit/fund).
Public npm packages were obtained; no private/project backend services were contacted.
Android/iOS export warnings concerned intentionally disabled bytecode and console
color settings. Exports are JavaScript compilation checks, not release artifacts.
No online doctor or security advisory audit was run.

## Device verification and remaining limitations

USER-REPORTED historical Task 1 result: Language Selection and Welcome launched on
a real iPhone using Expo Go. This predates Task 2A and is not verification of these
animations, persistence, navigation or accessibility changes.

Task 2A iPhone graphical verification, VoiceOver, Reduce Motion, large text,
landscape, and Android hardware Back/TalkBack remain pending. iOS/Android JavaScript
exports validate compilation only; no native build, simulator or phone was run.
Local preference storage can fail or be cleared by the OS/user; progress then
continues only in memory and first use may repeat. No backend/AI/microphone,
Supabase, production or cross-user behavior is exercised or claimed.

No independent review has been performed by Codex. Manual iPhone verification
and independent review are required before approval to commit. No Mobile Task 2B.

## Exact changed-file inventory

All paths below are relative to apps/mobile in this worktree.

Modified (15):

- README.md
- VERIFICATION.md
- package.json
- package-lock.json
- scripts/run.cjs
- src/app/_layout.tsx
- src/app/index.tsx
- src/app/welcome.tsx
- src/language.tsx
- src/screens/WelcomeScreen.tsx
- test/launcher.test.ts
- test/routing.test.tsx
- test/safety.test.ts
- test/screens.test.tsx
- test/setup.ts

Added (13):

- src/app/introduction.tsx
- src/app/language.tsx
- src/components/AnimatedMemoryBook.tsx
- src/components/PreferenceLoading.tsx
- src/intro-copy.ts
- src/onboarding/preferences.ts
- src/screens/IntroductionScreen.tsx
- src/useReducedMotion.ts
- test/artwork.test.tsx
- test/intro-screen.test.tsx
- test/motion.test.tsx
- test/preferences-provider.test.tsx
- test/preferences.test.ts
