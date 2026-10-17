# My Story Projects - development web preview

This is a read-only page for Charan's FastAPI 0.2.0 contract. It has a separate
HTML entry and Vite configuration. The legacy `App`, auth provider, generated
Supabase client, dashboard, AI logic and production environment files are unchanged.
This is not an Expo application.

The preview uses only `https://edbkuunyeyxnyenmmqud.supabase.co` and a local
FastAPI origin. No hosted backend URL is approved in this task. Authentication is
kept in memory with its own SDK client, without legacy localStorage sessions or
general OAuth URL sign-ins. Only development password-recovery callbacks are
processed by the SDK; recovery sessions cannot supply story-project tokens.
Reloading the page requires sign-in again. A JWT issuer/role
check prevents forwarding an old-project token; it does not verify a signature.
FastAPI still performs actual Supabase Auth validation and ownership checks.

## Safe manual verification on Windows

These steps have NOT been executed against Supabase or FastAPI by this change.
Use development test accounts and existing synthetic development projects only.
Do not copy the legacy repository's root `.env` or use a production account.

1. Open PowerShell in the NEW worktree, not the existing security branch:

   ```powershell
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-web-story-projects'
   git branch --show-current
   ```

   Expected branch: `feat/web-story-project-list`.

2. Create only the preview's local settings, then open that file in your editor:

   ```powershell
   if (Test-Path '.\development\story-projects\.env.local') {
     Write-Host 'Settings already exist. Inspect them without overwriting.'
   } else {
     Copy-Item '.\development\story-projects\.env.example' '.\development\story-projects\.env.local'
   }
   ```

   If `.env.local` already exists, inspect it instead of overwriting it. Keep the
   example's development Supabase URL and local backend URL. Fill
   `VITE_STORY_PROJECTS_SUPABASE_PUBLISHABLE_KEY` using the `sb_publishable_...`
   key from project **edbkuunyeyxnyenmmqud**. The file is Git-ignored. Do not put
   a service-role key, secret key, password or access token in it.

3. Have Charan confirm the running local backend's effective configuration is
   the SAME development Supabase project. It needs explicit `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY`; old root `VITE_SUPABASE_*` settings and process
   environment variables must not override them. The preview does not change
   or verify the backend configuration. Use only the approved, already prepared
   backend on `http://127.0.0.1:8000`. Do not start or install backend services
   merely to complete these instructions without that confirmation.
   If the backend runs only on Charan's computer, stop here: your PC's loopback
   cannot reach it. This preview needs a backend prepared on your own PC. A
   shared hosted development URL would require separate approval/configuration.

4. With dependencies already available, start only the preview:

   ```powershell
   node .\node_modules\vite\bin\vite.js --config .\vite.story-projects.config.ts --mode story-projects
   ```

   Open `http://127.0.0.1:5173/story-projects.html`. The server binds only to
   loopback and refuses to change ports if 5173 is busy. The separate config
   does not load the root `.env`, Lovable/MCP plugin, or legacy application auth.
   Do not use the usual `npm run dev` command for this preview.

5. Sign in with an approved DEVELOPMENT test account. Check the loading state,
   then titles, Swedish/English language labels and statuses. If no projects
   exist, expect "You have no story projects yet." Ask Charan to supply existing
   synthetic fixtures if needed; this page cannot create them. In browser Network
   tools, confirm the project request is GET `/api/v1/story-projects` at the local
   backend, with one `/api/v1` prefix. Authentication itself uses Supabase Auth
   sign-in/refresh/sign-out requests; these are not story-project writes.
   Never copy token/header values into chat, screenshots or a Git commit.

6. Refresh the list, sign out and confirm titles disappear, then reload and
   confirm sign-in is required again. Browser Network tools' Offline mode can
   safely demonstrate the network-error message; restore Online and retry.
   Real expired-token/401 behavior still needs separate manual confirmation.
   Stop the preview with Ctrl+C in its own PowerShell window.

Only record pass/fail outcomes and non-sensitive messages. Report the account's
Supabase project reference and backend origin, not email/password/token values.

