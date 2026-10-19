# Day 4 backend status

Updated 19 October 2026. Backend version 0.4.0 implements the simulated text
conversation and memory-review workflow. External AI and live transcription remain
disabled; no model key, paid API call or new service was introduced.

## Implemented

- Existing immutable conversation messages are reused through an invoker-security
  history view, preserving sequence, session language and source timestamps.
- Five authenticated endpoints submit text or an existing user source, list
  messages/memories/open questions and confirm, reject or correct candidates.
- A disabled/mock provider interface supports conservative deterministic Swedish
  and English examples. Literal evidence is retained for every candidate, including
  the required 1974/1975 correction, no invented relatives and unchanged emotional
  intensity examples. Unsupported phrasing can produce no extracted facts.
- PostgreSQL atomically saves turns, facts and clarifications. Content-bound
  idempotency and unique source processing prevent duplicate work after retries.
  Message sequence and project-wide fact-version checks reject stale context.
- Source/value fields are immutable. Review writes preserve original evidence,
  store corrections separately, append audit revisions and use optimistic versions.
  Ownership RLS and narrowly granted RPCs protect private records.
- [Tarun's API handoff](conversation-api.md) includes routes, request/response
  examples, feature configuration, review cards, language and error handling.

## Verification

- 330 Python tests pass; four opt-in live integration tests are skipped. These
  include 35 provider accuracy tests, 64 conversation API cases and the existing
  Day 1–3 regressions. The existing Starlette/httpx deprecation warning remains.
- 30 embedded PostgreSQL tests pass across the full migration chain, including
  eight Day 4 persistence/privacy subtests and the hosted test script replayed
  locally. `pip check` passes.
- Migration `20261019010000_day4_conversation_memory` was applied transactionally
  to dedicated development project `edbkuunyeyxnyenmmqud`. Migration history now
  contains 23 versions; no legacy/production project was changed.
- `supabase/tests/cloud-conversation.sql` passes on the hosted development
  database: atomic turns, replay/source uniqueness, stale-context denial,
  1974/1975 correction with immutable originals, versioned review, Swedish
  persistence, cross-user reads/RPC denial and anonymous denial. All synthetic
  Auth/project/session/message/fact rows were rolled back.
- Postflight counts match the original development data: one Auth user, two
  projects, no sessions/messages, three settings rows including the two existing
  orphans. New memory/clarification/turn tables remain empty. Anonymous append
  execution is denied; authenticated execution is enabled under ownership checks.
- The local Uvicorn process runs with explicit mock mode at
  `http://127.0.0.1:8000`; `/health` and `/ready` return 200. OpenAPI reports version
  0.4.0 and Bearer security on all five new operations.

Hosted SQL tests use transaction-local JWT subjects and PostgreSQL roles. They do
not issue a real Supabase login token or verify Tarun's browser/Expo integration.
The HTTP regression suite uses isolated Auth/PostgREST mocks. The remaining
frontend acceptance below must use an authenticated development account.

The work is committed on `backend/day-4-mock-conversation`; it has not been pushed
or merged. The local server uses a process-level flag, so future starts must set
`CONVERSATION_MODE=mock` explicitly; the checked-in default stays disabled.

## Frontend acceptance

Tarun should test an authenticated fictional story in the development project:
submit a memory, view the simulated reply and history, inspect pending candidates,
resolve a question and continue the conversation. Display `corrected_value` when
present and visibly identify the assistant as a simulation.

No production deployment, GitHub merge, guest-mode change, email configuration
change or paid AI integration is included. Real-model quality and pilot privacy
evaluation require a later approved implementation.
