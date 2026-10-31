# Memy local browser client

This browser client uses the existing development Supabase account and the real
FastAPI `real-v2` contracts. It is a local browser adaptation, separate from the
Expo native application. It does not use seeded stories or simulated AI.

Run from this directory with Python 3 and the backend's installed `httpx`:

```sh
python3 server.py --port 8767 --client-config /absolute/path/to/mobile/apps/mobile/development.auth.local.json
```

Open <http://127.0.0.1:8767/>. The existing real backend must already be running
at `http://127.0.0.1:8001`. The server binds only to loopback, reads only the
mobile client's public Supabase configuration, and proxies fixed API paths to
that backend. It does not read provider or Supabase server credentials. The
`--client-config` argument supports a separate mobile checkout; its default is
`apps/mobile/development.auth.local.json` relative to this repository. The JSON
must contain only `supabaseUrl` and `publishableKey`. Never pass a backend env
file, server key or provider key here.

Sign in using an existing confirmed development account. Credentials and the
session stay in browser memory; reloading closes the session. Create or open a
story, record up to 60 seconds or select a supported audio file, and explicitly
save its transcript. Send a transcript to the interviewer, review memories,
generate/edit a draft, and download its PDF. Preparing spoken replies is a
separate explicit AI action. Browser microphone availability depends on the
browser and OS permissions; file upload is the supported fallback.

Each provider action shares the existing backend budget governor and ledger.
Opening, signing in, fetching saved content, reviewing memories, editing, and
PDF generation do not call an AI provider. There are no automatic paid retries.
An uncertain paid result must be reconciled through the owned operation lookup.
Do not reset the backend ledger or treat the testing ceiling as a new budget.

Checks (no network or provider calls):

```sh
node --test api.test.mjs
MEMY_JSDOM_PATH=/absolute/path/to/node_modules/jsdom/lib/api.js node --test workspace.test.mjs
python3 -m unittest -q test_server.py
node --check app.js
node --check workspace.js
```

All 27 offline API, workspace, and proxy checks passed. Browser startup showed
the sign-in interface without console warnings or errors, and the local proxy
reported the real-v2 backend ready. Mocked UI checks are
separate from actual signed-in browser acceptance and actual iPhone acceptance.
No hosted configuration changes or Git commits/pushes are required to run this
client. The earlier Milestone 1 review ZIP predates this browser adaptation.
