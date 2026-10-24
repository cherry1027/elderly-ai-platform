# Day 2 backend status

Status date: 17 October 2026. Backend version: 0.2.0.

## Implemented and locally verified

The backend now has six authenticated `/api/v1/story-projects` routes covering
project create/list/read/update and conversation-session create/list. Supabase
Auth `getUser` validates each incoming user access token. The same token and the
publishable key are forwarded to PostgREST, preserving ownership RLS; project
queries also filter explicitly by the verified user ID.

Typed request models enforce title, language, description and pagination bounds.
Only title and description are mutable. Session creation accepts an optional empty
body and inherits the owned project's language. Responses are typed, protected
responses are `no-store`, and auth, validation, not-found, conflict and dependency
failures use the documented nested error envelope without echoing private input.
No database migration was needed for Day 2.

Verified local evidence:

- 116 backend offline tests pass; the two opt-in integration modules are deselected.
- 13 embedded PostgreSQL schema/RLS tests pass.
- The live readiness integration check passes; the two-user workflow is skipped
  until explicit opt-in and valid user tokens are supplied.
- `python -m pip check` passes.
- The six route success paths, missing/foreign ownership behavior, exact token and
  publishable-key forwarding, pagination, validation and sanitized failures are
  covered with mock HTTP transport; no cloud call occurs in those tests.

## Live verification still pending

A real authenticated cloud flow has not run because two real Supabase test-user
access tokens are not yet available. A dashboard session or GitHub login is not a
substitute: each token must come from signing that user into the application
against project `edbkuunyeyxnyenmmqud` and reading the Supabase SDK session.

`backend/tests/test_day2_live.py` is opt-in through
`RUN_MEMY_DAY2_INTEGRATION=1`, `MEMY_TEST_USER_A_TOKEN` and
`MEMY_TEST_USER_B_TOKEN`. It is hard-gated to the dedicated development URL,
creates uniquely named projects owned by those users, verifies isolation and
sessions, and cleans only the projects it created. Project deletion cascades its
synthetic sessions. Do not use production accounts or paste tokens into Git,
documentation or chat.

The live public readiness test passed on 17 October after this chat's network
access was enabled. A real HTTP `GET /ready` also returned 200 with
`"database":"ok"`. Git staging now succeeds as well. These two environment
blockers are resolved. Readiness is still separate from authenticated workflow
verification; it must not be presented as proof that the two-user cloud test ran.

## Remaining handoff work

- Run the two-user opt-in cloud test with short-lived development-user tokens.
- Have Tarun verify sign-in, token refresh, all six routes and errors from Expo.
- Choose and deploy a shared backend URL; current URLs are developer-local only.
- Adapt the legacy UI before reuse: it assumes a single current draft, while the
  backend now exposes explicit multi-project and multi-session resources.

## Local commits

- `5841875` — authenticated project/session APIs and focused tests.
- `6a0cab6` — multi-project and source-transcript isolation tests.
- Documentation is saved in the commit containing this status file.

These changes are committed locally; a GitHub push is not part of this Day 2 run
and has not been performed.

Day 2 did not add speech-to-text, audio upload/retention, AI conversation,
extracted facts/memories, story generation, payments or subscriptions.

## Follow-up acceptance on 18 October 2026

The previously outstanding two-user HTTP test passed against dedicated
development project `edbkuunyeyxnyenmmqud` using two real, disposable anonymous
Supabase Auth users. It verified create/list/read/update, inherited session
language and cross-user access denial through FastAPI and hosted PostgREST/RLS.
The test created no permanent email/password accounts. Anonymous sign-in was
restored to disabled and the exact two users and their synthetic data removed.
See [Day 3 status](day-3-status.md) for the separate audio tests and limits.
