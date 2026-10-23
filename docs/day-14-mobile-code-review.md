# Day 14: Expo source-to-API review

23 October 2026. **Read-only source review, not a real-iPhone acceptance result.**
No mobile UI, dependency, device configuration, cloud data or deployment was
changed by this review. No paid provider was invoked.

## Reviewed revisions

- Expo branch `feat/mobile-autobiography-continuation`, exact revision
  [`1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e`](https://github.com/cherry1027/elderly-ai-platform/tree/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile).
- This revision is one commit ahead of, and contains, the PDF feature revision
  `07c5c198c86f337ecbc09c62dfc19497bc8e1bbc`; it is not the older web preview
  or only the original mobile project-details branch.
- Compared with reviewed Day 14 runtime baseline
  `c67687ec4b392dbf0e4f73fc8451ac6f0da05560`, FastAPI `0.8.1`, its 25 operations and the current
  [mobile API contract](mobile-api-contract.md). The 23 business operations
  require a Supabase user Bearer token; the two health operations are public.
- The backend pin identifies reviewed application/runtime code. Later
  evidence-tool or documentation-only commits do not change that application
  code; report the actual checkout separately when coordinating a run.
- Source was read at the pinned revision through the repository; an Expo build,
  native test suite and actual device run were not performed by this review.
  Frontend-reported test totals are not newly verified test results here.

## Complete mock journey exists in source

All mobile source references below are relative to `apps/mobile/` at the exact
Expo revision above. The files describe implementation, not proof of device
behavior or hosted authorization.

| Stage | Native source and request | Static compatibility / remaining acceptance |
| --- | --- | --- |
| Sign in / restore | `src/auth/client.ts:250` verifies a session with Supabase `getUser`; `:308` exposes a token only for the expected signed-in account. `AuthProvider.tsx` hides the user while backgrounded. | Per-request user Bearer token matches FastAPI. Actual expiry, sign-out/sign-in and account switching must still be observed on device. |
| Dashboard / create / detail / edit | `src/api/story-projects.ts:495` onwards uses the existing project GET/POST/PATCH operations and validates selected IDs/language. | Project payloads and `200`/`201` success statuses match. Creation deliberately has no automatic retry after an ambiguous outcome. |
| Start / continue | `src/stories/Conversation.tsx:75` first lists sessions, reuses an active session, or calls canonical `POST /story-projects/{id}/continue`; client validation is at `src/api/story-projects.ts:624`. | Uses returned session, `200` and `generation_triggered:false`; never blindly creates through `/sessions`. Verify actual session reuse/no duplicate sessions in the authorized device run. |
| Record / upload | `src/audio/native-recorder.ts` owns native recording; `src/api/audio-transcripts.ts:117` sends actual M4A bytes via Expo's file-like multipart part, `language`, explicit `consent:true` and one stable UUID. | Client limits are 25,000,000 bytes and 90 seconds; backend independently decodes/validates. A real iPhone M4A and cleanup/permission/background behavior still need device evidence. |
| Simulated transcript / conversation | `src/api/audio-transcripts.ts:101` requires the permanent bilingual fictional simulation prefix; `src/conversation/TranscriptConversation.tsx:144` processes a saved source via `/messages` with a stable action key. | Original transcript is referenced, not overwritten or replaced with a fabricated local success. Conversation response requires `mode:mock`. This is not speech-recognition quality testing. |
| Confirm / correct / reject | `src/api/memory-review.ts:130` reads memories/clarifications; `:161` patches status/correction using `expected_version`. `src/memories/MemoryReview.tsx` reconciles ambiguous saves. | Native flow preserves original evidence/value separately from the correction. Verify confirmation, supported year correction, rejection and persisted reread on phone. |
| Generate / browse | `src/generation/GenerateStory.tsx:172` creates an explicit confirmed action and stable key. `src/api/story-drafts.ts:206` uses the documented generation body; `GenerationBrowser.tsx` reads selected generations. | No implicit generation on Continue/refresh. Strict mock mode, source snapshots and per-revision verification are checked. Human confirmation and current source selection need phone observation. |
| Edit / revision history | `src/generation/DraftEditing.tsx:143` sends content with the captured `expected_revision`; it rereads before an explicit exact retry. Client/history contracts are in `src/api/story-drafts.ts:238` onwards. | Matches optimistic revisions and manual-unverified wording. Conflict handling and preservation of older wording need device evidence. |
| Export / download / share | `src/api/story-exports.ts:140` uses export `POST` for `201` PDF bytes, historical download `GET` for `200`, and export-metadata GET. `src/exports/StoryExports.tsx` reconciles audits and saved selection before sharing. | MIME, length, private headers, selected generation/revision, export ID, filename and bounded PDF signatures match the backend. Native PDF opening, Å/Ä/Ö, pagination and share-sheet behavior must be checked on iPhone. |

Pinned implementation evidence: [shared transport](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/src/api/story-projects.ts),
[audio client](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/src/api/audio-transcripts.ts),
[memory review](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/src/api/memory-review.ts),
[drafts](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/src/api/story-drafts.ts),
[PDF client](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/src/api/story-exports.ts).

## Confirmed integration gap: admission backoff

Day 13 added `429 RATE_LIMITED` with `Retry-After:60` and `503 API_BUSY` with
`Retry-After:1`. At the reviewed Expo revision:

- The shared transport (`src/api/story-projects.ts:290–315`) does not read
  `Retry-After` or expose a safe retry delay.
- The audio, conversation, memory, draft and PDF allowlisted error maps do not
  recognize either new code. Unknown `429` is a generic unavailable error;
  `503` is also generic, with writes conservatively considered ambiguous.
- This does not bypass authentication or trigger automatic repeated writes.
  However, explicit retry controls are not guaranteed to wait the instructed
  60 seconds / one second, and generic wording cannot distinguish admission
  rejection from a database/provider outage.

**Frontend-owned follow-up before claiming complete Day 13/14 error integration:**
parse only a bounded safe `Retry-After` value, retain the two exact status/code
pairs, show localized backoff/loading feedback and prevent deliberate retries
until the delay elapses. Preserve original action keys and payloads, captured
revision/version and reconciliation rules. Do not turn this into automatic
POST/PATCH retries. Test both JSON admission errors and outer `503 text/plain`
network/server overload responses. No mobile source was changed in this audit.

## Network and privacy boundaries

`normalizeMobileApiBaseUrl` (`src/api/story-projects.ts:111–125`) accepts only
canonical RFC1918 IPv4 origins, optionally ending in `/api/v1`. It rejects DNS
names, loopback, public addresses and arbitrary URL paths. Consequently:

- The agreed trusted personal hotspot/private network is compatible when both
  devices can reach the approved computer LAN address. Shared student-housing
  Wi-Fi must not carry user tokens over plain HTTP.
- A new HTTPS DNS staging service is **not** a drop-in configuration change for
  this client; it requires a separately reviewed frontend allowlist change and
  authorized deployment/transport setup. No tunnel/firewall/public exposure is
  created by this review.
- API and Supabase origins must remain distinct. A publishable key is not the
  FastAPI Bearer token. Keep private configuration ignored; never copy backend
  `.env`, service-role keys or passwords into Expo.

`src/exports/native-pdf.ts` uses a dedicated app-cache directory, random names,
opaque RAM-only handles, eight-file/one-hour bounds and owned-file cleanup.
`expo-sharing` is present in the reviewed package file. Those are implementation
safeguards, not a guarantee that recipient apps remove a shared copy or that an
OS crash executes cleanup. A share explicitly hands the document to another
application; native cache lifecycle and account switch must be tested.

## Device and accessibility evidence still required

The mobile branch itself marks [continuation acceptance](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/docs/autobiography-continuation.md#real-iphone-acceptance--pending)
and [PDF acceptance](https://github.com/cherry1027/elderly-ai-platform/blob/1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e/apps/mobile/docs/pdf-export.md#real-iphone-acceptance--not-executed-by-codex)
as pending/not executed. Prior reports that other mobile tasks passed do not
establish the latest full journey or Day 13 security/backoff acceptance.

English/Swedish strings, accessibility-language labels, font scaling, busy/error
announcements and large controls exist in source (for example
`ConversationScreen.tsx`, `StoryExportsScreen.tsx`, `LargeButton.tsx`). Source
inspection cannot certify VoiceOver focus, real screen-reader announcements,
large-text clipping, contrast, touch targets, microphone prompts, share-sheet
return or interrupted-network recovery. Physically check these on iPhone;
Android is a separate acceptance run.

Use fictional histories only. Run the complete signed-in journey, interruption
and account-switch checks against the pinned backend, then attach sanitized
pass/fail observations and timestamps. Do not publish tokens, account email,
private story text, LAN IPs or native cache paths. Hosted JWT/RLS evidence and
actual-device evidence must be reported separately from this static review.

## Content-free device checklist

The [device evidence example](fixtures/day14-device-evidence.example.json)
contains the 12 mandatory Day 14 cases, all initially `pending`, and pins both
reviewed revisions. After an actual authorized run, Tarun may fill a local copy
using only `pending` / `pass` / `fail` and the three boolean attestations. They
confirm a physical iOS device, fictional data and trusted transport; never set
them merely because source or automated tests look correct. Do not add email,
tokens, story text, paths, screenshots or free-text notes to this JSON schema.

```sh
cd backend
.venv/bin/python scripts/validate_day14_evidence.py
# Optional: validate a locally completed content-free checklist instead.
.venv/bin/python scripts/validate_day14_evidence.py /absolute/path/to/day14-device-evidence.json
```

The default template returns `PENDING` with 12 pending cases. The standalone
validator makes no network call and loads no app/env configuration. Missing
cases, unknown fields, duplicate JSON keys, wrong pins and oversized inputs are
rejected without echoing file content. Even a fully checked report is labelled
`SELF_REPORTED_COMPLETE`, never independently verified or pilot approved.
Privacy release approval remains `PENDING` in every result. This tool records
the human's account of a run; it does not execute tests or authenticate claims.
Exit code `0` means the JSON is a valid pending/complete report, **not device
PASS**. Consumers must inspect `result` and `counts`; the all-pending template
intentionally exits `0`. A self-reported failed case exits `1`; invalid evidence
exits `2`. None of these exits grants independent verification or pilot approval.
