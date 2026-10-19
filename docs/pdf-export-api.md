# Day 6 PDF export and story continuation

Backend 0.6.0 adds private PDF downloads and Continue My Story. Export always uses
a selected **saved** draft revision. Continuation never generates text or
overwrites earlier drafts. Conversation and story writing remain deterministic
mocks; no paid AI calls are enabled.

## Setup and endpoints

Install the updated backend dependencies, including pinned ReportLab and bundled
licensed Unicode fonts. No system fonts, external rendering service, storage
bucket, PDF credentials or new environment variables are required.

```sh
cd backend
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
CONVERSATION_MODE=mock STORY_GENERATION_MODE=mock python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For PowerShell use the [Day 5 environment setup](story-drafts-api.md). Both mock
flags stay disabled by default; saved-draft export and continuation do not call
either provider. Swagger: `http://127.0.0.1:8000/docs`. On a phone, use a reachable
developer-machine LAN address and bind Uvicorn to `0.0.0.0`; phone localhost is not
the developer computer. No shared hosted FastAPI server has been deployed.

Every route requires `Authorization: Bearer <Supabase user access token>`. Ownership
is checked against the parent project in FastAPI and the database. Never put a
token in a URL, send service-role credentials or navigate to a download URL without
an authenticated request.

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/v1/story-drafts/{draft_id}/export` | 201 PDF bytes, not JSON |
| GET | `/api/v1/story-projects/{project_id}/exports` | 200 metadata array |
| GET | `/api/v1/story-exports/{export_id}/download` | 200 PDF bytes |
| POST | `/api/v1/story-projects/{project_id}/continue` | 200 session/latest-draft JSON |

Export lists use `limit` (default 50, 1–100) and `offset` (default 0, 0–100000),
ordered by creation time descending and then export ID descending.

## Export the saved revision

Save any editor changes through the Day 5 PATCH API first, then explicitly request:

```json
{"format":"pdf","include_title_page":true,"include_page_numbers":true}
```

An omitted body or `{}` uses those defaults. Explicit `null`, nonboolean options,
unsupported formats and unknown fields are rejected. The caller cannot submit
replacement story content, a project title or another user's ID in the body.

Successful POST and download responses contain:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="memy-my-childhood-v1-r2.pdf"
Cache-Control: private, no-store
Pragma: no-cache
Expires: 0
X-Content-Type-Options: nosniff
X-Memy-Export-Id: EXPORT_UUID
X-Memy-Draft-Version: 1
X-Memy-Draft-Revision: 2
X-Memy-Page-Count: 3
```

`Content-Length` describes the returned bytes. CORS exposes the filename and
`X-Memy-*` headers to the configured frontend origins. The safe ASCII filename
includes generation/revision numbers; Swedish letters are transliterated only in
the filename, never in story text.

The export audit is saved only after successful rendering and before any PDF
bytes are returned. A concurrent draft edit or project-title change returns 409
instead of mislabelling the document. Repeating the same export for the same
revision/title/options/renderer reuses its audit row; no idempotency header is
required. Repeated downloads do not create drafts, edits, sessions or audit rows.

## Metadata and historical downloads

Illustrative metadata for a fictional story:

```json
{
  "export_id":"a6600000-0000-4000-8000-000000000001",
  "project_id":"a6200000-0000-4000-8000-000000000001",
  "draft_id":"a6500000-0000-4000-8000-000000000001",
  "draft_version":1,
  "draft_revision":2,
  "language":"sv",
  "title":"Minnen från Malmö",
  "format":"pdf",
  "include_title_page":true,
  "include_page_numbers":true,
  "renderer_version":"memy_pdf_v1",
  "filename":"memy-minnen-fran-malmo-v1-r2.pdf",
  "content_sha256":"<SHA-256 of the saved revision's UTF-8 text>",
  "byte_size":47000,
  "page_count":3,
  "created_at":"2026-10-19T12:00:00Z"
}
```

The hash is a 64-character lowercase hexadecimal string in real responses. The
sample sizes and IDs are illustrative, not a verified export response.

No PDF blob or duplicate story text is stored. Metadata references the immutable
generated original or a preserved manual edit, plus a snapshot of the title and
rendering options. Download reconstructs that selected historical revision and
checks its text hash. Editing the story or renaming the project later does not
change an older export's selected text/title.

`byte_size` and `page_count` are measurements of the first successful render.
They are not a signed PDF-byte checksum or a promise of byte-identical output
across future platforms/library versions. Download headers report actual bytes
and pages. Same-runtime renders are deterministic. Renderer changes require a
new renderer version and an explicit compatibility policy for old exports.
Use audit `created_at` for generation time; deterministic PDF metadata uses a fixed
creation timestamp rather than an audit timestamp.

The A5 layout uses warm cream/sage colours, embedded DejaVu Serif, large selectable
body text, wrapping, a chapter heading and optional cover/page numbering. Covers
are unnumbered; body numbering starts at 1. XML-like input is printed literally,
not interpreted as links, images or executable markup. Unsupported glyphs/control
characters are rejected rather than silently substituted. The limits are 20000
story characters, 100 pages and 2 MB per generated PDF; two render jobs may run at
once. A timed-out worker retains its capacity slot until it actually finishes.

