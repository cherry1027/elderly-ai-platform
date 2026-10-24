# Day 12 pre-approval backend status

23 October 2026 · `codex/day-7-mobile-integration` · public API **0.8.1**.

**Provider adapters, offline safeguards and the bilingual evaluation package are
implemented. Live quality, live persistence/mobile integration and release
acceptance remain pending.** No paid model call was made; no spending approval
or active allowance was created. Key creation was separately approved and is not
funding approval.

## Checklist and acceptance boundary

| Duty | Delivered / remaining |
| --- | --- |
| Review existing AI | Day 11 baseline and provider interfaces reviewed. Public SQL/Expo modes are explicitly mock-only; canonical story saves do not accept arbitrary real-model prose. |
| Real speech adapter | OpenAI multipart adapter, EN/SV hint, bounded decoded private audio snapshot, sanitized failures; exercised with fake HTTP only. Recognition accuracy not measured. |
| Real conversation adapter | Separate text-reply/extraction calls, confirmed-only prior reply context, pending/confirmed contradiction checks and selected-language contract. Actual reply quality/language remains unverified. |
| Structured extraction | Closed schema, eight-candidate cap, exact source value/evidence, valid years/slots, no auto-confirmation/model-selected DB IDs; pending candidates only. Exact quotation is not semantic entailment proof. |
| Writer/verifier | Separate model pass, full paragraph/source-ID coverage, unsupported/incomplete review rejected; unsafe-candidate evaluation entry point. Not independent historical fact-checking. |
| Usage controls | Required private expiring written approval, allowed models, durable atomic per-attempt reservations, call/rate/reservation ceilings, no retry/refund. Administrative ceilings are not actual billing or a universal upstream hard cap. |
| Bilingual evaluation | Fictional TTS recordings prepared/decoded; WER/name/date, contradiction, code-switch and positive/adversarial story harness prepared. All actual quality results remain **NOT_RUN**. |
| Regression/handoff/push | Passing regression suite and [provider/evaluation guide](day-12-ai-integration.md), existing mobile API kept intact, review-branch commits only. No main merge. |

Day 12 adapter/runtime guard pin:
`b16955502c1e397d82b6997dfb5f75bf5ca38a69`; controls commit `a0460d3`.
Later documentation commits do not enable paid mode. No database migration,
Supabase change, new public endpoint/schema or dependency upgrade was made.

## Verification evidence

- **961 Python checks passed, 4 skipped**, 15.72 seconds; one existing
  Starlette/httpx deprecation. The four separately gated Supabase live tests
  remain skips, not OpenAI quality passes.
- **65 isolated PostgreSQL checks passed**, 11.80 seconds, including all previous
  ownership/history/source/export regressions. No Day 12 cloud SQL run was needed:
  this package makes no Supabase schema or data changes.
- **185 focused offline checks** cover provider transport, extraction/reply,
  writer/verifier, approval/usage and provider selection/evaluation fences.
  They use synthetic keys, temporary fake approvals and explicit doubles—not
  the provisioned real key or a real model.
- `pip check`: no broken requirements. Existing offline OpenAPI snapshot checks
  passed with all 25 operations and unchanged version/paths/response schemas.
- Offline `scripts/evaluate_ai.py` returned `paid_calls:0`,
  `quality_status:NOT_RUN`; no live CLI invocation was executed.
- Two local synthetic speech fixtures passed actual decoder bounds:
  `/private/tmp/memy-day12-fictional-20261023/fictional-en.wav`
  (6.21 s, 202796 bytes) and
  `/private/tmp/memy-day12-fictional-20261023/fictional-sv.wav`
  (7.68 s, 250000 bytes). These are temporary local TTS fixtures, not real elderly
  recordings, committed audio assets or transcription results. The builder and
  [reference dataset](fixtures/day12-ai-evaluation.json) reproduce their scripts.

Independent offline review led to fixes for public provider-injection bypass,
audio validation/reopen replacement, duplicate/deep provider JSON, malformed
falsy errors and unexpected-client exception sanitization. Regression cases
verify those failures remain bounded and cannot silently become success.

## Credential and spending safety

The developer selected `memy-ai-dev-backend` in secure Platform setup and approved
its server-only ignored env-file destination. The saved file is private (0600),
untracked and ignored; no plaintext key was printed, shared with Expo or added
to Git. No real credential was used in the test suites. All configured public
features retain their previous disabled/mock behavior.

No valid spending-approval file, paid-project setting or funded allowance was
created. The brief's SEK figures remain unapproved proposals. Before live tests,
an authorised administrator must review current model access/deprecations,
pricing/FX and worst-case ceilings, record genuine written approval and keep its
ledger intact. Approval text is not cryptographic proof of a founder's identity;
control files must remain administrator-only.

Usage enforcement is single-host POSIX evaluation only, not Windows ACL or
distributed-worker readiness. Unknown/failed/cancelled attempts remain reserved.
Actual usage must be reconciled separately with OpenAI; other callers/keys are
outside this local ledger.

## What is deliberately not activated

`AI_PROVIDER_MODE=openai` selects only the separate evaluation factory. Normal
FastAPI refuses that mode and injected OpenAI providers; audio has an additional
runtime guard. Existing conversation/story flags still accept disabled/mock
only. Thus this is **not yet an authenticated live-AI mobile workflow**.

The existing persistence contract stores mock mode and deterministic canonical
verification, and transcript responses lack persistent provider provenance.
Bypassing those checks or calling real output mock would be unsafe. A reviewed
live provenance/verification persistence design, migration/API/Expo contract and
fresh authorised two-user workflow are required before public live activation.
No service-role key, relaxed RLS or client-declared verification was introduced.

Next gates: founders' written budget, current provider compatibility/access,
funded bilingual and adversarial quality runs, privacy/retention/region review,
representative consented elderly audio, live provenance persistence, actual
Auth/PostgREST integration and iPhone/PDF acceptance. Model-reported language or
verification alone cannot satisfy those gates. Continue Tarun's existing mock
integration in parallel; no mobile setup change is needed for this package.
