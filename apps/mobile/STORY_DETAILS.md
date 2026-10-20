# Mobile Task 3C — Story Details and editing

Branch: feat/mobile-story-details. Base: eb95476a9e735358964595b75f761dec7de21fc5.

## Title-feedback correction

The old Create My Story source placed the error above the field, refocused the
input after failure, and had no error-scroll mechanism or explicit iOS announcement.
These are source-confirmed gaps consistent with the USER-REPORTED hidden-feedback
problem, not a physically reproduced iPhone root cause.

The exact requested EN/SV errors are now beside Story Name. Invalid submission
dismisses the keyboard without reopening it. Layout and keyboard hide/show events
scroll to the field. Errors stay until corrected; iOS receives an explicit
announcement and Android uses a live region. Done preserves text and never submits.
The reviewed Unicode validator is preserved: boundary whitespace is trimmed,
invisible-only input rejected, meaningful internal text unchanged, and all trimmed
code points count toward 120. iPhone visibility and VoiceOver still need retesting.

## Details, editing and API contract

Normal authenticated flow: My Stories → Open story → Story Details → Edit Story.
Details contain title, read-only language, description and safe status information.
Unknown statuses receive a neutral translated label. Editing permits only title
and description. Language cannot change. Fields use large/scalable text, safe-area
scrolling, generous spacing and keyboard-safe validation beside each field.

The shared authenticated transport supports:

- GET /api/v1/story-projects/{UUID}: HTTP 200, one seven-field project.
- PATCH on the same path: HTTP 200, backend-confirmed project. Input permits title
  and/or nullable description, with at least one supported field. The form sends
  title and description. No ownership ID, language, status or legacy fields.
- Title: existing Unicode-aware 1–120-code-point validation. Description: nullable
  or at most 4,000 code points. Empty UI description becomes null; nonempty spaces
  and multiline text remain unchanged. No Unicode normalization is performed.
- UUID and response ID checks, immutable response language and exact matching of
  supplied validated title/description. Current verified-account Bearer tokens
  come through the existing account-bound accessor. A UUID does not authorize access.

Available documentation was inspected in LOCAL cached commit
5b5bc88a2b11de72aad2fa0815a7ea050aea1304, backend 0.2.0. Its schema/handoff/resource
gateway agrees with the user's confirmed GET/PATCH contract. Cached origin/main
did not contain those backend paths. No fetch/merge, backend or database change
occurred. Actual deployed behavior and server ownership remain unverified.

Success is displayed only after validated PATCH confirmation. Recoverable failures
keep the draft. Ambiguous writes do not show success or automatically retry;
Cancel/reload reconciles with a fresh GET before editing again. Cancellation cannot
undo a server-accepted write. No version/ETag contract exists in the reference, so
concurrent edits may overwrite one another; the form sends both editable fields.

Owner/selection/revision/generation guards and abort signals discard stale work.
Sign-out clears private state before parent cleanup. Leaving/backgrounding the
protected route unmounts its private views. No project state is persisted and no
optimistic dashboard rows or fabricated saves are introduced.

## Configuration and safety

The approved iPhone-reachable backend address remains UNCONFIGURED. Real GET/PATCH
and saving are unavailable without valid approved settings. No real local auth/API
configuration was copied. Root environment loading, inherited public env injection
and live settings during checks remain disabled. Live registration, Guest, audio,
paid AI and unrelated backend/database functionality remain disabled/unchanged.

Private-LAN filtering does not authenticate a server. Plain HTTP does not encrypt
Bearer tokens. Later live testing needs an explicitly approved development endpoint
and appropriate trusted transport/network, preferably TLS. Do not invent an address,
change a firewall or create a tunnel to make this preview work.

## Safe iPhone sample preview

This explicit mode mounts no account or preference providers, uses no network or
persistent storage, and displays labelled invented samples. Valid Create/Save
attempts show saving unavailable; they never change the sample or show success.
There is no simulated successful-save mode and no actual account is involved.
It starts on an isolated Welcome screen. Select View sample stories to inspect
the fictional dashboard. Sign Out and Exit Preview / Return to Welcome lead back
to this same isolated Welcome, never to an actual signed-in account. Change
language and Replay Introduction are available on Welcome. Sample language is
in-memory only; the normal application's saved language is untouched.

For fictional sample testing, use normal Windows PowerShell:

```powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-story-details\apps\mobile'
npm run preview:stories
```

The terminal must print MEMY SAMPLE STORIES PREVIEW. The launcher now uses Expo's
supported --port 0 to select an unused port and clears only Metro's bundle cache.
It never kills another process or removes app preferences/authentication sessions.
The preview display name is Memy (Sample Stories); normal mode remains Memy.

