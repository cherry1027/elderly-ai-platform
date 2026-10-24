# Day 15 — current Expo integration review

24 October 2026. **Read-only source review; not physical-device, issued-JWT or
live-provider acceptance.** No mobile source, device configuration, Auth setting,
hosted row, dependency, deployment or provider mode was changed for this review.

## Current revision and scope

Fresh GitHub branch inventory and the commit comparison identify the current
cumulative native integration candidate:

- Branch: `feat/mobile-api-backoff`.
- Exact commit: [`b787dcd70b54f6220bfa3d7c0899a2c1f677e080`](https://github.com/cherry1027/elderly-ai-platform/tree/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile).
- This is exactly one commit ahead of, and contains, the Day 14 reviewed native
  revision `1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e`, including its PDF and
  autobiography-continuation work. It is not the React/Vite web preview.
- The mobile change itself references backend handoff
  `365b83bcc92ea01d87f86aa0d13bb8d25cedfb5a`, API `0.8.1`.
- The [pinned comparison](https://github.com/cherry1027/elderly-ai-platform/compare/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e...b787dcd70b54f6220bfa3d7c0899a2c1f677e080)
  changes 39 files, adding backoff handling and retaining memory-review intent.

The source and deterministic test cases below were inspected through GitHub at
that exact revision. This review did **not** rerun the native Jest suite, create
an Expo build, start a phone app or certify a frontend-reported test total.

A limited offline check did execute the exact pinned pure
`test/api-backoff.test.ts` source against `src/api/backoff.ts`: **40 parser/store
cases passed** using local Node `v24.11.1`, its built-in TypeScript transform and
a minimal `node:assert/strict` test/assertion shim. No network, package install,
app files or Git refs were involved. This is not Jest, React Native transport/UI,
an Expo build or physical acceptance. The built-in transform emitted its normal
experimental-feature warning. The complete mobile suite was not available here.

## Day 14 backoff gap: addressed in source

The earlier finding in [Day 14's review](day-14-mobile-code-review.md) remains a
historically correct observation at `1d93b74`; it is no longer the current
source-level gap at `b787dcd`.

| Requirement | Current implementation evidence | Verification boundary |
| --- | --- | --- |
| Recognize admission, not arbitrary failures | `src/api/backoff.ts:12` accepts only exact `429/RATE_LIMITED` and `503/API_BUSY`. The shared transport `src/api/story-projects.ts:313` reads only bounded allowlisted JSON code metadata. Audio/conversation/memory/draft/PDF wrappers preserve typed errors and safe retry advice. | Static source and synthetic-response tests, not a hosted/device observation. |
| Bound `Retry-After` | Unsigned decimal delta-seconds only; absent/malformed values default to 60 / 1 seconds. Zero becomes one second; oversized integer delays cap at 86,400 seconds. HTTP dates, signs and fractional values use defaults. | This is a client waiting aid, not a new backend enforcement mechanism. |
| Prevent retry bypass | Owner/origin-scoped RAM store, monotonic extension of an active deadline, pre-token and pre-dispatch admission gates (`story-projects.ts:243–288`). Stale owner/cancelled responses cannot establish a new-account wait. | Account switching, background timing and controls still need actual-device acceptance. |
| Do not automatically repeat actions | `ApiBackoffProvider` is mounted above private screens; one expiry timer/foreground refresh updates state. Expiry enables deliberate controls and does not dispatch a GET, POST, PATCH, export or share. | Tests use fake clocks and native mocks. No live saturation/error injection was performed. |
| Calm translated feedback | `ApiBackoff.tsx` adds English/Swedish wait/ready messages, scalable text and a calm accessibility announcement rather than a ticking live countdown. Request controls wait; navigation, local editing and sign-out remain available. | VoiceOver timing, focus and large-text layout must be physically checked. |
| Preserve uncertain mutations | Unknown or plain-text outer `503` is still an uncertain write, not proof of pre-operation rejection. Timeouts/network/cancellation preserve ambiguity after dispatch. Existing action UUID/payload, expected draft revision and read-before-explicit-retry rules remain authoritative. | No automated retry or silent successful-save claim was introduced. Actual loss/reconnection remains a device gate. |
| Retain memory corrections safely | `src/memories/MemoryReview.tsx:116–247` retains selected memory ID, correction, immutable input and expected version in scoped RAM; complete rereads must agree before an explicit exact retry. An acknowledged PATCH cannot be declared successful from an older reread. Changed versions require deliberate re-review. | Private intent is cleared on background/inactive, leaving, unmount, access failure or owner/project/session change. It is not durable recovery after process termination. |

Pinned source: [backoff parser/store](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/src/api/backoff.ts),
[shared transport](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/src/api/story-projects.ts),
[provider/banner](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/src/api/ApiBackoff.tsx),
[memory reconciliation](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/src/memories/MemoryReview.tsx).

Inspected new test sources include `test/api-backoff.test.ts`,
`test/api-backoff-transport.test.ts`, `test/api-backoff-provider.test.tsx`,
`test/api-backoff-controls.test.tsx` and `test/memory-backoff-recovery.test.tsx`.
They cover strict pair/header parsing, owner/deadline isolation, cancelled late
responses, disabled controls, no automatic request at expiry, plain-text 503
ambiguity, retained correction/version, conflict, acknowledgment and cleanup.
Existing generation, draft-editing and PDF tests add exact-payload/revision and
read-before-repeat assertions. Their presence is not a newly measured pass count.

## Acceptance still pending

The latest native branch explicitly labels
[API waiting acceptance](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/docs/api-backoff.md#physical-iphone-acceptance-pending),
[continuation acceptance](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/docs/autobiography-continuation.md#real-iphone-acceptance--pending)
and [native PDF acceptance](https://github.com/cherry1027/elderly-ai-platform/blob/b787dcd70b54f6220bfa3d7c0899a2c1f677e080/apps/mobile/docs/pdf-export.md#real-iphone-acceptance--not-executed-by-codex)
as pending/not executed by Codex. No fresh complete device or two-issued-user
JWT result was found in those repository artifacts. Historical user-reported
earlier-feature acceptance is not current end-to-end certification.

Tarun should run the existing [fictional-data iPhone checklist](day-14-tarun-rehearsal.md)
with this newer mobile revision and an explicitly coordinated backend checkout,
then report only sanitized results. The approved trusted personal hotspot/private
network remains necessary: the current client accepts canonical RFC1918 IPv4
origins, not arbitrary public HTTPS/DNS staging addresses. No tunnel, firewall
exception, public server or transport allowlist change is authorized by this review.

The backoff-specific phone checks additionally need a separately reviewed
development fixture at an explicitly approved address. Do not hammer the hosted
service to force 429 or saturate it to force 503. Verify exact JSON admission and
unknown/plain-text 503 separately, background/foreground, sign-out during a late
response, EN/SV, large text and VoiceOver. Check native M4A permission/interruption,
PDF opening/share/cancel/return and account-isolated cache lifecycle in the full
journey. Android remains a separate physical run.

Keep Day 14 evidence pins historical. Any Day 15 run record must identify both
the actual backend checkout and mobile `b787dcd`; never relabel an old result or
submit new-revision claims to a validator pinned to the old pair. Static review,
offline backend tests, hosted SQL-role checks, issued-user JWT tests and physical
phone acceptance are distinct evidence layers. None alone grants pilot approval.
