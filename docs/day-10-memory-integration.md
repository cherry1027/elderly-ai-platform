# Day 10 mobile memory review and continuity

23 October 2026 · backend **0.8.1** · free deterministic mock only.

Use branch `codex/day-7-mobile-integration`. The runtime patch is
`a00df98eb97a3528cd83dff91c36bbda3a09323a`; later commits add tests/docs only.
There are still 25 operations with unchanged paths, request fields and response
schemas. No new migration, provider key, Auth change or paid service is needed.

## One behavioral fix Tarun should adopt

`PATCH /api/v1/memories/{fact_id}` already uses `expected_version`. In 0.8.1,
a confirmation that **omits** `corrected_value` cannot silently inherit a newer
correction: if the observed memory has a correction and the submitted version
does not match, return **409 `CONVERSATION_CHANGED`**. Reload and show the actual
current wording before asking the user to confirm again.

Current-version omission still preserves the existing correction. An explicitly
repeated identical correction with its immediately preceding version is still
handled idempotently by the locked database function, as is an identical plain
confirmation without a correction. Neither case adds duplicate audit revisions.
Do not turn a conflict into an unconditional overwrite or generate a new key to
hide it. This is an intent-safety patch, not a repair of corrupted stored data.

## Reuse these existing APIs

All routes require `Authorization: Bearer <current user access token>`.
POST messages/generation additionally require a stable UUID `Idempotency-Key`.
Memory PATCH and Continue do not use that header.

| Action | Existing request | Success |
| --- | --- | --- |
| Resume a story | `POST /api/v1/story-projects/{project_id}/continue` with `{}` | 200; returned session, latest draft, `generation_triggered:false` |
| Read messages | `GET /api/v1/story-sessions/{session_id}/messages` | 200 chronological array |
| Send text / process transcript | `POST /api/v1/story-sessions/{session_id}/messages` | 201 atomic mock turn |
| Show memory cards | `GET /api/v1/story-sessions/{session_id}/memories` | 200 array including pending/confirmed/rejected |
| Show unresolved questions | `GET /api/v1/story-sessions/{session_id}/clarifications` | 200 open-question array |
| Yes / No / Correct | `PATCH /api/v1/memories/{fact_id}` | 200 current full memory |
| Explicitly generate | `POST /api/v1/story-projects/{project_id}/generate` | 201 saved mock draft |

List routes accept `limit=1..100` (default 50) and `offset=0..100000`.
Messages sort by ascending sequence; memory/questions by `created_at,id`.
Sequences need not start at one or be contiguous within a session: the database
uses a shared identity. Do not infer message counts or the next ID from a gap.
See the [complete schemas/errors](mobile-api-contract.md).

## Confirm, correct and reject explicitly

Yes, for the currently displayed fact:

```json
{"status":"confirmed","expected_version":1}
```

Correct a year on that fact:

```json
{"status":"confirmed","corrected_value":"1975","expected_version":1}
```

No:

```json
{"status":"rejected","expected_version":1}
```

Use returned versions, not hard-coded `1` for an already reviewed memory.
Blank/null correction text, unsupported fields and missing versions are invalid.
An illustrative **corrected uncertain year** response is:

```json
{
  "id":"10000000-0000-4000-8000-000000000001",
  "project_id":"20000000-0000-4000-8000-000000000001",
  "session_id":"30000000-0000-4000-8000-000000000001",
  "source_message_id":"40000000-0000-4000-8000-000000000001",
  "fact_type":"event",
  "value":"1974",
  "evidence":"I think we moved in 1974",
  "year":1974,
  "slot":"move",
  "uncertain":true,
  "status":"confirmed",
  "corrected_value":"1975",
  "version":2,
  "created_at":"2026-10-23T10:00:00Z",
  "updated_at":"2026-10-23T10:01:00Z"
}
```

The original value/year/evidence, source reference and `uncertain` extraction
flag do not change. Display the corrected value as the reviewed effective
information; `status:confirmed` is the approval signal, not `uncertain:false`.
Memory responses do not contain a `language` or `original_value` field: use the
owned session's language and existing source fields. No schema alias was added
to match the planning document's illustrative response.

Typing `Yes`, `No`, `Ja` or `Nej` does **not** select a fact or perform a review.
The UI must submit the explicit fact-ID/version action. All extracted candidates
start pending, including facts with no clarification question. Re-fetch current
memories/questions after review; old conversation-turn replay preserves its
creation-time pending-memory snapshot and is not the current review state.

