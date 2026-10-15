# Memy AI backend

Python 3.13 is the verified development runtime. From the repository root:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for Swagger UI. Run
`curl -i http://127.0.0.1:8000/health` in another terminal. Expected: HTTP 200 and
`{"status":"ok","service":"memy-ai-backend"}`.

`GET /health` is public liveness and does not depend on Supabase. It does not
prove database connectivity. No AI, transcription, payments, or storage features
are implemented in this backend at Day 1.

## Supabase configuration and readiness

The existing root `.env` supplies the development project's
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The backend accepts those
names to reuse this project's configuration. To choose a different development
project, copy `.env.example` to `backend/.env` and set `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. Explicit backend file values take precedence over the
frontend file aliases; process environment variables take precedence over files.
Paths are resolved from the code location, independent of the working directory.
Do not add service-role keys, database passwords or OpenAI keys to any `VITE_*`
variable. A service-role key is not needed for this foundation.

`GET /ready` makes a bounded-time HEAD request to the Supabase `profiles` relation
using the publishable key and no user session. It fetches no rows. HTTP 200 means
the key, data API and relation are reachable; it does **not** validate authenticated
RLS or prove new migrations have been applied. Missing configuration, invalid
credentials, timeouts and upstream errors return sanitized HTTP 503 responses.

```sh
# From backend/: offline tests, then the explicit live data API probe
python -m pytest -q -m 'not integration'
RUN_SUPABASE_INTEGRATION=1 python -m pytest -q -m integration
curl -i http://127.0.0.1:8000/ready
```

`CORS_ORIGINS` is a JSON array of exact web origins, without a trailing slash.
Defaults cover the existing Vite app on port 8080 and port 5173. Add a frontend
deployment's origin explicitly. Native Expo requests do not require browser CORS.
`REQUEST_TIMEOUT_SECONDS` defaults to 5 and accepts values greater than 0 up to 30.
