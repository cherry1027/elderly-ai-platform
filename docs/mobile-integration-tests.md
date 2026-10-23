# Mobile backend verification and acceptance

This report is for backend **0.8.0**, runtime baseline
`73094c77c9c9d04a9a4c6b213b05112eb675c130` on
`codex/day-7-mobile-integration`. It supports Tarun's reported mobile
`feat/mobile-draft-editor` checkpoint `eb4eaa8`; the mobile result is a team report,
not an independently rerun iPhone test in this backend audit.

Use the [handoff](mobile-backend-handoff.md) and
[API contract](mobile-api-contract.md) for setup and request formats. Nothing in
this verification authorizes production testing, paid providers, Auth-setting
changes, new usable login accounts, a public deployment or deletion of existing
data. Transaction-only synthetic database subjects are distinguished below.

## Fresh results

The following complete suites were rerun against the unchanged runtime baseline
while preparing this handoff. Both suites used synthetic, isolated local data;
the separately recorded hosted check used transaction-only fictional fixtures.

| Check | Actual result | Scope |
| --- | --- | --- |
| Backend: `.venv/bin/python -m pytest -q` from `backend/` | **752 passed, 4 skipped**, 32.63 seconds | Python validators, routes, controlled failures, mock HTTP journeys and actual audio/PDF processing |
| Combined handoff regression | **755 passed, 4 skipped**, 20.54 seconds | Same runtime plus three offline snapshot/exporter checks; one existing deprecation warning |
| Database: `npm test` from `supabase/tests/` | **56 passed, 0 failed, 0 skipped**, 13.17 seconds | Complete repository migrations, real local PostgreSQL policies/triggers/RPCs through PGlite |
| Fresh hosted Day 5 draft SQL | **PASS; synthetic rows ROLLED BACK** | Actual development PostgreSQL with two fixture subjects/roles; not issued-user JWTs, PostgREST or iPhone |
| Fresh hosted PDF/Continue SQL | **PASS; synthetic rows ROLLED BACK** | Actual development database export metadata, historical saved content and non-generating continuation, not rendered PDF bytes |
| Fresh hosted conversation/ownership SQL | **PASS; synthetic rows ROLLED BACK** | Fictional source/memory/review and cross-owner project/memory/history denial |
| Read-only fixture postflight | **0 remaining in all seven checked categories** | Exact synthetic Auth subject IDs/project IDs only; no existing user content queried |
| Actual iPhone PDF/Continue acceptance | **Pending Task 3D-8** | Native download/share lifecycle and end-to-end device behavior cannot be certified by backend tests |

The backend suite emitted one existing Starlette/httpx TestClient deprecation
warning; it was not a failed assertion. No packages were upgraded to conceal it.
The four skips are the explicit opt-in readiness probe, the two-user Day 2 cloud
case and the English/Swedish Day 3 cloud cases. They were **not** silently counted
as passed.

### What these results establish

- The HTTP tests run the real FastAPI routes, schemas, gateways, deterministic
  conversation/story providers and, where stated, real decoder/PDF renderer.
  Auth and PostgREST responses are replaced by explicit transports/stateful
  doubles. A saved row in those doubles is not a hosted Supabase persistence test.
- PGlite runs the real application migrations, SQL functions, constraints,
  privileges, RLS and triggers with two subjects and an anonymous role. It is not
  hosted Auth, real JWT issuance, PostgREST, Storage or an iPhone. Historical
  `pg_cron`/`pg_net` extension provisioning is omitted because those hosted
  extensions are unavailable in the isolated engine.
- The isolated suites execute the existing rollback-only cloud SQL scripts
  locally too. A test called “hosted verification SQL also passes locally” does
  **not** mean that the script was sent to the cloud during this run.
- The simulator returns fixed fictional text, not recognized speech. A mock
  draft's `passed` status means deterministic agreement with supported confirmed
  sources; it is not a real-model hallucination or language-quality evaluation.

## Coverage of Tarun's eight persistence/security requests

The test identifiers below are concrete entry points for review and focused
reruns. Full suites were run; this is not a report of selected cases alone.

