# Backend staging and recovery package

7 November 2026. Local deployment preparation for the authorized **seven-user
remote mobile-web pilot**. No hosting account, paid resource, public API, remote
database/Auth change, deployment or source push was created by this packaging
work. The actual hostname and reviewed source publication remain pending. This
package does not certify the final app or an actual phone journey.

## Delivered local components

- `backend/scripts/run_staging.py`: one-process launcher, development-project
  pinning, exact HTTPS origin/Host/CORS checks, AI-off bootstrap, history
  continuity preflight, periodic private snapshots and sanitized backup events.
- `backend/scripts/staging_state.py`: read-only-source SQLite online backup,
  integrity/hash verification, immutable-history manifest and restore to a new
  isolated directory. It never creates an empty financial ledger or overwrites
  the running ledger. Approval identity and original reservations are pinned;
  later reservations/counter growth remain possible. New accounting policy,
  subject-allocation and usage-settlement tables are preserved and pinned too.
- `backend/scripts/monitor_staging.py`: HTTPS-only, credential-free read-only
  checks of `/health`, `/ready` and `/api/v2/capabilities`. It never invokes a
  provider or reads a user's story. AI intentionally disabled is distinguished
  from a failed backend/database check.
- `deployment/container_preflight.py`: credential-free synthetic audio-decoder,
  encryption and English/Swedish PDF-font checks, also run as the runtime user
  during the image build. It does not create Settings or call external services.
- `Dockerfile`, deny-by-default `.dockerignore`,
  `deployment/render.staging.yaml`, `deployment/staging.env.example`: prepared
  deployment inputs. Automatic deploys are disabled. The Docker context excludes
  private files, Git, the mobile application, tests, exports and local env files.

The Docker engine is unavailable on this Mac, so the image has **not** been
built/run here. The runtime preflight passed using the local Python environment;
that does not prove the Linux image builds or that its memory capacity is adequate.
Python launcher, backup/restore and monitor behavior were tested locally with
synthetic files and HTTP mocks. There is **no new staging URL**.

## Transport and hosting boundary

Use two services: a static HTTPS web build containing only public client
configuration, and this persistent FastAPI service. The browser sends requests
directly to the approved API origin. The local `web-preview/server.py` is a
loopback preview tool and must not be exposed as the public host. Server keys,
approvals, financial records and speech encryption keys belong only on FastAPI.

