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
