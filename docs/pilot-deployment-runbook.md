# Pilot deployment and rollback runbook

24 October 2026 · prepared procedure, **not deployment authorization**.

No production deployment, migration, Auth change, paid-provider activation or
merge to `main` is performed by this document. Milestone acceptance and the
controller's privacy/retention approval are separate decisions. Until the
release gates are closed, use authorized accounts and fictional data only.
See [Day 14 evidence](day-14-status.md), [privacy/deletion readiness](day-13-privacy-retention.md)
and [legacy deployment risks](day-13-deployment-readiness.md).

## 1. Scope and release record

Only the reviewed FastAPI application is in scope. The known development
project is **memy-ai-dev**, reference `edbkuunyeyxnyenmmqud`, origin
`https://edbkuunyeyxnyenmmqud.supabase.co`. This is not a production target.
Supabase Dashboard membership is distinct from an application Auth account.

Before an authorized release, record the exact backend and mobile commit SHAs,
selected hosting environment, target Supabase project, migration delta and
designated release/rollback operators. Record reviewers, decision, time and
approved scope without credentials or biography content. Branch names can move;
they are not immutable release identifiers. The Day 14 reviewed runtime is
`c67687ec4b392dbf0e4f73fc8451ac6f0da05560`; it must not be mistaken for a future
Day 15 release SHA or for independently verified mobile acceptance.

Stop before deployment if any of these is unresolved:

- Two issued-user JWT ownership checks, actual EN/SV iPhone journey, native
  recording/PDF behavior and mobile retry/backoff acceptance.
- Current RLS, Storage/object, legacy Edge Function and dependency advisory
  review for the actual target. Local test replay is not deployed-state proof.
- Approved privacy notice, retention/deletion process, support contact and
  processor/region arrangements. No default retention period is invented here.
- Reviewed HTTPS ingress, capacity/monitoring controls, backup/recovery evidence
  and a compatible previous application artifact.
- Explicit founders/release-owner approval of the pilot's real scope. A mock
  demo is not real transcription or live-model-quality acceptance.

## 2. Environment and configuration

Python 3.13 is the verified development runtime; dependencies are pinned in
`backend/requirements.txt` and `backend/requirements-dev.txt`. Node.js 24 is the
verified local SQL-test runtime. Build a fresh environment for the selected SHA;
do not overwrite a running operator's checkout or copy another developer's env
file. Dependency installation/hosting is an authorized operational step, not
something this runbook has executed. `pip check` verifies dependency consistency,
not vulnerability absence.

| Setting | Required boundary |
| --- | --- |
| `SUPABASE_URL` | Exact approved project origin; development is the HTTPS origin above. Verify before starting. Ordinary `app.main` startup does not pin the project; the private development launcher does. |
| `SUPABASE_PUBLISHABLE_KEY` | Current client-safe key belonging to that exact project. No service-role/secret key is required by this backend. Copy through the approved configuration channel, not a committed file. |
| `CORS_ORIGINS` | JSON list of exact approved browser origins; no wildcard. CORS is not native authentication or authorization. |
| `REQUEST_TIMEOUT_SECONDS` | Default 5; bounded by configuration to more than 0 and at most 30 seconds. This is the upstream HTTP timeout, not an end-to-end mobile deadline. |
| `API_MAX_CONCURRENT_REQUESTS` | Default 64; per-process API admission guard. |
| `API_REQUESTS_PER_MINUTE` | Default 120; per-worker verified-user allowance, not distributed abuse protection. |
| `AI_PROVIDER_MODE` | Keep `disabled`. The public mock-only API rejects `openai` mode and real-provider injection. |
| `CONVERSATION_MODE`, `STORY_GENERATION_MODE` | Keep `disabled` unless an explicitly labelled fictional mock demo is agreed; only `mock` is the other supported public mode. |
| `OPENAI_API_KEY`, model/approval/ledger settings | Do not copy into Expo, expose or activate. A key's presence or funding approval does not authorize a live call. This runbook neither provisions nor uses one. |

Settings load process environment before dotenv files; within the same source,
backend `SUPABASE_*` names take precedence over legacy `VITE_SUPABASE_*` aliases.
`backend/.env` takes precedence over the root `.env`. `EXPO_PUBLIC_*` is not read
by backend Settings. Restart the correct process after configuration changes.
Use least-privilege host access, private configuration storage and restricted
temporary volumes. Never commit env files, passwords, access/refresh tokens,
database URLs with passwords, provider keys or private approval/usage files.
Do not dump an environment or request headers to diagnose a problem.

From an already configured development backend, the safe diagnostic is:

