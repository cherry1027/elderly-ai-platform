# Tarun — final backend integration handoff

24 October 2026 · fictional development demo, not a pilot launch approval.

## Reviewed pair and configuration

- Backend: `codex/day-7-mobile-integration`; application-code baseline
  `c67687ec4b392dbf0e4f73fc8451ac6f0da05560`, FastAPI 0.8.1, 25 operations/23
  private. Day 15 evidence/docs commits do not change application routes.
- Current reviewed Expo candidate: `feat/mobile-api-backoff`, exact commit
  `b787dcd70b54f6220bfa3d7c0899a2c1f677e080`. Includes the earlier PDF and
  autobiography-continuation work, plus the source-level retry fix.
- Record both actual checkout SHAs. Do not merge branches just to connect the
  clients, overwrite UI, or substitute the old web preview for `apps/mobile/`.
- Supabase: `https://edbkuunyeyxnyenmmqud.supabase.co`; current development
  publishable key through the agreed private configuration channel only.
  A publishable key is not the user's API Bearer token.
- API origin: `http://<YOUR_WINDOWS_PRIVATE_LAN_IP>:8000`, only on the agreed
  trusted private hotspot/LAN. There is no shared public HTTPS backend delivered
  here. Swagger is that origin plus `/docs`; API prefix is `/api/v1`.

Keep `development.auth.local.json` and `development.api.local.json` ignored,
using the actual supported fields in the [Windows/Expo quickstart](backend-mobile-quickstart.md).
Do not use generic Expo env suggestions instead of this branch's reviewed JSON
setup. No backend `.env`, service-role key, password or OpenAI key in the app.
The current client rejects loopback/public/DNS origins; a new HTTPS host needs
separate reviewed support. HTTP still sends tokens unencrypted even on a
private network; shared student-housing Wi-Fi is not approved.

From the configured backend checkout on Windows:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\diagnose_supabase.py
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
```

Test `/health` and `/ready` from Windows and iPhone Safari before signing in.
The launcher validates real audio bytes but returns fixed labelled fictional
transcripts; it is **not speech recognition**. Conversation/story modes are
mock-only. No paid calls, public tunnel, firewall disabling or production use.

## Stable APIs and retry behavior

Use the [complete API contract](mobile-api-contract.md),
[request/response examples](frontend-integration.md), [OpenAPI snapshot](openapi.json),
[audio guide](day-9-mobile-audio.md) and [story/PDF guide](day-11-story-integration.md).
Supabase signs in; the app passes the current user access token as
`Authorization: Bearer …` to FastAPI. Backend validates it online and forwards
that user's JWT to PostgREST under RLS. The frontend never supplies trusted owner
identity or interprets a local success as saved cloud data.

Your `b787dcd` change addresses the Day 14 source-level `RATE_LIMITED` / `API_BUSY`
gap. Bounded waiting, owner/origin scope, explicit retry controls and conservative
uncertain-write reconciliation are present. A limited offline exercise passed
40 pure parser/store cases; the full native suite/build was not rerun here.
See the [pinned mobile review](day-15-mobile-review.md).

Do not auto-retry writes at timer expiry. Preserve action UUID, exact payload and
captured revision/version, reread uncertain saves and require deliberate retry.
Unknown/plain-text outer 503 is not proof the mutation never started. Initial
project/session and export-audit creation do not have universal idempotency.
For native backoff acceptance use a separately reviewed approved local fixture,
not traffic flooding to force hosted 429/503.

## Actual-device verification still needed

The user confirmed the full current EN/SV iPhone checklist has not run yet.
Use the 12 scenarios in [the Day 14 rehearsal](day-14-tarun-rehearsal.md), but pin
this newer mobile revision. Keep that older evidence file historical; use the
new [Milestone evidence template](fixtures/milestone-1-evidence.example.json).

Observe actual login → dashboard/create → Start/Continue → real M4A upload →
permanent simulation notice → mock conversation → confirm/correct/reject →
explicit generation → edit/history → correct authorized PDF opening/share →
Continue with preserved versions. Repeat the content flow in English/Swedish.
Check account switch/expiry, microphone denial/cancel/background, interrupted
network/save, no duplicates, VoiceOver, large text and Swedish PDF glyphs.
Use only fictional memories and authorized test accounts. Android is separate.

After an actual run, copy the template locally and enter only fixed statuses and
the three truthful attestations; never include credentials, narrative, screenshots,
IPs or cache paths in its JSON. From backend on Windows:

```powershell
.\.venv\Scripts\python.exe scripts\validate_milestone_evidence.py '<LOCAL_REPORT_PATH>'
```

Expected default exit is **3** with `PENDING`, not a test failure or release pass.
Even all self-reported passes remain `SELF_REPORTED_COMPLETE_NOT_ACCEPTED`, with
all approval flags false. Independent review and founder decisions are still
required. The sample intentionally starts every gate pending; use
[the acceptance matrix](milestone-1-acceptance.md) for measured backend results.

Fresh two-issued-user hosted JWT testing is a separate pending secure-account
handoff, not established by today's read-only SQL or phone health probes.
Send only sanitized stage results and actual commit IDs. Do not publish tokens
or passwords. Stop the backend/Metro after testing; no hosted deletion is part
of this device checklist.
