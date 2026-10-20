# Mobile Task 3B verification — 20 October 2026

## Current review addendum — Unicode correction

The implementation results below are a historical record of the original 1,006-test
run. They are not the validation results for the subsequent Unicode correction.
Fresh full-suite/check logs and exact source hashes are supplied in the final
review ZIP under review/TEST_RESULTS.md and review/validation.

The added focused regressions reproduced 57 failures before the fix (151 passed,
208 total). After the correction, all 211 focused cases passed; three additional
control-only cases were added during self-review. The shared validator now trims
U+0085 and U+001C–U+001F at boundaries, rejects whitespace/invisible-only titles,
preserves meaningful internal text and snapshots title/language once. Separate
blocked-network diagnostics show zero token lookups and POST calls after the fix
for the original U+0085/strip-control reproductions. No live service was contacted.

**USER-REPORTED and still unresolved:** ordinary empty-title feedback was not
sufficiently visible on iPhone. This is deferred to the first small Task 3C subtask:
clear EN/SV errors for empty, whitespace-only and overlong titles, visibility above
the keyboard, screen-reader accessibility and zero invalid POST requests. No UI
layout/focus fix was made here; component-tree alerts do not prove device usability.

The actual API-local file remains absent. An ignored auth-local file is now present
but was not opened or copied during verification. Protected checks disable auth/API
configuration before any local file read. Live POST/GET and native device behavior
after this correction remain unverified. This addendum supersedes the historical
statements below about local-file absence and device-verification status.

## Original implementation verification (historical)

Verified branch: feat/mobile-create-story.
Verified clean base/HEAD: 0d2bb7be6e0b6b98ddbd954167522bd91471ef27.
The staging area was empty. No branch switch, fetch, stage, commit or push occurred.

## Final automated verification

All seven final checks passed against unchanged runtime/test/config SHA-256
snapshots. Complete results/logs are in the ignored .verification/task3b folder.

| Check | Actual result |
| --- | --- |
| Full mobile suite | 1,006 passed, 0 failed, 0 skipped; 33 suites; exit 0 |
| TypeScript | Passed, exit 0 |
| ESLint | Passed, exit 0 |
| Expo public configuration | Passed; authentication and API both disabled |
| Offline dependency compatibility | Passed; dependencies up to date, with Expo's offline-validation limitation warning |
| Android JavaScript export | Passed; 1,457 modules, exit 0 |
| iOS JavaScript export | Passed; 1,319 modules, exit 0 |
| Git/source whitespace | Passed; tracked diff and all 19 changed files |
| Windows guide syntax | All three PowerShell blocks parsed; none executed |

The final full-suite command is npm test -- --silent --testTimeout=15000.
The verification runner also writes JSON/log output under .verification/task3b.
Jest reported 137.612 seconds; the launcher process completed in 139.27 seconds.
The 852-test baseline is retained, with 154 additional cases. No snapshots are used.
There are no failed or skipped required final checks. Both JS exports were scanned
for the legacy project identifier and literal Supabase key candidates; none were
found. These scans supplement configuration/source review, not a complete secret
audit. JS exports are not native builds or real networking/device verification.

## Initial checks and retesting

The focused shared GET/POST adapter suites passed: 192 tests across 2 suites.
Initial form/controller/navigation/dashboard run: 115 passed, 2 failed out of 117.
Both failures were an accessibility test querying a nonfocusable native group
container; the individually accessible radio choices worked. The test assumption
was corrected without grouping/hiding those choices. The final isolated UI suite
passed all 36 tests. A TypeScript assertion using an unsupported matcher was
corrected; TypeScript and the initial ESLint check passed.

The first complete run passed 1,005/1,006 tests, with the existing signed-out
Replay navigation case exceeding Jest's five-second case budget. That unchanged
case passed in isolation using its original five-second budget (30 other cases
intentionally filtered/skipped in that diagnostic run). The full final run uses
--testTimeout=15000, without changing assertions, suite coverage or application
request deadlines. That complete final rerun passed all 1,006 tests.

