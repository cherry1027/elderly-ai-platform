# Day 14 — mobile integration and pilot rehearsal

23 October 2026 · development only · FastAPI 0.8.1.

**Backend-side rehearsal, read-only hosted checks and handoff are delivered.
Full Day 14 acceptance is pending: Tarun will run the actual iPhone checklist
later. No pilot, production, privacy or live-model-quality approval is implied.**

## Reviewed pair

- Backend review branch: `codex/day-7-mobile-integration`; application-code
  baseline `c67687ec4b392dbf0e4f73fc8451ac6f0da05560`.
- Expo: `feat/mobile-autobiography-continuation` at
  `1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e`, including PDF revision `07c5c198`.
- Later evidence/documentation commits do not change this application baseline.
  Record both actual checkout SHAs before testing; branches can advance.
- No mobile UI replacement, merge into `main`, deployment, migration, email,
  paid call or hosted user/data mutation was performed.

## Eight duties — evidence, not an inflated completion count

| Duty | Delivered now | Still pending |
| --- | --- | --- |
| Real iPhone API integration | Latest native source-to-contract review; current Windows/private-network setup and content-free acceptance checklist. | Actual login, create, dashboard and session observations on Tarun's iPhone. |
| Native audio/conversation | Offline real AAC/M4A encoding and decoding through the upload route, labelled simulation, source processing and recovery after a lost completion response. | Real iPhone recording, microphone lifecycle and upload over the approved transport. |
| Memory review | EN/SV pending/confirm/correct/reject, immutable original and version/retry regressions. | Native review UI and persisted reread on device. |
| Autobiography/PDF | Explicit generation, editing/history, old revision PDF bytes and Continue/new-version preservation rehearsed. | Actual PDF opening/share, Swedish glyphs and full native journey. |
| Fresh hosted security | Real HTTPS readiness and missing/invalid-token rejection; read-only SQL checks over existing development rows. | Two issued real-user JWTs, owner writes and two-way cross-user denial through hosted APIs. |
| Legacy Edge exposure | Fresh development Functions page shows no functions listed; database helper and bucket metadata recorded separately. | Independent deployment inventory if dashboard state is uncertain; old project/legacy remediation and privacy gates. No function was invoked or changed. |
| Reliability/accessibility | Full regressions; loss/replay/stale-revision tests; CORS now exposes `Retry-After` to allowed browser origins. | Mobile explicit rate/backoff integration, VoiceOver/large text and physical interruption behavior. |
| Document/push | This report, reproducible offline checks, scoped SQL fixtures, mobile source audit and Tarun checklist on the existing review branch. | Incorporate actual device and valid-two-user results without turning self-reports into independent certification. |

## Automated verification

- **1,231 Python tests passed, 4 skipped** (26.16 seconds, final rerun); one existing
  Starlette/httpx deprecation warning. The four opt-in live cases are not passes.
- **86 isolated PostgreSQL tests passed** (12.32 seconds), including 13 new
  Day 14 checks. PGlite replays migrations and tests SQL behavior, not hosted Auth.
- Offline `verify_day14.py`: **142 named assertions passed** across EN/SV.
  Uses explicit Auth/Data API doubles, real routes/validators, a locally encoded
  silent M4A, fixed simulated providers and the actual PDF renderer. It is not
  recorded speech, a database/RLS emulator, a cloud test or a phone test.
- Evidence validator: 62 focused tests pass. Default remains `PENDING`, with
  12 pending cases and three unconfirmed attestations. Exit 0 means valid input,
  not device acceptance; even completed input is only `SELF_REPORTED_COMPLETE`.
- OpenAPI snapshot check and `pip check` pass. API remains 25 operations,
  23 private, version 0.8.1, with unchanged success payloads. Dependency
  consistency does not establish absence of CVEs.

```sh
cd backend
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
.venv/bin/python scripts/export_openapi.py --check
.venv/bin/python scripts/verify_day14.py
.venv/bin/python scripts/validate_day14_evidence.py
# From repository root:
npm --prefix supabase/tests test
```

## Fresh hosted evidence — read-only scope

Only `memy-ai-dev` (`edbkuunyeyxnyenmmqud`) was checked. The safe diagnostic
returned project match, publishable-key fingerprint `7dbc1add8497`, HEAD 200 and
`result=OK`. In-process FastAPI using real Supabase HTTPS returned `/health` 200,
`/ready` 200, missing token 401 and invalid dummy token 401. No valid issued-user
or actually expired issued token was used in this fresh probe.

The exact [read-only SQL batch](../supabase/tests/cloud-day14-readonly-security.sql)
ran successfully in development: 16 RLS tables, three invoker views, 19 guarded
core definer RPCs. Anonymous, empty-identity and collision-checked nonexistent
SQL identities exposed no private rows; missing-identity core RPCs rejected
before writes. Existing aggregate data included two projects/two sessions, six
sources/six memories and one draft/edit/export. No IDs or story contents were
returned. See the [sanitized result](fixtures/day14-hosted-readonly-result.json).

This is **SQL-role evidence, not JWT authentication or two real users**. The
user's latest instruction was not to enable anonymous sign-in. It remained off;
zero temporary users were created, no cleanup was needed and no stored rows or
Auth settings changed. The broader rollback-only synthetic workflow is prepared
and passes locally, but **was not executed hosted**. Do not run it automatically
as a substitute for the declined test-account setup.

### Findings that remain release gates

- Hosted bucket metadata contains three legacy buckets, including one public
  image bucket; the audio/PDF buckets are private. Objects, public URLs and
  backup retention were not inspected. This is not a storage privacy pass.
- Of 23 public database definer functions, four legacy helpers remain executable
  by `anon`: `handle_new_user`, `handle_new_user_settings`, `has_role`,
  `rls_auto_enable`. Three are trigger/event-trigger functions. Only catalog
  metadata was read; they were not invoked or changed. Their presence does not
  mean four deployed Edge Functions or prove exploitation. Separate review is
  needed before release; the 19 core RPCs passed their restricted grant checks.
- The development Functions page again showed “Deploy your first Edge Function”
  with no entries. A platform incident banner was visible, so this dashboard
  observation is not an independent management-API inventory guarantee.
  Legacy repository function source remains unsafe to bulk-deploy; do not use
  old-project configuration. Follow the [Day 13 remediation gates](day-13-deployment-readiness.md).
- Actual public live-AI persistence remains unreleased. Fixed simulations do not
  measure English/Swedish transcription quality, regardless of funding approval.

## Immediate next step with Tarun

Use the [12-case iPhone rehearsal](day-14-tarun-rehearsal.md) and
[latest source review](day-14-mobile-code-review.md). His transport currently
does not read `Retry-After` or recognize `RATE_LIMITED` / `API_BUSY`; generic
errors fail safely but do not implement explicit backoff. Preserve his UI and
keys/reconciliation rules while adding that frontend-owned handling.

Run on the agreed trusted personal hotspot/private network, with authorized
fictional accounts/data only. Do not enable anonymous Auth, create accounts,
erase data, change policies, expose a tunnel or call a paid model to clear a
pending label. Two existing authorized disposable accounts can be used later
with separately approved write/cleanup scope. Pilot privacy/retention and
actual-device release gates remain open.
