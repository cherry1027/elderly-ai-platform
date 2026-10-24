# Day 9 native audio and simulated conversation handoff

Backend 0.8.0 supports a free, explicitly enabled recording-upload demonstration.
It validates real audio bytes, saves a **fixed fictional transcript**, and can
process that existing transcript through the mock conversation API. It does not
recognize what the user said. The permanent notice in the transcript and a
visible simulation label in the UI are mandatory parts of this demonstration.

The reviewed mobile branch `feat/mobile-story-continue` at `ed05ebd` has working
session entry/resumption, but no recorder, upload client, transcript display or
conversation messages. Its Android configuration explicitly blocks microphone
permission. Those frontend changes and physical-device acceptance belong to
Tarun; this backend delivery does not silently activate them.

## Start the development backend

Keep the existing dedicated development Supabase configuration. From `backend/`
on Windows:

```powershell
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
```

On macOS:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan --simulate-transcription
```

The explicit flag selects the simulated adapter only after the launcher verifies
`edbkuunyeyxnyenmmqud`. Without it, both ordinary Uvicorn and the launcher remain
disabled for transcription; environment variables or an AI key cannot opt in.
Conversation/story modes are free mocks. Stop with Ctrl+C; omit the flag on the
next start to disable simulated uploads. Previously saved transcripts remain
readable, but disabled-mode POST replay still returns 503.

Use the agreed trusted personal hotspot/private network, not shared housing
Wi-Fi HTTP. Update the Windows IP in the mobile checkout's ignored
`apps/mobile/development.api.local.json`, retain its existing Auth JSON, start
the normal app with `npm start`, and scan the new QR. See the
[Windows setup guide](backend-mobile-quickstart.md). No public URL, deployment,
new keys, email or Auth/RLS changes are required.

## Record and upload actual bytes

Reuse the existing verified account-scoped Auth provider and the active session
ID returned by Start/Continue. Its project language is fixed as `en` or `sv`.
The app must explicitly request recording permission, handle refusal and stop
recording before uploading. Use a short, fictional 5–10-second clip first.
Keep recording foreground-only and stop/dispose it on navigation, interruption,
sign-out or account/project changes. Do not enable background recording for this
milestone.

For the recorder implementation, use the version matching the current mobile
SDK, not a wholesale upgrade. Expo's [SDK 57 audio documentation](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
covers recording and microphone configuration. Its high-quality preset uses
AAC-in-M4A; Android AMR/3GP and raw ADTS `.aac` are not this API's supported M4A
format. Native permission/config changes may require a new app binary; permission
handling and actual transport must be verified on the device.

Upload contract:

| Part | Required value |
| --- | --- |
| Method/path | `POST /api/v1/story-sessions/{session_id}/transcribe` |
| Authorization | Current user's `Bearer` access token; never the publishable key |
| Idempotency-Key | One UUID retained for the same recording bytes and language |
| Multipart `file` | Native file descriptor: URI, safe `recording.m4a` name, `audio/mp4` type |
| Multipart `language` | The active session's `en` or `sv` |
| Multipart `consent` | String `true`, only after explicit processing consent |

The file descriptor must transmit the recording's bytes. Sending the URI as a
text field or JSON is invalid. Do not manually set the multipart Content-Type:
the native implementation supplies the boundary. Adapt native descriptor typing
to the pinned React Native version rather than replacing the shared API client.

```ts
// recordingUri, sessionId, language and uploadKey belong to one account/session
// action. Generate uploadKey with a reviewed native UUID helper, not a guessed
// assumption that browser crypto.randomUUID exists on the device.
const token = await getAccessToken(expectedUserId);
if (!token) throw new Error('Sign in is required');
const form = new FormData();
form.append('file', {
  uri: recordingUri, name: 'recording.m4a', type: 'audio/mp4',
} as unknown as Blob);
form.append('language', language);
form.append('consent', 'true'); // only after explicit consent