All tests use synthetic credentials/data and explicit mocked services. Accidental
application fetch/XHR/WebSocket calls are blocked. No Supabase/FastAPI/AI request,
signup/email, interactive preview, database migration or deployment is performed.

The existing installed dependency tree was copied into this worktree only after
its mobile package-lock SHA-256 matched the completed dashboard's lockfile:
BBD841D1AA12214FE6B6A89D153A2EFEA7AA4E8C34B6571574395BACBE1C1E5A.
No dependencies were installed/upgraded; no ignored auth/API settings were copied.

## Scoped self-review

The existing verified-user token accessor, SDK refresh and secure session storage
remain unchanged. New creation requires the protected account and an explicit
button action; no URL parameter opens/submits the form. Missing API settings fail
before token access/POST. Both real local configuration files remain absent.

GET and POST share the existing transport, safe URL policy, deadline, response
validation and sanitized failures. Only title and language are sent. A valid 201
matching those values and draft status is required for success. Unknown/malformed
responses cannot create fake success or dashboard data.

Installed Expo 57 source was checked: its default native runtime installs Expo's
fetch unless the RN-fetch public-variable opt-out is enabled. The protected launcher
strips every EXPO_PUBLIC setting, including that opt-out. The pinned Expo iOS and
Android fetch implementations support redirect:error, as requested by the shared
client. Actual native transport/redirect behavior still requires device verification.

Controller locks plus UI disabled states prevent concurrent submissions. Owner,
generation, abort and route-focus guards discard stale work on Cancel, leaving,
background/revalidation, account change and sign-out. Titles live only in local
component memory. Back remounts the server list; no optimistic row or persistent
project store is added. Uncertain writes do not automatically retry or promise
server cancellation. Backend idempotency is not invented.

Memy artwork/colors, scalable text, safe areas, keyboard avoidance, readable errors,
56-unit controls and EN/SV are reused. Device screen-reader behavior and layouts
remain manual checks; test attributes are not full accessibility verification.
This is self/team review, not external independent review or production readiness.

## Remaining limitations

Actual iPhone/Android Create UI, live backend POST/GET, native networking/refresh,
server ownership/RLS, two-account cloud isolation and real uncertain-write
reconciliation remain unverified. The API address is intentionally unconfigured.
Only the existing first 50 dashboard projects are shown. Native exports will
verify JavaScript compilation, not native/device builds. The prior Expo Go QR
navigation and gated-registration activation limitations remain unchanged.
Cancellation cannot undo a server-accepted POST; crashes/retries across devices
need future server idempotency approval. Response-size validation occurs after
body reading and is not a native streaming memory cap.

See CREATE_STORY.md for exact safe Windows/iPhone steps and later prerequisites.
No code or settings outside this mobile task/worktree are changed.

## Exact changed-file inventory

19 files, all apps/mobile: 9 modified and 10 added. Nothing is staged.
Paths below are relative to the repository root.

Modified:

- apps/mobile/README.md
- apps/mobile/src/api/story-projects.ts
- apps/mobile/src/app/authenticated.tsx
- apps/mobile/src/screens/MyStoriesScreen.tsx
- apps/mobile/src/stories-copy.ts
- apps/mobile/src/stories/StoryDashboard.tsx
- apps/mobile/test/my-stories-screen.test.tsx
- apps/mobile/test/safety.test.ts
- apps/mobile/test/story-dashboard.test.tsx

Added:

- apps/mobile/CREATE_STORY.md
- apps/mobile/CREATE_STORY_VERIFICATION.md
- apps/mobile/src/create-story-copy.ts
- apps/mobile/src/screens/CreateStoryScreen.tsx
- apps/mobile/src/stories/CreateStory.tsx
- apps/mobile/src/stories/StoriesHome.tsx
- apps/mobile/test/create-story-client.test.ts
- apps/mobile/test/create-story-routing.test.tsx
- apps/mobile/test/create-story-screen.test.tsx
- apps/mobile/test/create-story.test.tsx

Suggested commit message (not executed):

feat: add native create my story flow
