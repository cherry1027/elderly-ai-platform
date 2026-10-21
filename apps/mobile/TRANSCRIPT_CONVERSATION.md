# Task 3D-4B: saved transcript to simulated conversation

Development-only addition to the reviewed recording/upload feature. No real AI, speech recognition,
voice playback, typed composition, guest, memory review, story generation or PDF is enabled.

## Contract verified read-only
Backend Day 9: 73094c77c9c9d04a9a4c6b213b05112eb675c130.
References: docs/day-9-mobile-audio.md, docs/conversation-api.md, docs/frontend-integration.md,
backend/app/api/conversations.py, schemas/conversations.py, conversation_resources.py and tests.

POST /api/v1/story-sessions/{session_id}/messages returns HTTP 201, including same-key replay.
Only source_message_id (the returned transcript UUID) and the exact session language en/sv enter
the JSON body. Transcript text, owner IDs, role and timestamps are never POSTed.
Authorization uses the current verified user's access token. The existing private-LAN-only API
configuration, JSON transport, token guards, cancellation and safe errors are reused.
A new secure conversation UUID is distinct from the audio upload UUID and retained with that
source ID/language. No automatic POST occurs on selection, upload, mount, refresh or reopening.
The UI validates HTTP/JSON/schema, mode:mock, unchanged source text/ID, session/language, message
roles/order and the returned memory/clarification contract. Candidates are not confirmed or edited.

GET /api/v1/story-sessions/{session_id}/messages returns ascending sequence history.
Read pages use limit=100, with a conservative 1000-message ceiling and an explicit complete flag.
Incomplete history disables processing; it never proves a source is absent or unprocessed.
The earlier audio panel still loads its first 50 saved transcripts, as before this task.

## Reconciliation and duplication
Uploaded transcripts already are user messages. Processing reuses that immutable original; only
the backend reply and its metadata are appended. The UI merges by persisted IDs, rejects sequence
collisions/changed existing rows, and shows original transcript prose once in the recording panel.
The history refers to those originals rather than rendering a second copy of the same text.
Replies are full returned backend text, clearly labelled AI simulation, without speech/streaming.

Important backend limitation: history has NO source-to-assistant linkage or request key.
Uploading A and B, then processing A can put A's reply immediately after B. Neither source presence
nor assistant adjacency establishes processing. The app never guesses such associations.
Only a verified POST response/replay establishes the selected turn. A conflict is not proof of success.

After uncertain results, Check saved conversation performs GET only. Retry the same action is a
separate explicit choice, retaining the same UUID and JSON payload, and checks history again first.
No new key is substituted. Successfully confirmed actions are disabled during the same account visit.
Blocked actions have an unavailable label, never a false Already processed label. The explicit\nCONVERSATION_CHANGED conflict allows a same-key retry after reconciliation; ambiguous key/source\nconflicts remain blocked. Authentication/access failures clear the displayed message history.
A per-account RAM provider keeps key/ID metadata across story navigation; it stores no source text,
audio or token. Sign-out, account changes and authenticated-provider teardown clear it.
App/process exit or foreground re-verification may lose RAM keys. Later history remains readable,
but cannot recover a prior turn key. A deliberate attempt under a fresh key may get 409; backend
source uniqueness prevents a duplicate turn in the inspected backend implementation. The live
deployment of that database protection has not been independently checked here. Exact old turn lookup would need an additional backend
contract, outside this task. Do not bypass this constraint with text matching or guessed pairs.

POST has a bounded 30-second budget; history calls keep bounded metadata deadlines. Abort/timeout
does not prove rollback. Stale responses and diagnostic/error bodies cannot restore prior accounts'
data. No source text, reply, native path, password, token or local configuration is logged.
Sample Stories is guarded separately and cannot issue these authenticated requests.

## Local setup and real iPhone acceptance (PENDING)
No live login/backend request was performed during implementation. Automated checks use synthetic
responses, blocked global network access and mocked native operations. JavaScript exports are not
native builds or device acceptance. Earlier functionality below is USER-REPORTED, not Codex-tested.

This new worktree intentionally does not inherit ignored credentials or addresses from another one.
If development.auth.local.json / development.api.local.json are absent, privately create them from
development.auth.example.json / development.api.example.json. Keep the pinned approved development
Supabase URL; use only its client-safe publishable key. Re-enter the existing approved iPhone-reachable
private backend address. Do not use a service-role key, access token, root .env or public tunnel.
Do not commit or put these local files into a review ZIP. Checks disable local configuration loading.

Windows PowerShell (after review, not executed by Codex):
1. Keep the existing approved development backend in mock conversation mode. Its reviewed launcher:
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-backend-day7\backend'
   .\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
   If it is already running correctly, do not start a second server.
   No migrations, settings/RLS edits, paid providers or real speech-recognition flags are needed.
2. Stop ONLY this app's previous Metro terminal with Ctrl+C. Then:
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-transcript-conversation\apps\mobile'
   npm start
   Scan the NEW normal-app QR code with Expo Go on the same approved private network.

iPhone checklist:
1. Log in with the existing authorized development account. Open an owned English fictional story
   and its active session. Verify the existing saved, permanently labelled fictional transcript.
2. Confirm that merely opening, selecting, refreshing and re-entering do not process a new turn.
3. Select that transcript by its number, then choose Process selected transcript (simulation).
   Expect the original text to remain unchanged, a single saved user-message reference and the
   actual Memy simulated reply. There is no spoken answer or real speech recognition.
4. Refresh saved conversation, leave to the story and reopen. History should stay in sequence,
   with no duplicate original or reply and no automatic processing. During the same account visit,
   a confirmed original should be disabled as Already processed.
5. Repeat with an owned Swedish session. Session language must remain Swedish even if the UI
   language changes. Original permanent simulation notice must remain intact.
6. Tap Process repeatedly: at most one request action should run. Do not deliberately interrupt
   personal recordings; use fiction only. If a response becomes uncertain, Check saved conversation
   first, then explicitly Retry the same action if offered. A refresh alone must never send POST.
7. Sign out while a request is running; no previous messages may remain or appear late.
   Re-sign in/reopen. Saved history comes from the backend; RAM keys may have been cleared.
8. With a separately authorized second development account, verify it cannot see/open the first
   account's session. Do not claim cross-user isolation from one successful account.
9. Test unreachable development backend and expired login: clear errors, no fake reply/success,
   no replacement upload, and Back/Sign Out still available.
10. Test large text/VoiceOver, both languages, scrolling and touch targets. Recheck Intro/Replay,
    Login/Sign Out, disabled live Registration/Guest, dashboard, Create/Edit and recording/upload.

Never share raw logs, tokens, passwords, recordings or personal story text. Report only safe
HTTP status, allowlisted code, screen state and fictional test references when needed.

## USER-REPORTED prerequisites
The user reports real-iPhone login, owned story list/create/edit in English and Swedish, session
start/resume, M4A recording/upload with consent, labelled simulated transcript and reload persistence.
No Task 3D-4B device acceptance has yet been reported. Independent review remains pending.
