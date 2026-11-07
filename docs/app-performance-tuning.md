# Local app performance pass — 6 November 2026

The reviewed local preview uses the mobile candidate `0811ff8` plus a separate
performance patch, published separately in `codex/mobile-performance-20261106`.
No deployments, hosted Auth changes or schema changes are part of this pass.

## Backend

- `RealAIGateway` reuses successfully validated project/session ownership reads
  only within one authenticated request. The context path needs two ownership
  GETs instead of five. There is no cross-request authentication or biography
  cache. The database still checks ownership and active state atomically when
  claiming/completing an operation.
- `REAL_AI_COMBINED_TURN_ENABLED=true` opts into one structured AI request for
  source-grounded memory candidates and the interviewer reply. It defaults to
  **false**. Both nested results must pass the existing language, evidence,
  uncertainty and response validators before the normal atomic persistence.
  Local conflict linking never rewrites a pause/stop reply.
- This path reserves one bounded 2,900-output-token request using the same
  approved model, approval and cumulative ledger. It has no automatic fallback
  or paid retry. Story writing retains its separate verifier and two-call gate.

## App

- Memoized message bubbles avoid rendering the saved thread on each keystroke.
- Transcript-to-message matching uses a Set instead of repeated scans.
- Repeat listening can reuse verified RAM-only WAV bytes: at most two clips,
  10 MB total, and the earlier of server expiry or five minutes. Expiry,
  backgrounding, session changes, sign-out and disposal clear the cache. No
  automatic speech generation is introduced.
- PDF download/share starts before the optional export-metadata refresh. There
  is still one export write and explicit metadata invalidation.
- A browser-specific compact-header width issue is fixed so the story title
  has usable horizontal space beside its options button.

## Verification and limits

- Backend: 1,932 checks passed; four hosted integration checks excluded.
- App: 254 focused checks, TypeScript, ESLint and production web export passed.
  The final layout correction also passed 54 existing workspace/layout checks
  and was visually verified in the signed-in browser.
- Independent reviews covered ownership reuse, the combined-turn path and the
  app performance changes.
- Real synthetic English/Swedish ordinary samples measured 4.938 → 3.932 seconds
  and 4.830 → 3.989 seconds of provider processing. These are single paired
  samples, not an app-wide latency guarantee. A Swedish conflict sample took
  6.192 seconds.
- Ten synthetic cases (12 provider requests) also covered conflicts, stopping
  and prompt injection. Accounted benchmark exposure was US$0.018852, including
  the existing safety margin; this is not a provider invoice. No Auth/database
  data was changed by the benchmark. Swedish extraction produced some
  overlapping candidates, which remain subject to human review.
- The existing US$5 window, expiry, cumulative history and US$0.75 remote hold
  remain unchanged. This is local testing, not external-pilot/device acceptance.

## Optional early reply preview (7 November 2026)

The reviewed progressive path uses the same configured text model, standard
service tier, single combined provider call, global/per-user governor and atomic
claim/complete/fail workflow. It does not generate a second, speculative answer.

`REAL_AI_STREAM_TURN_ENABLED=true` additionally requires the combined-turn switch.
An explicit `Accept: text/event-stream` on the existing typed or recorded-message
POST opts in. Ordinary JSON callers and a disabled switch keep the original
contract; the capabilities object and public OpenAPI JSON snapshot are unchanged.
A completed idempotent replay can return JSON to that same request. The client
accepts it without issuing a second POST.

The provider returns the interviewer reply first and extracted candidates second.
Only a complete, language-validated nested reply can be previewed. The interface
labels it as not saved and offers no Listen, memory confirmation or story action
for it. All extraction/source/conflict checks and atomic database completion are
still required. The final decoded message must exactly match the preview.

The bounded stream emits operation, optional reply, optional saving, then exactly
one completed/error event. Operation IDs are tied to the requested owner-scoped
project/session and immutable typed source. Errors before the first operation
keep normal HTTP status/recovery headers. Errors after streaming begins carry
sanitized status/code/recovery/original-operation metadata; they never authorize
automatic retries. Disconnect/background/timeout clears provisional prose and
preserves only the original operation reference for Check saved result.

Provider, relay and client return at a validated terminal event rather than
waiting for socket EOF. The server watches disconnects across ASGI versions and
cancels/joins its worker. Model output, events and total response bytes remain
bounded. No provider credentials, extraction JSON or internal instructions are
sent as preview text. The local preview relay only admits this transport for the
two exact authenticated conversation POST routes.

These changes reduce time before a real reply becomes readable; they do not
promise instantaneous completion or seven simultaneous provider workflows.
Mocked regressions and JavaScript exports remain separate from real provider
measurements, phone acceptance and the later hosted seven-user pilot.
