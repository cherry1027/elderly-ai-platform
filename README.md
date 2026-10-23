# Memy AI

Mobile integration: start with the [consolidated backend handoff](docs/mobile-backend-handoff.md),
[API contract](docs/mobile-api-contract.md), [verification report](docs/mobile-integration-tests.md)
and [real-voice proposal](docs/mobile-voice-contract.md). The [OpenAPI snapshot](docs/openapi.json)
is generated from backend 0.8.1; the proposal does not enable paid services.
Current memory-review behavior and acceptance are in the [Day 10 guide](docs/day-10-memory-integration.md)
and [status report](docs/day-10-status.md).

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

API: http://127.0.0.1:8000 · Swagger: http://127.0.0.1:8000/docs · Version: 0.8.1

- GET /health: public process liveness.
- GET /ready: public Supabase Data API connectivity, without fetching records.
- /api/v1/story-projects: authenticated create, list, read and metadata update.
- /api/v1/story-projects/{project_id}/sessions: authenticated create and list.
- /api/v1/story-sessions/{session_id}/transcribe: authenticated bounded upload;
  defaults to `503 TRANSCRIPTION_DISABLED`; explicit development simulation is available.
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
called. Day 9 adds `--simulate-transcription` to the dedicated development
launcher: valid audio returns a fixed fictional transcript with a permanent
simulation notice, not recognized speech. Ordinary startup remains disabled.
See [the audio API](docs/audio-api.md) and [native audio handoff](docs/day-9-mobile-audio.md).
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

Day 7 consolidates the mobile handoff, adds safe request-body bounds and JSON
failure responses, hardens cancelled decoder cleanup and verifies the complete
Swedish/English mock journey against development Supabase with two issued user
tokens. For a trusted same-network phone test, run from `backend/`:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan
```

The launcher pins the development project and enables only mock conversation and
story generation. Normal audio transcription stays disabled. It does not create
a public URL or establish real iPhone acceptance. See [Day 7 verification and
remaining device checks](docs/day-7-status.md).

For Day 9's explicitly labelled audio simulation, add `--simulate-transcription`
to that launcher command. The same upload and source-message APIs preserve one
immutable original, separate assistant/memory records and versioned review.
No new migration or model key is needed. Native recording/upload screens and
physical-iPhone audio acceptance remain Tarun's work; see [Day 9 status](docs/day-9-status.md).

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
- [Windows and iPhone backend quickstart](docs/backend-mobile-quickstart.md)
- [Day 2 status](docs/day-2-status.md)
- [Day 3 status and remaining acceptance](docs/day-3-status.md)
- [Audio upload and transcript contract](docs/audio-api.md)
- [Day 4 mock conversation and memory contract](docs/conversation-api.md)
- [Day 4 status and verification](docs/day-4-status.md)
- [Day 5 story generation, read/edit and verification contract](docs/story-drafts-api.md)
- [Day 5 status](docs/day-5-status.md)
- [Day 6 PDF export and story continuation](docs/pdf-export-api.md)
- [Day 6 status and verification](docs/day-6-status.md)
- [Day 7 mobile integration and reliability verification](docs/day-7-status.md)
- [Day 1 status](docs/day-1-status.md)
- [Database design](docs/database-foundation.md)
- [Initial audit](docs/day-1-audit.md)

Tarun's review and a shared hosted backend URL remain team follow-ups. The legacy
web UI's single-draft assumptions have not yet been adapted to the new multi-project
API. No public FastAPI hosting, paid speech recognition, live AI conversation,
payment or subscription features are enabled. Mock text conversation and memory
review are available only through the explicit development feature flag. Database migration
deployment is separate from publishing or hosting the FastAPI application.
