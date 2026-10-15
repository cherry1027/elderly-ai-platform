# Day 1 repository audit — 15 October 2026

Baseline: `5e2cd3e` (`first commit`), clean `main` checkout. A read-only
`git ls-remote --heads origin` confirmed GitHub `main` has the same commit.
Origin: https://github.com/cherry1027/elderly-ai-platform.git.

## Existing implementation

- Vite 5 / React 18 / TypeScript web app, not React Native/Expo or Next.js.
- Supabase JS client and email/password authentication in
  `src/integrations/supabase/client.ts` and `src/contexts/AuthContext.tsx`.
- Swedish web routes, dashboard, book editing, recording, interviews, export,
  payments and admin pages. Existing code is not evidence these flows work.
- 19 SQL migrations and 12 TypeScript Edge Functions. Tables include `profiles`,
  `books`, `pages`, `stories`, `interview_turns`, settings and payment/admin data.
- Ownership-based RLS is defined for profiles, books, pages and interview turns.
- Private audio/PDF storage and public image storage are defined in migrations.
- npm and two Bun lockfiles coexist; use npm's existing lockfile for this audit.
- The only existing automated frontend test asserts `true` equals `true`.
- README is the default Lovable template. No Python backend or `/health` route
  existed at baseline. No repository AGENTS.md or CI workflow was found.

## Relevant gaps and decisions

- Add `backend/` alongside the existing app; preserve existing frontend and SQL.
- Reuse `profiles`; do not duplicate or rename existing book tables casually.
- `story_projects`, `conversation_sessions`, persistent language selection and a
  shared Python API contract were absent at baseline.
- Preserve original transcript messages separately from confirmed memories and
  generated content. Audio retention and transcript visibility remain undecided.
- Existing frontend stores raw audio and limits free users to one active book.
  These behaviors need later product review against the new pilot scope.

## Existing issues to review before enabling the old pilot flows

- Nine Edge Functions have gateway JWT verification disabled. Some handlers
  validate users themselves; `openai-realtime-token`, `openai-tts` and
  `minna-interview` contain no caller authentication check in the inspected code.
  They can call paid services if deployed as shown. Deployment status is unverified.
- Existing `book-images` storage is public. Review privacy before real uploads.
- Root `.env` was already Git-tracked. Only its variable names were inspected:
  project ID, publishable key and Supabase URL. Publishable keys belong in clients,
  but server credentials must never be added to this tracked file. New backend
  environment files and the Python environment are ignored.

No existing Edge Functions, frontend product flows or historical migrations are
rewritten as part of the foundation.
