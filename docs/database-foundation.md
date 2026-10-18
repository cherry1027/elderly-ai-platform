# Database foundation and Day 3 transcription persistence

Migrations:

- `supabase/migrations/20261015180000_day1_backend_foundation.sql`
- `supabase/migrations/20261017120000_day3_audio_transcription.sql`

Requires PostgreSQL 15+ and the preceding repository migrations.

## Reuse the existing schema

| Logical entity | Storage | Ownership |
| --- | --- | --- |
| Profile | Existing `profiles`; adds `preferred_language` (`en`/`sv`) | Existing `user_id = auth.uid()` RLS |
| Story project | `story_projects`, an updatable `security_invoker` view of existing `books` | Existing books RLS, excluding soft-deleted rows |
| Conversation session | New `conversation_sessions` referencing `books.id` | Caller must own the parent, non-deleted book |
| Original message | New `conversation_messages` referencing a session | Visibility follows the session; insert only into an active owned session |

The view avoids a second project table and an immediate migration of existing
frontend book IDs. A story project's ID is its book ID. Session foreign keys
reference `books` because PostgreSQL cannot reference a normal view. The frontend
can continue using its existing tables while the Python API is introduced.

New `books.language` and `profiles.preferred_language` default to `sv`, preserving
the existing Swedish application's behavior. Both accept only `en` or `sv`.
New API clients should explicitly choose a language when creating a project.
Existing book status values are retained to avoid breaking the current app.

## Sessions and source preservation

A session records `id`, `project_id`, selected `language`, `status`, timestamps
and `ended_at`. An active session has no end timestamp; a completed session has
one. Each project can have many sessions. This permits later continuation without
deciding whether multi-day conversations will be the product default.

Original messages record `id`, `session_id`, server-generated `sequence`, `role`,
`original_text` and `created_at`. User and assistant messages are distinguishable.
Corrections are appended; authenticated callers cannot update or individually
delete messages. An immutability trigger also rejects privileged UPDATEs.
Deleting an owned project/session cascades messages for explicit data erasure.

The source text is distinct from existing `pages.content` and `stories.content`,
which hold generated/edited material. No automatic conversion of historic
`books.transcription_text` or `interview_turns` occurs. These legacy sources remain
intact. Confirmed memories need a separate future schema with source references;
neither assistant output nor a raw transcript is automatically a confirmed fact.

No audio bucket is added. Retention duration, consent and whether transcripts are
visible in the UI remain product decisions. The existing frontend's audio-upload
behavior must be reviewed separately before pilot use.

## Day 3 transient-audio contract

Raw audio remains transient and is never stored in the database. The
`audio_transcription_requests` table is a durable idempotency ledger containing
only ownership, the session, a client request UUID, a lowercase SHA-256 content
hash, language, attempt state and the completed message reference. Authenticated
clients cannot insert, update or delete ledger rows, and cannot select claim or
completion tokens directly.

The three RPCs are callable with the caller's normal user JWT and publishable key;
the backend does not need a service-role key:

1. `claim_audio_transcription` verifies the non-deleted project and active session
   belong to the caller, binds the request UUID to its session, content hash and
   language, and returns a 120-second claim. A live duplicate reports
   `in_progress`; a failed or expired request receives a new token and increments
   its attempt count.
2. The backend calls the transcription provider outside the database transaction,
   holding audio in memory only. The 120-second lease is intentionally longer than
   the backend's 60-second provider timeout.
3. `complete_audio_transcription` rechecks ownership, active state, the current
   token and lease, then atomically appends one user-role `conversation_messages`
   row and marks the ledger completed. Transcript text is nonblank and limited to
   32,000 characters. Replaying the same completed token and text returns the same
   transcript; a stale token or changed text is rejected.
4. `fail_audio_transcription` records a stable failure code without creating a
   message. Retrying the same bound request can obtain a fresh claim.

`audio_transcripts` is a `security_invoker` read view over completed ledger rows
and their immutable source messages. It exposes exactly `transcript_id`,
`session_id`, `language`, `text`, `status` and `created_at`. Session filtering plus
the underlying RLS returns only the caller's audio transcripts and excludes typed
messages and appended corrections. Session `project_id` and `language` are
immutable, preserving transcript provenance; session status and `ended_at` remain
updatable through their existing state constraint.

The database proves caller ownership, request binding, append-only storage and
source separation. It does not cryptographically attest that submitted transcript
text came from the transcription provider: an authenticated owner can already
append text to their active session, and the backend supplies completion text to
the RPC. Provider authenticity, if required later, needs a separately designed
attestation or trusted-worker boundary.

This provides exactly-once database insertion, not exactly-once provider billing.
If a worker crashes after the provider accepts audio but before completion, the
client must resend the same bytes and request UUID after the lease expires; the
provider may be called again. No provider call, paid branch or hosted change is
part of the local schema tests.

## Deployment and verification

The migration runs in a transaction and adds columns, a view and two tables. It
does not delete, rename or rewrite existing data. It changes defaults only for the
new language fields. Do not replay historical migrations into an already-managed
database: compare migration history and the actual schema first.

1. Verify the project reference in the Supabase dashboard matches the intended
   development project. Check PostgreSQL version, existing `books`/`profiles`
   columns, migration history and backups. Reachability alone cannot establish
   whether the team considers a project development or production.
2. Use an authenticated Supabase management connection to apply this migration
   once. A publishable client key cannot run schema changes.
3. Confirm the new view and tables, policies and language columns exist. Regenerate
   Supabase TypeScript types from the deployed schema before frontend usage.
4. With two separate test users, verify each sees only their own projects,
   sessions and messages. Attempt cross-user writes and source-text rewrites;
   verify rejection. Verify anonymous access is denied.

The local test suite replays the existing migrations and tests eighteen PostgreSQL
scenarios. See `supabase/tests/README.md` for its exact coverage and limits.

## Verified development deployment — 16 October 2026

The original project was reachable through its public Data API but the signed-in
account had no management access. A separate Free-plan project, `memy-ai-dev`
(`edbkuunyeyxnyenmmqud`, Ireland), was created with the user's authorization.
All 20 repository migration versions were applied to its empty schema through
the signed-in Supabase SQL Editor. Original-project data was not copied or changed.

The hosted `cloud-ownership.sql` check passed: user ownership restrictions,
cross-user insert/read denial, append-only source preservation, and anonymous
restrictions. Its synthetic users and rows were rolled back. This validates the
actual PostgreSQL policies; email login and end-user token issuance are later
integration work. The backend's live `/ready` probe also passed against this new
project. Its local configuration is in ignored `backend/.env`.

Primary references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgreSQL invoker views](https://www.postgresql.org/docs/current/sql-createview.html),
[PGlite](https://pglite.dev/docs/).

The required two-real-user token test for the Day 2 APIs is still pending because
no test-user access tokens were provided. The in-memory suite uses two isolated
JWT subjects, but it does not replace hosted Auth and PostgREST verification.