Every PDF is labelled a development mock. Export is **not** a factuality check:
manual edits remain unverified, and exporting does not incorporate pending
memories or change a draft's verification status.

## Continue My Story

Send POST with no body or `{}`. No language, status, text or ownership fields are
accepted. The response contains:

```json
{
  "project_id":"PROJECT_UUID",
  "language":"sv",
  "session":{
    "id":"SESSION_UUID","project_id":"PROJECT_UUID","language":"sv",
    "status":"active","created_at":"2026-10-19T12:00:00Z",
    "updated_at":"2026-10-19T12:00:00Z","ended_at":null
  },
  "session_created":false,
  "latest_draft":"<full Day 5 draft object, or null if none>",
  "generation_triggered":false
}
```

The UUID labels and latest-draft string above describe the response shape; real
responses use UUIDs and an object, not that string. See the complete
[Day 5 draft schema](story-drafts-api.md).

The server resumes the newest active session. If none is active, it creates a
new session in the project's saved language; completed sessions are not reopened.
Repeated continuation reuses the active session. Existing legacy sessions may
include more than one active session, so the response identifies which to use.

Use that session with the [Day 4 message and memory-review APIs](conversation-api.md).
Confirm new evidence and resolve conflicts. Only a subsequent explicit Day 5
generation request may create a new draft version. Earlier manual text and
exports stay intact. Manual edits are not silently merged into regenerated
canonical prose: show the earlier edited version alongside the new reviewable
version so the user can reconcile them. Unresolved contradictory memories still
block generation. An unchanged context reuses the existing draft rather than
overwriting manual edits.

## Frontend download patterns

For the web preview, authenticated `fetch` the POST/GET, check `response.ok` and
`Content-Type` before using `response.blob()`, then offer a local Blob download.
Read `X-Memy-Export-Id` to link the export-history entry. Revoke the object URL
after the download; do not log the token or persist private document bytes in
localStorage or a service-worker cache.

For a compatible current Expo SDK, install `expo-file-system` and `expo-sharing`
with `npx expo install`. An authenticated GET can be saved in app cache and shared
only after the user requests it:

```ts
import { fetch } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const response = await fetch(`${API_BASE_URL}/api/v1/story-exports/${exportId}/download`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) {
  throw new Error("PDF download failed");
}
const file = new File(Paths.cache, `memy-export-${exportId}.pdf`);
await file.write(await response.bytes());
if (await Sharing.isAvailableAsync()) {
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf" });
}
```

Match these APIs to Tarun's installed SDK rather than upgrading the app implicitly.
The [official FileSystem examples](https://docs.expo.dev/versions/latest/sdk/filesystem/)
cover byte downloads and app-cache files. Native local-file sharing differs from
web support; check availability and use the browser Blob flow on web, not a public
upload of the autobiography. See [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/).
Clear private temporary files on sign-out according to the app's retention policy.

## Loading states and errors

Show Saving → Generating PDF → Download ready, and disable duplicate taps while
the request is in flight. For continuation show Resuming → Memory conversation;
do not call generation automatically. A successful continuation can have no draft.

Errors retain `{"error":{"code":"...","message":"..."}}`, never raw story text,
database details or credentials.

| HTTP | Code | Frontend handling |
| --- | --- | --- |
| 401 | `AUTHORIZATION_REQUIRED`, `INVALID_ACCESS_TOKEN` | Sign in / refresh the user session |
| 403 | `ACCESS_DENIED` | Stop the unauthorized operation |
| 404 | `PROJECT_NOT_FOUND`, `RESOURCE_NOT_FOUND` | Missing or not owned, without revealing foreign data |
| 409 | `EXPORT_SOURCE_CHANGED` | Reload the selected saved revision/title and retry |
| 422 | `VALIDATION_ERROR`, `PDF_INVALID_REQUEST`, `PDF_EMPTY_DRAFT` | Correct input or save a nonblank draft |
| 422 | `PDF_UNSUPPORTED_CHARACTER` | Ask the user to replace unsupported text characters |
| 503 | `PDF_BUSY`, `PDF_GENERATION_FAILED`, `SUPABASE_UNAVAILABLE` | Retry later; no partial PDF is returned |
| 504 | `PDF_GENERATION_TIMEOUT` | Retry after the previous worker has finished |

## Acceptance and examples

Test with fictional data: project → session → sourced memory → confirm → explicit
generation → edit/save → export → continue → new confirmed memory → explicit new
version. Read the older edited draft and download its older export afterward.
Repeat with a second account and verify foreign resources stay inaccessible.
Confirm a contradiction requires clarification and PDF failures do not create a
partial document/audit. Real mobile/browser acceptance remains Tarun's integration
step; automated mock checks are not live AI validation.

Two fictional, manually authored **typography fixtures**, not claims about real
users or actual mock-writer output, are checked in under `output/pdf/`:
[Swedish sample](../output/pdf/memy-sample-sv.pdf) and
[English sample](../output/pdf/memy-sample-en.pdf). Rebuild with
`backend/.venv/bin/python backend/scripts/build_pdf_samples.py`. All seven pages
were rendered and visually reviewed for glyphs, wrapping, margins and numbering.