## What continuity means in the current mock

Continue reuses the appropriate active session. Rehydrate its messages, memory
cards and open questions using the three owned GET routes; fence responses to
the current account/project/session. These parallel reads are not one atomic
snapshot, so reload after a version conflict.

The backend's next-turn context loads project-wide **non-rejected structured
facts**, including confirmed corrections from older sessions. Pending facts are
included only to detect uncertainty/conflicts; they are not approved biography
content. The append RPC checks the current session's latest sequence and the
whole project non-rejected `{id,version}` set before committing anything.

Original history remains attached to its original session. If the app displays
earlier sessions, list the owned project's sessions and paginate each selected
session's history/memories/questions. A new session's GET lists do not silently
aggregate every old session. The provider does not consume free-form messages
from prior sessions or promise open-ended conversational recall. That remains
real-AI design work, not a gap filled with fabricated memory today.

No history truncation is silently described as complete: the mock context rejects
more than 200 non-rejected facts with `409 CONTEXT_LIMIT`. Completed sessions can
be read/reviewed but cannot accept new turns. There is no public session-complete
route; do not add a guessed mobile request or create sessions on every Continue.

## Verified fictional scenario for both languages

Use [day10-memory-review.json](fixtures/day10-memory-review.json). These exact
phrases passed provider/schema checks; the corresponding review/story workflow
passed the real PostgreSQL fixture. It is a replay recipe, **not a retained cloud
session or a real user's biography**. Create a fresh fictional project in the
normal signed-in app and retain the returned IDs privately.

1. Continue to obtain its active session. Submit the fixture's `initial_text`:
   uncertain 1974 becomes a pending fact and a question.
2. Submit `correction_text`: 1975 becomes a **separate pending conflicting fact**,
   not an overwrite of the first source. Submit `rejected_text` to get the
   fictional Ada candidate.
3. Apply the ordered `review_steps`: correct/confirm the **original move** to
   1975, reject the redundant **correction candidate**, and separately reject
   the **Ada candidate**. Each action targets its actual returned fact ID.
4. Re-fetch questions and memories. Both date questions should be resolved;
   only the original move is confirmed with a separate correction value.
   Approving the new candidate alone never auto-rejects the old one.
5. Try a duplicate explicit correction: no new revision. Try stale confirmation
   omitting the correction: 409, then reload. A different stale correction or
   opposing review must not replace the winning version.
6. Resume: same active session ID, same saved source information. Briefly speak
   the other language using `code_switch_text` but keep the request's saved
   `language`. Expect a chosen-language safe fallback, not translated extraction
   or automatic project-language changes. Bare confirmation text is fact-free.
7. Explicitly generate with `confirm_generation:true`, the project language and
   one new UUID. Expected canonical text is `I moved in 1975.` or
   `Jag flyttade år 1975.` No rejected Ada, unresolved fact or original 1974 is
   asserted in the generated content. The original source still contains 1974.

Only **supported, confirmed** facts enter the mock writer. A confirmed
teacher/lärare occupation is currently unsupported by its canonical sentence
builder and is excluded, not invented into prose. Generated drafts report that
exclusion. Do not promise every confirmed arbitrary free-text correction appears
in the story; unsupported corrections likewise remain reviewable but excluded.

For recording, keep the separate `--simulate-transcription` flag, original
bilingual simulation notice, consent and `source_message_id` processing described
in the [audio handoff](day-9-mobile-audio.md). This typed correction fixture does
not turn fixed audio output into speech recognition.

## Loading, errors and device acceptance

Disable repeat taps while saving a review, keep the current card on a safe
failure, then reconcile from GET rather than locally assuming success. Handle
401 through the account-scoped Auth provider, 404 as missing/not owned, 409 by
reloading, 422 by fixing input and sanitized 503/504 by showing bounded retry UX.
Never retry a changed write automatically or use another account's cached IDs.

Tarun should run EN/SV on the agreed trusted private network: sign in → create →
record/upload with visible simulation → process source → review/correct/reject →
resume → generate → sign out → cross-account denial. Keep tokens/recordings/story
bodies out of screenshots/logs. Actual iPhone behavior, fresh real-token HTTP
acceptance and true multi-connection contention are separate from the local
tests/hosted role checks in [Day 10 status](day-10-status.md).
