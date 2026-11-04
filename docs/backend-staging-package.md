# Backend staging and recovery package

5 November 2026. **Current decision: keep hosting local.** No hosting account,
paid resource, public API, remote database change, deployment or source push was
created by this work. This package prepares those operational steps for a later
approved release. It does not certify the final app or actual iPhone journey.

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
- `Dockerfile`, deny-by-default `.dockerignore`,
  `deployment/render.staging.yaml`, `deployment/staging.env.example`: prepared
  deployment inputs. Automatic deploys are disabled. The Docker context excludes
  private files, Git, the mobile application, tests, exports and local env files.

The Docker engine is unavailable on this Mac, so the image has **not** been
built/run here. Python launcher, backup/restore and monitor behavior were tested
locally with synthetic files and HTTP mocks. There is **no new staging URL**.

## Transport and hosting boundary

The prepared Render service uses Frankfurt, one instance and a 1 GB persistent
disk mounted at `/var/data`. Render redirects public HTTP to HTTPS and manages
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

`CORS_ORIGINS` is a JSON list of exact HTTPS browser origins, initially `[]` for
native-only use. CORS never replaces Bearer validation or RLS. `/docs`, `/redoc`
and `/openapi.json` are removed only in this staging wrapper; existing local API
documentation and route contracts are unchanged. Use the reviewed checked-in
OpenAPI contract for Tarun. Access logs are off and security response headers
include HSTS, `nosniff`, frame denial and `no-referrer`.

Do not scale this SQLite design across hosts or attach multiple writers to a
network filesystem. One process/instance owns one authoritative ledger. A future
multi-instance deployment needs a separate transactional shared-budget design.

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

1. Record the exact reviewed backend revision and mobile revision. Current
   changes are uncommitted; the Blueprint cannot deploy them from Git until a
   separate source-publication decision is made. Do not substitute `main` or an
   old published revision.
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
   approved models, policy and server secrets. The current allowance has expired;
   no new testing window is authorized by this document. The wrapper requires a
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

`tests/test_staging_state.py` and `tests/test_staging_launcher.py` cover: complete
table preservation, WAL snapshot, isolated restore, hashes, counter corruption,
history deletion/change detection, legitimate appends, missing ledger without
initialization, symlink/permission rejection, bootstrap restrictions, exact
development target, HTTPS/Host/CORS/Auth guards, disabled public docs, sanitized
monitoring and bounded managed-backup pruning. Local focused result: **42 passed**.
No live provider requests, hosted changes, real user fixtures or actual-device
checks were performed by these tests.
