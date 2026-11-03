# Memy local browser client

This browser client uses the existing development Supabase account and the real
FastAPI `real-v2` contracts. It is a local browser adaptation, separate from the
Expo native application. It does not use seeded stories or simulated AI.

Run from this directory with Python 3 and the backend's installed `httpx`:

```sh
python3 server.py --port 8767 --client-config /absolute/path/to/mobile/apps/mobile/development.auth.local.json
```

Open <http://127.0.0.1:8767/>. The existing real backend must already be running
at `http://127.0.0.1:8001`. The server binds only to loopback, reads only the
mobile client's public Supabase configuration, and proxies fixed API paths to
that backend. It does not read provider or Supabase server credentials. The
`--client-config` argument supports a separate mobile checkout; its default is
`apps/mobile/development.auth.local.json` relative to this repository. The JSON
must contain only `supabaseUrl` and `publishableKey`. Never pass a backend env
file, server key or provider key here.

Sign in using an existing confirmed development account. Credentials and the
session stay in browser memory; reloading closes the session. Create or open a
story, record up to 60 seconds or select a supported audio file, and explicitly
save its transcript. Send a transcript to the interviewer, review memories,
generate/edit a draft, and download its PDF. Preparing spoken replies is a
separate explicit AI action. Browser microphone availability depends on the
browser and OS permissions; file upload is the supported fallback.

Each provider action shares the existing backend budget governor and ledger.
Opening, signing in, fetching saved content, reviewing memories, editing, and
PDF generation do not call an AI provider. There are no automatic paid retries.
An uncertain paid result must be reconciled through the owned operation lookup.
Do not reset the backend ledger or treat the testing ceiling as a new budget.

Checks (no network or provider calls):

```sh
node --test api.test.mjs
MEMY_JSDOM_PATH=/absolute/path/to/node_modules/jsdom/lib/api.js node --test workspace.test.mjs
MEMY_JSDOM_PATH=/absolute/path/to/node_modules/jsdom/lib/api.js node --test welcome.test.mjs
python3 -m unittest -q test_server.py
node --check app.js
node --check workspace.js
```

All 96 offline API, welcome, workspace, and proxy checks passed. Browser startup showed
the sign-in interface without console warnings or errors, and the local proxy
reported the real-v2 backend ready. Mocked UI checks are
separate from actual signed-in browser acceptance and actual iPhone acceptance.
No hosted configuration changes or Git commits/pushes are required to run this
client. The earlier Milestone 1 review ZIP predates this browser adaptation.

## Story-studio refinement — 31 October 2026

The local web interface now includes a book-inspired welcome, larger-text
controls, a real story library, a conversation-first recording studio, clearer
memory/evidence cards, and a readable autobiography view with explicit editing.
The existing cream/forest/bronze theme is retained. Private form/editor drafts
stay in RAM through presentation updates and saved-data refresh; backgrounding
still deliberately clears them. The recording timer updates in place so the
keyboard-focused Stop control is not replaced every second.

The app reads the real capability state and explains when AI testing is paused.
It leaves saved reading, memory review, editing and PDF preparation available.
It never renews approvals, changes a spending ledger or enables a provider.

