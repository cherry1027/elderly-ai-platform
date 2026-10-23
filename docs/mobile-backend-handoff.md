# Memy Mobile Backend Handoff

23 October 2026 · backend 0.8.0 · development only.

**Tarun can implement Task 3D-8A/B against the existing backend.** PDF export,
historical downloads and non-generating story continuation already exist. This
handoff adds documentation, a reproducible OpenAPI snapshot and offline contract
checks; it does not change the working runtime, database schema or API responses.

## Start here: the stable pins

| Component | Exact reviewed reference |
| --- | --- |
| Backend repository | [cherry1027/elderly-ai-platform](https://github.com/cherry1027/elderly-ai-platform) |
| Shared backend branch | `codex/day-7-mobile-integration` |
| Stable runtime commit | `73094c77c9c9d04a9a4c6b213b05112eb675c130` (`73094c7`) |
| Latest mobile branch reported by Tarun and confirmed on GitHub | `feat/mobile-draft-editor` |
| Mobile commit | `eb4eaa8caa38e1cbf1e519831283d269eaeb9252` (`eb4eaa8`) |

The backend remote reference was rechecked for this handoff and still pointed to
`73094c7` before these documentation/tooling additions. There is no newer runtime
contract to migrate to. The handoff package's commit is a descendant of that
baseline; record `git rev-parse HEAD` after obtaining it. Do not equate a changing
branch name with an immutable version. No merge into `main` is part of this work.

The mobile package/configuration files were inspected at `eb4eaa8`. Tarun reports
2,825 tests in 67 suites, TypeScript/lint/Expo checks and major real-iPhone flows.
Those mobile tests and device actions were **not independently rerun in this
backend handoff**. Historical Day 8/9 documents describe older mobile commits;
their statements about absent audio/editing UI are not current mobile status.

## The handoff package

- [Mobile API contract](mobile-api-contract.md): all 25 operations, exact headers,
  bodies, response shapes, binary PDF handling, errors and retry semantics.
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
| Health/readiness, user-token validation, project CRUD and owned sessions | Implemented and tested; local regression, historical hosted API checks, fresh hosted ownership checks | No public HTTPS FastAPI deployment |
| Audio upload/decoding/limits, immutable originals and source-ID processing | Implemented and tested; real local audio bytes, hosted persistence history | No real speech recognition |
| Development transcription | **Mock only**, opt-in launcher flag; permanent bilingual fictional notice | Fixed fixture independent of speech; default disabled |
| Conversation and memory extraction | **Mock only**, deterministic EN/SV rules; real ownership/provenance/versioned review | Not an open-ended model; uncertain/conflicting candidates require review |
| Generate My Story | **Mock only writer**, real saved drafts/source snapshots/versioning | `passed` means deterministic mock verification, not an LLM accuracy guarantee |
| Manual draft editing and history | Implemented and tested; fresh hosted persistence, revisions and stale-edit denial | Manual content is `needs_review`, not auto-verified |
| Private PDF export/history/download | Implemented real renderer + real saved metadata, not simulated PDF bytes | Fresh hosted SQL checks metadata/historical text; native PDF/share acceptance is pending |
| Continue and explicit new generation | Implemented and tested; fresh hosted continuation/version preservation | Continue never generates; manual prose is not auto-merged into the next generation |
| Current mobile UI through editing/history | Tarun reports implemented and iPhone-tested at `eb4eaa8` | Not independently certified by this backend audit |
| Real STT, general AI conversation, TTS and streaming | **Planned** | No provider adapter, approved spending or new voice route enabled |
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

Fresh complete regression: 752 runtime-baseline backend checks and 56 isolated
database checks passed; four separately gated live pytest cases were skipped.
The handoff additionally adds three offline snapshot/exporter checks. The final combined
result and fresh hosted rollback-only results are recorded in the
[verification report](mobile-integration-tests.md).

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
