# Day 7 backend integration and reliability

Verified 20 October 2026. Backend **0.7.0**; cumulative review branch
`codex/day-7-mobile-integration`, based on pushed Day 6 commit `dabe71f`.
No merge to main, public hosting, paid AI provider or new database migration.

## Backend deliverables

- [x] Reviewed the clean Day 6 branch, all 25 existing operations, schemas,
  migrations and outstanding integration limitations. Reproduced the baseline:
  519 backend tests and 54 database checks.
- [x] Added a mock-only development launcher with explicit trusted-LAN opt-in,
  exact development-project pin, disabled access logs/proxy trust and a 32-request
  concurrency cap. Loopback is the default. No public tunnel was created.
- [x] Verified online Supabase Auth validation and user-JWT/RLS forwarding with
  two distinct disposable development identities. Invalid/missing credentials
  and cross-user resource access fail without disclosing private content.
- [x] Passed the bilingual authenticated project/session-to-story workflow
  through real FastAPI routes and the hosted development database.
- [x] Verified successful multipart WAV parsing/persistence with a fictional
  transcription fixture, immutable source processing, memory clarification and
  correction without overwriting original evidence. Normal runtime transcription
  remains deliberately disabled; M4A/WAV and failure/cleanup regressions pass
  locally against real decoder fixtures.
- [x] Verified explicit mock generation, manual revisions, identical edit retry,
  stale different-edit rejection, real private PDF bytes, continuation and
  explicit version two while the earlier edited draft/export remain unchanged.
- [x] Added bounded small API requests, sanitized JSON unexpected errors,
  cancellation-resistant Unix decoder reaping and accurate JSON error media types
  for PDF operations. Preserved audio's ownership-before-read checks.
