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

API: http://127.0.0.1:8000 · Swagger: http://127.0.0.1:8000/docs

- GET /health: public process liveness.
- GET /ready: public Supabase Data API connectivity, without fetching records.
- Business endpoints and server-side user authentication are later features.

## Development environments

New backend/mobile development uses **memy-ai-dev**, project reference
`edbkuunyeyxnyenmmqud`, at https://edbkuunyeyxnyenmmqud.supabase.co (Ireland, Free).
Its 20 migration versions are deployed and its ownership rules have been tested.

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
(61 errors and 19 warnings) remain in legacy frontend/Edge Function code.
The schema suite has 11 passing checks; the backend has 29 offline checks and an
opt-in live integration check.

## Handoff

- [Backend setup and live verification](backend/README.md)
- [Tarun's frontend integration contract](docs/frontend-integration.md)
- [Day 1 status](docs/day-1-status.md)
- [Database design](docs/database-foundation.md)
- [Initial audit](docs/day-1-audit.md)

Tarun's review and a shared hosted backend URL remain team follow-ups. No public
FastAPI deployment, AI, transcription, payment or subscription work was added.
