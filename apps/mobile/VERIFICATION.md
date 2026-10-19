# Mobile Task 1 — final startup fix and verification

This is a source self-review/local test record. Independent review is still pending.

## Scope and Git state

Worktree: memy-mobile. Branch: feat/mobile-expo-foundation.
HEAD/base: 5e2cd3eeab27ed666b541ab4d674ae49457a7cda, unchanged.
All Mobile Task 1 files are new, unstaged additions under apps/mobile.
No existing tracked files, repository-root packages, backend or web worktrees changed.
No dependency installation, stage, commit, push, merge or deployment occurred in this step.

## Startup correction

The previous launcher passed both --lan and --offline. Installed Expo CLI 57
rejects that combination. Its unconditional EXPO_OFFLINE=1 was also inappropriate
for regular LAN startup.

- npm start: Expo start --go --lan.
- npm run android: same, plus --android.
- Both remove an inherited EXPO_OFFLINE value from the child environment.
- Verification commands keep EXPO_OFFLINE=1.
- Every command still forces EXPO_NO_DOTENV=1, EXPO_NO_CLIENT_ENV_VARS=1 and
  EXPO_NO_TELEMETRY=1.
- Tools resolve inside apps/mobile; no root Vite/Lovable/MCP configuration runs.
- Invalid launcher action names are rejected without running a child.
- No tunnel, firewall change, application endpoint or new UI feature was added.

LAN startup can use Expo's own metadata/development tooling services. It is not
network-blocked mode. The application still has no authentication/backend/AI requests.

## Final checks actually run

| Check | Result |
| --- | --- |
| npm test -- --silent | PASS: 79 tests, 5 suites, 0 failures; 41.059 seconds |
| npm run typecheck | PASS, exit 0 |
| npm run lint | PASS, exit 0; no errors or warnings |
| npm run check:config --silent | PASS, exit 0; public config is Memy with Android/iOS and only expo-router plugin |
| npm run check:bundle | PASS, exit 0; Android JavaScript export, 1,362 modules |
| npm run android -- --help | PASS, exit 0; CLI loads without starting Android/emulator |
| npm start -- --port 8187 --max-workers 1 | Actual bounded LAN startup passed in CI mode |
| GET local /status | HTTP 200 and packager-status:running |
| Stop owned startup session | Ctrl+C; test port successfully rebound afterward, proving release |

The LAN check deliberately inherited EXPO_OFFLINE=1 to exercise removal by the actual
launcher. CI=1 and EXPO_NO_DEPENDENCY_VALIDATION=1 bounded the check and skipped
interactive/dependency-service prompts. It did not open a phone, emulator or browser.
No existing process was stopped. The TCP bind probe established the chosen test port
was free before startup and released afterward.

All original 47 tests remain, plus 32 launcher regressions. Router tests exercise
actual navigation; native modules are mocked by Expo/Jest. Launcher tests execute
the actual script in a VM with mocked child processes. They verify argument lists,
child environment protections, inherited offline removal, working directory, failure
handling and invalid action names. They do not start services.

The public config excludes internal filesystem metadata by design. Source configuration
is static, has no Supabase/FastAPI/AI settings or update service, and only contains the
Router's generated extra configuration. No real environment file was inspected.
No public config or server response containing credentials is included in review output.

## Observed non-blocking tooling limitations

- Windows denied the optional CIM port-owner query. Permissions were not changed.
  Cleanup used only the owned terminal session and verified port release by binding.
- React Native DevTools attempted its normal cache download and reported Access Denied
  in the restricted Codex cache, then used a fallback. Metro remained healthy.
  No cache permissions or unrelated files were changed to suppress it.
- Android export printed console-color and intentionally disabled-bytecode warnings.
  It is a JavaScript compilation check, not a native build or device test.
- An online Expo doctor/security advisory audit was not performed; dependencies were
  not changed during this startup fix.

## Device verification — USER-REPORTED

The user reports that Mobile Task 1 successfully launched in Expo Go on a real
iPhone, and that Language Selection and Welcome rendered.

This report was provided before the startup fix. Codex did not perform or observe
the phone test. UI source and artwork did not change in this fix. Do not infer
successful device navigation, VoiceOver, large-font, landscape or Android checks
from the launch/render report.

## Security/accessibility self-review

No remaining blocking source defect was identified in this narrow foundation.
The app uses local native SVG/React Native components and in-memory language state.
It has no environment reads, authentication SDK, backend endpoint, recording,
guest allowance, storage, remote assets or paid service integration.

Scalable text, 56-unit minimum controls, language radio checked states, readable
labels, safe areas, scrollable layouts and decorative SVG hiding remain present.
No animated route transitions are enabled. Jest cannot establish native Yoga
clipping, screen-reader focus or pronunciation. These require device verification.

Pending: post-fix phone startup, Android Expo Go/hardware Back, full navigation,
maximum text size, landscape, VoiceOver/TalkBack and independent review.
Language resets to English on reload; platform fonts differ intentionally.

## Package identity

The independent-review ZIP includes every complete Mobile Task 1 file, tracked/new
Git diffs, inventory, SHA-256 manifest, current test results and review/device notes.
The archive's MANIFEST.json is the authoritative hash list for the packaged files.
No actual .env, credentials, dependencies, generated exports, caches, Git metadata
or unrelated project files are included.

See README.md for exact beginner-friendly startup/testing instructions.
