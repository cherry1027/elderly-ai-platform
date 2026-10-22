# Mobile Task 3D-5 — Memory Review and Correction

Development-only feature. No story generation, live AI, speech recognition,
spoken replies or guest access is introduced. Task 3D-6 has a separate read-only
plan and needs separate approval.

## Flow and contract

Open an authenticated owned story → Start/Continue → Review My Memories.
One sourced memory is shown at a time. Choose Yes/Correct/No, then Save review.
Back lets the person skip reviewing; no automatic confirmation or interrogation.
Refresh/reopening retrieves current backend state, not cached facts.

- GET /api/v1/story-sessions/{session_id}/memories
- GET /api/v1/story-sessions/{session_id}/clarifications (open questions only)
- Existing GET /api/v1/story-sessions/{session_id}/messages for source context
- PATCH /api/v1/memories/{fact_id} with status confirmed/rejected,
  expected_version, and optional corrected_value for confirmation only.

Uses the existing verified-user token accessor and shared API transport. The
publishable key is never substituted for a user token. No user ID is sent as
ownership proof. Backend authorization/RLS remains essential.

Each resource is bounded to 1,000 ordered rows. Full bounded results are
explicitly incomplete and cannot be saved. Requests are sequential so a failed
resource cannot leave orphaned pagination running. No automatic PATCH retry.

## Evidence and corrections

Original transcript, extracted value, evidence, year, source IDs, fact type and
other immutable metadata remain unchanged. The current correction is separate.
For example correction 1975 does not mutate original extracted year 1974.
Confirming without a new correction preserves an existing correction. Rejection
clears its active corrected_value per the backend; source evidence remains.
Only source-linked user messages support a review, not assistant text.
Original value/evidence must occur in the source; extracted year must occur in
the evidence. Unmatched or incomplete provenance cannot become actionable.

A source beginning with the existing canonical simulation notice is visibly
labelled fictional. Unmarked source origin is explicitly unknown, never assumed
to be real recognized speech. Clarifications remain read-only context: at most
three current-memory questions are shown with the total. Resolving one memory
never silently decides another conflicting memory.

Corrections use Python-compatible boundary whitespace trimming, 1–1,000 Unicode
code points and readable-content validation. Internal spaces, accents and
meaningful characters remain. NUL, unpaired surrogates and invisible-only
corrections are rejected before token acquisition or PATCH.

## Reliability and privacy

Version conflicts reload authoritative state and clear the local correction
draft, requiring explicit re-review. Ambiguous saves offer read-only refresh
first, never an automatic mutation. Success requires a validated PATCH response
and compatible reloaded current state. Newer competing corrections are displayed
as changed, not as the local save's success.

Account/project/session/configuration scopes remount private state. Navigation,
background and sign-out abort and fence late responses. Access failures clear
facts/source context and disable further refresh until leaving/re-authentication.
A cancelled HTTP request may still commit remotely; reopening reconciles it.
No corrections, source messages or review state are persisted on the device.
No private content is logged. Existing secure auth storage is unchanged.
Sample preview cannot issue these requests or authenticated mutations.

## Safe Windows and real-iPhone acceptance — NOT run by Codex

Use a trusted personal network, approved development Supabase account, current
ignored mobile-local client settings and fictional data only. This worktree
already contains the two local configuration files; their contents were not
inspected or changed during implementation. Never paste them into a review ZIP.

1. In the separate already-configured backend terminal:
   Set-Location 'C:\\Users\\Grkta\\Documents\\Codex\\2026-10-15\\files-mentioned-by-the-user-elderly\\work\\memy-backend-day7\\backend'
   .\\.venv\\Scripts\\python.exe scripts\\run_mobile_dev.py --lan --simulate-transcription
   This existing launcher pins development Supabase, mock conversation and mock
   writing. Do not enable real providers, migrations or policy changes.
2. In a separate PowerShell terminal:
   Set-Location 'C:\\Users\\Grkta\\Documents\\Codex\\2026-10-15\\files-mentioned-by-the-user-elderly\\work\\memy-mobile-memory-review\\apps\\mobile'
   npm start
   Scan this terminal's NEW Expo Go QR code. Do not use preview:stories or an old
   QR code. A prior Expo Go route can reopen; navigate normally, without clearing
   stored sessions or onboarding preferences.
3. Sign in normally. Create a NEW fictional English test story, not one of the
   two original dashboard fixtures. Start a conversation, record a brief
   fictional sample, explicitly consent to upload, then select its saved
   simulated transcript for the AI simulation. The simulation is canned;
   spoken content is not actually transcribed. If it yields no memory candidates,
   report that limitation rather than typing invented records into the database.
4. Open Review My Memories. Check language, Needs your review state, fictional
   notice, source disclosure and any clarification questions.
5. Confirm one appropriate candidate and Save. Choose a different appropriate
   candidate for a correction; enter fictional corrected text, press keyboard
   Done, verify retention, then Save. If a suitable incorrect candidate exists,
   reject it. No need to alter original fixture stories just to fill all choices.
6. Refresh, go Back, reopen and check saved states/corrections persist. Reopen
   conversation history and verify original simulated transcript/evidence/year
   are unchanged. A corrected year is a separate reviewed value.
7. Repeat appropriate checks on a NEW Swedish fictional story. Try large text,
   VoiceOver, correction validation, keyboard hiding and portrait/landscape.
8. On disposable data, if possible test a concurrent correction in a second
   authorized client: stale Save should reload and demand re-review. Disconnect
   during a save; do not assume failure or repeat immediately. Reconnect and
   Refresh first. Confirm no duplicate/overwritten correction.
9. Sign out during load/save and verify no private rows remain. A separate
   authorized two-account check is still required to establish live isolation.
10. Stop only terminals you started with Ctrl+C. Do not change backend settings,
    delete existing Docker resources or reset user data.

## Verification and limitations

All automated tests use synthetic transports; global real network access is
blocked by the existing Jest setup. TypeScript/lint and offline Expo checks run
with local auth/API settings disabled by the existing protected launcher.
JavaScript exports are packaging checks, not native-device or live API evidence.
Actual result counts are in the independent-review package.

Current-task iPhone acceptance, real backend PATCH/version behavior, cloud
authorization/RLS and independent review remain pending. The user-reported
earlier audio/conversation verification is a prerequisite, not evidence this new
memory feature passed. No production readiness claim is made.
