# Day 11: Create, edit, continue and export a story

23 October 2026 · backend **0.8.1** · `codex/day-7-mobile-integration`.

This reuses the deployed Day 5/6 foundations and Day 10 safety patch. No new
endpoint, response field, migration, paid provider or production change is
needed. See [verification and remaining acceptance](day-11-status.md).

## The four mobile actions

| Interaction | Existing API | Success / important rule |
| --- | --- | --- |
| Create My Story | `POST /api/v1/story-projects/{project_id}/generate` | 201 full draft; explicit confirmation + stable UUID `Idempotency-Key` |
| Story Preview | `GET /api/v1/story-drafts/{draft_id}` | 200 selected saved draft, sources and verification |
| Edit Story | `PATCH /api/v1/story-drafts/{draft_id}` | 200 saved draft; optimistic `expected_revision` |
| Download PDF | `POST /api/v1/story-drafts/{draft_id}/export` | 201 **PDF bytes**, not JSON |

Also reuse:

- `GET /api/v1/story-projects/{project_id}/drafts`: saved generation list,
  newest version first; `limit=1&offset=0` for the newest.
- `GET /api/v1/story-projects/{project_id}/verification`: latest generation's
  verification. Do not replace an older selected draft's report with this one.
- `GET /api/v1/story-drafts/{draft_id}/history`: manual edits, newest revision
  first; original revision 1 is separately in `original_content`.
- `GET /api/v1/story-projects/{project_id}/exports`: export metadata history.
- `GET /api/v1/story-exports/{export_id}/download`: 200 historical PDF bytes.
- `POST /api/v1/story-projects/{project_id}/continue` with `{}`: reused/created active
  session plus latest saved draft; `generation_triggered:false`.

Lists use `limit=1..100` and `offset=0..100000`. All need the **current user's**
`Authorization: Bearer <access token>`. No service-role key, token-in-URL,
anonymous fallback, public document bucket or shared Wi-Fi HTTP is acceptable.
Use the already approved trusted personal network; no new hosting is implied.
The [complete API contract](mobile-api-contract.md) defines all 25 operations.

## 1. Explicit generation and factuality

On the explicit confirmation button, freeze a new UUID for this one logical
action and send the saved project language:

```json
{"language":"sv","style":"warm","confirm_generation":true}
```

Opening, Refresh, Continue, preview, navigation and cancelling the confirmation
must not send this request. On a lost response, reconcile saved drafts first;
only an explicit retry uses the **same key and same payload**. Do not create a
new key to hide an unknown outcome. A different explicit future generation gets
a new key. Equal source context may reuse an existing draft/version even with a
new key; no-op generation must not overwrite human edits.

The writer uses only supported, confirmed, source-linked canonical sentences.
Pending/rejected/unresolved/unsupported facts are not asserted as autobiography.
An important unresolved contradiction blocks generation, rather than silently
choosing a year. The deterministic verifier rejects added wording before save.
This is a narrow mock consistency check, not independent historical truth or
real AI paraphrasing. Occupation and arbitrary free-text corrections can be
unsupported, even when confirmed; do not invent a client-side replacement.

Illustrative **complete** fictional response, using actual schema fields:

```json
{
  "draft_id":"11000000-0000-4000-8000-000000000001",
  "project_id":"12000000-0000-4000-8000-000000000001",
  "status":"ready_for_review",
  "language":"sv",
  "style":"warm",
  "version":1,
  "revision":1,
  "content":"Jag växte upp i Malmö.",
  "original_content":"Jag växte upp i Malmö.",
  "mode":"mock",
  "source_memories":[{
    "memory_id":"13000000-0000-4000-8000-000000000001",
    "memory_version":2,
    "source_message_id":"14000000-0000-4000-8000-000000000001",
    "fact_type":"location",
    "value":"Malmö",
    "evidence":"Jag växte upp i Malmö",
    "corrected_value":null,
    "year":null,
    "slot":"grew_up_location",
    "sentence":"Jag växte upp i Malmö."
  }],
  "verification":{
    "status":"passed",
    "unsupported_claims":[],
    "method":"deterministic_mock_v1",
    "checked_revision":1,
    "checked_at":"2026-10-23T10:00:00Z",
    "sources_current":true,
    "reason":null
  },
  "created_at":"2026-10-23T10:00:00Z",
  "updated_at":"2026-10-23T10:00:00Z"
}
```

These UUIDs are examples, not retained cloud records. Read the returned full
draft, not the planning brief's abbreviated illustrative shape. Display mock
labelling, story language, `version`, `revision`, and the selected verification.
`stale_sources` means its source context changed, not that an old draft vanished.

## 2. Manual editing without lost revisions

Save deliberately, using the revision the user actually edited:

```json
{"content":"Jag växte upp i Malmö.\n\nJag minns sjön.","expected_revision":1}
```

There is no generation idempotency header on PATCH. A changed save increments
`revision`, keeps the generation `version`, immutable `original_content` and
source snapshots, and returns `status:edited` plus
`verification.status:needs_review` / `method:manual_unverified`. Exporting does
not upgrade that report to passed. A normalized unchanged save is a no-op.

For 409 `STORY_CONTEXT_CHANGED`, show saved/local wording for reconciliation;
do not overwrite automatically. If the response was lost, GET the draft/history
before an explicit exact retry. An exact immediate replay at the single next
revision returns the saved result without another audit. This is **not** a
general stale-content replay promise: further revisions or a different stale
wording return 409. Confirm observed revision and wording instead.
Read full history with pagination; use small pages for potentially long prose.
No public Restore endpoint exists. Editing the draft never rewrites transcripts,
memory corrections or previous audit rows.