```sh
.venv/bin/python scripts/diagnose_supabase.py
```

It reports project/fingerprint/status classifications rather than the key.
Check project match and HTTP result; do not assume a historic fingerprint proves
that a currently selected key is invalid or valid. Never fix a 401 with broader
anonymous grants, a service-role credential or disabled TLS verification.

## 3. Transport and process plan

There is no shared hosted HTTPS endpoint delivered by this repository. The
Day 14-reviewed native app at `1d93b74` accepts private RFC1918 IPv4 origins,
not a new HTTPS DNS host. A future hosted endpoint requires a reviewed mobile
configuration/transport change and its own device acceptance; adding a tunnel
or replacing guards is not implicit approval.

For the agreed **private development rehearsal only**, follow the
[Windows quickstart](backend-mobile-quickstart.md) and
[iPhone checklist](day-14-tarun-rehearsal.md). The explicit launcher command is:

```sh
.venv/bin/python scripts/run_mobile_dev.py --lan --simulate-transcription
```

This launcher refuses any project except the dedicated development project,
sets conversation/story to labelled mocks, validates uploaded audio and returns
fixed fictional transcripts. It does not recognize speech. `--lan` exposes all
local interfaces: use only the agreed trusted personal hotspot/private LAN,
restricted Private-network firewall access and fictional data. HTTP still
carries an unencrypted Bearer token. No shared housing Wi-Fi, public network,
port-forward, firewall disable or production exposure. Stop after the run.

For a **separately approved future HTTPS deployment**, the disabled-mode process
can bind loopback behind a reviewed ingress; this is an illustrative process
shape, not a ready mobile service or permission to start one:

```sh
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers --limit-concurrency 32 --timeout-keep-alive 5
```

No reload in a hosted environment. Review TLS/certificate renewal, exact allowed
hosts, connection/read/idle limits, request/upload limits, trusted health probes,
edge/shared throttling and redacted access/error logs. Do not trust arbitrary
forwarded headers. If proxy headers are needed, separately review exact trusted
hops instead of enabling trust for every peer. Supabase HTTP uses TLS, follows
no redirects and ignores ambient proxy/CA overrides; an enterprise proxy/CA
requires an explicit reviewed setup, not `verify=False`.

Do not scale workers as an unreviewed capacity fix: each worker has its own
admission/rate state. Coordinate process limits with the ingress and resource
budget. The 32-connection Uvicorn limit and 64-request API guard are different
layers; outer-server busy responses can be non-JSON.

## 4. Migration and legacy-function safety gate

**Do not run bulk `supabase` link/push/deploy commands with the current repository
configuration.** `supabase/config.toml` targets old project
`pxejznayegywcctnssxb`, not development, and nine listed legacy functions have
`verify_jwt=false`. These functions are outside FastAPI's disabled/mock gates.
Do not deploy, invoke or copy their secrets as part of a FastAPI release.

Before any separately authorized database change:

1. Verify the exact target project and environment through independent metadata,
   then compare its applied migration history with the selected Git SHA.
2. Review the actual delta, RLS/grants/search paths, triggers, extension and
   scheduler effects, locks, existing-row compatibility and failure behavior.
   Do not replay historical migrations into a populated project blindly.
3. Rehearse against an approved isolated disposable target with fictional data.
   The local suite skips historical hosting extension provisioning; it does not
   certify hosted scheduler/network effects. Review rollback-only fixtures for
   external trigger effects and sequence advancement before authorizing them.
4. Prefer additive, forward-compatible schema changes. Verify both the selected
   application and retained previous artifact remain compatible. Specify a
   forward-fix plan if a schema change prevents application rollback.
5. Establish the backup/recovery evidence below, obtain explicit target/delta
   approval, then let the designated operator apply only that reviewed delta.
6. Verify migration history, permissions and authorized owner/cross-user requests
   without logging private rows. A readiness 200 alone is insufficient.

The empty-database bootstrap generator is only for a confirmed empty approved
development database, not repair/recovery of an existing project. There is no
automatic down-migration, drop/reset or data-restore procedure authorized here.

## 5. Backup and recovery prerequisites — not verified

No current hosting-plan backup entitlement, enabled backup schedule, recovery
point, restore capability, retention or restore drill is certified by Day 14.
Do not assume database backups include Storage objects, Auth configuration,
external provider copies or device PDFs. Do not purchase/upgrade a plan as an
implicit implementation step.

Before a pilot, the responsible operator must inventory the actual approved
backup/export facilities and separately document:

- What is covered and excluded; encrypted storage, access control, location,
  retention and cleanup ownership approved by the controller.
