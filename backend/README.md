# Memy AI FastAPI backend

Python 3.13 is the verified runtime. From the repository root:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
# New checkout only: copy .env.example to .env and fill its project URL/key.
python -m pytest -q -m 'not integration'
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger: http://127.0.0.1:8000/docs

```sh
curl -i http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8000/ready
```

## Supabase configuration

The local ignored `backend/.env` is configured for the dedicated development
project `edbkuunyeyxnyenmmqud`, Ireland, Free:

```dotenv
SUPABASE_URL=https://edbkuunyeyxnyenmmqud.supabase.co
SUPABASE_PUBLISHABLE_KEY=<development-project-publishable-key>
```

No database password or service-role key is required for this foundation.
For a new checkout, create `backend/.env` from `backend/.env.example` and obtain
the publishable key from this project's dashboard. Never commit local env files.

Settings accept the legacy root `VITE_SUPABASE_*` aliases as a fallback. The root
web client still uses the older project; explicit `SUPABASE_*` values in
`backend/.env` select the new project. Process environment variables override
dotenv files. Paths are resolved from the code location, independently of cwd.

`CORS_ORIGINS` is a JSON array of exact HTTP(S) origins without trailing slashes.
Defaults cover localhost/127.0.0.1 ports 8080 and 5173. Add deployment origins
explicitly. `REQUEST_TIMEOUT_SECONDS` defaults to 5 and accepts values >0 to 30.

## Current HTTP contract

Only two routes are implemented; both are public.

`GET /health` checks process liveness without contacting Supabase:

```json
{"status":"ok","service":"memy-ai-backend"}
```

`GET /ready` makes a bounded HEAD request to `profiles?select=id&limit=0`
using the publishable key, with redirects disabled. It fetches no records:

```json
{"status":"ok","service":"memy-ai-backend","database":"ok"}
```

Missing configuration returns HTTP 503 with code `SUPABASE_NOT_CONFIGURED`.
Invalid credentials, timeouts, redirects and upstream failures return HTTP 503:

```json
{"status":"unavailable","service":"memy-ai-backend","error":{"code":"SUPABASE_UNAVAILABLE","message":"Database is not ready."}}
```

Upstream bodies and credentials are not exposed. Readiness alone does not prove
RLS or schema deployment; these were checked separately in the new development
project. Framework 404/405 responses use `{"detail":"Not Found"}` and
`{"detail":"Method Not Allowed"}`.

## Verification

```sh
# From backend/
python -m pytest -q -m 'not integration'
RUN_SUPABASE_INTEGRATION=1 python -m pytest -q -m integration
python -m pip check
```

Verified on 16 October 2026: 29 offline checks, one live readiness integration
check against the new project, and HTTP 200 for /health, /ready, /docs and the
allowed-origin CORS preflight. The schema suite has 11 passing PostgreSQL checks.
`supabase/tests/cloud-ownership.sql` also passed against hosted PostgreSQL roles;
its synthetic users and rows were rolled back. Email login/token issuance is
not exercised by that SQL test. Starlette currently emits a non-failing
httpx TestClient deprecation warning.

## Expo and future authentication

For a physical phone on the same reachable LAN:

```sh
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Use `http://<developer-machine-LAN-IP>:8000`; phone loopback points to the phone.
A shared remotely accessible API URL has not been deployed.

Future protected routes will accept a Supabase user Bearer token, verify it
using Auth getUser or project JWKS, and forward the user token with the
publishable key for RLS. Decoding an unverified JWT is insufficient. This is the
documented approach, not a claim that protected routes are implemented.

See [the frontend handoff](../docs/frontend-integration.md).