## Password recovery: manual verification

Recovery is part of this development preview only. The installed Supabase Auth
SDK (2.95.3) processes standard implicit recovery redirects and validates their
user with the approved development Auth service. The form requires its
`PASSWORD_RECOVERY` event plus a valid development user session. An untrusted
`type=recovery` URL value alone cannot open the form. Auth event callbacks are
synchronous; password updates and local sign-out happen outside those callbacks.

The exact development password minimum and required character groups have not
been supplied. The form checks presence and matching confirmation. Supabase
enforces the project's actual length, character and other password policies on
`updateUser`; a rejected password shows safe guidance and never a success message.
No guessed client-side policy or new Supabase configuration is introduced.

1. In PowerShell, use this feature worktree and the existing development settings:

   ```powershell
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-web-story-projects'
   node .\node_modules\vite\bin\vite.js --config .\vite.story-projects.config.ts --mode story-projects
   ```

   If the preview is already running with this configuration, keep that server.
   Do not start a second server or change ports. Password recovery itself does
   not need FastAPI. Do not start a backend or change settings merely to reset
   this development test password.

2. After the preview is running, ask Charan to send a FRESH recovery email for a
   synthetic DEVELOPMENT test account in project `edbkuunyeyxnyenmmqud`, with:

   `http://127.0.0.1:5173/story-projects.html`

   Open the newest email action link once in your browser on this Windows PC.
   Use `127.0.0.1`, not `localhost`, and never paste the email action link or the
   callback URL containing credentials into chat. No email is sent by this page.

3. Expect "Checking your recovery link…", then "Choose a new password" with
   labelled New Password and Confirm Password fields. Keyboard focus goes to
   New Password. Normal login and project controls must be absent. Auth URL
   parameters should disappear from the address bar after SDK initialization.
   Browser Network tools may show development `/auth/v1/user` validation, but
   must show NO `/api/v1/story-projects` request during recovery. Inspect only
   method/path; do not share headers, payloads, full callback URLs or screenshots
   that contain credentials.

4. Enter two different values. Expect a focused, announced mismatch error and
   no password update. Then enter a matching new password that follows Charan's
   development policy. Use only a disposable test password. A policy rejection
   must keep the recovery form open with safe guidance. Passwords are cleared
   after any attempted SDK update; re-enter them to retry. Tab through the form
   and confirm the labels, visible focus and error announcement are usable.

5. Submit matching acceptable values. The SDK sends only `{ password }` to
   `updateUser`, then signs out the temporary session with local scope. Expect
   "Your password was updated successfully. Sign in with your new password."
   and the normal sign-in form. No project request should occur until you sign
   in again. If local sign-out fails, expect a confirmed-update message and a
   "Reload to sign in" button; use it to discard the in-memory recovery session.

6. Sign in using the new development test password. Normal authentication should
   still work. Project loading additionally needs the already approved local
   FastAPI setup described above; if that backend is off, its network error is
   separate from a successful password reset.

7. A Supabase-rejected expired/used email link must show a helpful invalid-link
   message, without the new-password form or project requests. Ask Charan for
   another fresh email if needed; do not repeatedly reuse an old email action.
   A plain `http://127.0.0.1:5173/story-projects.html?type=recovery` must likewise
   show an invalid-link message, never a password form. Reloading the clean URL
   must require normal sign-in again. Stop your preview with Ctrl+C when done.

Only record pass/fail and non-sensitive messages. Real email delivery, one-time
email action validation, Auth redirect allowlisting, password-policy settings and
the full recovery flow STILL need this manual check. Mocked tests cannot prove
those deployment settings. Supabase decides whether credentials are valid; the
frontend cannot revoke a bearer access token before its server-enforced expiry.
Code-only PKCE redirects cannot be completed by this in-memory client without
the initiating browser's verifier; they fail safely with fresh-email guidance.
Use the standard Supabase recovery email action, not a copied PKCE callback.

## Contract and limits

