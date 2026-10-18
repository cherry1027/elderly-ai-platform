# Memy Web Task 3A — application entrance

Worktree: `memy-web-entry-integration`; branch: `feat/web-entry-integration`.
Base: `49335f6b9c77f236dbccae61b6a537339a182286`.

The application's actual `src/main.tsx` now selects the entrance before loading
the legacy application. `/` and `/index.html` show the approved memory-book
introduction, then Welcome to Memy. Existing paths and authentication callbacks
continue to the unchanged legacy application. No router, authentication, guest,
backend, schema, or dependency implementation is changed.

The Story Projects/password-recovery feature remains in its separate worktree.
It is not copied, merged, or required for this entrance. Its existing preview
and callback URL on port 5173 remain separate.

## Safe local preview

Run only these commands in Windows PowerShell:

```powershell
Set-Location "C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-web-entry-integration"
node .\node_modules\vite\bin\vite.js --config vite.entry.config.ts --mode entry
```

Open **http://127.0.0.1:5176/** in Chrome. Keep PowerShell open; stop only this
preview with Ctrl+C. Port 5176 is fixed: if occupied, startup fails rather than
using another project's port. Do not stop an unfamiliar process. No backend,
Docker, Supabase, environment file, sign-in, or website account is needed.
Do not use `npm run dev`, the original Vite configuration, or a production build
to review this change; those retain the original Lovable/MCP and service behavior.

The preview uses a minimal HTML shell with the **actual main bootstrap**, not
the standalone Task 2 demonstration. It resolves only the bootstrap's deferred
legacy application import to a local inert message. Other legacy modules and
service SDKs are blocked. The original App, authentication initialization, remote
fonts, and root environment files are not loaded. The resolver and request
allowlist are development-preview safeguards, not production authorization.

Only loopback is bound; Host headers are restricted. CSP blocks API/socket
connections, forms, frames and remote assets. Permissions Policy blocks devices.
Hot-reload injection is removed; manually reload after edits. Local HTML,
React, JavaScript and CSS requests are expected. The explicit JSX development
runtime dependency preserves the previously reviewed jsxDEV fix.
No Lovable/MCP plugin, root PostCSS configuration or backend service is executed.
The preview refuses builds and refuses environment files in its isolated env
directory. Ignored dependency/cache files stay local to this worktree.

## Entrance and callback behavior

- A first profile/origin visit shows three animated scenes. Next, Back, Skip,
  Enter Memy, English/Swedish and reduced motion remain available.
- Skip/Enter save only `memy.onboarding.v1 = complete`. Returning visits show
  Welcome; Replay Introduction preserves the completion flag. Storage failures
  show a notice and do not block Welcome. Origin includes the port; Task 2's
  completion on port 5175 does not automatically apply to 5176.
- Login, Create Account and Continue as Guest are truly disabled, with a clear
  availability note. They do not navigate or invoke legacy guest/AI flows.
- Normal queries such as `?utm_source=family&type=book` and section anchors
  such as `#about` do not suppress the introduction. Auth marker names, recognized
  auth `type` values, and every non-entrance path bypass it. This is route
  classification only; no URL parameter establishes an authenticated session.
- URLs, tokens and codes are never rewritten, removed, displayed, passed to
  component props or logged by the new entrance. Initial and late hash/history
  callbacks hand off to the preserved application boundary. In this preview that
  boundary is deliberately inert. The normal application retains its original
  service behavior on those paths; that behavior is outside this task.
- The language selector keeps focus when language changes. Scene/view changes
  focus their heading. The animation control is a stable-name switch with a
  checked state; the operating-system reduced-motion preference has priority.

## Manual review — not yet performed for Task 3A

1. Open the root URL in a fresh Chrome Incognito window. Check all three scenes,
   Next/Back, Skip and Enter. No microphone prompt or network API calls should
   occur. The design and finite animations are reused from Task 2.
2. Reload after Skip/Enter: Welcome appears. Replay works, and reload still
   returns to Welcome. All three destination buttons remain disabled.
3. Change language while the selector is focused. Focus stays there. Use Tab,
   Shift+Tab, Space and Enter; scene changes focus the new heading. Check the
   Animations switch with a screen reader and Chrome reduced-motion emulation.
4. Check 320px, 375px, tablet and desktop widths in Chrome's device toolbar,
   plus browser zoom. For a physical phone, loopback cannot reach your Windows
   server; use desktop emulation for this isolated review. Do not expose this
   server on the LAN or change its binding.