| Requirement | HTTP / Python evidence | Actual local SQL evidence |
| --- | --- | --- |
| 1. Generate and save a draft | `test_story_drafts.py::test_generate_is_explicit_owned_verified_and_saved_atomically`; `test_mock_journey.py::test_full_mock_journey_preserves_reviewed_history_and_requires_explicit_regeneration` | `story-drafts.test.mjs`: “confirmed context produces a deterministic Swedish draft” and “English context generates an English verified draft” |
| 2. Repeat generation without duplicate drafts | `test_story_drafts.py::test_committed_replay_returns_current_edited_draft_even_when_mode_disabled` | `story-drafts.test.mjs`: “generation keys replay safely and different keys deduplicate”; same-key replay, changed binding rejection, new-key/same-context deduplication and exact row counts |
| 3. Persist edit and increment revision | `test_story_drafts.py::test_edit_preserves_revision_history_and_marks_content_unverified`; complete mock journey | `story-drafts.test.mjs`: “manual edits append history and can never auto-pass verification”; revision 1 to 2, identical retry without duplicate history |
| 4. Retrieve previous revisions | `test_story_drafts.py::test_edit_history_is_a_plain_owned_array_with_pagination` | Same manual-edit SQL case calls `list_story_edit_history`, checks previous/new content and pagination; rollback-only Day 5 SQL checks the stored history |
| 5. Preserve generated original and sources | Complete mock journey; `test_day9_voice_flow.py::test_real_stereo_m4a_flows_through_simulated_transcript_and_source_conversation` | Day 5 SQL checks immutable originals/source snapshots; Day 9 bilingual conversation SQL checks audio-original identity and text before/after memory reviews |
| 6. Reject a stale different edit | `test_story_drafts.py::test_story_rpc_errors_are_mapped_without_leaking_database_details`; `test_verify_day7.py::test_identical_manual_edit_retry_is_idempotent_before_rejecting_different_stale_content` | Manual-edit SQL case rejects stale different content with SQLSTATE `55000`; gateway maps it to HTTP 409 `STORY_CONTEXT_CHANGED` |
| 7. Deny another account's resources | Project/session, conversation, draft and export route suites; foreign draft/export/Continue cases | Foundation: books/project/session ownership; conversation: memory/source isolation; drafts: “cross-user, anonymous and direct-write access is denied”; exports: “cross-user, anonymous and direct mutation paths remain closed” |
| 8. Continue without replacing/regenerating | `test_exports_continuation.py::test_continue_existing_project_returns_latest_draft_without_generation`, `test_continue_without_body_can_create_session_but_never_a_draft`; complete mock journey | `exports-continuation.test.mjs`: “continuation resumes the active session without generating”, “a completed session creates exactly one resumable active session”, and “new confirmed memories require explicit generation and create version two” |

Additional PDF checks in `test_exports_continuation.py` include:

- `test_export_selected_edited_revision_and_record_audit_before_returning_pdf`.
- `test_repeated_identical_export_can_reuse_audit_identity_without_revision_change`.
- `test_download_renders_the_recorded_historical_revision_read_only`.
- `test_repeated_download_is_read_only_and_does_not_change_selected_revision`.
- `test_export_hides_missing_or_foreign_draft_and_never_renders`.
- `test_download_hides_foreign_export_and_never_renders`.
- `test_continue_hides_foreign_project_without_session_or_generation_mutation`.

The complete mock journey parses actual PDF bytes and proves an old export still
contains the selected edited version after explicit version-two generation.
The local SQL export tests use fictional render measurements; they verify audit
metadata/hash/history and ownership, **not** PDF bytes. Those layers complement
one another rather than each proving the entire stack.

### Version and history expectations

`version` is the generated autobiography number within one project. `revision`
is the manual-edit counter within that generated draft. Read generation versions
with `GET /api/v1/story-projects/{project_id}/drafts` and manual edit records with
`GET /api/v1/story-drafts/{draft_id}/history`. History records contain
`previous_content` and `content`; there is no separate GET-by-revision route.
The generated revision-one text also remains in `original_content`.

An edit is not a factual verification: changed manual content becomes
`needs_review` / `manual_unverified`. A later new generation preserves the earlier
edited draft and export; it does **not** automatically merge that manual prose
into the new canonical draft. The UI must offer an explicit comparison/review.

