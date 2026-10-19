# Memy AI

Autobiography application with an existing React/Vite web client, Supabase, and a Python/FastAPI backend.

## Start the backend

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
# On a new checkout, copy .env.example to .env and fill the development project values.
python -m pytest -q -m 'not integration'
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API: http://127.0.0.1:8000 · Swagger: http://127.0.0.1:8000/docs · Version: 0.6.0

- GET /health: public process liveness.
- GET /ready: public Supabase Data API connectivity, without fetching records.
- /api/v1/story-projects: authenticated create, list, read and metadata update.
- /api/v1/story-projects/{project_id}/sessions: authenticated create and list.
- /api/v1/story-sessions/{session_id}/transcribe: authenticated bounded upload;
  currently returns `503 TRANSCRIPTION_DISABLED` after validation.
- /api/v1/story-sessions/{session_id}/transcripts: immutable audio originals.
- /api/v1/story-sessions/{session_id}/messages: ordered history and opt-in mock turns.
- /api/v1/story-sessions/{session_id}/memories and /clarifications: owned memory review.
- /api/v1/memories/{fact_id}: confirm, reject or correct a sourced candidate.
- /api/v1/story-projects/{project_id}/generate: explicit opt-in mock story generation.
- /api/v1/story-projects/{project_id}/drafts and /verification: versioned drafts and reports.
- /api/v1/story-drafts/{draft_id} and /history: owned read/edit and preserved edits.
- /api/v1/story-drafts/{draft_id}/export: private on-demand PDF generation.
- /api/v1/story-projects/{project_id}/exports and /continue: export audit and safe resumption.
- /api/v1/story-exports/{export_id}/download: authenticated historical PDF retrieval.

Live speech recognition is deliberately disabled: no paid provider is wired or
called. Provider/persistence success paths are tested with explicit test doubles,
not fabricated results from the running application. See [the audio API](docs/audio-api.md).
Day 4's explicitly labelled text-conversation simulation is separately available
with `CONVERSATION_MODE=mock`; it does not enable speech recognition or a live AI
provider. See [the conversation API](docs/conversation-api.md).
Day 5 separately enables deterministic autobiography drafts with
`STORY_GENERATION_MODE=mock`; only supported, confirmed memories are included,
and manual edits never receive an automatic factual pass. See
[Create My Story](docs/story-drafts-api.md).
Day 6 adds readable English/Swedish PDFs, immutable export metadata and explicit
story continuation without overwriting earlier edits. PDF bytes are generated in
memory, never stored in a public bucket. See [the PDF and continuation contract](docs/pdf-export-api.md).

Protected routes validate the supplied Supabase user access token through Auth
`getUser`, then forward that exact user token plus the publishable key to the Data
API. PostgreSQL grants and Row Level Security remain the authorization boundary;
ordinary user requests never use a secret or service-role key.

## Development environments

New backend/mobile development uses **memy-ai-dev**, project reference
`edbkuunyeyxnyenmmqud`, at https://edbkuunyeyxnyenmmqud.supabase.co (Ireland, Free).
Hosted Day 3 SQL and two-user HTTP checks passed for ownership, immutability and
retries. Current Day 4 deployment is tracked in [Day 4 status](docs/day-4-status.md).
Day 3 HTTP acceptance used two disposable
anonymous Auth users and an explicit fictional transcription provider.

The existing web client's local root `VITE_SUPABASE_*` configuration still points
to the older project `pxejznayegywcctnssxb`. It was deliberately preserved. New
Expo/backend integration must use the new project consistently. The original
project's data was not copied or modified.

Environment files are local and ignored. Root `.env` was removed from Git tracking
while preserving the local file. Use the checked-in examples for new checkouts.
Never put database passwords, service-role keys or server API secrets in client
environment variables.

## Existing web client and schema tests

```sh
npm ci --ignore-scripts
npm run dev
npm test
npm run build
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json

npm --prefix supabase/tests ci --ignore-scripts
npm --prefix supabase/tests test
```

Frontend test, build and TypeScript checks pass. Existing `npm run lint` findings
remain in legacy frontend/Edge Function code. Backend and schema verification is
documented in [the Day 2 status](docs/day-2-status.md); live authenticated checks
are opt-in and require two real development-project user tokens.

## Handoff

- [Backend setup and live verification](backend/README.md)
- [Tarun's frontend integration contract](docs/frontend-integration.md)
- [Day 2 status](docs/day-2-status.md)
- [Day 3 status and remaining acceptance](docs/day-3-status.md)
- [Audio upload and transcript contract](docs/audio-api.md)
- [Day 4 mock conversation and memory contract](docs/conversation-api.md)
- [Day 4 status and verification](docs/day-4-status.md)
- [Day 5 story generation, read/edit and verification contract](docs/story-drafts-api.md)
- [Day 5 status](docs/day-5-status.md)
- [Day 6 PDF export and story continuation](docs/pdf-export-api.md)
- [Day 6 status and verification](docs/day-6-status.md)
- [Day 1 status](docs/day-1-status.md)
- [Database design](docs/database-foundation.md)
- [Initial audit](docs/day-1-audit.md)

Tarun's review and a shared hosted backend URL remain team follow-ups. The legacy
web UI's single-draft assumptions have not yet been adapted to the new multi-project
API. No public FastAPI hosting, paid speech recognition, live AI conversation,
payment or subscription features are enabled. Mock text conversation and memory
review are available only through the explicit development feature flag. Database migration
deployment is separate from publishing or hosting the FastAPI application.
