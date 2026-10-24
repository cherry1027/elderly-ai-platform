# Memy Mobile Backend Handoff

24 October 2026 · backend 0.8.1 · development only.

Current final handoff: [Day 15 status](day-15-status.md),
[Tarun integration](tarun-final-integration.md), [acceptance matrix](milestone-1-acceptance.md)
and [security/deployment gates](security-release-gates.md). The current native
source addresses the Day 14 backoff gap; full actual-device and fresh two-issued-user
JWT acceptance remain pending. No pilot/main merge/deployment is approved here.

**Tarun can implement Task 3D-8A/B against the existing backend.** PDF export,
historical downloads and non-generating story continuation already exist. This
handoff includes the Day 10 stale-confirmation safety patch, a reproducible
OpenAPI snapshot and regression checks. Paths, payloads and success schemas
are unchanged; stale implicit review intent is rejected with the existing 409.
Day 13 adds documented 429 throttling and 503 admission handling below.
Day 14 rehearses the cumulative mock journey and exposes `Retry-After` through
allowed-origin CORS; no path, version or success schema changes. The
[Day 14 acceptance report](day-14-status.md) and
[real-iPhone checklist](day-14-tarun-rehearsal.md) remain historical evidence.
Use the final handoff above for the newer mobile revision.

## Start here: the stable pins