- GET only; default first 50 projects, without adding pagination in this task.
- Plain array of `id`, `title`, nullable `description`, `language` (`en`/`sv`),
  string `status`, `created_at` and `updated_at`. Unexpected shapes fail safely.
- The minimal API client in `src/lib/api/story-projects.ts` has no React,
  browser storage, SDK or environment dependencies. A future mobile client can
  supply its own token provider and fetch implementation.
- `VITE_API_BASE_URL` accepts the local origin or an optional `/api/v1` suffix.
  The client always appends the API prefix exactly once. Redirects and cookies
  are disabled; requests are uncached and backend reads time out after 10 seconds.
- A 401 clears displayed projects and asks for sign-in, without substituting an
  API key or repeatedly retrying. Expired SDK sessions use SDK refresh.
- No project/session mutations, message endpoints, schemas, migrations,
  billing logic, deletion rules, backend code or package/dependency changes.
- Production builds are refused by the preview config. Its entry also requires
  Vite development mode `story-projects` before creating the Supabase client.

## Automated verification

From this worktree with existing dependencies:

```powershell
node .\node_modules\vitest\vitest.mjs run --config .\vitest.story-projects.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism --no-cache
```

The focused configuration does not load environment files or the application
Vite/MCP plugins. Tests mock Supabase Auth and fetch; network calls are blocked.
They cover tokens, legacy-project rejection, SDK refresh, URL construction,
success/empty/error/unexpected responses, read cancellation, sign-out, escaped
titles, labelled forms, loading announcements and error focus. Recovery tests
also exercise the ACTUAL installed SDK with synthetic Auth HTTP responses, plus
recovery events, password validation/update errors, session cleanup, URL/log
privacy, and blocking all project requests until a fresh password sign-in.
These are mocked SDK/handler checks, NOT live Supabase integration tests.
They also run the
existing scaffold smoke test, which is not substantial legacy-app coverage.

Mocked checks are not end-to-end verification. No live development backend,
Supabase authentication, token refresh, CORS or real RLS behavior has been verified
by those checks. Manual verification and your review/approval are still required
before committing or pushing this feature. Do not merge or deploy it yet.

## Recovery addition: verification and file list (2026-10-17)

Final verification: 132 tests passed in six test files (the existing 85 cases
plus 47 new cases), exit code 0, without failed tests or unhandled errors.
The focused strict TypeScript check (15 files), repository app TypeScript check
and scoped ESLint check all passed. Accessibility checks covered associated
labels, password input types/autocomplete, required fields, descriptive text,
error focus/announcements, loading states and disabled duplicate submissions.
Actual browser keyboard/screen-reader behavior still needs manual verification.

Self-review covered event ordering, synchronous auth callbacks, overlapping
sign-in/token reads, password updates, failed cleanup, URL/error privacy, the
development-project guard and regressions. Recovery also blocks stale project
results and stale sign-in errors. No known blocking code issue remains from
that review. This is self-review, not independent review.

Changed existing preview files in this addition:

- `src/development/story-projects/development.ts`
- `src/development/story-projects/MyStoryProjects.tsx`
- `src/development/story-projects/main.tsx`
- `src/development/story-projects/development.test.ts`
- `src/development/story-projects/MyStoryProjects.test.tsx`
- `src/development/story-projects/preview-config.test.ts`
- `story-projects.html`
- `docs/web-story-projects.md`

Created preview files:

- `src/development/story-projects/PasswordRecovery.tsx`
- `src/development/story-projects/recovery.ts`
- `src/development/story-projects/recovery.test.tsx`

Local Git-ignored verification artifacts are `recovery-test-results.local`
(machine-readable final test results) and `recovery-baseline.local` (file hashes
used to check preservation; no file contents). These are not application files.
The development `.env.local`, package files, FastAPI code, database files, MCP
function, existing API client, preview server config and other branches were
not changed. This work remains uncommitted and unpushed on
`feat/web-story-project-list`.

No services were started, real Supabase/backend requests made, recovery emails
sent or real passwords updated by these tests. The implementation is ready for
manual recovery testing and independent review, not end-to-end approval.