Scan the NEW terminal QR code with iPhone Camera and open Expo Go. Both devices must use the
same trusted local network. No backend, tunnel or firewall change is needed. If
Windows requests a new firewall permission or the phone cannot connect, stop and
report it. Do not select an old Expo Go Recent project or scan an older QR code.
An explicit override is supported as --port 8083 or --port=8083 if needed. Duplicate,
invalid and short -p port forms are rejected. Default automatic selection is simpler.

The banner must say SAMPLE STORIES. Nothing is saved. (or the Swedish version).
If it does not, stop and verify the command/worktree. No login or real account data
should appear. Use invented text only. This mode cannot be enabled by URL parameters:
it requires native debug execution, the explicit launcher flag and exact disabled
auth/API settings. Other commands remove inherited flags case-insensitively.

### Manual checklist — pending, not executed by Codex

1. Welcome → View sample stories → Create My Story → leave Story Name empty → Create. Confirm the exact
   error is readable beside the field. Repeat with spaces, invisible-only text and
   121 characters. Reopen the keyboard: feedback must remain visible.
2. Correct to an English/Swedish title with meaningful spaces/accents. The error
   clears. Done must retain text without submitting. Valid Create shows unavailable,
   never success or a fabricated dashboard row.
3. Open either sample. Check title, description, language and status. The Swedish
   sample deliberately exercises an unfamiliar status.
4. Edit title and multiline description. Language remains read-only. Check empty/
   overlong title errors and description over 4,000 characters. Done typing dismisses
   without changing text; Return in description inserts a new line.
5. Valid Save shows unavailable, retains the draft and never shows success.
   Cancel returns to the original unchanged sample. Exit to Welcome → Change
   language → Svenska → Continue, then repeat the checks.
6. Test Larger Text, small layouts, scrolling and VoiceOver labels/announcements.
7. Sign Out returns to Welcome and drops drafts; no real account is signed out.
   View sample stories opens the unchanged examples again. Backgrounding also
   drops the draft and returns to Welcome. Test Replay and its Back/Skip/Enter
   actions. Stop Expo with Ctrl+C when done.

### Return to the NORMAL app without removing stored data

1. Press Ctrl+C in the terminal running this worktree's sample preview. Leave
   unrelated projects alone. If startup fails or produces no new QR, stop; do not
   reopen a previous preview as a substitute.
2. Fully close Expo Go on the iPhone (swipe away its app card). Do not uninstall it,
   delete project data, sign out an account or reset onboarding.
3. In the same apps/mobile directory, run:

```powershell
npm start
```

4. Confirm MEMY NORMAL APP in this terminal, wait for its NEW QR, and scan that QR
   with Camera. Do not use Expo Go Recents. Normal display name is Memy, with no
   Sample Stories suffix. A completed returning user reaches Welcome, or My Stories
   after verified session restoration. A genuine first use with no completed
   preference still follows Language/Introduction, without a sample banner.
5. Replay Introduction. No sample banner should appear on Welcome or any of the
   three scenes. Preferences and valid sessions must remain intact. If a banner
   still appears, stop and report only the startup mode and QR port, never credentials.

The old preview server/native experience can remain active independently of a new
terminal. A cache reset does not switch Expo Go's loaded manifest. The banner is
expected throughout Replay inside explicit sample mode, whose fictional context
must remain visible. Normal mode never falls back to samples on a configuration error.

Normal npm start retains the actual app flow and does not enable samples. This
worktree has no automatically copied authentication configuration;
actual login requires separately approved development settings. Real story operations
remain unavailable until the backend URL is explicitly approved/configured.

## Remaining verification

Automated services use mocks. JavaScript exports are not physical-device/native
networking verification. Live GET/PATCH, real two-account ownership, server RLS and
uncertain-write reconciliation are pending. Response-size checks occur after body
read, not as a streaming memory cap. Existing Expo Go/restored-route and gated-
registration activation limitations remain. Dashboard pagination still stops at 50.

No deletion, generated chapters, sessions, microphone, AI, Guest, migration or
production work is included. No stage, commit, push, merge or deploy occurred.
Independent review and manual iPhone approval remain pending.

The later navigation audit/corrections supersede the initial navigation findings
and test counts. See NAVIGATION_AUDIT.md for the current screen-by-screen audit,
new verification evidence and normal-versus-sample testing instructions.

Suggested commit message: feat: add accessible story details and editing

See STORY_DETAILS_VERIFICATION.md for actual test/check results, initial failures
and corrections, self-review and the exact changed-file inventory.