The prepared Render service uses Frankfurt, the current `0.5c-512mb` compute
plan identifier, one instance and a 1 GB persistent disk mounted at `/var/data`. Render redirects public HTTP to HTTPS and manages
TLS certificates; the application does not trust `X-Forwarded-*` headers. The
generated service hostname must exactly match `STAGING_ORIGIN` and
`RENDER_EXTERNAL_HOSTNAME`. Custom-domain ingress requires its own configuration
review rather than silently broadening allowed hosts. [Render TLS](https://render.com/docs/tls),
[web services](https://render.com/docs/web-services),
[Blueprint specification](https://render.com/docs/blueprint-spec).

For another host, `STAGING_TLS_MODE=direct` requires private regular certificate
and key files (`STAGING_TLS_CERT_FILE`, `STAGING_TLS_KEY_FILE`), and Uvicorn serves
TLS directly. There is no insecure public mode and no wildcard proxy trust.
[Uvicorn TLS and proxy settings](https://uvicorn.dev/settings/).

`STAGING_ORIGIN` is the exact approved public API origin (`apiOrigin`).
`CORS_ORIGINS` must contain the separately approved public web origin
(`webOrigin`), for example `["https://approved-web.example.com"]`. The checked-in
AI-off shell deliberately starts with `[]`; it is not ready for browser requests
until the reviewed web origin replaces it. Never insert wildcard origins. CORS never replaces Bearer validation or RLS. `/docs`, `/redoc`
and `/openapi.json` are removed only in this staging wrapper; existing local API
documentation and route contracts are unchanged. Use the reviewed checked-in
OpenAPI contract for Tarun. Access logs are off and security response headers
include HSTS, `nosniff`, frame denial and `no-referrer`. CORS exposes
`X-Memy-Operation-Id` and `X-Memy-Recovery` so browser streaming and conservative
recovery retain the same contract. Security-header middleware forwards each
stream chunk without waiting for the whole reply.

The public static build accepts exactly four client-safe environment settings:
`MEMY_WEB_ORIGIN`, `MEMY_API_ORIGIN`, `MEMY_SUPABASE_URL` and
`MEMY_SUPABASE_PUBLISHABLE_KEY`. Alternatively, use the ignored
`apps/mobile/staging.web.client.local.json` file with exactly `webOrigin`,
`apiOrigin`, `supabaseUrl` and `publishableKey`; do not mix the two methods.
Neither method contains server secrets. Both origins must be the final canonical
public HTTPS origins. Build from the approved mobile source with
`node scripts/export-web-staging.cjs` inside `apps/mobile`; follow its
`web-preview/README.md` for the complete installation and hosting instructions.
The browser-only `/auth/callback` route is for implicit invitation/recovery
links, not code-only PKCE. Do not add or advertise its exact final redirect
until independent review and actual-device verification pass. The native `memy-foundation://auth/confirm`
callback does not replace browser password setup. Existing password accounts
can be used for the first AI-off connectivity check.

The Docker build installs pinned binary wheels and runs `pip check`; a missing
compatible wheel fails the build rather than attempting an unreviewed compiler
fallback. The image preflight checks accepted PyAV decoders, a bounded synthetic
WAV subprocess, AES-GCM round-trip and real EN/SV PDF rendering using bundled
Unicode fonts. It uses no real recording or private configuration. No system
FFmpeg or external PDF-font download is required. An operator with Docker must
still build and run the actual image before provisioning:

```sh
docker build -t memy-staging-reviewed .
docker run --rm --entrypoint python memy-staging-reviewed /app/deployment/container_preflight.py
```

Do not put secret build arguments into these commands. The runtime service must
pass its separate private configuration/continuity check after the disk and
secrets are installed.

Do not scale this SQLite design across hosts or attach multiple writers to a
network filesystem. One process/instance owns one authoritative ledger. A future
multi-instance deployment needs a separate transactional shared-budget design.
The 512 MB plan is an initial candidate, not measured seven-user capacity. Bound
concurrent audio/PDF work and keep the existing fail-fast AI-busy response; do
not add an unbounded paid-work queue or automatic retries to hide contention.
Measure memory and full EN/SV journeys with the actual image before invitations.

## Persistent state and private configuration

The dedicated runtime user is uid/gid 10001 in the image. The tiny entrypoint
creates/chowns only `/var/data/memy`, then drops root before importing or running
the application. It never recursively changes ownership/permissions on imported
history. Import files as that runtime user, in directories mode `0700` with files
mode `0600`. Linked/shared files are refused.

| Path in `/var/data/memy` | Purpose |
| --- | --- |
| `ledger.sqlite3` | Entire cumulative SQLite financial history, including future settlements and user allocations |
| `usage.jsonl` | Existing numeric provider observations; retain the complete log |
| `history.json` | Immutable baseline hashes from the approved migration snapshot |
| `approval.json` | A separately authorized, unexpired spending approval; copying one does not renew it |
| `budget-policy.json` | Reviewed cumulative ceiling, prior-exposure baseline, unresolved remote hold and per-user limits |
| `pilot-cohort.json` | Private operator-reviewed list of at most seven distinct accounts allowed to start paid AI |
| `speech.sqlite3` | Optional encrypted owner-scoped prepared-speech cache |
| `backups/` | Managed financial-state snapshots, private and bounded |

Provide Supabase publishable/server credentials, the OpenAI project key and
speech encryption key only through private server configuration/hosting secrets.
They never enter the repository, Docker image, mobile build, monitor output or
backup bundle. Keep the speech key stable across restarts; rotating it makes old
encrypted audio unreadable. The example keeps the existing 300-second retention;
any longer period requires an explicit retention choice, within the implemented
limit. Neither memory nor disk cache promises indefinite audio preservation.

The financial snapshot does **not** include provider credentials, the speech key,
approval/policy files, cached audio, Supabase data/Auth/Storage, device PDFs or
processor-held data. Store current approval/policy and recovery credentials
separately through the approved encrypted private handoff. A fresh disk or
missing baseline never receives an automatically fresh budget.

## Migration and cutover procedure — future approved operation

1. Record the exact reviewed backend revision and mobile revision, including
   any reviewed local patch hash. The Blueprint deploys committed Git source,
   not local working-tree edits. A local patch requires a separate reviewed
   source-publication decision before deployment from Git. Do not substitute
   `main`, a moving branch or an old published revision.
2. Stop/disable paid calls on **both** the Mac and Tarun's WSL before exporting.
   Wait for in-flight requests and preserve unknown reservations conservatively.
   Obtain Tarun's returned ledger/usage evidence through the approved encrypted
   channel. Until it is returned/reviewed, retain the full existing US$0.75 remote
   hold and mark reconciliation incomplete. The staging setup does not refund it.
3. Run the read-only reconciliation report. Resolve conflicting history with an
   explicitly reviewed append-only consolidation; never replace one branch's
   ledger with the other, discard reservations or reuse an approval ID with
   changed terms.
4. Create a private online backup from the authoritative ledger and log:

   ```sh
   python scripts/staging_state.py backup \
     --ledger /absolute/private/source-ledger.sqlite3 \
     --usage-log /absolute/private/source-usage.jsonl \
     --output /absolute/private/new-handoff-snapshot
   python scripts/staging_state.py verify \
     --backup /absolute/private/new-handoff-snapshot
   ```

   The output parent must already be private; the new output directory must not
   exist. Only numeric counts/status are printed. Transfer the snapshot with
   encryption and verify its manifest at the destination. A snapshot taken while
   calls are active remains financially conservative, but log evidence can lag;
   it is not a safe cutover without quiescence and reconciliation.
5. After hosting/billing approval, initially provision with
   `STAGING_BOOTSTRAP_AI_OFF=true`, `STAGING_ENABLE_REAL_AI=false` and
   `REAL_AI_ENABLED=false`. This explicit bootstrap serves health, authentication
   and saved-data routes with paid operations disabled; it does not initialize
   the missing ledger. A partial financial-state import is rejected.
6. Restore the verified snapshot into a **new** private directory, not over the
   live state. Install the verified `ledger.sqlite3`, `usage.jsonl` and
   `history.json` into the private state directory as uid/gid 10001 while the
   service remains AI-off. Install the separately reviewed approval/policy
   privately. Never log or paste their secret values.
7. Set `STAGING_BOOTSTRAP_AI_OFF=false`. Start/check the wrapper while AI remains
   off. Its continuity check requires every baseline reservation/approval binding
   to remain intact and allows additions. A missing/corrupt/replaced history
   fails startup rather than creating a new allowance.
8. Only after explicit live-window authorization, configure both enable switches,
   approved models, policy, private `AI_PILOT_COHORT_PATH` and server secrets.
   The cohort contains 1–7 unique verified account UUIDs and never enters the
   mobile app. Staging refuses paid activation without a valid private list;
   outsiders retain owned saved-data/PDF access but cannot start paid AI.
   See [seven-user operations](seven-user-pilot-operations.md).
   No new testing window is authorized by this document; install only the
   currently approved private terms. Do not infer approval from the public
   launch worksheet or a copied historical approval. The wrapper requires a
   cumulative budget policy and durable encrypted speech storage if speech is
   enabled. Feature-level disables and the normal approval checks still apply.
9. Re-run hosted two-user authorization, HTTPS checks and the complete EN/SV
   device journey before inviting external testers. Return the actual staging
   URL, reviewed SHA pair and sanitized acceptance result to Tarun.

Supabase migrations/Auth are not applied by the launcher or image. The known
target is only `edbkuunyeyxnyenmmqud`; a different staging project requires an
explicit target review/configuration change. Do not bulk-push the repository's
legacy Supabase configuration to obtain a deployment.

## Backups, recovery and monitoring

After provisioning, startup takes a private online SQLite snapshot and the
process repeats it hourly. `STAGING_BACKUP_INTERVAL_SECONDS` accepts 300–86400;
`STAGING_BACKUP_KEEP` accepts 2–168 complete managed copies (default 24). Only
verified snapshots created under the exact managed directory/name format are
pruned; the live ledger/log, unrelated files, incomplete bundles and all prior
reservations remain untouched. Snapshots on the same disk help operator recovery
but do not protect against losing that disk/account. Approve and configure an
encrypted off-host destination before claiming disaster-recovery readiness.

The platform health-check path is `/health`: fast, dependency-free liveness.
It fits Render's five-second health-check deadline without shortening the global
Supabase Auth/Data request timeout or causing restarts during a temporary
database outage. Do not lower `REQUEST_TIMEOUT_SECONDS` just to satisfy a hosting
probe; doing so also affects authenticated reads and saves. A healthy platform
check alone does not mean the database is ready: require `/ready` in release
acceptance and run it in the independent external monitor below. Neither route
calls paid AI. Fast-path flags
`REAL_AI_COMBINED_TURN_ENABLED=true` and `REAL_AI_STREAM_TURN_ENABLED=true` select
the reviewed combined/streaming transport only after the separate paid gates
and private approval succeed. The AI-off bootstrap remains AI-off.
[Render health checks](https://render.com/docs/health-checks).

Disk-backed services cannot customize Render's shutdown window or provide
zero-downtime deploys. The platform normally sends SIGTERM and then force-stops
after 30 seconds. This package sets Uvicorn graceful shutdown to 20 seconds and
bounds the backup-thread join to two seconds. It does not promise to finish every
provider request during shutdown. Pause new paid work, wait for in-flight calls
and take a verified snapshot before a manual deploy; retain unknown reservations
if interrupted. Do not add an unsupported `maxShutdownDelaySeconds` field to the
disk-backed Blueprint. [Render deploy lifecycle](https://render.com/docs/deploys),
[Uvicorn shutdown settings](https://uvicorn.dev/settings/).

Render disks persist across restarts/deploys, but filesystem snapshots alone are
not a database recovery guarantee. This package uses SQLite's online backup API
and checks database integrity, foreign keys, gross counters and file hashes.
[Render persistent disks and recovery guidance](https://render.com/docs/disks),
[Python SQLite online backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup).

Test a restore only into a new isolated directory:

```sh
python scripts/staging_state.py restore-new \
  --backup /absolute/private/verified-snapshot \
  --output /absolute/private/new-isolated-restore
```

This command does not switch traffic, change the application ledger path or
overwrite any current data. After actual loss, an older backup can omit recent
reservations, even when all its own hashes match. Keep AI paused, compare all
available provider/WSL records and preserve an uncertainty hold before any
explicit recovery/cutover approval. Restoring an older budget is never a refund.

External read-only monitoring command, after a real endpoint exists:

```sh
python scripts/monitor_staging.py --origin https://approved-backend.example.com
```

Schedule it from an independently managed monitor and configure a human alert
destination before claiming active outage alerting. It returns JSON booleans and
status classifications; no raw upstream failures, URLs containing user IDs,
tokens, private story contents or configuration values are emitted. Review the
host's proxy/crash logs separately. Watch `staging_backup` failures and disk
capacity too. `/ready` proves a zero-row database probe, not owner isolation,
full feature health or paid-provider quality.

## Verification performed for this package

`tests/test_staging_state.py`, `tests/test_staging_launcher.py`,
`tests/test_staging_image_package.py` and `tests/test_real_ai_stream_route.py`
cover complete financial-table preservation, WAL snapshot, isolated restore,
hashes, counter/history tampering, legitimate appends, missing-state rejection,
bootstrap restrictions, exact development target/Host/CORS, absent Render
hostname rejection, owner recovery-header exposure, readiness/liveness
separation, bounded single-worker shutdown configuration, progressive middleware,
sanitized monitoring, bounded backup pruning and terminal stream behavior.
The image-preflight test uses real synthetic audio decoding and PDF rendering
while forbidding Settings construction and HTTP requests. Latest local focused
result: **66 passed**. After preserving the global timeout and restoring
platform liveness, all **53 affected staging checks** passed again. Dependency
consistency and `git diff --check` also pass.
No live provider requests, hosted changes, real user fixtures or actual-device
checks were performed by these tests.

Before the first invitation, record all remaining operational evidence:

- actual Linux image build/start and non-root runtime;
- final API/web origins, exact CORS and browser callback verification;
- verified one-authority financial import, reviewed per-user/global limits and
  current authorized approval; preserve unresolved remote exposure;
- readiness, stream framing/recovery and two-user authorization on the hosted
  service;
- measured memory use plus actual English/Swedish microphone/PDF journeys;
- restart/backup/isolated-restore exercise and an encrypted off-host recovery
  destination;
- independent monitor with a human alert destination and a clear pilot support
  contact.

A local green suite does not replace those hosted/device acceptance gates.
