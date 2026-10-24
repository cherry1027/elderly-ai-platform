# Day 5 backend status

Completed 19 October 2026. Backend version **0.5.0** adds the free,
deterministic Create My Story workflow. No paid AI provider, key or API call was
introduced. This is a mock enforcement demonstration, not a live AI autobiography
writer or a guarantee about future model factuality.

## Delivered

- [x] Reviewed Day 4 source/memory models, conflicts, evidence, migrations and Git.
  Day 4 is pushed at `520d026` on `backend/day-4-mock-conversation`; main is still
  the separate Day 2 line. No previous implementation was recreated.
- [x] Explicit owned generation with strict boolean confirmation, saved project
  language and UUID action-key retries. Nothing generates automatically.
- [x] Bounded confirmed-memory aggregation with immutable user-source references,
  excluded pending/rejected/unsupported claims and conservative conflict blocking.
- [x] Deterministic first-person English/Swedish mock writer, without invented
  relatives, scenery, emotional intensity or unconfirmed dates.
- [x] Independent exact-content verification before persistence, plus a database
  canonical-content check that prevents unsupported text receiving `passed`
  through a direct authenticated RPC.
- [x] Owned generation versions, content-bound replay/deduplication, immutable
  generated originals, ordered source snapshots and per-revision verification.
- [x] Read/list/edit APIs and retrievable append-only edit history. User edits
  remain `needs_review`; source changes are reported without losing edited text.
- [x] Regression/security tests, independent review, hosted rollback-only checks,
  [Tarun's frontend contract](story-drafts-api.md) and incremental local commits.

## Verification evidence

- `cd backend && .venv/bin/python -m pytest -q`: **440 passed, 4 skipped**.
  Skips are the existing opt-in live integration checks. There are 37 focused
  writer/verifier tests and 54 draft API tests, plus strict contract tests and
  all prior regressions. The existing Starlette/httpx deprecation warning remains.
- `.venv/bin/python -m pip check`: no broken requirements. No dependency change.
- `npm --prefix supabase/tests test`: **42 passed** across the complete migration
  chain, including Day 5 ownership, factuality, conflicts, correction safety,
  retries, edit/source preservation and the hosted SQL script replayed locally.
- Migration `20261019020000_day5_story_drafts` was applied transactionally to
  dedicated development project `edbkuunyeyxnyenmmqud`, following explicit
  approval. Migration history now has **24** entries. No legacy project changed.
- [Hosted verification SQL](../supabase/tests/cloud-story-drafts.sql) passed:
  fictional English/Swedish generation, confirmed Malmö, omitted unconfirmed
  year, rejected relationship exclusion, unsupported-output refusal, edited
  original/history preservation, replay/deduplication, corrected year, version 2,
  stale-source/conflict denial, two-user isolation and anonymous denial.
- All hosted synthetic data was rolled back. Postflight matches the preflight:
  one Auth user, two projects, no sessions/messages, three settings rows including
  the two existing orphans. All five new Day 5 tables are empty. The original
  users/projects/settings were not deleted or changed.
- Hosted grants deny anonymous generation and authenticated direct draft INSERT;
  owner-checking generation RPC execution is granted only to authenticated users.
- The local server runs at `http://127.0.0.1:8000` with both mock flags explicitly
  enabled. `/health` and `/ready` return 200; OpenAPI/Swagger show version 0.5.0
  and Bearer security on all six Day 5 operations. Unauthenticated generation
  returns 401 with `Cache-Control: no-store`.

The HTTP regression tests use isolated Auth/PostgREST responses. Hosted SQL tests
use transaction-local JWT subjects and database roles, not issued login tokens.
These are not evidence that Tarun's real browser/Expo login-to-story flow already
passed. That frontend acceptance remains a team integration step.

## Branch and operating boundaries

The work is committed and pushed on `backend/day-5-story-drafts` at `7fab579`,
based on the pushed Days 1–4 backend branch. **Day 5 is not merged into main.**
GitHub publication is separate from development database migration deployment.

Checked-in flags remain `CONVERSATION_MODE=disabled` and
`STORY_GENERATION_MODE=disabled`. Start with both set to `mock` only when the
simulation is wanted. These are FastAPI provider gates, not database-wide kill
switches: direct user-JWT RPCs remain available for owned canonical mock drafts.
They cannot invoke a paid provider or persist unsupported text as verified.

Use FastAPI for memory review. A pre-existing Day 4 direct RPC with explicit
`confirmed` plus NULL correction can revert a correction in a versioned review;
normal API omission preserves it. This Day 5 migration does not change that older
RPC's semantics. The source-context token detects subsequent changes. Malformed
or whitespace-padded corrections are conservatively excluded by the mock.

No auth/email settings, existing orphan data, raw-audio retention policy, PDF
export, photo uploads, subscriptions, public hosting, live AI or live voice were
changed. The new mock emits narrowly supported paragraphs rather than embellishing
free-form prose. Real-model quality evaluation requires a later implementation.

## Tarun's next verification

After obtaining this branch, sign in to the dedicated development project, create
an `en`/`sv` project and session, submit and confirm a fictional memory through
the Day 4 API, then generate → preview → edit → retrieve/history. Reuse the same
action UUID for network retries and display the mock and review-state labels.
See [the six-route contract and examples](story-drafts-api.md). No password or
server secret needs to be shared for the handoff.
