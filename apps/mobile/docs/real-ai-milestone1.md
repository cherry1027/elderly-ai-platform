# Milestone 1 real AI mobile integration

This is the native Expo application. The new real workspace uses `/api/v2` for
AI data and the existing authenticated `/api/v1` project CRUD and atomic Continue
contract. The earlier simulation contract remains unchanged and separate.

## What is implemented

- Supabase sign-in and existing project/dashboard screens remain in the original
  verified account scope.
- Opening a story reuses its active owned session. Otherwise the canonical
  Continue endpoint starts/resumes one session atomically.
- A deliberate microphone action requests native permission and records up to
  60 seconds. Stopping keeps the recording on the phone until explicit consent
  and **Save Real Transcript**. SDK 58 uploads actual verified file bytes.
- The original real transcript is read separately from AI messages. A deliberate
  **Ask Memy About This Memory** submits only its saved transcript ID.
- The interviewer response and extracted suggestions are shown with real
  provider provenance. Suggestions arrive pending; the user confirms, corrects
  or rejects them with optimistic versions. Evidence remains immutable.
- **Listen to Memy** requests an owned AI-generated WAV reply explicitly. Native
  playback verifies the saved audio hash, stops before microphone recording and
  exposes an always-available Stop action. Playback never silently requests a
  new paid synthesis after expiry.
- Confirmed memories can be submitted explicitly to the writer. Each generated
  autobiography is a new version. Readers can choose older versions, edit with
  revision conflicts, inspect edit history and read preserved source evidence.
- Model review is labelled as needing human review, never factual proof.
- PDF preparation uses the existing private native cache/share service. Saved
  export audits can be retrieved and shared from their original snapshots.
- Backgrounding clears private in-memory prose, local recordings and playback;
  returning requires a fresh saved-data read. Dirty navigation uses native leave
  guards. Sign-out/account replacement unmounts the owned workspace.
- If a private native file cannot be deleted, its revoked capability is retained
  by a process-level cleanup coordinator. Capture/playback stay blocked, including
  in a new story/account view, until an explicit cleanup retry succeeds.
- Full 100-record pages show an explicit Load More control for transcripts,
  messages, memories, generations, edits and export audits. The view bounds its
  private RAM to 1,000 records per resource and clearly identifies that ceiling.
- Every paid action uses a RAM-held idempotency key. An ambiguous response is
  blocked from automatic retry. Reconciliation uses the *server operation ID*,
  or a read-only lookup by action kind/client key when no response arrived. It
  then reloads owned resources instead of trusting an opaque result envelope.
  Completed speech metadata is decoded separately so a recovered synthesis can
  be downloaded without paying again. Owned IDs/expiry may remain in the same
  account's RAM across background; audio bytes and files are cleared. Expired or
  evicted audio requires the explicitly labelled Create New Spoken Reply action.
- AI rate limits honor Retry-After through the shared owner-scoped cooldown.
  Reaching an approved usage limit disables further AI actions in the view and
  explains that renewed budget approval is needed; waiting is not a budget reset.

The current theme, application scheme, authentication storage, old simulated
parsers and original B3/B4 native PDF implementation are preserved.

## Explicit real entry point

Use the approved development Supabase client configuration already prepared for
this mobile app. Never copy the backend `.env`, a provider key or a Supabase
secret into Expo.

1. Copy `real-ai.api.example.json` to ignored `real-ai.api.local.json`.
2. Replace its private IPv4 address with the backend computer's reachable LAN
   address on a trusted private network/personal hotspot. The contract marker
   must remain exactly `real-v2`. Shared/public Wi-Fi requires a separately
   reviewed HTTPS setup; the current application intentionally rejects arbitrary
   public hosts.
3. Run `npm run start:real` from `apps/mobile` and scan its new QR code.

The protected real launcher disables the legacy endpoint when the real
configuration is missing or malformed. It does not silently switch to fictional
transcripts, hardcoded interviewer replies or generated sample stories.

The backend must supply the additive v2 migration/routes and report
`GET /api/v2/capabilities` with `contract: real-v2` and `mode: real`. If the live
provider gate is closed, the app clearly reports that real AI is not activated.
Saved data can still be read; no transcript/reply is invented to fill the gap.

`npm start` remains compatible with the older configured development workflow.
The sample-stories launcher remains a separate explicitly labelled preview.
Neither grants authority to activate services.

## Validation and remaining acceptance

Automated tests use synthetic HTTP/native adapters and block accidental network
access. Android/iOS Expo exports validate JavaScript bundling; they are **not**
installed applications or proof of microphone, voice, Auth callback or OS-share
behavior on a phone.

The corresponding backend's additive development migration and funded bilingual
HTTP pipeline have now passed. Real-provider transcription, interview turns,
grounded memory suggestions, explicit review, story generation/verification,
revisions/history, PDF export and verified speech were exercised using clearly
labelled synthetic speech inputs. The full run passed 26 cross-user denials;
a second Swedish turn reused its session and passed three more. This is
backend evidence, separate from human speech quality or phone acceptance.

Mobile regression: 4,030 tests across 113 suites passed, plus typecheck, lint,
offline Expo configuration and dependency validation. Mocked tests and JS
exports do not establish a full signed-in native journey. Actual English/Swedish
phone acceptance, human recording/voice evaluation and Tarun's final independent
review remain pending. The user has authorized publishing the implementation on
separate feature branches for review; no merge to main or deployment is included.

The existing total AI testing ceiling is US$10, with a cumulative conservative
reservation ledger. Preserve all earlier reservations; purchased account credit
does not authorize new spending. Backend activation is private, time-limited
and currently supported on the reviewed Mac/POSIX runtime. No credentials are
included in mobile source. See the backend branch's
`docs/milestone1-github-handoff.md` and `docs/milestone1-real-integration.md`.

Before signing off the real app, run both languages on a physical phone using
an authorized development account: login → create/reopen a story → record →
consent/upload → check real transcript → interview follow-up → record an answer
→ correct/confirm memories → generate/review/edit → older version/history →
prepare/share PDF → reopen and verify persistence. Include permission denial,
backgrounding, playback interruption, expired credentials, lost responses,
duplicate taps and revision conflicts. Hosted two-user checks must confirm
isolation of all v2 transcripts, messages, memories, drafts, exports and speech.

Registration remains governed by the original separately gated Auth flow. This
change does not enable signup, edit callback allowlists or send any emails.
