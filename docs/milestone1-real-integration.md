# Memy Milestone 1 — real integration handover

The real-provider backend journey is implemented and has passed funded English/Swedish HTTP acceptance. The native B3/B4 frontend is implemented and its automated checks pass. **Full actual-phone acceptance, human recording/voice quality evaluation and Tarun's final independent review remain pending.** The older fictional browser preview is not evidence for this application.

## Verification update — 31 October 2026

- Backend regression: **1,526 passed**, four separately opted-in live checks skipped. Mobile: **4,030 tests / 113 suites passed**, plus typecheck, lint and offline Expo configuration/dependency checks. SQL/PGlite: **101 passed**. Expo's offline dependency validation retains its own reliability limitation. These results are separate from native acceptance.
- Two disposable development identities signed in through actual Supabase Auth. The funded run created owned English/Swedish projects and reused the correct sessions, transcribed audio through the real model, extracted pending source-grounded memories, produced interviewer replies, explicitly confirmed eight inspected synthetic facts, wrote and separately reviewed story drafts, saved revisions/history, exported historical PDF snapshots and returned verified spoken replies. The full run passed **26 cross-user denial checks**, with completed action replay checks; original transcripts remained unchanged.
- A second Swedish turn reused its session, retained the first original transcript and all four ordered messages, and passed three additional cross-user denials. Its follow-up respected an explicit correction about an unstated move origin. This addressed an unsupported inference observed in the first test question. One passing follow-up is bounded evidence, not a general guarantee against hallucination.
- Test inputs were **local synthetic speech**, clearly labelled. Both initial transcripts matched the supplied names, places and dates. The generated PDFs and WAVs are real provider outputs from those fixtures. Four PDF pages were rendered and visually reviewed; Swedish glyphs, page numbering and draft/human-review notices passed. None of this establishes human speech accuracy or actual iPhone playback/sharing.
- The original quota problem was a funded-account/key mismatch. A replacement credential was entered privately from the funded account and a real transcription canary passed. No additional credit purchase, subscription or auto-recharge was introduced. The development server is currently explicitly enabled behind the approved time/budget gate; default startup remains off.
- Real testing found and fixed two speech interoperability issues: the Python WebSocket client now uses a verified certifi CA bundle with mandatory hostname/certificate validation, and it accepts the current correlated `conversation.item.done` lifecycle event without relaxing final response, exact transcript, audio format or voice checks. Regression and independent code review passed. Failed attempts were preserved; post-fix retests were explicit actions with new keys, never automatic retries.
- The latest authorization is a **US$10 cumulative testing ceiling, aiming below US$5**. At the frozen handoff, 25 attempts conservatively reserve **US$7.00**, leaving **US$3.00** of reservation allowance. Reported usage for 16 completed requests estimates approximately **US$0.0218**; nine failed/unmeasured attempts remain excluded from that usage estimate and retain their full reservations. This is not an invoice or a claim of exact total spend. Preserve the ledger and all earlier reservations; account credit is not a spending authorization.
- Both exact run-tagged disposable identities were deleted and their absence verified after capture. Their tokens were removed from the private coordinator state. No existing user, Auth setting or production resource was changed.
- Actual iPhone English/Swedish microphone, AI playback, background/restart, reconciliation and native PDF sharing acceptance remains pending. The user previously confirmed that the actual app opens; that alone does not pass the full journey.

## Source and boundaries

- Backend base: `9acce16deeb31c80eb0d5c837dff6c4cce743d14`, isolated branch `codex/real-milestone1-ai-backend`.
- Mobile base: `de321bfb47ee5bb316431f62db9d9030fc79911f`, existing isolated B3/B4 worktree; theme retained.
- Implementation is published for review on separate backend and mobile feature branches. No merge to `main` or hosted application deployment is included; see `milestone1-github-handoff.md` for branch and validation details.
- Existing `/api/v1` simulated contracts remain unchanged. They are not used as real AI output.
- Development Supabase only: `edbkuunyeyxnyenmmqud`. The additive migration does not enable Auth, email, paid providers or public data access.

