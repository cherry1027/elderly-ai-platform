# Day 3 backend status

Updated 18 October 2026. Backend version 0.3.0. The zero-cost audio foundation is
implemented and locally verified; the original end-to-end speech-recognition
acceptance target is **not complete**. Live transcription is intentionally disabled
under the user's no-spending requirement.

## Implemented

- Authenticated, owned-session multipart upload and transcript retrieval routes.
- Real decoding of WAV/MP3/M4A/WebM with 25 MB/90-second bounds, one audio stream,
  consent, language matching, processing timeouts and per-process concurrency caps.
- Temporary recording cleanup, a credential-scrubbed decoder subprocess and safe
  error responses. Abrupt machine loss still requires deployment-level cleanup.
- Immutable originals in the existing conversation messages table, separate from
  corrections and generated stories, exposed through the audio-only read view.
- Durable content-bound idempotency, claim leases, atomic completion and failure
  retry handling. Database insertion is exactly once per completed request; future
  external provider billing is not guaranteed to be exactly once.
- A hidden-input terminal helper and opt-in hosted HTTP acceptance tests using two
  existing development users and an explicit fictional transcription provider.
- Tarun's multipart request, response, error and privacy contract in
  [the audio API guide](audio-api.md).

## Verified

- **202 offline Python tests pass**, including 30 upload and 35 transcript API
  tests. Existing Day 1/2 regression tests continue to pass.
- **19 embedded PostgreSQL checks pass** across all repository migrations.
- The live public Supabase readiness integration check passes.
- `python -m pip check` passes. One existing non-failing Starlette/httpx TestClient
  deprecation warning remains.
- Migration `20261017120000_day3_audio_transcription` was applied transactionally
  to dedicated Free development project `edbkuunyeyxnyenmmqud`, and its version
  recorded in migration history. The project now has 21 repository migrations.
- `supabase/tests/cloud-audio.sql` passed on that hosted project. It verified RPC
  retry/replay behavior, immutable originals, audio-only reads, cross-user RLS and
  anonymous denial. Its synthetic Auth/database rows were rolled back.

The hosted SQL check sets isolated JWT subjects inside a database transaction.
Separately, **three live HTTP acceptance cases passed** with two genuine,
disposable anonymous Supabase Auth users: the Day 2 project/session workflow and
the Day 3 Swedish/English persistence, retry and cross-user isolation cases.
These exercised real Auth validation and hosted PostgREST/RLS through FastAPI's
test client. The audio tests explicitly injected fictional transcripts: they do
not demonstrate real speech recognition or permanent email/password sign-in.
Anonymous sign-in was temporarily enabled with approval and then restored to
disabled. The exact two anonymous users were permanently removed afterward;
hosted cleanup queries confirmed zero matching users, projects and audio requests.
Tarun's development account and its synthetic dashboard projects were untouched.

## Remaining acceptance

1. Choose and explicitly authorize a real transcription provider. No API key was
   created, no OpenAI adapter was wired and no paid speech API call was made.
   Then test fictional Swedish and English recordings for actual recognition
   quality, including names, cities, years and accents.
2. Review provider processing/retention consent and production decoder isolation
   before using real pilot-user life stories or publishing the API.

No FastAPI hosting, preview deployment, frontend push, paid Supabase branching,
retained-audio bucket or OpenAI service was enabled. No GitHub push is included in
this run. Day 2 commits were previously pushed; Day 3 changes are committed locally
in incremental feature/test/documentation commits for review.
