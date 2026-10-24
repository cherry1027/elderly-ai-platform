# Audio upload and transcript API

Backend 0.8.0 retains authenticated upload validation, immutable transcript
storage and retrieval. Ordinary Uvicorn startup and the default development
launcher return `503 TRANSCRIPTION_DISABLED` after validation, without a claim
or provider call. Real speech recognition remains unimplemented.

Day 9 adds an explicit **development-only simulation**, using the same endpoint:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan --simulate-transcription
```

On Windows use `.\.venv\Scripts\python.exe`. The launcher refuses any project
except `edbkuunyeyxnyenmmqud`. It validates real recording bytes but returns a
fixed fictional English/Swedish fixture, **not words recognized from the audio**.
There is no model, provider key, paid call or new database migration. A bilingual
simulation notice is permanently stored inside the original text, including
GET results and completed retries. Preserve it and visibly label the UI.
See [the Day 9 native-audio handoff](day-9-mobile-audio.md) for the full two-step
upload → source-linked conversation flow and pending iPhone acceptance.

## Requests

Use the same Supabase development project and verified user Bearer token as the
Day 2 routes. The backend checks session ownership before reading multipart data.
Missing, foreign and soft-deleted sessions are hidden behind HTTP 404.

`POST /api/v1/story-sessions/{session_id}/transcribe` requires:

- `Authorization: Bearer <Supabase user access token>`.
- `Idempotency-Key: <UUID>` generated once per logical recording upload.
- Multipart `file`: one audio-only recording, maximum **25,000,000 bytes**.
- Multipart `language`: exactly `sv` or `en`, matching the session language.
- Multipart `consent`: exactly the string `true`, following the user's explicit
  agreement to processing. Do not preselect consent on their behalf.

Accepted extension and Content-Type pairs:

| Extension | Content-Type | Audio encoding |
| --- | --- | --- |
| `.wav` | `audio/wav`, `audio/x-wav`, `audio/wave` | Common PCM formats |
| `.mp3` | `audio/mpeg`, `audio/mp3` | MP3 |
| `.m4a` | `audio/mp4`, `audio/m4a`, `audio/x-m4a` | AAC or ALAC |
| `.webm` | `audio/webm` | Opus or Vorbis |

The server decodes the audio, rather than trusting a declared duration. It rejects
empty/corrupt files, multiple streams or video, audio longer than **90 seconds**,
sample rates outside 8–96 kHz, and more than two channels. Multipart data is capped
at 25,016,384 bytes, with one file, two small text fields and bounded headers.
Use 30–90-second recordings for the eventual pilot. Format fixtures in tests are
encoded silence; they are not evidence of Swedish/English recognition accuracy.

Example browser request, where `API_BASE_URL` is the root origin without `/api/v1`:

```ts
const uploadKey = crypto.randomUUID(); // keep this key for retries of this file
const body = new FormData();
body.append("file", recordingFile);
body.append("language", project.language);
body.append("consent", "true"); // only after the user has agreed
const response = await fetch(
  `${API_BASE_URL}/api/v1/story-sessions/${sessionId}/transcribe`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": uploadKey,
    },
    body,
  },
);
```

Do not set the request Content-Type manually: the browser/mobile multipart
implementation must include its generated boundary. Native Expo clients should
provide a file URI, the correct extension and its matching audio Content-Type.
The descriptor must cause the native multipart implementation to send file bytes;
posting the literal `file://` URI as text is not an audio upload. No provider key
belongs in frontend configuration. AAC inside M4A is supported; raw ADTS `.aac`
and Android AMR/3GP recordings are not accepted by this contract.

`GET /api/v1/story-sessions/{session_id}/transcripts` returns a plain array, in
ascending `created_at, transcript_id` order. `limit` defaults to 50 (1–100) and
`offset` to 0 (0–100000). It excludes typed messages, corrections and failed or
in-progress requests. All protected responses have `Cache-Control: no-store`.

## Tested success contract

With the explicit simulated adapter enabled, POST returns HTTP 200. Completed
retries return the same record, not a new original. GET uses the same six fields
for each item; no new response fields were added:

```json
{
  "transcript_id": "22222222-2222-4222-8222-222222222222",
  "session_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "language": "sv",
  "text": "[SIMULATED TRANSCRIPT / SIMULERAD TRANSKRIPTION — FICTIONAL / FIKTIVT. Not derived from uploaded audio / Inte baserat på uppladdat ljud.]\nJag flyttade till Malmö 1974. Jag arbetade som lärare.",
  "status": "completed",
  "created_at": "2026-10-18T08:06:00Z"
}
```

Text is preserved exactly, including whitespace and accents. It must be nonblank
and no longer than 32,000 characters. It is separate from editable corrections,
extracted memories and generated chapters. Project/session language never changes
because of the spoken language or Accept-Language header. No detected-language
claim or translation is implemented.

POST does not automatically call the conversation endpoint. Process the returned
`transcript_id` with `POST /api/v1/story-sessions/{session_id}/messages`, a separate
stable UUID action key, and `{"source_message_id":"TRANSCRIPT_ID","language":"sv"}`.
Do not resend its text: the existing source ID avoids a second original message.
The assistant and its source-linked memory candidates are saved separately and
the conversation response explicitly has `mode: "mock"`.