## Actual connected journey

Supabase login → owned project → atomic Start/Continue session → native recording → explicit audio-processing consent → immutable real transcription → an explicitly requested interviewer turn using owned prior context → grounded pending memory candidates → confirm/correct/reject → explicitly generate a sourced autobiography → separate model review and required human review → manual revisions/history → private PDF sharing and historical export download.

The interviewer stays in the project's English (`en`) or Swedish (`sv`) language. Spoken replies are explicit opt-in AI-generated audio. The voice must reproduce the saved assistant text exactly; a mismatch fails closed. It does not imply factual correctness or a human voice.

Raw recordings are temporary, not permanently uploaded to Storage. Original transcripts and their provenance remain separate from messages, memory corrections and saved drafts. Generated speech exists only in bounded private server memory for five minutes and private temporary mobile files. Restart/expiry returns `410 SPEECH_EXPIRED`; the app never automatically pays to regenerate it.

## Run with providers OFF

Install backend requirements in a private virtual environment. Python 3.13 is the verified local runtime; the existing requirements pin the macOS 13-compatible audio decoder. Use the existing private OpenAI configuration in place; do not copy it into this repository or mobile app.

From the isolated backend directory:

```sh
/path/to/python scripts/run_real_app.py \
  --env-file /absolute/path/to/existing/backend/.env \
  --env-file /absolute/path/to/isolated/backend/.private/real-ai.local.env \
  --check

/path/to/python scripts/run_real_app.py \
  --env-file /absolute/path/to/existing/backend/.env \
  --env-file /absolute/path/to/isolated/backend/.private/real-ai.local.env \
  --port 8001
```

This launcher forces all legacy simulation providers off and keeps real AI off unless BOTH `--enable-real-ai` and `REAL_AI_ENABLED=true` are explicitly set. Normal startup makes no provider requests. `/health`, `/ready` and `/docs` remain available. `/api/v2/capabilities` reports the closed gate honestly. Owned read/review/edit/export functions do not invoke AI.

For a physical phone, use a currently trusted private Wi-Fi/personal hotspot and explicitly pass `--host 0.0.0.0 --trusted-private-network`. Put the Mac's reachable private IPv4 address in the mobile configuration. Never send user JWTs over shared/student/public LAN HTTP. A reviewed HTTPS deployment is a separate task.

## Mobile launch

Use the delivered `apps/mobile` source and its SDK 58-compatible lockfile. Existing login/API configuration is still required. `real-ai.api.local.json` is an ignored, client-safe opt-in file containing only:

```json
{"apiContract":"real-v2","baseUrl":"http://192.168.1.10:8001"}
```

Shared project/session APIs use `/api/v1`, while the new client maps real AI calls to the sibling `/api/v2`. Use your actual private address, not this example. Run `npm run start:real`; missing/invalid real configuration fails closed. No keys belong in this file. The real workspace is native iOS/Android; a JavaScript export is not a native phone test.

For the actual device journey: sign in, open an owned story, choose **Share Memories → Refresh saved work**, then **Record a Memory → Stop Recording → consent → Save Real Transcript → Ask Memy About This Memory → Listen to Memy**. Review candidates in **Your memories** before selecting **Your autobiography → Create Autobiography**. Edit/save a revision, inspect history, then **Prepare & Share PDF** and open the native shared file. Repeat using a separate Swedish-language project; changing interface language alone does not change a project's language. Confirm background/reopen, interrupted requests and private audio cleanup separately. No native simulator or real-phone test is inferred from the browser, automated suite or captured API output.

## v2 contract

The OpenAPI snapshot contains all 25 unchanged legacy operations plus 20 v2 operations, including the free prepared-speech recovery read. Every private route validates the Supabase user access token online. `capabilities` is the only public v2 route. Lists are arrays, paginated with `limit`/`offset`. Project language and ownership come from the owned project/session, never a client `user_id`.

