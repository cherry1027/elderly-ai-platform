# Beautiful Memory Book — isolated development preview

This is the historical Task 2 guide. For the main-application entrance in this
integration branch, use [web-entry-integration.md](web-entry-integration.md),
its port 5176 command, and its current verification record. The Task 2 worktree
is unchanged. The shared component improvements below apply in this branch.

This preview lives on `feat/web-animated-onboarding`, based on the approved
`5b5bc88a2b11de72aad2fa0815a7ea050aea1304` foundation. It does not include or
modify the separately committed Story Projects/password-recovery feature.

## Start in Windows PowerShell

The existing dependencies have been copied into this worktree's ignored
`node_modules`. No package was installed and no dependency/lockfile was changed.
From this exact directory:

```powershell
Set-Location "C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-web-animated-onboarding"
node .\node_modules\vite\bin\vite.js --config vite.onboarding.config.ts --mode onboarding
```

Open **http://127.0.0.1:5175/onboarding-review.html** in Chrome. Keep PowerShell
open. Stop this preview with **Ctrl+C**. Do not use `npm run dev`: that starts
the existing Lovable application configuration instead. Do not start a backend,
Supabase, or Docker. If port 5175 is occupied, Vite stops instead of choosing a
different port. Stop only a preview you recognize; do not stop another project.

The onboarding configuration serves only the review entry and its assets. It
binds to loopback, rejects other Host headers, loads no root environment files,
uses no Lovable/MCP plugin or root PostCSS configuration, and disallows builds.
No environment variables or keys are needed. Adding an `.env` file in
`src/development/onboarding` causes startup to fail securely.

The response Content Security Policy blocks fetch/socket connections, frames,
forms, and remote assets. Permissions Policy disables microphone/camera. Vite's
injected hot-reload client is removed and CSS is linked directly; reload the
browser after source edits. Normal local requests for HTML, CSS, React, and
modules are required to display the preview. There are no API, AI, auth, or
recording requests.

## What this implements

Three original layered SVG scenes share one memory book. The cover opens and
pages fan out; generic memory symbols settle. A speech ribbon, voice waveform,
keyboard, and ink lines illustrate voice and text. An illustrated **Create My
Story** choice precedes the organized draft and editing pencil. No personal
facts, transcript, recording, or real story are generated. Every animation is
finite, approximately one second. Text is available immediately and navigation
does not wait for the illustration. Nothing advances automatically.

English and Swedish copy are selected explicitly. The welcome screen's Log in,
Create Account, and Continue as Guest controls are disabled and clearly labelled
as unavailable preview destinations. Replay Introduction remains available.
There is no connection to the legacy guest or authentication routes.

Only `memy.onboarding.v1 = complete` is saved, on Skip or Enter Memy. Replay does
not clear completion. Storage failures do not prevent entry to the welcome
screen; a notice explains that completion could not be saved. No language,
motion, user, memory, or authentication information is stored. Completion is
local to the browser profile **and origin** (scheme/host/port), not an account
or device-wide synchronized setting. Clearing site data resets it. Concurrent
open tabs are not synchronized until reload.

The review path and application entrance paths `/` and `/index.html` can run the
introduction. Ordinary marketing queries and section anchors no longer trigger
the callback exemption. Authentication marker names, recognized authentication
`type` values and other paths remain exempt. Callback
views do not read/write completion or process, display, remove, redirect, or log
credentials. They explain that the original authentication flow must be used.
History/fragment changes also exempt the mounted preview. This is an isolated
guard, not a new authentication handler or integration with application routing.
Do not point real authentication emails at this preview. Story Projects and
existing recovery URLs remain unchanged on their own worktree/server.

## Manual graphical review — pending user verification

Use the bare review URL, without query parameters or fragments. To see a first
visit without changing your regular browser storage, use a new Chrome Incognito
window. Incognito storage usually lasts only for that Incognito session.

1. On the first scene, watch the cover turn, pages fan, and house/path/leaves
   settle. Essential text should be visible immediately.
2. Select Next. Watch voice waves travel into written lines. Both the microphone
   illustration and keyboard should be visible; no permission prompt should open.
3. Select Next. Watch the graphical Create My Story action, then draft paragraphs
   and pencil. The source-memory leaf remains represented. This generates nothing.
4. Use Back/Next while art moves. Double/triple-click Next: it must not exit into
   welcome. Enter Memy is a distinct final action. There is no automatic timer.
5. Change English/Svenska on every scene. Text and illustration labels change;
   your scene stays selected. Test the longer Swedish labels on a narrow screen.
6. Select Enter Memy. Only the welcome preview appears; account/guest controls
   remain unavailable. Reload: the same origin should return to welcome.
7. Select Replay Introduction. Replay works even with completion saved. Select
   Skip from the first or second scene; reload again to confirm welcome.
8. Switch Animations off. All three illustrations must remain complete and
   readable. Switch motion back on. In Chrome DevTools Rendering, emulate
   `prefers-reduced-motion: reduce`: all decoration should be still, and the OS
   preference cannot be overridden by this preview's button.
9. Use Tab/Shift+Tab, Enter, and Space. Controls must have visible focus. Language
   selection retains focus; the animation switch exposes its checked state. Scene
   changes move focus to their heading. With a screen reader, check the polite
   progress announcement and localized text. SVG decoration should not be read.