const response = await fetch(`${API_BASE_URL}/api/v1/story-sessions/${sessionId}/transcribe`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': uploadKey },
  body: form,
  signal: uploadAbortController.signal,
  credentials: 'omit', cache: 'no-store', redirect: 'error',
});
```

This shows the request contract, not a complete replacement transport. Retain
account/project fencing, a reviewed bounded audio timeout (for example 60 seconds
for this short-clip simulation), status/Content-Type/body validation and sanitized
errors. The existing 10-second metadata timeout is not automatically an audio
upload budget. Native fetch is independent of browser CORS; network transport
still needs its own device check. See [React Native networking](https://reactnative.dev/docs/network).

The server checks Auth and ownership before reading bytes. It accepts audio-only
M4A/AAC or ALAC, WAV, MP3 and WebM under the exact extension/MIME pairs in the
[audio API](audio-api.md). Limits remain 25,000,000 file bytes, 90 decoded seconds,
8–96 kHz, at most two channels and one audio stream. AAC padding can push a
nominal 90-second clip past the limit; do not start device acceptance at the boundary.

## Process the returned original without copying it

A successful simulated upload returns HTTP 200 and the existing six fields:
`transcript_id`, `session_id`, `language`, `text`, `status: completed`, `created_at`.
The text starts with the permanent bilingual `SIMULATED TRANSCRIPT / SIMULERAD
TRANSKRIPTION` notice. The fixed body is:

- English: `I moved to Malmö in 1974. I worked as a teacher.`
- Swedish: `Jag flyttade till Malmö 1974. Jag arbetade som lärare.`

The output is identical for different valid recordings in the same language.
That is intentional simulation, not recognition, translation or an audio-quality
claim. Preserve the notice; GET transcripts and successful same-key replay retain
it. Older unlabelled records are not retroactively classified as simulated.

Next send a separate stable conversation action key:

```http
POST /api/v1/story-sessions/SESSION_ID/messages
Authorization: Bearer USER_ACCESS_TOKEN
Idempotency-Key: CONVERSATION_ACTION_UUID
Content-Type: application/json

{"source_message_id":"TRANSCRIPT_ID","language":"sv"}
```

Use the returned transcript UUID and the same session/language. Do not send its
text again and do not supply both `text` and `source_message_id`. The existing
immutable original is the turn's `user_message.id`; only the assistant, sourced
facts and turn ledger are appended. HTTP 201 returns `mode: mock`, assistant
`message`, `memories`, `clarifications` and `requires_clarification`.

This fixture produces two **pending**, source-linked event candidates: move to
Malmö in 1974 and occupation teacher/lärare. The latter is a deliberately narrow
matcher, not general profession recognition. `requires_clarification: false`
does not mean a memory is confirmed. Fetch current history/memories after review;
replaying an old turn returns its creation-time snapshot.

## Review and corrections

Use the existing `PATCH /api/v1/memories/{fact_id}` with its current version:

```json
{"status":"confirmed","expected_version":1}
```

No means `status: rejected`; correction means `status: confirmed` plus a nonblank
`corrected_value`, such as `1975`. Original transcript, extracted value/year and
evidence are immutable; review state, correction text and revision audit are
separate. There is no transcript PATCH route. A typed correction is a new source
message, not a rewrite of the recording's original.

`Egentligen var det 1975.` or `Actually, it was 1975.` creates a separate pending
conflict candidate and question. Bare `1975`, `Ja` or `Yes` does not resolve it.
Confirming the new fact does not automatically reject/replace the old one. An
explicit correction of the original move and rejection of a redundant conflicting
candidate require separate versioned reviews; reload after an interruption.
Do not silently present these as one atomic replacement or generate a draft
while contradictory facts remain unresolved.

## Retries privacy and device acceptance

Keep the same file bytes, session, language and upload UUID for an explicit retry
after an uncertain response. Different bytes under that key return 409. The
conversation action has its own stable UUID; another key cannot process the same
original twice. Abort is not proof that a server write was undone. No automatic
write retries or background upload queue are added here.

Retain a private client-local file only while its outcome is unresolved, then
dispose of it when no retry needs it; do not upload it to a public bucket. GET
transcripts can show history but exposes neither upload keys nor byte hashes, so
do not identify an uncertain upload by guessing the latest row. Completed sessions
reject upload POST replay; use history and an explicit reconciliation decision.

Server files/spools are temporary and removed on normal success/error/cancellation
paths. No raw audio is stored in Supabase Storage. Abrupt process/host loss still
needs deployment-level encrypted ephemeral storage and crash cleanup; the decoder
subprocess is not an OS sandbox. Use fictional development recordings only.

Tarun's acceptance must demonstrate permission allow/deny, real M4A upload,
visible simulation labels, both languages, the correct source/session IDs,
refresh persistence, repeat taps/retries, offline/unreachable errors, sign-out
and cross-user protection. Share only safe statuses, error codes and fictional
resource identifiers—not passwords, tokens, recordings or private story bodies.
Current backend and isolated-database evidence is recorded in
[Day 9 status](day-9-status.md); it does not substitute for this device test.