| Component | Exact reviewed reference |
| --- | --- |
| Backend repository | [cherry1027/elderly-ai-platform](https://github.com/cherry1027/elderly-ai-platform) |
| Shared backend branch | `codex/day-7-mobile-integration` |
| Application-code baseline | `c67687ec4b392dbf0e4f73fc8451ac6f0da05560` (`c67687e`); later docs/evidence-only commits may follow |
| Latest reviewed mobile branch | `feat/mobile-api-backoff` |
| Mobile commit | `b787dcd70b54f6220bfa3d7c0899a2c1f677e080` (`b787dcd`), contains `1d93b74` and PDF work |

The earlier integration pin was `73094c7`; `a629760` added the consolidated
handoff without changing that runtime. Day 10's `a00df98` is the small 0.8.1
memory-review patch. Day 12's `b169555` adds separately gated OpenAI evaluation
and explicit public release guards without changing the 0.8.1 mobile contract.
Day 13's `a2dd846` hardens Auth/audio, admission limits and readiness; `c2decb4`
adds non-destructive privacy/audit tools and SQL regression coverage. It adds
documented rate/admission errors but leaves success fields intact. Later
documentation-only commits do not activate live providers; record
`git rev-parse HEAD` after obtaining them. Do not equate a changing branch name
with an immutable version. No merge into `main` is part of this work.

The latest mobile source was inspected at `b787dcd`; see the
[Day 15 review](day-15-mobile-review.md). Bounded `RATE_LIMITED` / `API_BUSY`
handling and no automatic retries are present; 40 pure parser/store cases passed
in a limited offline harness, not the full native suite/device. PDF/continuation
and backoff still need physical acceptance. Earlier, at `eb4eaa8`, Tarun reported
2,825 tests in 67 suites, TypeScript/lint/Expo checks and major real-iPhone flows.
Those mobile tests and device actions were **not independently rerun in this
backend handoff**. Historical Day 8/9 documents describe older mobile commits;
their statements about absent audio/editing UI are not current mobile status.

## The handoff package

- [Day 15 status](day-15-status.md), [acceptance](milestone-1-acceptance.md),
  [security gates](security-release-gates.md), [runbook](pilot-deployment-runbook.md)
  and [Tarun final checklist](tarun-final-integration.md): complete regressions,
  fresh read-only hosted checks and explicit remaining release prerequisites.

- [Day 14 report](day-14-status.md), [native source review](day-14-mobile-code-review.md)
  and [iPhone rehearsal](day-14-tarun-rehearsal.md): 1,231 Python and 86 isolated
  PostgreSQL tests, 142 offline journey assertions and fresh read-only hosted
  checks. Anonymous sign-in remained off; no hosted account/data changes or
  paid calls. Actual device and valid-two-user JWT results remain pending.

- [Day 13 security report](day-13-status.md),
  [privacy/retention workflow](day-13-privacy-retention.md) and
  [deployment gates](day-13-deployment-readiness.md): current security patch,
  additive429/503 admission handling and unresolved pilot approvals. No new
  routes/success fields and no real-provider activation.

- [Mobile API contract](mobile-api-contract.md): all 25 operations, exact headers,
  bodies, response shapes, binary PDF handling, errors and retry semantics.
- [Day 12 provider guide](day-12-ai-integration.md) and
  [pre-approval status](day-12-status.md): offline-tested OpenAI adapters and
  usage gates; public live AI and spending remain disabled. No Expo change yet.
- [Day 11 story guide](day-11-story-integration.md) and
  [current verification](day-11-status.md): explicit generation, manual revisions,
  private binary PDF download and Continue acceptance; existing 0.8.1 APIs reused.
- [Day 10 memory guide](day-10-memory-integration.md) and
  [current status](day-10-status.md): clarification/review/resumption fixtures,
  0.8.1 conflict handling and current evidence/pending device checks.
- [Real voice proposal](mobile-voice-contract.md): current limitations, proposed
  turn lifecycle, providers/cost assumptions and approval gates. Not a live API.
- [Verification report](mobile-integration-tests.md): fresh local and hosted
  database evidence, the eight requested checks and remaining device acceptance.
- [OpenAPI JSON](openapi.json): generated offline from the actual FastAPI app.
  Swagger `/docs` and `/openapi.json` expose the same application schema when run.
- [Placeholder configuration](examples/mobile/): backend `.env.example`,
  `development.auth.example.json` and `development.api.example.json`.
- [Windows/iPhone quickstart](backend-mobile-quickstart.md),
  [audio upload guide](day-9-mobile-audio.md),
  [draft guide](story-drafts-api.md) and [PDF guide](pdf-export-api.md): details.

## Status: what actually exists

These labels describe separate layers. Real persistence does not turn a mock
writer into a real AI service, and SQL role checks do not prove a phone login.

| Capability | Status / evidence | Important boundary |
| --- | --- | --- |
| Health/readiness, user-token validation, project CRUD and owned sessions | Implemented and tested; historical hosted API checks; Day 14 readiness/missing-invalid-token and read-only SQL-role checks | Fresh two-issued-user JWT/owner-write acceptance pending; no public HTTPS FastAPI deployment |
| Audio upload/decoding/limits, immutable originals and source-ID processing | Implemented and tested; real local audio bytes, hosted persistence history | No real speech recognition |
| Development transcription | **Mock only**, opt-in launcher flag; permanent bilingual fictional notice | Fixed fixture independent of speech; default disabled |
| Conversation and memory extraction | **Mock only**, deterministic EN/SV rules; real ownership/provenance/versioned review | Not an open-ended model; uncertain/conflicting candidates require review |
| Generate My Story | **Mock only writer**, real saved drafts/source snapshots/versioning | `passed` means deterministic mock verification, not an LLM accuracy guarantee |
| Manual draft editing and history | Implemented and tested; historical hosted SQL persistence/revision/conflict checks; Day 14 offline rehearsal | Manual content is `needs_review`, not auto-verified; current hosted check is read-only |
| Private PDF export/history/download | Implemented real renderer + real saved metadata, not simulated PDF bytes | Historical hosted SQL checked metadata/text; Day 14 checks real bytes offline; native PDF/share acceptance is pending |
| Continue and explicit new generation | Implemented and tested; historical hosted SQL and Day 14 offline continuation/version preservation | Continue never generates; manual prose is not auto-merged; current hosted check is read-only |
| Current mobile UI through PDF/continuation/backoff | Source reviewed at `b787dcd`; 40 pure parser/store checks in a limited offline harness | Full native suite, actual-iPhone journey and backoff acceptance not rerun |
| Real STT, general AI conversation, TTS and streaming | **Public activation planned; STT/text evaluation adapters implemented** | Funding approval is reported; no active evaluation allowance, public activation/persistence or new voice route was configured by this work |
| Guest quota, subscriptions, private photo pipeline and template gallery | **Planned for this FastAPI/mobile workflow** | Legacy Lovable code is not a reviewed implementation of these contracts |
| HTTPS staging and public pilot | **Planned** | Requires approved hosting, mobile URL-guard update and security/privacy gates |

All 25 current operations are documented; 23 require a user Bearer token.
Authentication, private retrieval, editing, PDF rendering and continuation do not
require enabling a paid model. Ordinary `uvicorn app.main:app` starts with
conversation/story generation disabled unless their explicit mock modes are set.

## Development setup without exposing credentials

Use separate checkouts/directories for the backend branch and Tarun's mobile
branch. They communicate over HTTP; do not merge the old web UI into the native
app to make this integration work. Keep both Git pins in acceptance reports.

In a backend checkout, from `backend/` on Windows:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=av -r requirements-dev.txt
# Prepare backend/.env privately using the approved development project values.
.\.venv\Scripts\python.exe scripts\diagnose_supabase.py
.\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
```

Reuse an existing compatible virtual environment rather than recreating it.
Use the pinned requirements, not an unrelated dependency upgrade. On macOS the
equivalents are `python3 -m venv .venv` and `.venv/bin/python`.

The dedicated launcher pins development project `edbkuunyeyxnyenmmqud`, enables
only the existing free conversation/story mocks, and enables fictional audio
transcripts **only** with `--simulate-transcription`. Omit `--lan` for loopback;
stop with Ctrl+C. Without the audio flag, valid owned uploads return
`503 TRANSCRIPTION_DISABLED`, including completed upload POST retries. Saved
transcripts remain readable. No provider key is needed.

In Tarun's `apps/mobile/` checkout, privately prepare the existing ignored files:

```json
{"supabaseUrl":"https://<DEVELOPMENT_PROJECT_REF>.supabase.co","publishableKey":"<APPROVED_DEVELOPMENT_PUBLISHABLE_KEY>"}
```

The first object belongs in `development.auth.local.json`. The API file
`development.api.local.json` has exactly:

```json
{"baseUrl":"http://<WINDOWS_TRUSTED_PRIVATE_LAN_IPV4>:8000"}
```

Use the backend root, not a guessed `/api/v1` suffix. The checked-in mobile
normalizer currently accepts private LAN IPv4 origins only, even with HTTPS;
it rejects DNS/public hosts. A future HTTPS staging hostname needs a reviewed
configuration change rather than disabling the guard. Restart the normal
protected mobile launcher with `npm start` after changing local JSON; do not use
`preview:stories` to claim real integration. No `EXPO_PUBLIC_*` fallback is used
by this mobile configuration. Placeholders are intentionally not runnable values.

Use only the agreed personal hotspot/trusted private network. Phone localhost is
the phone, not Windows. Do not send Bearer tokens over shared housing Wi-Fi HTTP,
port-forward the launcher or expose it through an unreviewed public tunnel.
The API/root and `/docs` are reachable only while the developer machine/server is
on and network/firewall rules permit the connection.

Expo signs in through Supabase and obtains the user's access token. Send that
token as `Authorization: Bearer …` to FastAPI; never substitute the publishable
key. FastAPI validates it online with Supabase Auth and forwards the same user
JWT to the Data API so RLS still applies. The current mobile source uses an
account-fenced SecureStore adapter; device lifecycle/refresh acceptance remains
Tarun's responsibility. No service-role key, database password or backend `.env`
belongs in the mobile app or this handoff.

## Immediate Task 3D-8 decision

Build **3D-8A first**: save editor changes, export the selected saved draft, handle
201 `application/pdf` bytes, capture the export ID, list previous exports and
download the chosen historical export with an authenticated GET. Do not treat
the POST success as JSON or open an unauthenticated download URL. Sharing is an
explicit user action; privately cached files need cleanup on account changes.

Then build **3D-8B**: Continue returns/reuses the owned session and the current
latest draft with `generation_triggered: false`. Collect and confirm new memories,
resolve contradictions, and only on an explicit user action call generation with
a new action UUID. Changed source context creates generation version two;
unchanged context reuses its draft. Earlier manual revisions and export references
remain available. The new prose does not automatically include earlier manual
wording; provide a comparison/reconciliation UI. Exact requests are in the
[API contract](mobile-api-contract.md).

## Verified now versus still awaiting acceptance

Latest Day 13 regression: 1,154 backend checks and 73 isolated database checks
passed; four separately gated live pytest cases were skipped. See the
[Day 13 report](day-13-status.md). The [Day 12 report](day-12-status.md) and
[original handoff verification report](mobile-integration-tests.md)
preserves the earlier 755/56 baseline and its hosted checks as historical evidence.

The hosted draft and export/continuation scripts passed using two synthetic
database subjects with transaction-local authenticated-role claims. They do not
prove new Auth-issued JWTs, PostgREST HTTP mapping, actual PDF downloads or a
real iPhone test. No existing data was deleted, Auth/RLS policy changed, paid
provider enabled or production project accessed. Do not turn these scoped
results into a general claim of production or real-AI readiness.

## Subscription, guest, photos and design dependencies

Existing foundations are owned projects/sessions/memories/drafts, immutable
sources/revision history, a basic single PDF layout and private export audit
metadata. For **this backend/mobile path**, the following need design and review:

| Feature | Proposed backend boundary; not implemented |
| --- | --- |
| 5–6-minute guest trial | Server-issued trial identity, consent, server-side expiry/usage ledger, abuse controls, limited generation, expiry cleanup and explicit account conversion |
| Subscriptions | Approved plan matrix, server-side entitlements and usage reservations, verified purchase/webhook receipts, replay/out-of-order/refund handling; no client boolean unlocks |
| Photos | Owned `project_assets` records plus private object storage, verified MIME/dimensions/byte limits, metadata stripping, re-encoding, scanning/quarantine and deletion lifecycle |
| Layout/design gallery | Server-approved template/version IDs and validated layout JSON, caption/placement schema, preview/export parity; never arbitrary HTML/CSS/file URLs |
| Customized books | Immutable `draft_id` + revision + template version + asset snapshot per export; background render jobs, per-user quotas and bounded isolated workers |

Do not wire the commercial flow to historical Lovable payment/voice functions
merely because those files exist. No reviewed FastAPI subscription/photo/guest
contract exists yet. Founders must approve limits, commercial terms, retention
and the mobile purchase approach before new endpoint names become commitments.

For future photos, a private Supabase bucket with per-user RLS is a candidate;
authenticated downloads avoid making personal photos public. Signed links, if
chosen, are bearer capabilities and must be short-lived and excluded from logs.
No bucket or photo permissions were created here.
[Supabase private-bucket documentation](https://supabase.com/docs/guides/storage/buckets/fundamentals)
describes the underlying access model, not an already configured Memy pipeline.

## Proposed HTTPS staging: review before deployment

Proposed topology: native app → HTTPS ingress → pinned FastAPI container → separate
staging Supabase Auth/PostgreSQL, with provider calls only after separate approval.
Use fictional accounts and no copied production biographies. Keep development,
staging and production URLs, keys, callbacks, logs, database backups and provider
budgets separate. Retain online token validation and user-scoped RLS.

One hosting candidate is a managed Google Cloud Run service in an approved EU
region. It supports container services and managed HTTPS; select the actual region,
budget, ingress and identity policy during review. This is a recommendation, not
a deployment, an all-EU-processing guarantee, or a promise of zero hosting costs.
See [Cloud Run overview](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run)
and [locations](https://docs.cloud.google.com/run/docs/locations).

Before public access: review a non-root container and pinned dependencies/fonts,
readiness/rollback, trusted proxy/TLS handling, per-user/IP rate limits, shared
usage caps, body/time limits and decoder/PDF worker isolation. Existing 32-request
launcher and two audio/PDF slots are per-process bounds, **not** distributed abuse
protection. Disable content/access logging; use safe operation IDs, HTTP/error
codes, durations, byte counts, model mode and coarse health metrics. Never log
tokens, signed URLs, story text, recording bytes or provider request bodies.

Define approved retention/deletion for originals, corrections, drafts, exports,
photos, provider copies, local files and backups. Current immutability guards
prevent accidental edits; they are not a complete account-erasure workflow.
Crash-time temporary-file cleanup and killable PDF workers still need deployment
work. Obtain privacy/legal review of notices, lawful basis, sensitive family data,
processor terms/transfers, access/export/erasure and DPIA need before real-user
pilots. No claim of GDPR compliance is made by this test report. The
[European Commission obligations guide](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en)
is a starting point for that review, not legal sign-off.

## Working agreement and change control

Freeze the runtime/API baseline above for Task 3D-8. Work one small feature at a
time: contract → frontend change → automated checks → independent review → iPhone
acceptance → scoped backend verification → commit/push review branch. Capture
Git pins, network type, language, safe status/error codes and fictional IDs only.
Do not change contracts, merge `main`, deploy, spend on providers or send emails
without the corresponding approval. A future real-model response/provenance
contract must be reviewed first: today's strict `mode: mock` schemas do not
silently accept a real provider just because an API key is present.