## 3. Private PDF bytes and historical exports

Save editor changes first; export cannot submit replacement text/title/revision.

```json
{"format":"pdf","include_title_page":true,"include_page_numbers":true}
```

An omitted body or `{}` also uses these defaults; explicit `null` is invalid.
No `Idempotency-Key` is required. Check status and `Content-Type` **before**
decoding. Success is a bounded binary `application/pdf`, at most 2 MB/100 pages:

```http
Content-Disposition: attachment; filename="memy-minnen-v1-r2.pdf"
Cache-Control: private, no-store
X-Memy-Export-Id: <returned export UUID>
X-Memy-Draft-Version: 1
X-Memy-Draft-Revision: 2
X-Memy-Page-Count: <actual page count>
```

Persist only the appropriate account-scoped export identity as needed by the
reviewed client design. Re-download using its authenticated GET, not the newest
draft's export POST. The backend binds immutable revision text/hash, title,
options and renderer. Later edits, a new generated version or project rename do
not replace an older export's selected text/title. Downloads are read-only.
No PDF blob is permanently stored by the backend. Initial audit size/page count
are not a PDF-byte checksum across future library/platform versions; same-runtime
rendering is deterministic. UTF-8 `content_sha256` identifies story text, not
the PDF file. The [PDF API guide](pdf-export-api.md) defines these distinctions.

For native implementation, Tarun's inspected `feat/mobile-draft-editor` commit
`eb4eaa8` uses Expo `~57.0.30` and already has `expo-file-system`; its package and
tree do not yet contain `expo-sharing` or a PDF export/download client. This
backend task does not modify his mobile branch or install dependencies for him.

Implement the download transport alongside the existing account-scoped API
client. Freeze account/project/draft/export selection, get a current token,
fetch authenticated bytes, validate the bounded PDF response, and fence results
after backgrounding, navigation, sign-out or account change. Use an app-generated
unique private-cache filename rather than trusting an unchecked header path.
Do not call `response.json()` for a successful PDF, or save a JSON/HTML error as
`.pdf`. Native disk-full/write/share failures are client failures, not evidence
the server export failed. If POST committed before a lost response, reconcile
the export list before explicitly retrying; identical export selection is
deduplicated by the database.

The official [FileSystem byte-download pattern](https://docs.expo.dev/versions/latest/sdk/filesystem/)
uses `expo/fetch`, `response.bytes()` and a `File` in `Paths.cache`; match it to
the installed SDK rather than importing APIs added only in a newer release.
If sharing is chosen, deliberately add the SDK-compatible package using the
[SDK 57 Sharing guide](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/), check
availability, and share a local file only after explicit user action. No public
upload or incoming-share extension is required. Keep the file available while
the OS viewer/share flow needs it; apply reviewed retention/sign-out cleanup.
Web Blob downloading is a separate fallback, not native local-file sharing.

The PDF skill's render-and-inspect workflow checked all seven pages of the
unchanged English/Swedish typography fixtures with the current renderer. Swedish
å/ä/ö, paragraphs, covers and page numbers render correctly. These manually
authored fictional typography samples are not real user stories or mock-writer
output. Native Files/Quick Look/share-sheet behavior remains a device gate.

## 4. Continue, then explicitly generate a new version

Continue must use the returned active `session.id` and keep the saved latest
draft. It does not generate, overwrite manual wording, reopen completed sessions
or delete exports. Repeating Continue reuses the active session. A new session
receives project-scoped structured-memory context, not arbitrary raw narrative
from every earlier session; see [Day 10](day-10-memory-integration.md).

Add and review new source-linked facts normally. Only an explicitly confirmed
generation may create version 2. Version 1's edited text/history/exports remain
readable. Regeneration does not silently merge manual prose into the new
canonical draft: show both versions and let the user reconcile deliberately.

## Errors and the remaining phone acceptance

| HTTP / code | UI action |
| --- | --- |
| 401 | Revalidate the account; never retry with a publishable key as Bearer |
| 404 | Missing/not owned; reveal no foreign story details |
| 409 `NO_CONFIRMED_MEMORIES`, `NO_SUPPORTED_MEMORIES` | Return to memory review; do not invent prose |
| 409 `CLARIFICATION_REQUIRED` | Resolve important conflicts first |
| 409 `STORY_CONTEXT_CHANGED`, `EXPORT_SOURCE_CHANGED` | Reload and reconcile the selected saved revision/source |
| 409 `IDEMPOTENCY_CONFLICT` | Stop; do not hide it with a replacement key |
| 422 `DRAFT_VERIFICATION_FAILED` | Unsupported generated wording was not saved |
| 422 `PDF_UNSUPPORTED_CHARACTER` | Ask for supported text; do not silently replace characters |
| 503 `PDF_BUSY`, `PDF_GENERATION_FAILED`, `SUPABASE_UNAVAILABLE` | Controlled retry after recovery; retain safe UI selection |
| 504 `PDF_GENERATION_TIMEOUT` | Back off; the old worker can still hold its capacity slot |

Use a NEW fictional project in each language and two existing authorised accounts.
Confirm → explicit Generate → Preview → Edit/Save → history → PDF → Continue →
new confirmed fact → explicit new version → download the old export again.
Test stale simultaneous editors, failed download/cache write, cancelled sharing,
background/sign-out, account switching, large text and VoiceOver. Refresh or
navigation must not generate. Report sanitized statuses/versions only.
Fresh real-token API execution and iPhone acceptance remain pending; Python,
embedded PostgreSQL, rendered sample inspection and hosted SQL role checks do
not establish those results.