## Repeat the local checks safely

Use the already prepared Python virtual environment and installed Node test
dependencies. No Supabase credentials, provider key, Docker or running backend
server is needed. If dependencies are missing, follow the setup guide rather than
upgrading packages during acceptance.

From `backend/`, POSIX:

```sh
RUN_SUPABASE_INTEGRATION=0 RUN_MEMY_DAY2_INTEGRATION=0 RUN_MEMY_DAY3_INTEGRATION=0 .venv/bin/python -m pytest -q
```

From `backend/`, in a fresh Windows PowerShell terminal:

```powershell
$env:RUN_SUPABASE_INTEGRATION = '0'
$env:RUN_MEMY_DAY2_INTEGRATION = '0'
$env:RUN_MEMY_DAY3_INTEGRATION = '0'
.\.venv\Scripts\python.exe -m pytest -q
```

From the repository root:

```sh
npm --prefix supabase/tests test
```

The opt-in flags above keep a previously configured shell from unexpectedly
turning an offline rerun into live cloud writes. Preserve the final counts,
commit IDs and sanitized failure stage. Do not publish environment dumps,
database response bodies, passwords, access/refresh tokens or recording content.

## Fresh hosted verification: approved development only

Historical reports record successful hosted rollback-only Day 5/6 SQL and a
separate two-real-token Day 7 mock API journey. See
[Day 6 status](day-6-status.md) and [Day 7 status](day-7-status.md). These are
previous-run evidence, not a fresh certification of today's token or device flow.

For this handoff, the complete existing `cloud-story-drafts.sql` was also run
in the dedicated development SQL Editor. Its final result was
`day5_workflow: PASS`, `owner_isolation: PASS`, `unsupported_draft: BLOCKED`,
`original_and_edits: PRESERVED`, `synthetic_data: ROLLED BACK`. This is fresh
hosted PostgreSQL evidence for draft persistence/replay/history/revision ownership,
using temporary `auth.users` fixture rows and transaction-local database-role
claims. No usable login account, password, email dispatch, Auth setting, migration
or paid provider was created or changed. It is not evidence of actual Auth login,
issued JWTs, HTTP response mapping or mobile behavior.

The existing `cloud-exports-continuation.sql` also passed freshly:
`day6_metadata_workflow: PASS`, `continuation: PASS`,
`historical_revision: PRESERVED`, `owner_isolation: PASS`; its complete transaction
ended with rollback. `cloud-conversation.sql` passed with one additional
read-only assertion inside Bob's existing ownership check: the foreign Alice
project must not be visible through `story_projects`. Results were
`day4_workflow: PASS`, `owner_isolation: PASS`, `source_text: PRESERVED`,
`synthetic_data: ROLLED BACK`. No repository SQL or deployed function was changed.

A separate `BEGIN READ ONLY` postflight filtered only the six fixed synthetic
subjects and six fixed projects used by those scripts. Remaining fixture counts
were **0** for Auth users, projects, settings, sessions, memories, drafts and
exports. No permanent cleanup DELETE was needed. Whole-project before/after
counts are not asserted: another developer may be working concurrently.
No existing account or private story text was read as part of these fixtures.

This is a fresh **database-layer pass for all eight requested behavior groups**
when combined with the mapping above. It is not a new two-issued-token HTTP
acceptance run. In particular, cross-user PDF protection is verified at the
owned export-context/audit layer; local HTTP tests verify that denied access
does not invoke the renderer or return PDF bytes. A fresh real-token PDF download
and native sharing result remains pending.

### A. Rollback-only database checks

After confirming the target and authority for temporary synthetic rows, use only
the existing development project `edbkuunyeyxnyenmmqud`. These scripts are suitable:

| Script | Verifies | Does not verify |
| --- | --- | --- |
| [`cloud-story-drafts.sql`](../supabase/tests/cloud-story-drafts.sql) | Saved bilingual canonical drafts, same-action/current-edited replay, same-context deduplication, revisions/history, stale edits, immutable sources, cross-user draft/history/RPC denial | Issued JWTs, HTTP mapping, real AI or mobile |
| [`cloud-exports-continuation.sql`](../supabase/tests/cloud-exports-continuation.sql) | Owned revision-bound export audits, deduplication, preserved historical text, non-generating Continue, explicit version two, cross-user export/Continue denial | Actual PDF rendering/download/share bytes or device networking |
| [`cloud-conversation.sql`](../supabase/tests/cloud-conversation.sql) | Source/memory/session ownership, append-only originals, versioned review and anonymous denial; this fresh run also asserted no foreign project row | Real login/token issuance or speech accuracy |

