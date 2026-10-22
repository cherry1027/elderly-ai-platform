# Mobile Task 3D-6 — Generate My Story

Development-only authenticated backend integration. Only the deterministic mock
writer is supported. No paid AI, real transcription, voice replies, PDF, Guest,
draft editing or version-history UI is enabled by this task.

## Flow

Existing owned story → Generate My Story → read saved draft (if any).
Generate My Story / Prepare a new draft opens an inline explanation; only
"Yes, generate my draft" sends a generation POST. Cancel, mounting, Refresh,
reopening and returning from navigation never generate automatically.

Review My Memories uses the existing conversation/review screen. This specific
navigation reads an existing active or latest returned saved session; it never
creates one. If no session exists, return to the story and deliberately start a
conversation. Current review remains per-session, not a whole-project selector.
Generation eligibility is exclusively backend-authoritative and project-wide.
A conflict in an older session may require separately coordinated review; the
current single-session review screen is not proof all project conflicts resolved.
Read-only review of a completed session returns to the story, without exposing
recording/upload actions for that completed session.

## Actual API and source protection

Reuses the current verified user's token accessor and shared JSON transport:
- POST /api/v1/story-projects/{id}/generate, HTTP201, UUID Idempotency-Key,
  exact {language: saved en|sv, style:"warm", confirm_generation:true}.
- GET /api/v1/story-projects/{id}/drafts?limit=1&offset=0.
- GET /api/v1/story-drafts/{id}.
- GET /api/v1/story-projects/{id}/verification.

The project report describes the latest generation. It is used only for the
matching draft ID/generation version/manual revision and a compatible status.
An older generation returned by replay keeps its own selected-draft report.
The API validates exact draft/source/report schemas, ownership scope, original
canonical source sentences and edited/stale report invariants.
No user ID is sent as authorization. No service-role or publishable key replaces
the user token. The existing approved development configuration is unchanged.

The preview shows actual saved backend prose, not client-written autobiography.
Source snapshots are secondary read-only disclosure, preserving original value,
evidence and extracted year separately from a correction and generated sentence.
A simulation match is not proof of historical truth or future AI correctness.
Backend-blocked pending, rejected, unsupported or conflicting memories never
produce fabricated local text.

## Retry and lifecycle

One secure native UUID per explicit logical action, with immutable language/style/
confirmation payload. Metadata lives in account/project/language/API-scoped RAM
above the existing private authenticated views, so a pending action survives
navigation and background authentication revalidation without storing prose,
tokens or sources. Sign-out/account changes clear it.

Duplicate taps lock synchronously. Uncertain responses require read-only saved
state reconciliation first. GET cannot identify the action key, even if a draft
now exists. Only explicit same-key retry follows another read. No automatic POST,
new-key replacement or local success/failure assumption. A blocked idempotency
conflict stays blocked and needs investigation; Refresh cannot bypass it.

Successful POST replay can return an older edited/stale generation; unchanged or
reverted source context can reuse saved drafts, preserving edits. After POST,
the selected saved draft is re-read and checked for immutable snapshot parity
and nondecreasing revision. A newer human revision is displayed honestly.
Cancellation, background, auth failure, sign-out/account/project changes abort and
fence responses. Aborting does not prove the server did not commit.

No private draft cache or retry queue is persisted. Process termination loses
action metadata: next launch is GET-only. Inspect existing drafts before a new
explicitly confirmed action; do not claim exact-action recovery after process loss.

## Safe automated checks

Use the existing protected npm launcher. Verification mode disables mobile-local
auth/API settings, dotenv/client environment loading and telemetry, and sets Expo
offline mode. Jest's existing real network/native blockers remain active.
All API/authentication responses in automated tests are synthetic.
No dependency versions or lockfiles change.
JavaScript exports are not native builds or physical-device verification.
Offline dependency validation has Expo's stated reliability limitation.

## Windows / real iPhone acceptance — PENDING, not performed by Codex

Use the existing authorized development account and a trusted personal network.
Do not use a shared/public HTTP network, tunnel, new firewall rule, production
project, new signup email or paid provider. Keep existing ignored client-only
local JSON settings private. They were present but not read, copied or changed.
If LAN address changes, follow the existing approved local setup; no default
address is hardcoded by this feature.

PowerShell terminal1, in the already configured read-only backend checkout:

    Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-backend-day7\backend'
    .\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription

This pinned launcher enables mock conversation/story writing; the transcription
flag is fictional simulation only. It never enables a paid speech provider.
Use the same existing approved development credentials, never copy legacy .env.
If backend is already running correctly, keep it; do not start a duplicate.
Do not install packages or run migrations for this acceptance step.

PowerShell terminal2:

    Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-story-generation\apps\mobile'
    npm start

Scan this terminal's NEW Expo Go QR code, not an old sample-preview QR.
Expect MEMY NORMAL APP, without the SAMPLE STORIES banner.
Do not reset sessions/onboarding preferences to force a route.

1. Sign in. Use a NEW fictional English story with source-supported confirmed
   memory candidates. Leave the two original dashboard fixtures intact.
   If necessary use existing short recording/upload → simulated transcript →
   mock conversation → Memory Review. The simulated transcript is canned and
   does not recognize what you spoke. Confirm only appropriate fictional facts.
2. Open the story and Generate My Story. Loading/Refresh must not create a draft.
   Select Generate, then Cancel once; no saved draft should appear from that.
3. Select Generate again and explicitly choose Yes, generate my draft.
   Expect actual backend prose, AI simulation notice, story language and draft
   verification. Missing/unsupported/conflicting facts should show a helpful
   error and memory review route, never a locally invented autobiography.
4. Expand Source memories. Check original evidence/year and separate corrections.
   A correction may be unsupported by the narrow mock templates; report this
   rather than changing source transcripts or bypassing verification.
5. Refresh, return to the story, reopen, and reload the app. The same saved
   draft should remain; no automatic generation, new version or lost edit.
   Checking exact row/version duplication server-side requires Charan's safe
   authorized development verification; visual sameness alone is not proof.
6. Repeat on a NEW fictional Swedish story. Use interface language independently
   if helpful; generated language must remain the saved project's language.
7. Use another NEW empty/unreviewed project: attempt generation explicitly.
   Expect translated guidance, not story prose. Review Memories must not create
   a session merely because it was selected.
8. If safe, disconnect during generation on disposable data. Reconnect,
   Refresh saved draft first, then explicit Retry same generation if offered.
   Reopening/navigation/background must retain the same RAM action while the app
   process remains alive. Do not repeatedly tap or assume cancellation failed.
9. Sign out during a read/generation; no prior draft must remain visible.
   A second existing authorized development account is required for a real
   cross-user denial check. Never create cloud accounts automatically.
10. Check VoiceOver, large text, confirmation focus, source paging and Back.
    Stop only terminals you started using Ctrl+C.

## Pending gates / limitations

Current-task live generation, persistence, idempotent replays, cloud authorization,
cross-account denial, actual deployment/mode configuration and physical
accessibility are unverified by mocked tests.
The supplied prompt reports previous iPhone-tested login/stories/audio/
conversation/memory review; that is USER-REPORTED baseline evidence only.
This is implementation self-review, not independent review.
Task 3D-7 is planning-only until device acceptance, independent review and the
separately approved commit/push. No editing/history controls are included.

Suggested future commit after approval:
feat: add authenticated simulated story generation and saved draft preview