5. In a fresh Incognito session, open `http://127.0.0.1:5176/?utm_source=family`:
   the introduction appears. Then try `http://127.0.0.1:5176/?type=recovery` and
   `http://127.0.0.1:5176/aterstall-losenord`: only the inert bypass appears and
   the URL is unchanged. Use synthetic values only, never real recovery links.
6. For a late callback, open the root and append `#type=recovery` in the address
   bar. The preview hands off to the inert bypass. Return to `/` manually.
7. Check Console/Network for module errors, unexpected remote requests or
   sockets. CSP source-map/connect warnings alone do not justify relaxing CSP.
8. The separate Story Projects preview must be checked in its own approved
   worktree/server using its existing instructions. Its files and callback URL
   are unchanged. Those tests and live recovery are not claimed as rerun here.

These are manual instructions, not browser results executed by Codex. No real
authentication, cross-user isolation or production readiness is established.

## Automated checks

```powershell
node .\node_modules\vitest\vitest.mjs run --config vitest.entry.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism
node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.app.json
node .\node_modules\eslint\bin\eslint.js src/main.tsx src/entry src/development/entry src/features/onboarding vite.entry.config.ts vitest.entry.config.ts --max-warnings 0
```

Tests exercise the actual entrance, bootstrap and callback/storage behavior with
synthetic URLs, mocked legacy modules, and network/device guards. Configuration
tests exercise real middleware hooks with synthetic requests; they are not live
Supabase tests. A compiler/module-graph check can validate Vite transforms in
middleware mode without listening on a network port. See the task report for
actual results and their limits.

### Verification record — 18 October 2026

- Final focused retest: **227 passed, 0 failed**, six test files, exit 0.
  Breakdown: 38 onboarding interactions, 69 storage/callback cases, 30 bootstrap
  integration cases, 62 entry-preview configuration checks, 27 standalone
  onboarding configuration checks, and one existing example test.
- Application TypeScript (`tsconfig.app.json`, its existing compiler settings)
  passed. Strict TypeScript for shared onboarding and preview configurations
  passed. Scoped ESLint with zero warnings passed. Git diff whitespace check
  passed. No dependencies or package/lock files changed.
- Vite transformed nine entrance modules in middleware mode with **no listening
  HTTP server**. The actual bootstrap resolved its legacy import to the inert
  module; its graph contained no legacy App/authentication/Supabase modules.
  The optimized JSX development runtime exported a working `jsxDEV` function.
  The temporary compiler cache was removed. An initial probe asserted the wrong
  dot-property interop spelling; correcting that probe verified the real export
  without requiring a source change.
- Self-review fixed late callback handoff, callback-to-root loading races,
  animation-switch styling, and the special inherited-environment prefix guard.
  Final retesting passed. This is self-review, not independent review.
- **Task 3A Chrome/manual verification is pending.** No live authentication,
  Supabase, FastAPI, AI, microphone, Docker or email checks were performed.
  Story Projects/recovery remains separate and was not rerun from its worktree.
  Nothing was staged, committed, pushed, merged or deployed.

## Boundaries and pending work

Manual graphical/accessibility approval and independent review remain pending
for this integration. Existing auth/recovery deep links are preserved, not newly
validated against real services. Login, account creation and guest integration
require separate approval. Charan's two-user cloud authorization test and the
Story Projects auth-timeout/sign-out findings remain separate pending work.

This change controls document entrance. After the legacy application is loaded,
its existing BrowserRouter still owns subsequent internal navigation, including
navigation to its original `/` route. Replacing that internal route or connecting
the new welcome actions is outside this task.

The existing standalone Task 2 guide describes historical results. Shared
components in this branch now have the callback and accessibility improvements
described above. Original feature worktrees remain untouched.

Suggested commit message after approval:
`feat: integrate memory book onboarding at the web entrance`

## Exact Task 3A file list

Eight existing files modified:

```text
docs/web-onboarding.md
src/main.tsx
src/features/onboarding/OnboardingExperience.tsx
src/features/onboarding/OnboardingExperience.test.tsx
src/features/onboarding/copy.ts
src/features/onboarding/onboarding-state.ts
src/features/onboarding/onboarding-state.test.ts
src/features/onboarding/onboarding.css
```

Ten files added:

```text
docs/web-entry-integration.md
entry-review.html
src/entry/bootstrap.tsx
src/entry/bootstrap.test.tsx
src/entry/Entrance.tsx
src/entry/LegacyApplication.tsx
src/entry/preview-config.test.ts
src/development/entry/LegacyBypass.tsx
vite.entry.config.ts
vitest.entry.config.ts
```