Safe execution checklist:

1. Verify the selected Dashboard project reference, not only its display name.
   The SQL files do not cryptographically pin the hosting project themselves.
   Never select the legacy or production project.
2. Read migration history and confirm the required Day 5 and Day 6 migrations and
   functions are already deployed. Do not apply migrations as a side effect of
   testing. Record sanitized preflight counts for Auth users, projects, sessions,
   messages, drafts, edit-history rows and export audits.
3. Read each whole script, including its fixed-identity collision guard,
   `BEGIN`, role/subject switches and final **`ROLLBACK`**. Execute the complete
   unchanged script in its own query. Never run a selected fragment, replace
   rollback with commit, or remove the collision guard. A collision is a reason
   to stop and investigate, not permission to delete a matching existing row.
4. Require the final PASS/ROLLED BACK result. A queued command, truncated output,
   or an exception is not a pass. If the transaction is left aborted, explicitly
   roll back that transaction before any further action.
5. Repeat the count/fixture-ID postflight and confirm no synthetic subjects or
   rows persisted. Investigate unexpected deltas without deleting unfamiliar
   data; another developer may be working concurrently.

These scripts use synthetic database subjects and authenticated/anonymous roles
inside a rolled-back transaction. They do not create login credentials, send
emails, enable anonymous sign-in, change RLS or alter existing user data. Their
two-subject SQL checks must not be described as two issued-user-token tests.

### Offline OpenAPI snapshot checks

`docs/openapi.json` is the generated schema for the same 25 operations at runtime
0.8.0; it contains no live responses, user records or configured credentials.
The exporter does not start an ASGI lifespan or send network requests. Importing
the normal application still validates ordinary local/environment settings;
invalid configuration causes a sanitized nonzero exit rather than a leaked
exception dump. No claim of bypassing local configuration is made.

From `backend/`:

```sh
.venv/bin/python scripts/export_openapi.py --check
```

Regenerate with the same command without `--check` after an intentional reviewed
API change. On Windows use `.\.venv\Scripts\python.exe` and native path separators.
The three new tests check exact snapshot agreement, deterministic output without
embedded configured credentials, and safe fresh-process rejection of malformed
Supabase URL, CORS and timeout settings. No API/runtime behavior changes are
introduced by the exporter.

### B. Optional real-token API-to-cloud mock journey

[`backend/scripts/verify_day7.py`](../backend/scripts/verify_day7.py) is the
existing separately opt-in harness. It requires two **existing, authorised,
distinct disposable development accounts** and pins the exact development URL.
It runs real FastAPI in-process against hosted Auth/PostgREST with explicit free
fictional providers and the real PDF renderer. It is not the already-running
Windows server, a phone or live AI.

Only after approving that run and deletion of its own synthetic fixtures, from
`backend/` in a real terminal:

```sh
.venv/bin/python scripts/verify_day7.py --run --cleanup
```

Windows equivalent:

```powershell
.\.venv\Scripts\python.exe scripts\verify_day7.py --run --cleanup
```

Credentials are entered through hidden prompts and tokens stay in process memory.
Do not paste either into chat or command-line arguments. If a second authorised
account is unavailable, stop; do not change Auth settings or create identities
merely to make the test run. `--cleanup` deletes and verifies only project IDs
created by that invocation, including their child test rows; it does not delete
Auth users, settings or another person's projects. Without it, synthetic projects
are retained deliberately. Treat incomplete cleanup as a failure needing review.

Harness coverage includes owned sources/memories, explicit generation, edit and
identical edit retry, stale different-edit rejection, real private PDF bytes,
non-generating Continue, version two, preserved old draft/PDF and cross-user
denial. Both languages run by default and alternate ownership.

