# Day 13 backend security and reliability status

23 October 2026 · `codex/day-7-mobile-integration` · public API 0.8.1.

**Offline security hardening, audits and handoff are implemented. Production,
personal-data privacy sign-off, live-AI persistence and real-iPhone acceptance
are not certified.** No paid call, migration/deployment, Auth setting change,
hosted data deletion or main merge was performed.

Reviewed runtime pin: `a2dd8464cc2f5ffe4ec9dc0a73f5061b520d4f46`.
Privacy/audit tooling pin: `c2decb430be46e9e2d1c1f332e65315a18c9945b`.
Later documentation commits do not activate providers or change cloud state.

## Checklist — evidence and remaining boundaries

| Duty | Delivered | Not established by this work |
| --- | --- | --- |
| Authentication/authorization | All 23 private operations require online Auth; duplicate Authorization rejected; expiry/revocation/forged sub, owned parents and foreign resource denial covered. Auth response has total deadline, 256 KiB cap, duplicate/deep JSON rejection and no redirects. | Fresh real issued-user JWT and deployed RLS exercise not run today. Two health operations remain intentionally public. |
| Database/storage security | 16 core RLS tables, three invoker views and 19 restricted fixed-search-path definer RPCs audited in isolated PostgreSQL. Private ledgers and immutable sources tested. | Hosted policies, buckets/objects, backup expiry and old project deployment are not independently established by migration replay. |
| Privacy/retention | Audio spools wait for cleanup through repeated cancellation; explicit 0600 recordings. New count-only authenticated inventory and a scoped deletion request workflow. | No invented retention TTL or destructive story/account/export endpoint. Controller decisions, legacy FK/order/blob/backup handling remain gates. |
| AI persistence | Runtime-mutated real providers cannot invoke or save through public audio/conversation/story routes; pending-only extraction, immutable sources and failed-story preservation tested. | Actual real-AI persistence/provenance is still not implemented/released; mock-only SQL is not bypassed or relabelled. |
| OpenAI safety | Existing server key reused by permission, not printed or transmitted; default disabled and approval/allowance/failure tests pass with fakes. Official data-controls guidance reviewed. | User reports funds approved, but no active allowance/model call/quality verification was created today. Funding does not make public live persistence ready. |
| Reliability | Network/DB errors, idempotent replays, partial transactions, timeouts, concurrent operations, stale versions, decoder/PDF cancellation, private old revisions and provider failures covered. | Initial project/session creation and export-audit creation do not have universal idempotency; never blindly retry them after ambiguous completion. |
| Security/performance | Per-worker capacity 64, verified-user 120/min default, bounded 4096-user registry, private/no-sniff/no-referrer API errors; Supabase ignores ambient proxies. Readiness single-flight and 2s cooldown. Offline response/PDF timing measured. | Edge/distributed abuse controls, dependency CVE review and hosted load/real-device speed remain deployment gates. |
| Docs/push | This report, [privacy/retention workflow](day-13-privacy-retention.md), [deployment gates](day-13-deployment-readiness.md), refreshed [OpenAPI](openapi.json) and mobile error/retry guidance. Existing review branch only. | No production-ready/GDPR-compliant/all-live-tests-passed claim. |

## Verification

- **1,154 Python checks passed, 4 skipped**, 21.49 seconds; one existing
  Starlette/httpx deprecation warning. Day 12 baseline: 961 passing checks.
- **73 isolated PostgreSQL checks passed**, 11.31 seconds, including eight new
  catalog/ownership/erasure-constraint regressions over all existing migrations.
- `pip check`: no broken requirements. Current OpenAPI snapshot check passed;
  all 25 operations/23 private operations and success schemas remain intact,
  with additive documented 429 admission errors.
- `git diff --check` and changed-file credential-pattern scan passed. The real
  key stays in the ignored private server env file, not Git or Expo.
- Default inventory reports `network_calls:0`, `deleted:false`; default AI
  evaluation reports `paid_calls:0`, `quality_status:NOT_RUN`.

```sh
cd backend
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
.venv/bin/python scripts/export_openapi.py --check
.venv/bin/python scripts/privacy_inventory.py
.venv/bin/python scripts/evaluate_ai.py
.venv/bin/python scripts/benchmark_security.py --iterations 40 --concurrency 4
# From repository root:
npm --prefix supabase/tests test
```

The four existing gated Supabase live pytest cases remain skipped, not success
or paid-model accuracy results. The privacy tool's live `--run` option was not
executed. SQL deletions/rollback exercises occurred only inside disposable
PGlite engines containing fixed fictional identities, never hosted user data.
`pip check` reports dependency consistency, not absence of vulnerabilities.

### Offline timing observation

40 requests per API path at concurrency 4; three real 15,999-character fictional
PDF renders. One local run returned:

| Measurement | p50 | p95 | Boundary |
| --- | --- | --- | --- |
| Liveness | 1.451 ms | 3.312 ms | In-process ASGI, no network |
| Authenticated project list | 2.739 ms | 9.123 ms | Online Auth/Data API replaced by explicit HTTP doubles |
| In-memory fictional PDF | 109.430 ms | 116.630 ms | Real renderer, three samples, max 61,642 bytes |

80 mock upstream calls, zero network/paid calls. These are local smoke timings,
not a hosted latency/capacity SLA or iPhone acceptance. No private prose or user
IDs appear in the report.

## Findings requiring release decisions

Auth deletion alone leaves legacy books/settings and source/draft snapshots;
print orders can block project deletion. Source deletion alone deliberately
preserves draft snapshots. No data was erased to hide these findings.
Legacy public images, self-editable demo entitlement flags, recovery backups,
unauthenticated paid/deletion function source and sensitive legacy logs are
documented in [deployment readiness](day-13-deployment-readiness.md).

The authorised read-only development dashboard check showed the first-function
empty state with no deployed Edge Functions listed in `memy-ai-dev`. Nothing
was invoked/changed; old project state is unknown. Do not bulk-deploy the old
Supabase configuration. Independent review caught and fixed an incorrect
settings count column, unsafe token-prompt fallback and unsanitized benchmark
startup errors before commit.

Use fictional data and keep Tarun's current mock integration. Before any real
pilot, resolve the documented controller/retention, hosted security, approved
transport, actual-device and deployment acceptance gates. Live-model quality
testing remains a separately scoped, explicitly funded exercise.