| Method | `/api/v2` path | Purpose |
|---|---|---|
| GET | `/capabilities` | Sanitized activation state; no key/budget details |
| POST / GET | `/story-sessions/{id}/transcribe` / `/transcripts` | Real upload / immutable originals |
| POST / GET | `/story-sessions/{id}/messages` | Owned context-aware interviewer / saved turns |
| GET | `/story-sessions/{id}/memories` | Pending/reviewed memory candidates |
| PATCH | `/memories/{id}` | Optimistic confirm/correct/reject |
| POST | `/story-projects/{id}/generate` | Explicit writing from confirmed resolved sources |
| GET | `/story-projects/{id}/drafts` | Saved versions |
| GET / PATCH | `/story-drafts/{id}` | Read / optimistic manual revision |
| GET | `/story-drafts/{id}/history` | Immutable edit history |
| POST | `/story-drafts/{id}/export` | PDF of the explicitly selected revision |
| GET | `/story-projects/{id}/exports` | Immutable export metadata |
| GET | `/story-exports/{id}/download` | Re-render that historical saved snapshot |
| POST / GET | `/conversation-messages/{id}/speech` | Explicit paid speech / free recovery of a prepared owned reply |
| GET | `/spoken-replies/{id}/audio` | Authenticated transient WAV |
| GET | `/operations/{id}` | Reconcile by server operation ID |
| GET | `/operations/by-key/{kind}/{action_key}` | Reconcile a completely lost response |

Paid POSTs require one UUID `Idempotency-Key` per explicit user action. Multipart transcription accepts `file`, project `language` and `consent=true`; max 25 MB/90 seconds. A turn accepts `{"source_transcript_id":"UUID","language":"en"}`. Generation accepts `{"language":"en","style":"warm","confirm_generation":true}`. Memory review uses `expected_version`; edits and PDF export use `expected_revision`. Typed AI chat is deliberately absent from this voice-first slice.

Completed actions replay saved results without provider dispatch. In-progress or uncertain actions cannot be reclaimed. A server trace distinguishes proven zero-dispatch failure from a possible charged attempt; only a proven failed action permits a new explicit key for the same transcript. Connection loss never triggers automatic paid retry. Error responses may expose `X-Memy-Operation-Id` for reconciliation; no claim nonce is exposed.

Private responses use no-store caching. Error bodies contain only stable code/message, never upstream provider bodies, keys or source text. `429` includes `Retry-After`; budget exhaustion needs reviewed renewed approval, not simply elapsed time.

## Persistence and authority

`20261029010000_real_ai_milestone1.sql` adds real operation, transcript, message, memory, clarification, memory revision, story draft/edit, speech-metadata and export-audit relations. It uses ownership RLS, immutable originals/audits and server-only claim/completion RPCs. User JWTs cannot forge real-provider provenance by directly inserting AI records. Review/edit RPCs remain owned and optimistic. All tables cascade through the existing project/account deletion design.

The server-only development Supabase secret stays in an ignored private file (directory 0700/file 0600). It must never be bundled, committed, logged, sent to Tarun's client or included in a review ZIP. No production key or settings were used. OpenAI credentials remain in existing or explicitly approved ignored private configuration; none is copied into this package. Key presence alone does not establish account funding or model access.

Manual SQL Editor application is recorded by filename/hash and verification evidence. Do not blindly reapply it through `supabase db push`; reconcile CLI migration history separately if introducing that deployment workflow.

## Activation and cost controls

