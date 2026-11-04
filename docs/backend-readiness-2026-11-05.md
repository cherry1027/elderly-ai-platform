# Backend pilot readiness — 5 November 2026

This work extends the real-v2 backend on `codex/real-milestone1-ai-backend`.
It preserves the existing API paths, user ownership, immutable original words,
confirmed-memory story inputs, PDF access and all historical spending records.
The mobile/frontend candidate remains Tarun's separate responsibility.

## Delivered implementation

- Optional cumulative accounting policy with an immutable historical anchor,
  the outstanding remote allowance, and separate authenticated-user limits.
  Short-lived approval rotation cannot reset the cumulative ceiling.
- Conservative request-size reservations, followed by append-only settlements
  for completed calls with usable provider usage. Failed/unknown calls retain
  their holds. Public-rate estimates are not provider invoices.
- Whole-action admission checks cost, call and rate headroom before a paired
  extraction/interview or writer/verifier workflow. A private host-wide lock
  prevents another action consuming its remaining slots. No automatic retries.
- Independent transcription, conversation, writing and speech controls, still
  subordinate to the explicit global enable and current spending approval.
  Capabilities stop offering two-stage actions when only one call remains.
- Stable error codes and `X-Memy-Recovery` advice. Exhausted/expired budgets have
  no misleading `Retry-After: 60`; ambiguous provider results require checking
  saved state before another attempt. The error body format is unchanged.
- Optional AES-256-GCM encrypted speech storage, owned reads and replay across
  restart. Future prepared replies can use 5–60 minute retention under the
  existing database contract. Old expired recordings are not restored or
  extended. Reading saved audio or downloading a PDF never enables paid AI.
- Read-only remote-ledger comparison, private SQLite backup, verified isolated
  restore, explicit speech cleanup and credential-free monitoring commands.
- A future single-instance HTTPS staging launcher, Docker build context and
  Render configuration with automatic deployment off and AI off by default.

## Operational scope and limits

Hosting stays **local**, as requested. Publication of these reviewed backend
changes to `codex/real-milestone1-ai-backend` is separately authorized. Publishing
the source does not activate the prepared deployment configuration or paid AI.
No paid server, public URL, hosted Auth change, database migration or production
change is part of this work. The Docker image requires a separate build where Docker is available.
Local backup/restore checks do not certify off-host backups or configured alerts.

Tarun's final WSL ledger and numeric usage observations have not been returned.
The full **US$0.75** remote hold remains reserved; remote reconciliation is
pending. The comparison tool does not import, refund or renew anything.

The previously approved cumulative ceiling remains **US$10.50**. The user
separately approved reconciliation of only two completed local calls and a
one-hour **US$0.50 maximum** live bilingual evaluation window. Existing failed
and uncertain historical charges remain covered. The private controls and
ledger are excluded from source/review packages.

## Quality evidence

`backend/scripts/evaluate_real_ai.py` targets the actual real-v2 adapters. Its
default invocation makes zero paid calls and reports `NOT_RUN`. Live execution
requires explicit upload consent, feature gates, an unexpired private approval
and the preserved cumulative ledger/policy. It checks English and Swedish
transcription, names/places/dates, exact candidate provenance, date correction,
language switching, confirmed-source writing/verifier and optional exact speech.

Synthetic local recordings are controlled fixtures, not elderly-user recordings.
Automated checks cannot establish natural-language quality, dialect/noise
accuracy, end-user usefulness, hosted ownership or actual-device acceptance.
Those limitations remain explicit in the evaluation output. Private synthetic
review samples are optional and never appear in public numeric reports.

See the delivered verification report for the actual latest regression count,
live evaluation result, conservative accounting totals and remaining manual
review. A model verification pass is a guard, not proof that a biography is true.

### Results of this run

- Backend: **1,798 passed, 4 opt-in integration checks skipped**, no failures.
- Local SQL/RLS suite: **116 passed**, no hosted migration or data writes.
- Dependency consistency, OpenAPI snapshot, compilation and whitespace checks
  passed. A test-client deprecation warning remains; it is not an app failure.
- Live real-v2 evaluation completed in both languages, including speech. There
  were 21 provider attempts including the initial duration-rounding probe.
- The English synthetic fixture had one place-name mismatch (WER 7.69%);
  the Swedish fixture matched its short reference (WER 0%). These tiny samples
  cannot establish older-speaker transcription quality.
- AI-assisted inspection found appropriate reply language, one-question turns,
  explicit date clarification and no invented claims in the one-sentence
  confirmed-source stories. This is not independent human review or evidence
  about longer stories. Speech pronunciation/listening review remains pending.
- Provider-usage estimates total approximately **US$0.021**, and conservative
  ledger accounting totals **US$0.026328** for this window so far. The gross
  reservations (US$0.356664) are not the bill. No invoice was checked.
- A rounded seven-second provider observation exceeded its initial duration
  reservation by 73 millionths of a dollar. The guard stopped. A narrowly
  reviewed append-only acknowledgement preserves both original amounts and
  counts the full higher settlement. Future bounds include whole-second
  rounding and one second of padding. Unknown/larger overruns still block.
- The original 58 reservations remain intact; the ledger now has 79 records.
  Before/after snapshots and isolated restores were verified.
- The updated local server returned 200 for `/health`, `/ready` and capabilities;
  all real-v2 features were available under the approved one-hour window.
  Availability ends automatically at the approval expiry or earlier limits.

## Handoff to Tarun

Keep the existing endpoint contracts and validated Supabase Bearer authentication.
Map `AI_GLOBAL_BUDGET_EXHAUSTED`, `AI_USER_BUDGET_EXHAUSTED`, `AI_USAGE_LIMIT`,
`AI_SPENDING_NOT_APPROVED` and `LIVE_AI_DISABLED` to allowance/paused messages,
not connectivity messages. Read `X-Memy-Recovery` and preserve saved words.
Only genuine rate/capacity responses have a bounded retry timer.

For speech, first use the free owned prepared-speech GET and audio GET. A missing
or expired reply needs an explicit generation request; never regenerate silently.
Use the existing operation reconciliation/idempotency flow after interruptions.

Before a remote pilot, return/reconcile WSL records, agree individual tester and
global allowances, approve hosting, configure exact HTTPS origins/callbacks,
privately migrate the canonical state, build/review the immutable release, and
complete the English/Swedish device and two-user hosted acceptance checklist.

Related runbooks: [AI accounting](pilot-ai-budget-accounting.md),
[speech retention](prepared-speech-retention.md),
[staging package](backend-staging-package.md).