Do not overclaim its coverage: its generation helper uses a new UUID for each
generation action. Same-generation-action replay is established by the SQL and
route tests above, not by that harness alone. It also does not independently
exercise owner/foreign history GET and foreign draft GET; include those in the
manual API/phone acceptance below if claiming a complete live endpoint check.

## Task 3D-8 API and iPhone acceptance

Use a trusted private network or an approved HTTPS staging endpoint. Never send
HTTP Bearer tokens over shared/public Wi-Fi, bypass mobile origin validation or
publish a temporary tunnel without a separate reviewed setup. Record the backend
and mobile SHAs, API origin and network category, never its password.

For one fresh, clearly fictional project in each language:

1. Use the normal app, not the account-free sample preview. Verify `/health` and
   `/ready`, sign in, create/retrieve the project and active session. Reuse the
   app's verified account-scoped token accessor; tokens never enter URLs or logs.
2. Submit fictional supported memories, fetch them and explicitly confirm them.
   For audio, use `--simulate-transcription`, real supported bytes, explicit
   processing consent and the permanent simulation notice. Keep source UUIDs and
   one stable UUID per logical audio/message action. Do not copy an existing
   transcript into a second typed source.
3. Generate with explicit confirmation and one generation UUID. Fetch the saved
   draft/list. Repeat the identical action with that UUID: the same `draft_id`
   must return without another generation. Do not infer persistence from a
   cached frontend row.
4. Save changed manual text at the current `expected_revision`, fetch the draft
   again, and fetch history. Expect one revision increment, preserved original
   and source snapshots, and `needs_review`. Repeating the exact immediately
   completed edit must not append history. Different content using that stale
   revision must return **409 `STORY_CONTEXT_CHANGED`**, not overwrite it.
5. Export the saved draft. Require **201 `application/pdf`**, safe attachment
   filename, `private, no-store` and the export/version/revision response headers.
   Parse neither successful PDF bytes nor proxy text errors as JSON. Open/share
   through a private native temporary file; dispose of it according to the
   mobile lifecycle after use, without public Storage or a permanent public URL.
6. Fetch export metadata and remember that exact export ID. Make another edit
   and verify GET download for the older export still uses its recorded saved
   text/title/options. It must not silently export unsaved editor text or the
   newest revision instead.
7. Continue the project. Expect `generation_triggered:false`, the resumed/new
   active session and the unchanged saved draft. Add and confirm a new fictional
   memory. Draft count must stay unchanged until an explicit new generation
   action creates version two. Read earlier versions/history and download the
   older export again; earlier manual wording remains available.
8. Sign out, then sign in as the second authorised account. Using only fictional
   IDs from this run, verify denial for the first account's project/session,
   memories, draft, draft list, history, export list, download and Continue.
   Expect owned-resource hiding (normally 404), not private content. Sign-out
   must clear visible/private account state before the replacement account loads.
9. Verify offline/timeout behavior, invalid/expired token handling, interrupted
   downloads and an uncertain write response without inventing success or
   blindly retrying writes. Record safe statuses/codes only. Refresh through
   Supabase; never substitute a publishable key for a user token.

Generation retries may return the current manually edited draft for their bound
generation. A new key with unchanged source context also reuses that draft.
Explicit version two requires a changed supported confirmed-memory context;
merely opening Continue is not such an action. PDFs are re-rendered from saved
historical text, not retained PDF blobs; future cross-platform byte identity is
not guaranteed.

There is no general project-delete HTTP endpoint. Keep exact fictional fixture
IDs in private test notes and agree a narrowly scoped cleanup with the backend
developer. Do not repurpose the harness's cleanup for arbitrary mobile-created
projects or remove another user's fixtures.

## Share a result, not secrets

For each acceptance checkpoint report PASS / FAIL / NOT RUN, both Git SHAs,
environment, method/path template, HTTP status, safe `error.code` when present,
expected/actual result and whether persistence was read back. Say explicitly
whether evidence came from a mock HTTP transport, local SQL, hosted SQL roles,
real-user tokens or the real iPhone. Redact passwords, JWTs, callback codes,
recording/story bodies and sensitive network dumps before sharing diagnostics.

Do not call the whole handoff production-ready or claim paid voice functionality
from these tests. Real recognition, conversational model quality, TTS,
interruptions, native PDF UX and staging security have separate acceptance gates.
