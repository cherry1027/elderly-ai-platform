# Day 11 backend status

23 October 2026 · backend **0.8.1** · `codex/day-7-mobile-integration`.

The backend story-generation/edit/export/Continue contract is verified and the
updated Expo handoff is ready. **Actual iPhone PDF download/share and a fresh
real-issued-user-token journey remain pending with Tarun.** No test is labelled
as a device pass. AI/transcription remain mock or disabled; no paid provider was
called. Existing APIs were reused, not replaced.

## Delivered

- Reproduced the clean `29ee850` Day 10 baseline: 767 Python / 60 SQL checks.
- Added a stateful route/provider journey: explicit generation, confirmed-only
  sources, same-key replay, same-context reuse preserving human edits, manual
  revisions/history, stale-edit 409, ownership and Continue/new generation.
- Added real PDF HTTP tests in both languages: valid selectable bytes, actual
  page/length headers, private no-store responses, historical selection after
  edit/rename/new export, safe failures/recovery and bounded worker capacity
  retained after timeout/cancellation.
- Added an exact rollback-only bilingual SQL journey: rejection/pending and
  unsupported-only blocks, unsupported additions/conflicts denied, r1/r2 exports
  preserved after r3/rename, new-session continuation, explicit v2, late v1 replay,
  two-way owner denial and immutable originals/history/export audits.
- Corrected the shared manual-edit example: `sources_current` describes source
  context freshness, not whether human prose was fact-verified. An ordinary edit
  can keep it true while remaining `needs_review/manual_unverified`; a later
  source change makes it false without changing that manual-review status.
- Added [Tarun's four-action integration guide](day-11-story-integration.md),
  sample actual-schema mock response, binary download/retry rules and device gates.

Runtime remains `a00df98eb97a3528cd83dff91c36bbda3a09323a` (0.8.1); Day 11 adds
tests/docs only. All 25 operations and schemas are unchanged. No migration,
provider key, new dependency, mobile-branch edit or main merge is needed. Record
the final review-branch HEAD for acceptance.

## Verification

| Check | Result and scope |
| --- | --- |
| Full Python regression | **776 passed, 4 skipped**, 42.41 s; one existing Starlette/httpx deprecation. Real FastAPI/providers/PDF with explicit offline Auth/PostgREST doubles. |
| Full isolated PostgreSQL | **65 passed**, zero failed/skipped, 10.67 s on final frozen SQL. Actual application migrations/RPC/RLS in PGlite; provisioning-only pg_cron/pg_net omitted there. |
| New Day 11 checks | 3 story-route + 6 PDF checks; 5 SQL checks (one parent and four subtests), including rollback emptiness across 16 relations and identity/project collision guards. |
| Dependency/API checks | `pip check`: no broken requirements. Existing offline OpenAPI tests passed; version, paths and schemas remain 0.8.1. No dependency upgrade. |
| PDF visual QA | Current renderer regenerated the existing fictional typography fixtures; all 3 Swedish / 4 English pages rendered through Poppler and visually inspected. Swedish glyphs, covers, paragraphs and numbering were readable without clipping/overlap. |
| Hosted development journey | **PASS**, exact tested SQL in `memy-ai-dev`, with transaction-local synthetic subjects/role claims and full rollback. Not actual Auth-issued JWTs or PDF rendering. |
| Hosted read-only postflight | **16 checked fixture categories, 0 remaining rows**, scoped only to the two fictional subjects/projects and their dependent records. No cleanup DELETE needed. |
| Native/fresh real-token acceptance | **Pending**, not converted into passes by backend tests or historical device reports. |

The four optional live pytest cases remain skipped. Typography fixtures are
manually authored fictional content, not actual deterministic writer output or
real user biographies. The PDF skill's render-and-inspect workflow informed the
Unicode/layout verification; no renderer changes were needed.

Hosted SQL hash:
`2c39f2bb778d1e586907bc9ab4ff0729213574e70ad0630c55594532cada2ab4`.
Results: `day11_bilingual_story_journey:PASS`, `unsafe_generation:BLOCKED`,
`retry_and_stale_revision:PASS`, `old_export_and_history:PRESERVED`,
`explicit_continue_generation:PASS`, `two_way_owner_isolation:PASS`,
`pdf_scope:METADATA ONLY`, `synthetic_data:ROLLED BACK`.
`BLOCKED` is expected unsafe-generation rejection, not a failure.

SQL PDF sizes/counts are deliberately fictional metadata, not rendered document
measurements. Real PDF bytes/counts are checked separately in Python. The
postflight counts only the exact fixtures, not unrelated concurrent developer
activity. No cloud PDF object or retained demo session was created.

## Mandatory scenarios covered

| Scenario | Evidence |
| --- | --- |
| Confirmed memories create draft | Route/provider and bilingual SQL, source-linked canonical prose |
| Rejected/unapproved/unsupported-only context | Blocked; no partial draft or invented biography |
| Unresolved important conflict | Generation denied; no v3 persisted |
| English/Swedish story and valid PDF | Both-language SQL and real HTTP/PdfReader tests; seven typography pages inspected |
| Human edits/history | Immutable generated original, r2/r3 audits, unverified manual status |
| Stale competing edit | Different same-version opponent rejected; exact immediate retry adds no audit |
| Foreign draft/export/Continue | API parent defense, two-way RLS/RPC isolation and anonymous denial |
| Old export after newer edits | Selected text/hash/title preserved after r3/rename/v2; same-runtime old PDF bytes preserved |
| Continue retains records | Same active then new session; previous sources/drafts/exports intact; no implicit generation |
| Duplicate generation | Bound replay and fresh-key/same-context reuse preserve edits; late v1 retry does not replace latest v2 |
| Download failure | Sanitized JSON 503, successful recovery, no failed-render export audit; GET retry creates no audit |

Stale updates are **sequential optimistic checks**, not a multi-connection
database contention/load benchmark. Worker-capacity tests do use real threads
and events. Native network/disk-full/cache/share-sheet/account-fencing and
accessibility behavior still require actual mobile acceptance.

## Handoff and remaining team gate

GitHub rechecked `feat/mobile-draft-editor` at
`eb4eaa8caa38e1cbf1e519831283d269eaeb9252`. Its native code has generation,
reading/editing/history transports, Expo ~57.0.30 and installed FileSystem.
This inspected tree has no PDF transport or sharing dependency. Backend
verification does not implement those native controls; the [guide](day-11-story-integration.md)
gives Tarun the binary/auth/retry contract without changing his UI or branch.

Remaining: two existing authorised development accounts, NEW fictional EN/SV
stories, confirm → explicitly generate → edit/save/history → download/preview/share
on iPhone → Continue/new fact → explicitly generate v2 → download old export.
Check account changes/sign-out, interrupted network, disk/share failures, large
text and VoiceOver. Use only the approved trusted private network and sanitize
reported statuses/versions; never send passwords/tokens in chat.

No production data, existing-user modifications/deletion, Auth/RLS setting,
anonymous sign-in, test email, paid service, public deployment, new mobile
dependency or main merge was part of Day 11. All hosted synthetic writes rolled
back; originals outside the fictional workflow were not queried or changed.