## Errors and retries

Errors retain `{"error":{"code":"...","message":"..."}}`. Never parse the
human-readable message or expose upstream bodies in the UI.

| HTTP | Code | Action |
| --- | --- | --- |
| 401 | `AUTHORIZATION_REQUIRED`, `INVALID_ACCESS_TOKEN` | Sign in or refresh through Supabase |
| 403 | `ACCESS_DENIED` | Do not retry as another user |
| 404 | `SESSION_NOT_FOUND`, `PROJECT_NOT_FOUND` | Missing or inaccessible resource |
| 408 | `UPLOAD_TIMEOUT` | Retry the identical file/key on a working connection |
| 409 | `SESSION_COMPLETED` | Start an active session |
| 409 | `TRANSCRIPTION_IN_PROGRESS` | Wait, then retry the same file/key |
| 409 | `TRANSCRIPTION_CONFLICT` | Key/content mismatch, stale lease, or state conflict |
| 413 | `RECORDING_TOO_LARGE` | Record a smaller clip |
| 415 | `UNSUPPORTED_MEDIA_TYPE`, `UNSUPPORTED_AUDIO_FORMAT` | Correct file type/multipart format |
| 422 | `INVALID_RECORDING`, `RECORDING_TOO_LONG`, `AUDIO_PROCESSING_LIMIT` | Replace the invalid/unsafe recording |
| 422 | `CONSENT_REQUIRED`, `LANGUAGE_MISMATCH`, `VALIDATION_ERROR` | Correct consent, language or request fields |
| 429 | `AUDIO_BUSY` | Back off; at most two audio requests per server process |
| 503 | `TRANSCRIPTION_DISABLED` | Default behavior; explicit development simulation is opt-in |
| 503 | `TRANSCRIPTION_UNAVAILABLE`, `TRANSCRIPTION_INVALID_RESPONSE` | Controlled provider failure; same-key retry |
| 503 | `AUDIO_PROCESSING_UNAVAILABLE`, `SUPABASE_UNAVAILABLE` | Dependency unavailable; bounded retry |
| 504 | `TRANSCRIPTION_TIMEOUT` | Provider exceeded its 60-second processing limit |

The database binds `(user, session, key)` to the original byte SHA-256 and
language. A different recording needs a new UUID. Concurrent duplicates do not
start a second active claim; in-progress requests return 409. Failed claims can
retry with a new opaque claim token. Claims expire after 120 seconds so a crashed
request can recover. Atomic completion inserts one original message and marks
the claim completed in one transaction; retries cannot overwrite it.

Exactly-once database insertion does **not** guarantee exactly-once provider
billing if a future external provider succeeds and its response or a DB write is
lost. There is no automatic provider retry or retained-audio outbox. The client
must resend identical bytes/key. Upload retries still repeat local validation;
while the provider is disabled they always return 503, even for an old key.
POST also requires an active session, including completed-request replay. After
session completion, use GET transcripts rather than promising another upload.

## Privacy and deployment limits

Raw recordings use server-created temporary files, never client-controlled paths
or Supabase Storage. Spools, decoder handles and the recording directory are
closed/deleted on normal success and error paths. The decoder runs in a separate
process, without backend keys or tokens, and is killed/reaped on its wall timeout.
The concurrency cap is per process, not a global or per-user rate limiter.

A subprocess and protocol allowlist are **not an OS security sandbox**. Before
public hosting or real pilot audio, use a maintained decoder/container sandbox,
encrypted ephemeral storage without backups and cleanup for abrupt host/process
loss. A machine crash can prevent normal temporary-file deletion. Review provider
data handling and obtain appropriate consent before sending any real recordings;
local temporary deletion does not establish an external provider retention policy.

The user-JWT SQL RPCs allow authenticated users to append source text for their
own sessions. RLS, immutable records and idempotency are enforced; these records
are not cryptographic proof of a provider result or speaker identity. No raw audio
retention policy, permanent audio URL or real AI/speech recognition is included.
Mock conversation and memory review are separate existing endpoints; none of
these checks establish speech-recognition accuracy or speaker identity.

## Verification

Day 9 offline API tests exercise the same simulated adapter available through
the explicit launcher flag, with real encoded AAC/M4A test bytes. The generated
clips are test audio, not captured iPhone speech. No OpenAI adapter is present.
The Day 9 PostgreSQL tests compose audio claim/completion, source-linked turns,
review, retries, immutability and two-user isolation in an isolated database.

Historical hosted database checks passed independently of
Auth sign-in. Three hosted HTTP cases also passed using two genuine anonymous
Auth users and explicit fictional transcripts. Permanent email/password login and
actual speech recognition were not part of that run. To repeat with existing
development accounts, run the opt-in two-user HTTP tests through
`backend/scripts/verify_two_users.py --day3`; these also use fictional results and
make no paid calls. This does not authorize creating accounts or changing Auth
settings. Real iPhone recording/upload/display remains pending until Tarun adds
those native screens. See [Day 9 status](day-9-status.md) and the historical
[Day 3 status](day-3-status.md).