- [x] Consolidated [Tarun's mobile handoff](frontend-integration.md), all 25
  operations, valid Swagger examples, languages, auth, uploads, retries,
  downloads and the complete fictional test walkthrough. Changes use incremental
  verified commits on the review branch.

These are backend deliverables. **Real Expo/iPhone acceptance is pending**; no
device test or team agreement is implied by the checkboxes.

## Regression results

- **610 backend tests passed; 4 opt-in live pytest cases remain skipped.**
  The original Day 7 run had 608; two fictional-demo fixture checks were added
  during the subsequent mobile handoff.
- **54 embedded PostgreSQL checks passed** across the unchanged migration chain.
- `pip check`: no broken requirements. No dependency upgrades were needed.
- Existing Starlette/httpx TestClient deprecation warning remains; it is not
  a failing test or a reason to change the pinned stack during integration.
- All 25 OpenAPI operations remain, 23 Bearer-protected. Nine strict request
  models now contain valid examples; no duplicate routes or relaxed validation.
- Loopback and observed LAN `http://192.168.0.21:8000` both returned 200 for
  `/health` and `/ready`; unauthenticated LAN business request returned 401 and
  no-store; permitted web CORS preflight returned 200. These probes ran from the
  Mac, **not a phone**. The IP may change and requires the same reachable network.

## Hosted two-user verification and cleanup

After explicit approval, anonymous sign-in was briefly enabled only in
`memy-ai-dev` (`edbkuunyeyxnyenmmqud`) to obtain disposable Auth sessions without
passwords or email. It was disabled again immediately after each pair was created.

The first run reached a saved draft, then stopped because the new harness
incorrectly expected 409 for an identical completed edit retry. The deployed
database intentionally returns 200 without another revision for that exact
retry. The harness was corrected and a focused regression was added. Its
synthetic project and both identities/settings were removed before rerunning.

The corrected run passed both **sv** and **en**, alternating project ownership
between two verified identities. It exercised actual Auth and PostgREST, actual
PostgreSQL ownership/RPC checks and the real PDF renderer. Conversation, story
writing and transcription were explicitly fictional; no provider key or paid
call was used. Access tokens stayed in process memory and were never printed or
saved. The harness cleaned and verified only projects it created.

Both rerun identities and only their generated settings were then permanently
removed with guarded exact-ID/run-marker checks. Final hosted postflight:

| Item | Retained count |
| --- | ---: |
| Existing Auth users | 1 |
| Existing projects | 2 |
| Sessions / messages / drafts / exports | 0 each |
| Settings rows | 3 |
| Historical orphan settings rows | 2, untouched |
| Day 7 disposable Auth users | 0 |
| Migration-history entries | 25, unchanged |

Email signup/confirmation, password policy, redirects, templates and existing
user/project data were not changed. Anonymous sign-in is restored to **off**.
The legacy Supabase project was not touched. This live mock harness is additional
evidence; it does not mark the four separately gated pytest cases as executed.

## Reliability boundaries and honest limitations

Non-audio API bodies have a 256 KiB observed-byte cap and a 30-second read
deadline, including requests without Content-Length. They return safe 413/408
errors. Unexpected API exceptions before a response starts become JSON
`500 INTERNAL_ERROR` with no-store and configured CORS. Response-started stream
failures cannot be replaced with a second response. No exception/request secrets
are written by the guard's fixed failure log message.

The launcher's Uvicorn concurrency rejection occurs before ASGI middleware and
can return `503 text/plain` without the JSON/no-store/CORS contract. Clients must
check status and Content-Type before parsing; ingress/network errors are not
guaranteed to have an application error envelope. LAN HTTP sends Bearer tokens
without transport encryption, so use only disposable development identities on
a trusted network; shared/public development needs HTTPS.

Audio retains its 25,000,000-byte/90-second limit, its bounded multipart parsing,
two admitted processing slots and isolated decoder process. Repeated request
cancellation now waits for a killed Unix decoder to be reaped before temporary
recording cleanup. A host crash can still prevent normal temp cleanup. Normal
disabled transcription currently validates/decodes owned uploads before returning
503; mobile clients should disable the recording action instead of repeatedly
uploading to an unavailable provider.

The launcher concurrency cap and audio/PDF semaphores are **per process**, not
per-user/IP quotas or production abuse protection. A PDF worker thread cannot be
forcibly killed: a hung renderer retains capacity and can delay shutdown. Public
deployment needs HTTPS, suitable ingress limits/user quotas, end-to-end deadlines,
worker isolation/shutdown policy and crash-time cleanup review. None were silently
provisioned or described as production-ready today.

Project/direct session POSTs do not support idempotency: reconcile ambiguous
responses before retrying. Audio/message/generate actions reuse their UUID key
and identical payload. Draft edits use optimistic revision checks; exact completed
retries are safe, different stale edits conflict. Continue reuses an active
session and never regenerates. PDF POST deduplicates its audit for the same saved
revision/title/options; GET downloads retain the historical saved text.

## Remaining team acceptance

1. Tarun should run this branch locally on his Windows computer or connect from
   the same trusted network. Separate home-network LAN addresses are not shared
   development hosting. A remotely hosted HTTPS endpoint remains a team decision.
2. Verify actual Expo-issued login tokens, session refresh/expired-token UX,
   create/rename/session/chat/review/draft flow and private PDF downloading on his
   real iPhone. Backend protocol/Auth tests are not this device acceptance.
3. Confirm mobile scheme/bundle ID, separately approve/allowlist the exact native
   callback and verify PKCE in an appropriate development build. The proposed
   `memy-foundation://auth/confirm` redirect remains pending; web callbacks stay
   working. No test email or Apple membership/build purchase was made.
4. Real speech recognition, live AI accuracy/latency, retention approval and
   production readiness remain separate work. Mock success does not validate them.

Use [frontend-integration.md](frontend-integration.md) as the single handoff;
feature-specific guides remain linked there. No message was sent to Tarun.

## Mobile handoff followup

The [Windows and iPhone quickstart](backend-mobile-quickstart.md) adds copyable
setup, safe client configuration, connection checks and an integration-error
report format. The [fictional bilingual fixture](fixtures/investor-demo.json)
contains five initial memories and a continuation memory in each language; the
real mock provider recognises all entries without calls to an external service.
Runtime/API behaviour is unchanged from `8375ada`.

A read-only hosted check confirmed that the existing authorised development
account has a confirmed email and configured password and is not banned. Its
two explicitly fictional dashboard projects are present, with no sessions.
Credentials and the account's email are not committed in these public guides.
No password reset, email, account/data mutation or Auth-setting change was
performed for the handoff. Its owner's actual app login and full iPhone flow
still need acceptance; the local fixture is not automatically seeded into the UI.
