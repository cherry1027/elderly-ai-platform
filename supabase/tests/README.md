# Isolated PostgreSQL schema tests

Day 14 adds `day14-security.test.mjs` and two deliberately separate fixtures:

- `cloud-day14-readonly-security.sql` uses `BEGIN READ ONLY`, no fixture writes
  and collision-checked nonexistent/empty SQL identities. The exact batch passed
  in `memy-ai-dev` on 23 October: 16 core RLS tables, three invoker views and 19
  guarded core RPCs. This is SQL-role read/catalog evidence, not issued JWTs,
  owner writes, two existing users, Edge deployment or actual-device acceptance.
- `cloud-day14-security.sql` prepares a broader rollback-only EN/SV synthetic
  correction/draft/history/export/ownership exercise. It passed in local PGlite
  only and **was not run hosted**. Do not run without appropriate separate
  authorization and trigger review; transaction rollback cannot undo external
  trigger effects or sequence advancement. No anonymous Auth toggle is needed
  by either SQL file, and no permission to run the broader batch is implied.

The 13 Day 14 tests include unchanged-data checks, collision protection and
intentional privilege/policy drift detection, inside disposable engines only.
The full suite now has 86 passing checks. See [Day 14 evidence and limits](../../docs/day-14-status.md).

Day 11 adds `day11-story-journey.test.mjs` / `cloud-day11-story-journey.sql`:
the exact rollback-only EN/SV generation/edit/history/export/Continue/new-version
journey, unsafe-generation blocks, version/audit retries, old export preservation,
two-way ownership and immutable sources. Identity/project collision guards and
rollback emptiness across 16 isolated relations are tested. SQL validates PDF
metadata/revision text, not rendered bytes, real Auth login or iPhone behavior.
See [Day 11 scope](../../docs/day-11-status.md). No migration is added.

Day 10 adds `day10-memory.test.mjs` and the reusable
`cloud-day10-memory.sql` fixture: EN/SV uncertain 1974→reviewed 1975, rejected and
pending exclusion, old/new session continuity, stale version vectors, duplicate
audit prevention, source immutability and two-way ownership. The exact SQL file
is exercised locally, its rollback leaves 14 isolated relations empty, and its
collision guard preserves a pre-existing fixture identity. Opposing same-version
reviews are sequential optimistic tests, not a multi-connection race benchmark.
See [current Day 10 evidence](../../docs/day-10-status.md). No migration is added.

From the repository root (Node.js 24 verified):

```sh
npm --prefix supabase/tests ci --ignore-scripts
npm --prefix supabase/tests test
```

The test runner uses PGlite, an in-memory PostgreSQL engine, and never opens a
network connection to Supabase. It creates minimal Supabase `auth.users`,
`auth.uid()`, roles and storage primitives, replays all repository migrations in
order, then tests privileges, RLS, language constraints, view writes and cascades.
Only historical `pg_cron` and `pg_net` extension provisioning is skipped because
those hosting extensions are unavailable in this engine. Application tables,
policies, triggers and the new migration execute as written.

Day 3 coverage includes immutable session provenance, denial of direct ledger and
token access, owner/session/hash/language idempotency binding, the 120-second claim
lease, failed and expired retries, stale-token rejection, the 32,000-character
transcript bound, atomic completion, completed replay, immutable original text,
audio-only transcript reads and cascade erasure. The tests make no network or
transcription-provider calls and incur no provider cost.

These checks validate PostgreSQL behavior with two separate users and an anonymous
role. They do not validate hosted Auth, PostgREST configuration, Storage, scheduler
extensions or the deployment state of any cloud project. Repeat the ownership
checks with two real test accounts after deployment to the intended development
project. No production user data is used in these tests.

`cloud-ownership.sql` checks ownership against the actual hosted development
database using synthetic users and the authenticated/anonymous PostgreSQL roles.
It runs inside a transaction and rolls back all synthetic rows. It does not
exercise an actual email login or token issuance. Never run it in production.

`cloud-audio.sql` is the equivalent rollback-only, dedicated-development check for
the Day 3 RPCs, completed-only view, retries, replay, immutable source text and
cross-user/anonymous denial. It creates synthetic `auth.users` rows without login
credentials and makes no provider or network call of its own. Review the target
project and migration state before running it; never run it in production.

Day 4 tests cover atomic user/assistant turns, immutable message references,
owner-only memory/clarification reads, private idempotency/audit ledgers, original
evidence grounding, unique source processing, versioned review and project-wide
fact-context concurrency checks. Completed sessions permit replay/read/review but
not a new turn. Parent/source erasure preserves unrelated users' rows.
`cloud-conversation.sql` repeats a fictional English/Swedish workflow with two
transaction-scoped subjects and rolls it all back. It does not send an email,
create a password, issue a real user token or call an AI provider.

Registration settings coverage runs in two fresh databases: one without inherited
table grants and one with legacy broad table/column grants. It checks signup
triggers, owner-only reads and preference updates, missing-JWT/anonymous denial,
protected identity/timestamp columns and preservation of existing orphan rows.
`cloud-settings.sql` repeats the role/trigger checks in the dedicated development
database inside a rolled-back transaction. It sends no email and does not test
an actual browser signup, email confirmation or issued access token.

Day 5 adds confirmed-memory story context, English/Swedish canonical sentences,
conflict and stale-context denial, versioned generation, content-bound retries,
immutable source/original snapshots and append-only manual revisions. Direct RPC
tests prove unsupported text cannot be saved as `passed`; cross-user and anonymous
calls remain denied. `cloud-story-drafts.sql` is a rollback-only hosted development
workflow with synthetic subjects and no login credentials or emails. It does not
prove an end-to-end real-user browser flow or real-model factual accuracy.

Day 6 tests add metadata-only PDF audits and non-generating continuation. They
verify owned saved revisions, historical content hashes after later edits/title
changes, render-metadata deduplication, race checks, active-session reuse/new-session
creation, explicit version two, contradiction blocking and cross-user/anonymous
denial. `cloud-exports-continuation.sql` repeats the two-user English/Swedish SQL
workflow and rolls back every synthetic row. It uses fictional byte/page counts:
PDF structure, glyphs and the real rendering pipeline are tested separately in
the backend. No public storage bucket or PDF blob is created.

For a confirmed empty development database only,
`node supabase/scripts/build-bootstrap.mjs` emits a transactional SQL Editor
bootstrap from the repository migrations, including their version history. It
rejects nonempty public schemas. Existing databases should use normal migrations.
