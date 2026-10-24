# Day 9 backend audio and conversation status

21 October 2026. Backend 0.8.0 is ready for an explicitly labelled audio-upload
simulation on the dedicated development project. The existing upload, transcript,
conversation and memory-review APIs compose without a new endpoint or migration.
**Day 9 physical-device acceptance remains pending:** the latest pushed mobile
branch has no recorder, upload client or message display yet.

## Delivered backend changes

- Added application `SimulatedTranscriptionProvider` and the explicit development
  launcher flag `--simulate-transcription`. Ordinary Uvicorn and the no-flag
  launcher remain disabled for transcription, regardless of environment values.
- The launcher is pinned to `edbkuunyeyxnyenmmqud`. It validates real bytes but
  returns fixed EN/SV fictional text, not recognized speech. Its bilingual notice
  remains part of the immutable stored transcript across GET and successful replay.
- Added narrow, source-grounded teacher/lärare extraction using the existing
  event type and occupation slot. Negated, hypothetical, quoted, qualified and
  unsupported job statements are not asserted as occupations.
- Added native-style AAC-in-M4A tests and actual PostgreSQL persistence tests for
  audio completion → existing source ID → one conversation turn → versioned review.
- Preserved the existing 25 operations, six-field transcript response, ownership
  checks, consent, format/size/duration limits, byte-hash retries and temp cleanup.

No paid model or real speech service is implemented or called. No new dependencies,
credentials, Auth changes, RLS changes, hosted migration, public deployment or
raw-audio storage were introduced. The existing development cloud records were
not modified or deleted for Day 9 testing.

## Day 8 and mobile integration checkpoint

The latest remote mobile revision is `feat/mobile-story-continue` at
`ed05ebdcf1502d85fe0d168dbdee63fad204c210`; the reviewed backend baseline was
`61c45c4`. Tarun reports successful iPhone Start/Continue and independent review.
The read-only 21 October development SQL check found two owned projects and two
active sessions—one EN and one SV—with no duplicate sessions, language mismatches
or orphaned sessions. SQL role/claim checks showed both resources to the owner
and zero to an unassigned nonowner; these were not fresh real-token login tests.

The mobile source implements list/create/detail/metadata editing and session
Start/Continue. It does not implement recording, audio upload, transcript display,
typed conversation or memory/clarification UI; microphone access is blocked in
its current Android configuration. This backend work does not replace Tarun's
UI or enable microphone permissions on his behalf.

## Verification results

| Check | Result and scope |
| --- | --- |
| Python regression | 752 passed, 4 opt-in live tests skipped; one existing Starlette/httpx deprecation warning. |
| PostgreSQL regression | 56 passed in isolated PGlite, including two new bilingual audio-to-turn persistence cases. No hosted writes. |
| Actual latest mobile source | 1,645 tests in 46 mocked suites passed at `ed05ebd`; TypeScript and lint passed. |
| Native-style audio fixtures | Real encoded AAC/M4A stereo at 44.1 and 48 kHz; generated test audio, not a captured iPhone recording. |
| Runtime smoke | Actual loopback launcher with simulation: `/health` 200, `/ready` 200 against development Supabase, unauthenticated projects 401; OpenAPI 0.8.0 has 25 operations. |
| Physical-device audio | Pending native UI/transport implementation and permission/upload/display tests. |

The mobile revision was extracted separately with no local Auth/API JSON;
dependencies came from its lockfile without lifecycle scripts. Its protected
verification mode blocks network access. No Expo server or native build was
started, so those results do not prove device behavior.

The new Python journey uses real decoding, FastAPI routes, simulation adapter and
mock conversation extractor, with synthetic stateful Auth/Data API responses.
It covers source-ID reuse, one original plus one assistant, two pending sourced
facts, upload/turn replay, conflicting byte hashes, ownership/validation errors,
review/correction/stale versions and temp cleanup. Existing suites also cover
expired Auth rejection, interrupted uploads, decoder cancellation and limits.
The separate SQL suite exercises real migrated functions, constraints, views
and RLS as two isolated users. Neither is a new hosted two-user/device test.

## Memory and retry boundaries

Process the returned transcript with `source_message_id`, never copied `text`.
The original transcript stays immutable; assistant responses, memory candidates,
corrections and draft content remain separate. Every new memory is pending until
explicit review; no open question does not imply confirmation.

A later explicit 1975 correction produces a new pending conflict, not an automatic
replacement of the original 1974 fact. Yes/No/corrections use versioned memory
PATCH actions. Confirming the new fact does not automatically reject the old one;
do not claim atomic replacement. Refresh memories after review because turn
replay retains its creation-time snapshot.

Upload replay requires the same bytes/key/language, an active session and an
enabled adapter. Switching simulation off preserves GET access but disables POST
replay. No historical unlabelled transcript is reclassified or backfilled.
Normal file cleanup does not guarantee cleanup after a process/host crash; the
decoder remains a bounded subprocess, not an OS sandbox for public hosting.

## Remaining device acceptance

Follow the [Day 9 native audio handoff](day-9-mobile-audio.md) on the agreed trusted
personal hotspot/private network, never shared Wi-Fi HTTP with Bearer tokens.
Tarun must implement and verify permission allow/deny, recording stop/disposal,
actual multipart bytes, both languages, visible simulation labels, source-linked
conversation display, persistence, retries, offline/interruptions, sign-out and
two-user protection. The full real-iPhone create-to-dashboard result also needs
explicit acceptance evidence rather than inference from session metadata.

Backend preparation is complete; do not mark the overall Day 9 goal complete
until this real-device workflow has passed. No main merge is included.
