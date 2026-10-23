# Day 10 backend status

23 October 2026 · **0.8.1** · `codex/day-7-mobile-integration`.

Backend implementation, focused memory/continuity verification and Expo handoff
are complete. Real-iPhone acceptance and a fresh issued-user-token API run remain
pending; no backend test is relabelled as a physical-device pass. All AI remains
explicitly mock; no paid provider is enabled.

## Delivered

- Reviewed Day 9 and the consolidated mobile handoff at `a629760`; reproduced
  the green baseline of 755 Python checks / 56 isolated SQL checks.
- Added route/provider coverage proving that a new session uses corrected,
  source-linked project facts from an older session, excludes rejected context,
  binds fact versions and rejects a stale result without partial turn success.
- Fixed a narrow review-intent issue: a stale confirmation omitting correction
  text now receives `409 CONVERSATION_CHANGED` instead of inheriting a newer
  correction from the preliminary read. Valid explicit and plain retries remain
  idempotent. Regression cases reproduced the old behavior before the fix.
- Added bilingual fictional review fixtures and provider/schema checks for
  uncertainty, 1974→1975 conflict, separate correction/rejection targets,
  chosen-language code-switch fallback and explicit Yes/No action semantics.
- Added the exact rollback-only Day 10 SQL workflow plus local migration/RLS
  execution, rollback-emptiness checks and collision protection. No migration,
  new endpoint, request field or response field was introduced.
- Updated [Tarun's Day 10 integration guide](day-10-memory-integration.md), the
  shared API/handoff and offline OpenAPI snapshot. All 25 operations remain.

Runtime fix pin: `a00df98eb97a3528cd83dff91c36bbda3a09323a`; context coverage:
`f2db820`. Later test/documentation commits do not alter the runtime patch.
Record the final review-branch HEAD when running acceptance. No main merge is
included.

## Verification

| Check | Result | Scope |
| --- | --- | --- |
| Complete Python regression | **767 passed, 4 skipped**, 24.22 s; one existing Starlette/httpx deprecation | Real FastAPI routes/providers/decoding/rendering with explicit local Auth/Data API doubles |
| Complete PostgreSQL regression | **60 passed**, 0 failed/skipped, 10.47 s | Actual migrations/RPCs/RLS in isolated PGlite; includes the exact Day 10 checker |
| Hosted Day 10 checker | **PASS; synthetic data ROLLED BACK** | Exact tested SQL in dedicated development; role/claim workflow, not actual Auth-issued JWTs |
| Hosted read-only postflight | **0 remaining in eight fixture categories** | Exact fictional subject/project IDs only; no existing story content queried |
| Dependency / contract checks | **PASS** | `pip check`: no broken requirements; OpenAPI snapshot matches 0.8.1 and retains all 25 operations |
| Native iPhone acceptance | **Pending with Tarun** | Latest reported UI is `feat/mobile-draft-editor` / `eb4eaa8`; not rerun on his device here |

The four optional live pytest tests remain skipped; hosted SQL does not turn
them into passes. `pg_cron`/`pg_net` provisioning is omitted only in the isolated
engine; application migrations execute as written. No package upgrades or new
paid dependencies were used.

The hosted checker returned `day10_memory_workflow:PASS`,
`review_retry_audit:PASS`, `stale_context:BLOCKED`, `owner_isolation:PASS`,
`source_and_history:PRESERVED`, `language_contract:PASS`,
`synthetic_data:ROLLED BACK`. `BLOCKED` is the expected rejection of stale work,
not a test failure. A separate read-only postflight found zero matching Auth
subjects, profiles, settings, projects, sessions, memories, review audits and
drafts for its two synthetic identities/projects. No cleanup DELETE was needed.
The eight scoped counts do not assert that no other developer changed unrelated
data concurrently. This SQL run validates the deployed database, not the new
FastAPI-only omitted-correction guard or fresh Auth login/token issuance.

## Required Day 10 behavior and evidence

| Requirement | Evidence / result |
| --- | --- |
| 1974 followed by 1975 detects conflict | Real mock fixture + existing provider tests + bilingual Day 10 SQL |
| Explicit correction stores confirmed 1975 | Versioned memory PATCH/RPC; original 1974/value/year/evidence remain intact |
| Rejected memory excluded from story | Rejected Ada and redundant date omitted; pending resumed-session emotion also omitted |
| Resume retains relevant context | Same active session reused; SQL also closes only its synthetic session and verifies new-session project context |
| Swedish and English responses | Provider fixtures in both languages; parent/session language stable |
| Brief language switch does not change project | Chosen-language safe fact-free fallback, plus persisted language checks |
| Duplicate review adds no unintended revision | Exact/no-op replay and one revision per changed fixture fact; stale competing logical updates denied |
| Cross-user memory access denied | Both ownership directions and anonymous denial in SQL, plus API owner/RLS defenses |
| Original transcript never overwritten | Original/evidence/source history checked before/after review; mutation rejected even for fixture table owner |
| Simulation remains labelled | Existing Day 9 audio/provenance GET/replay regression remains passing; no real recognizer added |
| Story uses supported, confirmed memories only | Exactly canonical corrected 1975, one confirmed source; pending/rejected/unsupported values excluded |

Focused new evidence lives in `test_day10_context.py`, `test_day10_fixture.py`,
the stale-confirmation cases in `test_conversations.py`, and
`supabase/tests/day10-memory.test.mjs` / `cloud-day10-memory.sql`.

## Continuity and concurrency limits

The deterministic provider receives project-wide non-rejected structured facts,
not the full text of every prior session. Pending facts are uncertainty/conflict
context, not approved autobiography facts. Current-session chronological history
is read separately. A new session's list routes are session-scoped; the UI can
load earlier owned sessions explicitly. No general long-term semantic memory,
translation, raw-history recall or `load_conversation_context` RPC is claimed.

The database serializes project/session/fact updates and rechecks expected
sequence/fact versions. Tests cover sequential opposing actions sharing a version,
stale cross-session vectors and safe replay. Single-connection PGlite and one
Dashboard query are **not genuine multi-connection contention/load tests**.
There is no project-wide raw-message-history token; adding arbitrary old narrative
to a model prompt would need a new consistency design.

Story confirmation is not a promise of unrestricted prose support. Existing
canonical mock writing excludes unsupported occupation/free-text corrections;
manual draft editing remains unverified and never changes original memories.
The fixed simulated audio fixture still does not recognize spoken words.

## Safety and remaining acceptance

Use only `memy-ai-dev`, reference `edbkuunyeyxnyenmmqud`, and fictional test
content. The new SQL checker runs under temporary synthetic database subjects
with local role/claim switches, collision guards and final rollback. It never
creates login credentials, dispatches emails, changes Auth/RLS or calls a model.
Do not run fragments, replace rollback with commit or delete a colliding row.

The [JSON fixture](fixtures/day10-memory-review.json) is verified but **not seeded
as a retained cloud session**. No fabricated live session UUID is handed to
Tarun. He can create it through the normal signed-in app following the guide.
The existing opt-in `scripts/verify_day7.py --run` client remains available for
two existing authorised development accounts; it was not rerun with fresh tokens
for Day 10. Do not request passwords/tokens in chat or enable anonymous Auth just
to manufacture a pass.

Remaining team acceptance: fresh real-token API behavior for the new stale-review
case, iPhone account/recording/review/resume/generation UX, permission/offline/
sign-out handling and true concurrent client testing. These are explicit pending
checks, not backend regressions hidden by the passing counts. No production
data, public deployment, paid service or main merge is part of Day 10.
