# Day 15 — final backend validation and handoff

24 October 2026 · `codex/day-7-mobile-integration` · FastAPI 0.8.1.

**Final backend-side validation/tooling and handoff are prepared. Milestone 1
is not accepted for a personal-data pilot.** The full current physical-iPhone
journey, fresh two-issued-user JWT test and release/privacy decisions remain
pending. No production deployment, main merge, paid call, migration, policy or
Auth-setting change was performed.

## Current reviewed revisions

- Application-code baseline: `c67687ec4b392dbf0e4f73fc8451ac6f0da05560`.
  Day 14 published evidence baseline: `365b83bcc92ea01d87f86aa0d13bb8d25cedfb5a`.
  Day 15 changes are offline evidence tooling/tests and documentation, not app
  routes, mobile UI, database schema or live-provider activation.
- Native candidate: `feat/mobile-api-backoff` at
  `b787dcd70b54f6220bfa3d7c0899a2c1f677e080`, one commit beyond `1d93b74`,
  including native PDF/continuation. The prior backoff gap is addressed in
  source; physical acceptance is not inferred. See [the pinned review](day-15-mobile-review.md).
- Record the actual final review-branch SHA in the PR and handoff. Branch labels
  are mutable; later evidence/docs-only commits leave this app baseline intact.

## Eight duties

| Duty | Delivered / checked | Remaining boundary |
| --- | --- | --- |
| Final backend regression | Complete Python/SQL suites, API security/audio/memory/story/PDF regressions, OpenAPI, dependency consistency, offline bilingual journey. | Local doubles/PGlite are not real phone or hosted JWT evidence. |
| Two-user authorization | Existing verifier reviewed; exact development target, free mocks and exact-run cleanup. User approved two disposable password accounts, not anonymous Auth. | Browser credential entry requires human handoff; issued-token test/cleanup has not run. No existing-user password reset. |
| Real iPhone integration | Current native source review, corrected revision pair and final EN/SV checklist. User explicitly confirmed device test has not run yet. | All 12 physical cases remain pending; no iPhone completion claimed. |
| Retry/timeouts | Current native backoff source reviewed; limited 40-case parser/store exercise. Backend idempotency, timeout, cleanup and revision regressions pass. | Full native/runtime/backoff/VoiceOver acceptance pending; no new automatic write retries. |
| Supabase/Edge security | Fresh HTTPS health/readiness and missing/invalid-token checks; read-only hosted RLS/catalog audit; current Functions empty-state observation. | Valid-two-user writes, legacy public objects/helpers, independent inventory/backup/ingress/CVE review remain gates. |
| Privacy/deletion | [Current engineering behavior, risks and decision owners](security-release-gates.md#privacydeletion-readiness), linked existing detailed workflow. | No retention TTL, legal compliance promise, fake delete endpoint or founder decision invented. |
| Deployment/rollback | [Prepared runbook](pilot-deployment-runbook.md): env, HTTPS, migration target review, monitoring, backup prerequisites, compatible immutable-artifact rollback. | No deployment/restore/drill executed; old Supabase config explicitly excluded. |
| Acceptance/handoff/push | [Gate matrix](milestone-1-acceptance.md), fail-closed report validator, [Tarun handoff](tarun-final-integration.md), final review PR. | PR is for review only; do not merge/deploy or equate it with milestone acceptance. |

## Verification evidence

- Existing Day 14 baseline rerun: **1,231 Python passed, four skipped**, one
  existing Starlette/httpx warning (35.13 seconds).
- **Final complete suite: 1,296 Python passed, four skipped**, one existing
  Starlette/httpx warning, 23.21 seconds. Includes 65 new acceptance-validator
  tests; no skipped live test is counted as success.
- **86 isolated PostgreSQL tests passed**, 14.43 seconds; no cloud connection
  in the Node/PGlite suite. All migration/SQL fixtures use disposable local data.
- Offline EN/SV rehearsal: **142 assertions passed** with locally encoded silent
  AAC/M4A, real decoder/routes/validators/PDF renderer and explicit Auth/Data API
  doubles. `hosted_supabase:NOT_RUN`, `real_iphone:PENDING` remain in its output.
- New gate tool: 65 focused tests pass; combined historical device-validator
  coverage is 127 checks. Default exit 3/PENDING, no independent/pilot/release
  approval even if all input is self-reported complete.
- Limited native check: 40 pure parser/store cases passed against exact pinned
  source using Node 24 built-in TypeScript transformation and assertion shim.
  Not the full native Jest, UI, Expo build, transport or real-device suite.
- `pip check`: no broken requirements, not a vulnerability audit. OpenAPI
  matches: 25 operations/23 private, version 0.8.1 and unchanged success bodies.
- Privacy inventory default: offline, zero network calls, `deleted:false`.

```sh
cd backend
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
.venv/bin/python scripts/export_openapi.py --check
.venv/bin/python scripts/verify_day14.py
.venv/bin/python scripts/privacy_inventory.py
.venv/bin/python scripts/validate_milestone_evidence.py
# Last command intentionally exits 3 for valid, unaccepted evidence.
# From repository root:
npm --prefix supabase/tests test
```

## Fresh hosted results — 24 October

Exact development Supabase URL/key diagnostic passed, HEAD 200, fingerprint
`7dbc1add8497`. In-process FastAPI over real upstream HTTPS returned health and
readiness 200, missing token 401 and invalid unissued dummy token 401. These
requests wrote no rows and did not use an actually expired or valid issued JWT.

The unchanged Day 14 read-only SQL batch passed again against existing data:
16 RLS tables, three invoker views, 19 guarded core RPCs and no private rows
visible to empty/nonexistent SQL identities. Current aggregate data: two
projects/two sessions, seven sources/six memories, one draft/two edits/two
exports. No private content or row identifiers were reported. This is SQL-role
evidence, not two real users. See [security release gates](security-release-gates.md).

Anonymous sign-in remains off. The current development Functions page again
showed no functions listed, with a platform incident banner still visible.
Hosted metadata still contains one legacy public image bucket and four
anon-executable legacy database helpers; no object/helper was invoked or changed.
These are not a blanket security pass or four deployed Edge Functions.

## Required next actions

1. Human completes secure entry for two disposable password accounts, then
   privately provides credentials to the verifier in a real terminal—not chat.
   Run the full hosted EN/SV workflow and verify only exact-run synthetic
   projects/children are removed. Separately delete only those temporary Auth
   users with exact-target confirmation; account deletion alone is not erasure.
2. Tarun runs the current physical EN/SV journey plus retry/interruption and native
   accessibility/PDF checks; submit sanitized results and actual revision IDs.
3. Founders/controller resolve [privacy/security gates](security-release-gates.md)
   and agree the pilot scope. Keep paid calls/public live persistence disabled.
   Real AI accuracy is NOT_RUN; mock output cannot satisfy a real-AI promise.

The chosen outcome is **backend evidence/handoff delivered, acceptance held**.
No pending prerequisite is relabelled complete to meet the scheduled final day.