10. Test desktop, tablet, 375px, and 320px widths, plus browser zoom. No horizontal
    scrolling, clipped controls, overlapping text, or inaccessible navigation.
11. In Chrome Network, verify requests are local preview assets only, with no
    Supabase/FastAPI/AI requests or sockets. Check Console for unexpected errors.

Do not use real tokens for callback checks. A synthetic URL such as
`http://127.0.0.1:5175/onboarding-review.html?type=recovery` must show the inert
callback message, without changing its URL or the completion flag. Return to the
bare preview URL manually afterward.

These are instructions, not claimed manual results. Unit tests cannot establish
animation quality, actual layout, assistive-technology behavior, or real keyboard
navigation in Chrome. User graphical verification and independent review remain
required before commit approval.

## Safe automated checks

```powershell
node .\node_modules\vitest\vitest.mjs run --config vitest.onboarding.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism
$onboardingSources = @(Get-ChildItem .\src\features\onboarding, .\src\development\onboarding -Recurse -File | Where-Object Extension -in '.ts', '.tsx' | Select-Object -ExpandProperty FullName)
node .\node_modules\typescript\bin\tsc --noEmit --strict --skipLibCheck --target ES2020 --lib ES2020,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --jsx react-jsx --types vitest/globals,node @onboardingSources vite.onboarding.config.ts vitest.onboarding.config.ts
node .\node_modules\eslint\bin\eslint.js src/features/onboarding src/development/onboarding vite.onboarding.config.ts vitest.onboarding.config.ts --max-warnings 0
```

The test setup blocks fetch, XHR, WebSocket, EventSource, sendBeacon, and
getUserMedia and asserts they were never invoked. Tests use synthetic URLs and
browser-local mock data. They exercise the actual React component and storage
helper, plus the real preview configuration and its middleware with mocks.
Configuration tests are not a real browser or deployed-server security audit.
Only the pre-existing trivial example test is present on this base; the separately
committed Story Projects tests are not merged or run from another worktree.

## Boundaries and remaining review

No backend, schemas, auth, guest logic, legacy routes, or database onboarding
field is changed. No dependencies are added. Motion uses React state, original
inline SVG, scoped CSS transforms/opacity, and system/Georgia fonts. No remote
font or animation service is needed. The warm palette follows the existing
Lovable design tokens; existing app components that depend on global Tailwind
and remote fonts are deliberately not imported into this standalone preview.

This preview does not implement actual welcome routing. Future integration must
preserve callback priority and explicitly approve authentication/guest behavior.
The separate Story Projects findings (auth/token timeout and failed sign-out
escape) and Charan's real two-user cloud authorization test remain separate,
pending work. This frontend illustration provides no production-readiness or
cross-user authorization evidence.

Suggested commit message after manual and independent review:
`feat: add isolated animated memory book onboarding preview`

## Verification record — 18 October 2026

- Final retest after the CSS margin correction: **95 passed, 0 failed**, four
  test files, exit 0. Breakdown: 28 React interaction/security tests, 40 storage
  and callback cases, 26 configuration checks, and one existing example test.
- Strict TypeScript for all onboarding TypeScript/TSX and both new configurations:
  passed, exit 0. Scoped ESLint with zero warnings: passed, exit 0.
- A broader application TypeScript repeat was interrupted after a prolonged
  wait; it is not used as verification evidence. Existing tracked source remains
  unchanged. The separate Story Projects tests were not rerun or merged.
- CSS parsed successfully and every ordinary selector is scoped. Calculated
  contrast: body 12.07:1; secondary copy 5.45:1; explanatory copy 6.37:1; primary
  button 7.55:1; eyebrow 5.23:1; focus outline 6.30:1. These exceed 4.5:1 for the
  tested pairs; they are not a complete rendered accessibility audit.
- Self-review corrected dependency-cache routing, removed Vite's injected
  socket client, placed draft animation after the illustrated creation action,
  and removed a potentially overflowing horizontal art margin. The first
  configuration-test attempt failed on a Node/JSDOM TextEncoder realm mismatch;
  the configuration suite now runs in Node, and final retesting passed.
- Only the isolated Vite preview was started; Vite 5.4.21 reported ready on
  loopback. Chrome automation was unavailable. The in-app browser timed out and
  a shell loopback request failed, so no graphical or HTTP integration pass is
  claimed. The temporary server was stopped. Start it from normal Windows
  PowerShell for manual Chrome review using the command above.
- **User manual graphical review and independent review are pending.**
  No production services, Supabase, AI, microphone, Docker, or email were used.
  Nothing was staged, committed, pushed, merged, or deployed.

## Exact feature file list

All 14 files are additions. No existing tracked file is modified.

```text
docs/web-onboarding.md
onboarding-review.html
src/development/onboarding/main.tsx
src/features/onboarding/MemoryBookScene.tsx
src/features/onboarding/OnboardingExperience.test.tsx
src/features/onboarding/OnboardingExperience.tsx
src/features/onboarding/copy.ts
src/features/onboarding/onboarding-state.test.ts
src/features/onboarding/onboarding-state.ts
src/features/onboarding/onboarding.css
src/features/onboarding/preview-config.test.ts
src/features/onboarding/test-setup.ts
vite.onboarding.config.ts
vitest.onboarding.config.ts
```