1. Preserve the latest **US$10 total evaluation ceiling**, aiming below US$5, and the existing durable reservations. Do not reset the ledger, treat the purchased credit balance as a budget, or enable automatic recharge. An expired approval requires a reviewed renewal that subtracts earlier reservations from the same total ceiling.
2. The tested evaluation uses `gpt-transcribe`, `gpt-6.1-terra` for text and the separate verifier, and `gpt-realtime-2.1-mini` with `marin` for speech. The selected account/model combination passed the bounded real-provider run. Standard service tier is explicit for text requests. Synthetic fixture success does not establish real-person recording or voice quality.
3. Configure `REAL_AI_TRANSCRIPTION_MODEL`, `OPENAI_TEXT_MODEL`, `OPENAI_VERIFIER_MODEL`, `REAL_AI_SPEECH_MODEL`, optional `REAL_AI_VOICE`, and a short-lived private approval file. The existing governor requires approved models, expiry, per-attempt reservations, maximum calls and call-rate ceiling, and a private durable SQLite ledger. It is POSIX-only and single-host; Windows server activation fails closed pending reviewed ACL support.
4. Use separate real text/verifier clients and approved operation ceilings for transcription, extraction, interviewing, writing, verification and speech. A reservation is a conservative local guard, not the provider's final bill or a universal multi-host cap. Uncertain requests are not refunded/retried automatically.
5. The funded canary and API run have passed. The running private Mac server uses a short-lived bounded approval plus both the server flag and launcher switch. Capability checks close the paid gate when approval expires or configuration is absent. Actual calls reserve before dispatch and stop when the remaining attempt/budget allowance is exhausted. Startup never calls a provider. Stop/disable paid serving after device testing; continuing beyond the same total ceiling needs a new explicit user authorization.

`REAL_AI_USAGE_LOG_PATH` optionally enables a private append-only numeric usage log. It records only operation/model, reservation reference, status, numeric provider usage and service tier; no source text, credentials or private story identifiers. Its estimates are not an invoice. The request governor reserves before each paid dispatch even if the provider later rejects the request.

`backend/scripts/verify_real_milestone1.py` runs staged real-v2 HTTP acceptance using caller-supplied, distinct development user tokens. Its private journal records action keys before paid requests. Re-running resolves existing operations instead of silently issuing fresh paid actions. Start with transcription/conversation, review the actual source-grounded memory candidates, then explicitly continue generation/speech. Synthetic speech input can verify the pipeline but must not be reported as human recording quality or phone acceptance.

Current provider implementation follows the official [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text), [speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) and [Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations). Recheck those and current pricing immediately before funded evaluation.

## Phase C readiness note

1. **Reuse:** the existing bounded `OpenAIClient`, durable spending governor, grounded extraction adapter, story writer and separate verifier are reused by `RealAIProvider`. The new Realtime speech adapter adds bounded faithful spoken replies. Existing Supabase Auth, project/session APIs and native recorder/PDF infrastructure remain in place.
2. **Implementation versus remaining work:** v2 routes, additive real-data migration and the native real workspace are implemented. Funded bilingual HTTP acceptance, populated real-record JWT isolation, context continuation and document rendering passed. Actual-device acceptance, human recording/voice quality and Tarun's exact-package review remain outstanding. Address any findings before founder sign-off; a JavaScript export cannot settle those questions.
3. **Decisions/prerequisites:** a funded credential and selected models are configured privately for the bounded evaluation. No additional purchase is needed for the current approved run. Preserve the budget/ledger and review provider data-retention terms. Use the supported private Mac/POSIX backend initially; Windows paid-server activation, distribution and shared HTTPS hosting are separate infrastructure decisions. No subscription, auto-recharge or hosted application deployment was created here.
4. **Next smallest acceptance task:** one consenting person's short English recording on the actual iPhone → real transcript → relevant interviewer reply → spoken playback. Record accuracy and latency, then complete reviewed memories, writing, editing/history and native PDF sharing; repeat with a Swedish-language project. The synthetic backend pipeline has already passed, so this step verifies the device and human inputs rather than repeating mocked output.

## Acceptance still required

- Human English/Swedish recordings: accuracy for names, places and dates, plus voice listening evaluation. Synthetic input pipeline and source-preservation evidence is already recorded separately.
- Context-aware interview quality and faithful AI-generated spoken playback on the actual device.
- Native microphone permissions, interrupted/background recording, app restart/relogin, retry/reconciliation, private-file cleanup, story edits/history and native PDF sharing in both languages.
- Tarun's independent review of this exact frozen package and fixes for findings.

Automated tests, mocked providers, local PGlite, SQL role claims, JavaScript exports and browser screenshots are recorded separately. None certifies live quality, billing, native acceptance or founder milestone sign-off.
