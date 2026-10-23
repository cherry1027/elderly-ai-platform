# API waiting and explicit retries

Development-only mobile change based on mobile commit
`1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e` and the read-only backend handoff
`365b83bcc92ea01d87f86aa0d13bb8d25cedfb5a` (Day 14, public API 0.8.1).
No successful API schema, backend configuration or provider mode is changed.

## Contract and timing

Only these exact JSON status/code pairs identify admission rejection:

| Status/code | Missing or malformed Retry-After default |
| --- | --- |
| 429 RATE_LIMITED | 60 seconds |
| 503 API_BUSY | 1 second |

The backend rejects these before the business operation. AUDIO_BUSY, PDF_BUSY,
SUPABASE_UNAVAILABLE and unknown 503 responses are separate failures. A plain-text
outer-server 503 never proves a write was rejected before execution.

Retry-After supports unsigned decimal delta-seconds only. Missing, negative,
fractional, HTTP-date and otherwise unsupported values use the defaults above.
Zero waits at least one second. Values over 86,400 seconds are unsupported and
conservatively bounded to one day, rather than creating an unbounded timer.
Valid positive values within that bound are preserved. A new response may extend
but never shorten an active deadline.

Deadlines use wall-clock timestamps. A single expiry timer and a foreground check
update controls; there is no polling or request queue. Expiry only enables user
actions. It never issues a GET, POST, PATCH, download or share automatically.
Like other client waiting aids, wall-clock changes/app restart are not server
enforcement; the backend continues to enforce admission independently.

## Scope, privacy and operations

Cooldowns are RAM-only, scoped to the verified owner and normalized API origin.
They survive ordinary screen navigation and temporary foreground authentication
checking. Sign-out/account replacement revokes old leases and clears waits.
Cancelled or stale-owner responses cannot register a wait for a new account.
No tokens, prose, audio or action payloads are stored in the cooldown store.

All API paths share the transport gate before authentication and immediately
before dispatch. A wait therefore also blocks incidental mount/reconciliation
reads. Visible request actions are disabled; local editing/navigation and
sign-out remain usable. No automatic retry has been added.

Operation-specific state remains authoritative: audio/conversation/generation
keep their exact UUID and payload; draft editing retains the expected revision;
memory review retains version/conflict rules. Creation and PDF export retain
their existing read-before-repeat safeguards. A wait during generation/PDF
verification cannot be mistaken for an unsuccessful write or fake success.

Unknown/non-JSON 503 mutations remain uncertain. They still require the existing
authenticated reconciliation before an explicit retry. Only allowlisted codes
and bounded timing metadata survive error decoding; server bodies are never
displayed or logged. Source evidence, selected generations, edit history and
private PDF ownership/cache/share rules are unchanged.

## Windows and iPhone setup

Do not copy private configuration automatically from another worktree. Prepare
the existing ignored mobile-local configuration privately using the approved
development Supabase project and a currently approved personally controlled LAN
backend origin. Never include the `/api/v1` prefix twice. Never use production
credentials, a service-role key, an invented address or a public tunnel.

From Windows PowerShell:

```powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-api-backoff\apps\mobile'
npm start
```

Scan the new QR code with Expo Go. This worktree has no automatically copied
private configuration, and verification commands use the existing protected
offline/verification launcher. Backend startup/Windows verification is separate.
Do not run sample preview as proof of real authenticated integration.

## Physical iPhone acceptance (pending)

Use fictional EN/SV stories and an authorized development account. Check existing
login, listing, Continue, recording/upload simulation, memory review, explicit
generation, old generation selection, manual editing and private PDF return.

Deterministic waiting verification requires a separately reviewed development
fixture/mock server at an explicitly approved address. This task does not add a
live error-injection switch or weaken server limits. Do not hammer the hosted
service to provoke a 429 or saturate it to provoke a 503.

With that fixture separately available:

1. Return exact 429/RATE_LIMITED with Retry-After:60, then 503/API_BUSY with 1.
2. Confirm the translated wait message, disabled API controls and enabled Back,
   sign-out and local editing. Navigate to another screen; no request bypasses
   the deadline.
3. Background and return. Remaining wait follows the deadline. After expiry,
   the message enables explicit retry without sending anything automatically.
4. Verify generation/audio/message keys and draft versions remain unchanged
   across explicit retries; uncertain writes reconcile before repeating.
5. Return plain-text 503 after an uncertain save; no successful-save claim or
   automatic write is permitted. Reconcile through supported authenticated reads.
6. Sign out/change accounts during a delayed response. No previous-owner rows,
   waiting state, prose or PDF may appear in the replacement account.
7. Repeat EN/SV with large text, VoiceOver and reduced motion; announcements must
   be calm state changes, not a continuous countdown.

Automated tests use synthetic responses and deterministic clocks. They are not
physical iPhone, hosted persistence, two-user JWT or real-AI acceptance.

## Release limitations

### Memory-correction recovery

The independent review found that a rejected memory Save could discard the local
correction when the form unmounted on error/refresh. The memory controller now
keeps one selected memory UUID, review action, raw correction and immutable
validated payload/expected_version in owner/project/session-scoped RAM.

During waiting or read-only reconciliation the retained form stays visible and
locked. Expiry does nothing. Explicit Refresh reads the owned memories and source
history. Only a complete unchanged baseline permits explicit Save again; that
retry performs another read immediately before sending the original payload.
No action is automatically replayed and no version is silently rebased.

A successful PATCH acknowledgment is retained separately. If its reread receives
backoff, the operation remains unresolved: an older read cannot enable retry,
and only a matching acknowledged version can confirm success. Other changed
versions require conflict/re-review. A failed or incomplete reread cannot enable
Review latest memory. That explicit local action clears the old intent only
after current complete data is available; a fresh review choice is then required.

Account/access failure, leaving, unmount and background/inactive cleanup discard
the private correction/payload. Only the existing non-content uncertain-write
flag survives backgrounding. No durable private-text storage was added.

No Home/tab redesign, book design, guests, subscriptions, new Auth settings,
backend changes or paid/live AI was introduced. Windows backend verification and
fresh integration acceptance remain separate. The device fixture and device
waiting acceptance are pending; dependency validation in offline mode uses the
installed SDK's cached compatibility table, not a fresh online registry audit.
