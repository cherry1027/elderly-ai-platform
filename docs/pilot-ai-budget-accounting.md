# Pilot AI accounting and tester limits

This is local, tested implementation. It does not activate AI, renew a spending
window, reconcile missing remote evidence, or create a hosting service.

## Reservation versus estimated cost

The original governor reserves an administrator-approved fixed ceiling before
every provider attempt. Historical reservations, approval digests, counters and
numeric usage logs remain intact. No historical reservation is automatically
refunded by these changes.

An optional private `AI_BUDGET_POLICY_PATH` enables cumulative pilot accounting.
Without that policy, the original fixed-reservation behavior is unchanged.

With a policy:

- A text request reserves a conservative bound from the complete UTF-8 request
  envelope and `max_output_tokens`, using the configured supported model's
  standard rates plus a 25% margin. The bound must fit the approval's per-call
  ceiling. Cached discounts are ignored.
- Completed responses with consistent numeric provider usage can receive an
  append-only settlement at a conservative usage-derived amount, rounded up
  with the same margin. The original reservation and gross counters remain.
- Unknown, incomplete, failed, cancelled and unmeasured requests keep their full
  reservation. Unsupported pricing/tier combinations are never discounted.
- A usage estimate exceeding its original bound is recorded and then blocks
  further dispatches for administrator review.
- Estimates exclude VAT, FX and fees and are not provider invoices. Actual
  upstream spending can only be confirmed against provider billing.

Transcription reservations round the probed duration upward to whole seconds,
add one second for container/decoder differences, then apply the margin. The
provider can report a whole-second duration even when the decoder reports a
fractional duration.

An over-ceiling observation stops further paid dispatch. A narrowly scoped
administrative `review_transcription_rounding` helper can acknowledge one exact
completed transcription observation after explicit review of a small duration
rounding discrepancy (at most 190 USD millionths). It appends a
`usage_overrun_reviews` row containing the matching amount/evidence digest,
reviewer, time and fixed reason. It never rewrites the original reservation,
settlement or counters; the full higher amount still counts against every cap.
This helper is not called automatically or exposed through an app API. It
cannot acknowledge unknown charges, other models or larger pricing overruns.

Current reviewed pricing references:

- <https://developers.openai.com/api/docs/pricing>
- <https://developers.openai.com/api/docs/models/gpt-6.1-terra>

The pinned text model is `gpt-6.1-terra`, with standard $1/M input and $5/M output
rates. Speech accounting conservatively prices every input/output token at the
higher audio rate; transcription uses reported duration at $0.0045/minute.
Unknown model aliases require an explicit code/pricing review.

## One global ceiling and separate tester limits

The policy pins an audited baseline of immutable reservation IDs plus a SHA-256
fingerprint of their complete rows, a reviewed baseline exposure amount, and an
outstanding remote hold. Future accounted usage is added to that baseline.
The policy is deliberately separate from the short-lived spending approval:
rotating an approval cannot reset cumulative exposure.

The baseline, global ceiling, remote hold and identity namespace are pinned
across every policy ID. A different filename or policy ID cannot release an
outstanding hold, move recent calls into a cheaper baseline, increase the global
ceiling or reset user identities. A legitimate future reconciliation or budget
increase needs a separately reviewed administrator migration. Removing the
policy environment path after initialization also fails closed.

Authenticated user identity must come from the backend's validated Supabase
identity. The backend binds it to `ai_budget_subject` around provider execution.
The ledger stores an HMAC pseudonym, never a raw account UUID/email, story text,
password or token. The private policy contains the HMAC namespace salt. Changing
that namespace cannot reset user quotas.

Each pilot user has a cumulative budget and attempt limit. These are enforced
with the global ceiling and the active approval in the same SQLite transaction.
The existing approval-wide rolling request-rate limit also remains enforced.
Whole multi-call actions take a nonblocking private file lock across processes.
Before their first paid stage, they check all required attempt/rate slots and
the conservative cost of the complete action. Another action receives `AI_BUSY`
rather than consuming the last extraction slot before its reply can run.
This is a single-host governor using one persistent ledger, not an independent
budget per application worker or tester computer.

## Closed pilot admission

For a remote five-user pilot, per-user spending limits also need an explicit
closed-cohort admission list. `AI_PILOT_COHORT_PATH` contains only 1–5 unique
canonical account UUIDs in a private reviewed server file. Staging requires it
before enabling live AI. It grants no funds and does not change Auth/RLS.
Saved-data/PDF/free audio reads remain available to their owner even outside the
list. See [pilot operations](five-user-pilot-operations.md) and
[recovery contract](pilot-api-recovery-contract.md). No real list is created by
these source changes.

## Private policy format

The JSON object has exactly these fields (integers are USD millionths):

```text
version: 1
policy_id: new administrator-reviewed immutable policy identity
approved_by: administrator label
global_budget_microusd: explicitly approved cumulative ceiling
baseline_exposure_microusd: reviewed exposure for the pinned baseline
baseline_reservation_ids: canonical reservation UUID strings
baseline_sha256: baseline_fingerprint(complete six-column reservation rows)
external_hold_microusd: entire unresolved remote allowance
per_user_budget_microusd: each tester's pilot allowance
per_user_max_calls: each tester's pilot attempt limit
subject_salt: 64 lowercase hex characters, generated privately
```

This schema description intentionally is not an executable approval or a new budget.
The policy and its parent directory must be private regular files/directories
(0600/0700); symlinks and linked files are rejected. Never include the policy in
mobile configuration, review ZIPs or version control. Restrict write access to
the administrator. Binding policy IDs authenticates consistency, not human
consent: writing a new file is not a substitute for spending authorization.

## Existing Mac and WSL history

The existing cumulative approved ceiling is US$10.50. Tarun's outstanding
US$0.75 allowance remains held until his actual WSL ledger and numeric provider
usage evidence are returned and reviewed. These changes do not release it.
The expired local approval does not become active after installing this code.

Read-only audit from the backend directory:

```bash
python -m scripts.reconcile_ai_ledgers --local-ledger /absolute/private/ledger.sqlite3
```

After the actual remote ledger has been returned privately, add
`--remote-ledger /absolute/private/returned-wsl.sqlite3`. The output contains
counts, fingerprints, conflicts and gross reservations, not raw user IDs or
private story content. This command never imports rows, releases a hold,
settles historical charges, resets a ledger or renews an approval.

A compatible report is only a review prerequisite. Before future transfer to
staging: pause all paid dispatch on both computers, preserve source snapshots,
review all new remote observations, resolve conflicts, then authorize an
append-only consolidation and one authoritative hosted ledger. Keep the remote
hold until that step is complete. Do not run simultaneous independent paid
copies against one shared approval.