Design checks included field/text contrast, keyboard focus, reading-size
controls, reduced-motion rules and narrow-screen reflow, informed by
[W3C guidance for older web users](https://www.w3.org/WAI/older-users/developing/).
This is not a claim of accessibility certification. Real-user usability testing
and full signed-in phone/browser acceptance remain separate work.

Browser visual QA covered the actual welcome plus clearly marked offline
workspace fixtures, including the story library, conversation/recording studio,
reader and editor. The temporary fixture server was stopped after testing and
is not part of the live app. Narrow reader/editor views had no horizontal
scrolling. No paid AI requests, hosted data changes, commits or pushes were made
for this visual refinement. The Expo native source is unchanged by this web pass.

## Spoken-reply and microphone recovery

Spoken replies are explicit: **Listen to Memy · Real AI**, then **Play spoken
reply**. Stop pauses and rewinds; replay does not synthesize again. Backgrounding
still clears private audio bytes/URLs, while retaining only owned, expiring
metadata in tab memory. **Load prepared audio** uses the existing authenticated
WAV read, including unchanged hash/container verification. **Check prepared
spoken reply** uses the free authenticated
`GET /api/v2/conversation-messages/{message_id}/speech`, so a lost client state
can recover audio that is still available, even when paid AI is paused.

Audio expires after five minutes and is lost on a backend restart. Expired audio
is reported honestly; creating a replacement always needs a separate explicit
AI action and available budget. Browser playback errors offer free reload or
Play again rather than silently generating new speech. Owner/project/session
changes and sign-out clear all retained metadata. Late background responses
cannot revive audio bytes.

Microphone permission/device failures now show actionable guidance and open the
existing audio-file fallback. A denied microphone request makes no upload or AI
call and preserves a previously selected, unsent file. Capture is never retried
automatically. These changes were verified offline, including paused-gate
recovery, focus/privacy/race handling and cross-user metadata access denial.

## Memory-garden interaction pass — 31 October 2026

The cream/forest/bronze theme now has warmer botanical details, optional memory
inspiration, clearer conversation roles, and actual-recording-only wave motion.
The welcome offers place/person/everyday prompts and an explicit sign-in shortcut.
Within a story, prompt text matches its English/Swedish language and changes only
in tab memory. Choosing a topic or another question never writes data, submits a
message, opens the microphone, plays audio, or calls an AI provider. This is local
inspiration, clearly distinguished from saved AI replies.

Existing conversations start with inspiration collapsed so saved messages remain
prominent; empty conversations offer it immediately. Explicit expansion choices
survive saved-data refresh and reset on background/context privacy cleanup. The
saved-work strip reports actual loaded session transcripts, session confirmations
and project drafts with their scopes, without scores, streaks or invented progress.

Welcome visual/keyboard order places sign-in before optional inspiration on narrow
screens. Controls retain visible focus and selected states, larger-text support,
and reduced-motion behavior. Browser QA checked the real unsigned-in welcome;
synthetic offline fixtures checked workspace layout, Swedish inspiration, reader
and editor at 375px. Those fixtures were never loaded into the real app or hosted
database. The full welcome remains English; new Swedish copy is limited to story
inspiration and saved-work descriptions. Native Expo source is unchanged by this
local web pass. Actual-device and older-user acceptance remain separate checks.

No new dependencies, provider calls, hosted changes, commits or pushes were made
for this interaction pass.

## Faster saved-work updates — 2 November 2026

Initial capability and story-library reads now start together, removing one
sequential network wave. Successful actions reread only collections they can
change, instead of refreshing all six collections in an open story:

| Action | Collection reads before | Collection reads now |
|---|---:|---:|
| Save original transcript | 6 | 1 |
| Save conversation turn | 6 | 3 |
| Review a memory | 6 | 2 |
| Generate or edit a draft | 6 | 1 |
| Prepare a new PDF | 6 | 1 |
| Download a saved PDF | 6 | 0 |

Counts assume each collection fits in its first page. Pagination is unchanged.
Conversation and memory-review refreshes still include drafts so new clarification
questions and changed source facts mark older wording accurately. Explicit **Reload saved story** and uncertain-action
reconciliation still reread every collection. Private context/background cleanup,
authentication, explicit transcript review, paid-action consent and retry controls
are unchanged. Nothing is stored in a new browser or HTTP cache.

Offline delayed-request and request-count checks verify the removed waterfall and
redundant reads. These are not claims of measured live-model speed or actual-phone
performance; no paid provider calls were used for these checks.

## Unsent-action recovery and PDF guidance — 2 November 2026

An operation that stopped before any provider dispatch can be recorded as
`failed`, including a spending-reservation rejection after its operation was
claimed. **Reload saved action** now releases that held client action only after
the owned lookup returns the complete matching `RealOperation` envelope with a
terminal `failed` status and `result: null`. The client checks the original
operation ID when known, kind, project/session scope, canonical non-null failure
code, timestamps and current
client/action identity. Malformed, wrong-scope, disposed, in-progress and uncertain
results remain held. A verified failed lookup reports that no AI request was sent
for that operation; it never retries a POST or clears prior spending history.
Starting a replacement still requires a later explicit click and a new action key.

The autobiography view now explains that writing the first draft uses Real AI,
while PDF preparation/download from an already saved draft makes no AI request.
Local testing-allowance messages are distinguished from provider credit/billing
rejections; the interface does not infer or display an account credit balance.
These paths are verified with synthetic offline responses, including the actual
client-to-workspace failure/recovery flow. No live provider call was used.

## Typed conversation — 3 November 2026

The conversation now opens with a large **Write a memory or answer…** composer,
**Send**, and a separate **Use voice instead** control. The current
cream/forest/bronze theme is retained. Opening voice options never opens the
microphone or sends audio. Typed messages and voice transcripts share the same
saved conversation, with the person’s original typed wording labelled as their
own rather than attributed to OpenAI. New composer, message-role, status and
review controls follow the story’s English or Swedish language.

An explicit send calls
`POST /api/v2/story-sessions/{session_id}/text-messages` with
`{"text":"the exact original wording","language":"en"}` (or `sv`). The input
accepts up to 4,000 Unicode characters, preserves spacing/newlines, and does not
convert typing into a simulated transcript. The backend saves the immutable
original and assistant reply together when the turn completes. Typed input uses
the existing interviewer and suggested-memory pipeline. Suggested facts still
require the user’s review; listening remains a separate explicit action.
Typing avoids transcription charges, but the AI text reply is still a paid
provider action governed by the existing allowance.

The interface shows **Memy is thinking…**, saved, failed and uncertain states.
Duplicate clicks are blocked before asynchronous hashing or dispatch. Enter
inserts a newline; Ctrl/Cmd+Enter is an explicit send shortcut, with IME/repeat
protection. A recoverable failed send keeps the unsent draft in tab memory.
Backgrounding, changing project/session or signing out clears that unsaved draft;
it is never saved to local/session storage. Successfully saved history is
reloaded from the owned backend when the story is reopened.

Pending action metadata retains a SHA-256 digest, never the original message.
Both initial results and recovered results must match its original wording,
project/session/language, source pairing, roles, sequence and original-user
provenance. Real mode, distinct message IDs, canonical assistant model/version, aware message timestamps and original-grounded, ownership-matching pending memories are also verified. Completed recovery must also match the owned operation envelope and
its original operation ID when known. Recovery is GET-only; no failed or
uncertain send is automatically retried. Missing database setup reports
`TEXT_CHAT_NOT_READY` honestly and releases the action only when the backend
response has no operation-claim header.

Verification: **121 Node checks and 16 proxy checks passed**, plus JavaScript
syntax checks and `git diff --check`. The new offline checks cover exact original
submission, a saved reply and reopened history, duplicate clicks, EN/SV controls,
length/blank/Unicode validation, IME/newlines, ownership/source/provenance
mismatches, budget failure, uncertain-operation recovery and background/context
privacy. These use labelled synthetic fixtures only. No live AI call, provider
enablement or budget/configuration change was made for this web implementation.
The signed-in browser was also checked with real saved history and an unsent
typing check. The separately approved development migration and its rollback-only
verification are recorded in `docs/typed-chat.md`. New live typed-provider and
actual-device acceptance remain separate. With AI paused, the real preview still
accepts a private draft but correctly disables Send; it never fabricates a reply.
