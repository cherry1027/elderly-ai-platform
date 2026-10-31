# B3 chat refinement and B4 autobiography experience

## Review identity and boundaries

This combined mobile follow-up starts at **de321bfb47ee5bb316431f62db9d9030fc79911f**
from `chore/mobile-sdk58-compat-b3`, on the separate local branch
`codex/mobile-chat-autobiography-polish`. HEAD remains the base: the changes are
uncommitted review material. The backend reference is read-only
`9acce16deeb31c80eb0d5c837dff6c4cce743d14` (API 0.8.1), not the source of this
mobile worktree. No source from the older mobile candidate is substituted.

Keep the cream/sage/forest theme, original artwork and B1/B2 entry/root navigation.
There is no B5, real AI, signup/recovery activation, Guest, playback, new book/PDF
renderer, photo, subscription or hosted-data change. Locked dependencies are
restored without upgrades. No private local configuration is copied or loaded by
verification, and no backend or Metro LAN service is started by this task.

## Implementation and safety map

- Chat presentation belongs around `SessionRecording`, `TranscriptConversation`
  and the saved conversation controller. Native recording and network ownership
  remain there. Stop is local; consented upload and explicit conversation
  processing remain separate operations with different action identities.
- The development transcript is fixed fictional material, not recognized speech.
  Saved assistant content is simulated too. Local introductory guidance must not
  be presented as a saved assistant question or as evidence of transcription.
- The reader/editor, saved-generation browser, edit history and PDF preparation
  reuse existing authenticated controllers. Opening those views does not
  generate, save, verify a memory or export automatically.
- A generation is a separately saved autobiography; a revision is a manual edit
  within that generation. Both are server identities, not cosmetic counters.
  Continuation returns to the exact selected generation after fresh owned reads.
- Editing preserves captured `expected_revision`, frozen retry input and
  conflict reconciliation. Done/blur do not save. Manual wording is unverified.
- Explicit generation may return any earlier matching saved generation. It does
  not promise version + 1, merge manual wording or replace the previous work.
- PDF preparation selects saved content. Historical downloads retain the audited
  title/generation/revision, not today's wording. Share/Save is explicit after
  validated bytes and the existing awaited private write. Closing the native
  sheet does not prove delivery. Existing revocation, cleanup and share leases
  remain authoritative.
- Reader callbacks are fenced to the exact current reader state and active child
  ownership. A callback captured before opening an editor, completing another saved
  read or background teardown cannot navigate, sign out or write over that view.
- Editor leave alerts use single-use non-content intents. A canceled or obsolete
  discard confirmation cannot clear later edits, a new warning or revalidated
  private content. This does not delay forced privacy teardown or change saves.
- PDF option callbacks are tied to the current rendered selection; an obsolete
  checkbox handler cannot replace a newer deliberate choice. Captured pending
  options remain immutable through existing reconciliation and explicit retries.
- No private prose, tokens, file paths or PDF handles are added to routes, logs
  or durable storage. Existing account/background privacy cleanup and the
  retained `1974 -> 1975` memory-correction recovery are preserved.
- Waiting expiry is not a request. Only exact supported admission errors carry
  their existing backoff meaning; unknown/plain-text 503 writes remain uncertain.

## Evidence categories

The untouched base was checked on this computer: **3,800 tests / 102 suites**,
TypeScript, ESLint, protected configuration/dependency checks, and both offline
JavaScript exports passed. The offline dependency command warns that its
compatibility validation has limited assurance. `npm ci --ignore-scripts
--no-audit --no-fund` restored the existing lockfile; npm emitted peer-resolution
and deprecation warnings. No vulnerability audit or dependency update was done.

The external independent-review archive contains the final structured Jest
results, command logs, exact source hashes, test-preservation inventory, critical
self-review and requirement coverage. Use its manifest/frozen-source identity,
not HEAD alone, to identify these uncommitted changes.

All automated tests use synthetic data and blocked real network/native boundaries.
JavaScript exports are not signed native builds. Physical iPhone/Android layout,
microphone, keyboard, VoiceOver, native share-sheet and live-backend acceptance of
this new source remain **PENDING**. No screenshots are claimed unless separately
listed as actual synthetic execution evidence. Prior phone reports do not accept
this package. See `b3-b4-device-checklist.md` for the manual acceptance procedure.

Independent review and separately authorized device setup precede any commit,
push, merge, release, live account use or service activation.
