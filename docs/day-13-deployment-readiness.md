# Day 13 deployment and remaining security gates

23 October 2026 · **not a production/personal-data pilot sign-off**.

The reviewed FastAPI source is distinct from legacy Supabase Edge Functions.
No deployment, cloud setting/migration, secret rotation, paid call, real-user
deletion or `main` merge is part of this security package.

## Read-only development deployment observation

With the user's explicit permission, the signed-in Supabase dashboard at
`edbkuunyeyxnyenmmqud/functions` was inspected on 23 October. It showed
`memy-ai-dev`, the **Deploy your first Edge Function** empty state and no listed
functions. No function was invoked or deployed and no settings were changed.
A service-incident banner was also visible; this is a dashboard
observation, not a guarantee of future state or an inventory of other projects.
The old project was not opened or modified. Hosted bucket objects, scheduler
jobs, policies and backups were not re-audited today.

## Legacy source hazards — exclude from this deployment

`supabase/config.toml` still targets old project `pxejznayegywcctnssxb`, and nine
listed functions disable gateway JWT verification. **Do not bulk-deploy those
functions, run an unreviewed Supabase link/push, or assume FastAPI's disabled
flags apply to them.** These are static findings, not evidence of active
exploitation or deployment in the new development project.

| Source group | Static finding and release action |
| --- | --- |
| `deletion-reminders` | No caller/scheduler authentication before service-role cross-user backup/deletion work. Keep undeployed; require authenticated scheduling, scoped authorization, retention approval and safe logging before reuse. |
| `openai-realtime-token`, `openai-tts`, `elevenlabs-transcribe`, `minna-interview` | No in-function caller authentication before paid-provider/token paths; outside the Day 12 governor. Keep undeployed; require auth/ownership, bounded inputs/deadlines, sanitized failures and approved usage controls. |
| `transcribe-long-audio` | User validation exists, but no effective owned-book existence gate before paid work; permanent raw storage and rewritten legacy transcription differ from the new immutable-source model. Do not use for this mobile pilot. |
| Legacy payment/invite handlers | Need reviewed ownership, product/amount binding, redirect allowlisting, invite concurrency and confirmation policy. Not part of the current FastAPI payment contract. |
| `admin-api` | Does verify claims and admin role; `verify_jwt=false` alone is not proof of bypass. Still needs a separate administrative-function review before deployment. |
| Legacy MCP | Old hard-coded issuer/project needs review; do not attach it to the new pilot accidentally. |
| Legacy data/storage | Replayed migrations mark `book-images` public and allow broad image reads. Private audio/PDF bucket metadata is not proof of hosted object isolation. Profile own-row updates include `is_demo_premium`; never use that flag as trusted billing/entitlement authority. |
| Legacy logs/recovery | Deletion reminders contain email/title logging and backup recovery behavior; other provider paths log/return raw failures. Review before deployment; schema recovery dates do not establish purge execution. |

No unsafe legacy migration was silently rewritten or applied to existing users.
Remediate the actually selected legacy features in a separate reviewed change,
or exclude them entirely from the new deployment.

## Controlled FastAPI staging configuration

Use only the reviewed backend commit and dedicated development project, with
fake/demo histories until privacy approval. No hosting account or bill is
created by this example:

```sh
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers --limit-concurrency 32 --timeout-keep-alive 5
```

This binds loopback behind a separately reviewed HTTPS ingress; it is **not**
a reachable mobile URL by itself. No reload in staging. The ingress must enforce
TLS, host allowlisting, request/upload limits, connection/read/idle limits,
trusted health-probe access, shared/edge throttles and redacted logging. Do not
trust arbitrary forwarding headers or disable TLS verification to make it work.
If trusted proxy headers become necessary, configure exact trusted hops in a
separate reviewed deployment rather than allowing every peer.

Server settings:

- Development `SUPABASE_URL` plus publishable key, never a service-role key.
- Exact browser CORS origins, no wildcard credentials. Native apps still need
  authentication; CORS is not an ownership boundary.
- `AI_PROVIDER_MODE=disabled`; conversation/story flags disabled or explicitly
  labelled mock for the demo. No live persistence or paid-provider activation.
- `API_MAX_CONCURRENT_REQUESTS=64`, `API_REQUESTS_PER_MINUTE=120` by default.
  These are per event-loop/worker safeguards, not a distributed rate service.
  Multiple processes multiply allowances; unauthenticated/edge limits remain
  ingress responsibilities. Rate state is bounded to 4096 verified IDs.
- Supabase HTTP traffic ignores ambient proxy/CA environment overrides and
  follows no redirects. A required enterprise proxy/CA needs explicit reviewed
  configuration, not a `verify=False` workaround.
- `/ready` performs a zero-row probe, permits only one in-flight upstream call
  and caches success/failure locally for two seconds. Cold concurrent probes can
  report unavailable. It never proves user JWT, ownership or full feature health.

Review hosting/restart/ephemeral-disk behavior, secret storage, minimal privileges,
dependency advisories, monitored error rates and rollback/restore drills before
opening access. `pip check` establishes dependency consistency, **not** a CVE
audit. Dependency upgrades/advisory scanning were not performed today.

## Release checklist still requiring evidence

1. Controller-approved [privacy/retention/deletion plan](day-13-privacy-retention.md),
   notice/contact, processor/region arrangements and sensitive-data review.
2. Authorised fresh hosted JWT/RLS/storage/backup and recovery verification;
   no assumption that local migration replay proves deployed state.
3. Tarun's actual iPhone auth→projects→session→mock turn→review→draft→edit→old PDF
   download→continue workflow over an approved trusted transport. Phone-local
   storage, expiry, interruptions and PDF sharing need device evidence.
4. Current provider access/cost controls and approved evaluation allowance,
   funded bilingual/unsupported-claim quality checks, then reviewed live
   provenance/verification persistence and Expo contracts. The user reports
   funding approval; no live allowance was configured or spent in Day 13.
5. Reviewed HTTPS ingress, dependency vulnerability review and measured hosted
   response/capacity tests. Local timing below is not that acceptance.

## Reproducible offline timing check

```sh
cd backend
.venv/bin/python scripts/benchmark_security.py --iterations 40 --concurrency 4
```

Uses in-process ASGI, fake Auth/Data API and real in-memory PDFs of fixed fictional
text. No external requests or private output. A configuration/import failure
returns a sanitized failure rather than a traceback. The measurements include
application middleware/validation, not Supabase TLS/network/database latency.
No artificial SLA, actual iPhone speed, hosted capacity, memory-leak or DDoS
acceptance is inferred from this smoke benchmark. See [the status report](day-13-status.md)
for the recorded run and full regression result.
