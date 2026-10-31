# Milestone 1 implementation handover — 31 October 2026

The implementation is ready for independent review and integrated acceptance.
This is not founder sign-off or a production release. Full physical-device
acceptance, human recording/voice quality evaluation and Tarun's final review
remain pending.

## Published source

| Component | Review branch | Base |
|---|---|---|
| FastAPI, real AI, development schema and local browser client | [`codex/real-milestone1-ai-backend`](https://github.com/cherry1027/elderly-ai-platform/tree/codex/real-milestone1-ai-backend) | `9acce16deeb31c80eb0d5c837dff6c4cce743d14` |
| Expo SDK 58, B3 chat/B4 autobiography and real AI mobile integration | [`codex/mobile-chat-autobiography-polish`](https://github.com/cherry1027/elderly-ai-platform/tree/codex/mobile-chat-autobiography-polish) | `de321bfb47ee5bb316431f62db9d9030fc79911f` |

These are separate review branches from the exact existing backend and mobile
bases. Neither branch is merged to `main`; no deployment command is part of
this handover. Use separate local checkouts/worktrees when reviewing both. The
original backend worktree remains unchanged.

## What is implemented

Supabase authentication and owned projects → atomic Start/Continue sessions →
explicit microphone capture/processing consent → immutable real transcripts →
context-aware AI interviewer and optional faithful spoken replies → grounded
memory suggestions with confirm/correct/reject → autobiography generation and
separate model review → manual edits and immutable history → private PDF sharing
and historical export retrieval. English (`en`) and Swedish (`sv`) remain fixed
at project level. The existing cream/green/bronze theme is preserved.

The browser client in `web-preview/` connects to the same real backend. It is a
browser adaptation, separate from native Expo acceptance. It supports existing
confirmed accounts, recording/file upload, conversations, memory review, drafts,
speech playback and PDF downloads. See its README for local setup.

The legacy `/api/v1` simulated AI contracts remain distinct. Start the mobile
real workspace with `npm run start:real`; missing configuration fails closed
and never fills the screen with invented AI output.

## Verification evidence and limits

- Backend regression: 1,526 passed; four separately opted-in live checks skipped.
- Mobile: 4,030 tests / 113 suites passed; typecheck, lint and offline Expo
  configuration/dependency checks passed. Offline dependency checks carry Expo's
  stated reliability limitation.
- Local PostgreSQL/PGlite schema and ownership tests: 101 passed.
- Browser API/workspace/proxy: 27 offline checks passed; browser startup and
  the real backend connection were verified separately from authenticated usage.
- Funded English/Swedish HTTP acceptance passed the real transcription,
  interview, memory review, writing/verifier, edits/history, PDF and verified
  speech pipeline with clearly labelled synthetic speech inputs.
- The full two-user run passed 26 cross-user denials. A second Swedish turn
  reused its session, preserved originals/four ordered messages and passed
  three more denials. Only the two exact disposable test accounts and their
  synthetic data were cleaned up.
- Both real generated PDFs were rendered and visually reviewed across four
  pages. These tests do not prove human transcription quality, iPhone playback,
  microphone permissions, native sharing or all interruption scenarios.

See [the real integration runbook](milestone1-real-integration.md), the
[OpenAPI snapshot](openapi.json), and the mobile branch's
`apps/mobile/docs/real-ai-milestone1.md`. Earlier B3/B4 simulation checklists
describe their original contract; use the real integration runbook for current
real-provider acceptance.

## Tarun's next acceptance pass

1. Review both exact pushed heads and keep a record of the commit SHAs tested.
2. Use an authorized development account on a trusted personal network with the
   reviewed Mac/POSIX backend. Shared/public LAN HTTP must not carry user JWTs.
3. Complete one short human English recording through real transcription,
   relevant interview response and actual spoken playback. Record sanitized
   accuracy/latency results, then review memories, generate/edit a story and
   open the actual natively shared PDF. Repeat with a Swedish project.
4. Verify background/reopen, denied microphone access, interruptions, lost
   responses/reconciliation, duplicate taps, revision conflicts and cleanup.
   Record PASS/FAIL/PENDING honestly and return findings before final sign-off.

No provider/server credentials, personal configuration, account tokens, raw
recordings, billing screenshots, usage ledgers or private approval files are
published. Real AI stays off by default and uses the existing time/budget gate
when explicitly enabled. Preserve the same cumulative US$10 testing ceiling
and ledger; purchasing credits does not create a new spending authorization.
Windows paid-server activation and shared HTTPS hosting are separate work.

The earlier independent-review ZIP predates the browser adaptation. Review the
pushed source heads for the complete current code; do not assume the older ZIP
includes `web-preview/`.