- Last successful recoverable point, monitoring/alerting and agreed recovery
  point/time objectives. No numerical SLA is asserted by this runbook.
- A tested restore into a **new isolated, approved recovery environment**, with
  accounts/keys and network access kept separate from the running project.
- Schema/data consistency, owner isolation and required object/identity linkage
  checks before any approved traffic switch. Never restore over live/shared
  data merely to prove a backup can be read.

Backup/export creation or restore may itself copy personal data and incur cost;
obtain the required scope, destination and spending authorization first. Record
sanitized evidence, not connection strings, row contents or recovery secrets.

## 6. Preflight, health and monitoring

Run the current selected source's complete regression commands and record actual
results, skipped cases and Git SHAs in the acceptance report:

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
.venv/bin/python scripts/export_openapi.py --check
.venv/bin/python scripts/verify_day14.py
# From the repository root:
npm --prefix supabase/tests test
```

The offline journey uses explicit Auth/Data API doubles and fixed simulations;
PGlite validates SQL locally. Neither substitutes for two real issued-user JWTs,
hosted Storage, real iPhone operation or model accuracy. Anonymous sign-in must
stay disabled; do not change Auth settings to clear a pending acceptance label.

- `/health` checks application liveness without an upstream call.
- `/ready` checks the configured Data API/key/`profiles` relation with a zero-row
  HEAD. Success/failure is cached locally for two seconds with one in-flight
  probe; a concurrent cold probe can return 503. It does not prove a valid user,
  ownership, full migration state, complete feature health or paid-provider access.
- Private routes require a real Supabase user Bearer token, not the publishable
  key. Missing/invalid/expired credentials must fail, and foreign resources must
  remain inaccessible without disclosing their private data.
- Observe sanitized status/code counts, latency, 401/403/404, 408/413/429/503,
  upstream failures, capacity, decoder/PDF work and private temporary-volume
  utilization. Set review thresholds against measured capacity; no hosted SLA
  or alerting service is delivered here.
- Never record tokens, authorization headers, email/UUID-bearing URLs, audio,
  transcript/story/PDF bodies or raw upstream errors in logs. The application
  suppresses raw failures/access logs; review proxy, hosting and crash logs too.

Mobile must respect bounded `Retry-After` for `RATE_LIMITED`/`API_BUSY`, show safe
timeout/uncertain-save states and reconcile before explicit retry. Reuse the
original payload/key/revision for supported idempotent operations. Project/
session creation and export audit are not universally idempotent; do not add
automatic POST/PATCH retries or generate fresh keys after ambiguous completion.
Actual mobile behavior still needs its own reviewed source/device evidence.

## 7. Safe rollback and incident response

Define incident ownership and communication before release. Stop or restrict new
traffic at the reviewed ingress if confidentiality, integrity, error rate or
capacity is unacceptable; do not “fix” it by removing Auth/RLS or publicizing a
bucket. Preserve sanitized diagnostic evidence and communicate impact without
private story content. Credential rotation is a separately scoped security
action, not part of routine rollback.

For application rollback, route traffic back to the retained, immutable,
previously tested artifact **only after confirming its compatibility with the
current schema**. Gracefully drain/stop the failed process; preserve current
user data, migration history, idempotency/audit state and private usage ledger.
No destructive Git reset, database reset, down-migration, account deletion or
overwrite restore is part of that procedure. If schema compatibility is not
proven, keep access safely restricted and prepare a reviewed forward fix rather
than guessing. Re-run liveness/readiness, auth/ownership and feature probes after
any approved traffic switch; readiness alone does not close the incident.

For recovery from actual data loss/corruption, use the separately approved
isolated-restore plan in section 5. Validate recovery and obtain explicit
cutover/data-reconciliation approval before changing the live target. Never
overwrite a shared development or production database to roll back an app.

Audio is normally temporary and new PDF bytes are generated in memory, but an
abrupt host termination may leave audio residue and devices/share recipients
may retain PDF copies. Do not promise that rollback, logout or Auth deletion
erases them. Use a reviewed, exact-target cleanup/deletion process; no automatic
destructive cleanup or retention TTL is activated by this runbook.

## 8. Handoff and decision

Supply Tarun the reviewed SHA pair, actual approved API origin, client-public
Supabase configuration and [API contract](frontend-integration.md), never the
backend env file. Retain content-free EN/SV device and hosted-authorization
results separately from simulations. Record open gates, owners and the explicit
decision: continue fictional demo, hold pilot, or approve a narrowly defined
rollout. Documentation completion is not release acceptance.
