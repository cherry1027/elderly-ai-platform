# Day 6 backend status

Completed 19 October 2026. Backend **0.6.0** adds privately downloaded PDF
autobiographies and non-destructive story continuation. AI remains mock-only;
no paid API call, OpenAI key, public hosting or PDF storage service was added.

## Delivered

- [x] Reviewed the clean Day 5 branch, verified GitHub at `7fab579` and reran the
  440-test baseline. Day 5 was already pushed; main remains unchanged.
- [x] Built a deterministic in-memory ReportLab PDF renderer with bundled,
  redistributable DejaVu fonts and a retained license.
- [x] Added English/Swedish headings, selectable å/ä/ö, warm cream/sage A5 styling,
  readable 14.5-point body text, wrapping, sensible page breaks and optional cover
  and body page numbers. All seven example pages were visually inspected.
- [x] Added authenticated export/download routes with user-JWT ownership checks,
  safe filenames, private/no-store headers, bounded worker capacity and controlled
  failures. Rendering finishes before recording the audit or returning bytes.
- [x] Added Continue My Story: resume the latest active session or create a new
  one without reopening a completed session or regenerating a draft. New confirmed
  memories produce another reviewable version only after explicit generation.
- [x] Added immutable export metadata and historical saved-revision retrieval.
  No permanent PDF bytes or duplicate story text are stored.
- [x] Added the complete mock HTTP journey and PostgreSQL workflow/security tests,
  retaining all existing regressions and the four opt-in live skips.
- [x] Prepared [Tarun's API handoff](pdf-export-api.md), fictional PDF examples and
  incremental local commits on `backend/day-6-pdf-continuation`.

## Verified

- **519 backend tests passed, 4 skipped**. This includes 32 PDF renderer tests,
  46 export/continuation API tests and one full stateful mock journey. The existing
  Starlette/httpx deprecation warning remains. `pip check` reports no broken
  requirements; ReportLab 5.0.1 and development-only pypdf 6.21.1 are pinned.
- **54 embedded PostgreSQL checks passed**, replaying the full migration chain.
  Day 6 covers ownership and anonymous denial, immutable audits, private helpers,
  deduplication, title/revision race checks, historical edits, session continuation,
  new version generation, contradictory memories and parent deletion cascades.
- Migration `20261019030000_day6_exports_continuation` was applied transactionally
  to dedicated development project `edbkuunyeyxnyenmmqud` after explicit approval.
  Migration history now has **25** entries. The legacy project was not touched.
- [Hosted rollback-only SQL](../supabase/tests/cloud-exports-continuation.sql)
  passed for fictional English/Swedish workflows, session resume/create, preserved
  original/manual/historical versions, new confirmed-memory generation, conflict
  refusal, export metadata/hash/deduplication and cross-user/anonymous denial.
- Hosted synthetic data was rolled back. Postflight retains one Auth user, two
  projects, no sessions/messages/drafts/exports and three settings rows, including
  the two untouched historical orphan settings rows. Anonymous export execution
  and authenticated direct audit INSERT are denied; owned authenticated RPC
  execution is granted.
- Local `/health` and `/ready` return 200. OpenAPI reports **0.6.0** with Bearer
  security on all four new operations; unauthenticated PDF export returns 401 and
  no-store. Swagger is `http://127.0.0.1:8000/docs`.

The HTTP journey uses isolated Auth/PostgREST state with the real mock conversation
provider, mock writer and PDF renderer. Hosted SQL uses transaction-local JWT
subjects/database roles and fictional render measurements, not issued login
tokens or actual PDF rendering. Together they test backend composition and
database enforcement, not a live AI model or Tarun's real frontend/device flow.
The four opt-in live tests remain pending, as on Day 5.

## Preservation and operating boundaries

An export binds the chosen saved revision, project title and rendering options.
Later edits/title changes do not change that historical content. Manual edits
remain unverified and are visibly labelled in exported PDFs. Continued generation
preserves earlier edited versions; it does not silently merge their prose into
the new canonical draft. The frontend should offer comparison/reconciliation.

Audit `byte_size` and `page_count` describe the first render, not a permanent PDF
blob. Repeated downloads verify the saved text hash and render on demand. They do
not create new versions or audit records. Byte-for-byte reproducibility across
future platforms/renderers is not a retention guarantee. Direct legacy session
creation can still leave multiple active sessions; continuation deterministically
selects the newest rather than changing unrelated sessions.

Both AI flags still default to disabled. The current local process explicitly
enables conversation/story **mock** modes; PDF export and continuation themselves
need no AI provider. Auth/email configuration, existing user data, orphan settings,
raw-audio retention, payments and subscriptions were not changed.

Day 6 was subsequently pushed to `backend/day-6-pdf-continuation` at
`dabe71fe706ecd74777f16705acb467719898d5f`; it was not merged into main.
Day 7 builds cumulatively on that commit. Development database deployment is
separate from GitHub publication and public application hosting.

## Handoff and remaining acceptance

Tarun should test his real authorized development account through create →
confirm fictional memory → generate → edit → export → continue → confirm new
memory → explicitly generate version two → download the older export. Repeat
ownership checks with a second account and verify mobile/web download UX.

Two explicitly fictional typography fixtures are included in `output/pdf/`: a
three-page Swedish example and a four-page English example. They are manually
authored layout fixtures, not real-user data or evidence of live AI quality.
All pages passed rendered visual inspection for glyphs, margins, wrapping,
continuation and page numbering. See [the handoff](pdf-export-api.md) for samples,
request/response contracts, errors, browser downloads and current Expo guidance.
