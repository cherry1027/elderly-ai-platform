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

All 63 offline API, welcome, workspace, and proxy checks passed. Browser startup showed
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
