# Memy mobile web pilot

This source exports the existing Expo mobile interface as a static HTTPS browser app. It does not publish a server, activate AI, alter Supabase, or replace the native app. The static app calls the reviewed FastAPI HTTPS service directly. No Python development proxy is exposed publicly.

The hosted browser pilot uses the dedicated Free project `mrfzmlckmvgxweiiugmr`. The native app, native registration and development/staging client configuration continue to use the original `edbkuunyeyxnyenmmqud` project. Existing accounts and stories in the original project are preserved and are not automatically copied into the browser pilot. Use only the new project’s publishable key in its web build.

When deploying this switch, update the backend’s private project configuration and the static host’s generated CSP together. The hosted web/API origins stay the same. A CSP that still permits only the original Supabase origin will block browser login. Verify the new project’s schema, RLS and individual accounts before sending pilot links.

## Build and origins

In `apps/mobile`, run `npm ci --ignore-scripts --legacy-peer-deps` using Node 22.13 or a supported version. Then run `node scripts/export-web-staging.cjs` with exactly these client-safe settings in the build environment:

```
MEMY_WEB_ORIGIN=https://<approved-static-host>
MEMY_API_ORIGIN=https://<approved-fastapi-host>
MEMY_SUPABASE_URL=https://mrfzmlckmvgxweiiugmr.supabase.co
MEMY_SUPABASE_PUBLISHABLE_KEY=<this-projects-publishable-key>
```

Alternatively, put these four JSON fields in the ignored `apps/mobile/staging.web.client.local.json`: `webOrigin`, `apiOrigin`, `supabaseUrl`, `publishableKey`. Do not use both input methods. This file contains client-safe settings only. Backend keys, provider keys, database passwords, approval files and ledgers never belong here. The build disables dotenv and Expo public-variable loading, rejects inherited `EXPO_PUBLIC_*` values and passes only a small process-environment allowlist to Metro.

The export is `apps/mobile/.verification/web-staging`. Host settings and a Render Static Site blueprint are generated alongside it in `.verification/web-staging-host`. The blueprint has automatic deployment disabled. The generated headers must be configured on the static host; merely uploading the static directory does not apply Render headers. Public API and web hosts are intentionally not invented in source.

The backend must allow exactly the chosen frontend HTTPS origin in CORS, expose the existing recovery/operation headers, and allow the reviewed API hostname. SSE, authenticated uploads and PDF/audio downloads go directly to that API. Test every preflight after hosting. The runtime refuses a different window origin, HTTP, private/local hosts, an unapproved Supabase project or a different API origin. Deployment previews at other hostnames are intentionally inactive until reviewed and rebuilt.

## Individual accounts and password setup

Allowlist exactly `https://<approved-static-host>/auth/callback` in development Supabase before sending an invitation or recovery email. Preserve existing approved web/native callbacks. Use the current implicit invite/recovery email links. Code-only PKCE callbacks are rejected by this web route; the native flow is unchanged. Configure `/auth/callback` and other Expo routes to rewrite to `/index.html` without redirecting or dropping the URL fragment.

The callback immediately removes tokens from history, accepts only bounded invite/recovery links for the approved origin and project, validates the bearer credential with Supabase, and then lets the recipient choose their own password. It does not automatically sign in or trigger any paid operation. Tokens and password fields remain in RAM only, are cleared on departure/backgrounding, and expire after five minutes. An explicit password save is followed by local-session revocation and a return to normal sign-in. No account password should be sent in chat.

Supabase default SMTP may send only to organisation-team addresses and has a two-emails/hour limit. Do not add pilot testers to the Dashboard organisation as an email workaround. Before sending to external testers, use a separately approved transactional SMTP setup or securely deliver operator-generated invite/recovery links privately. Both use the same implicit callback; neither requires sharing a password.

Self-service registration remains disabled. Create only the seven approved development/pilot accounts using the operator procedure. Send each person their own password-setup link after actual-device verification. Never distribute the OpenAI key or Supabase server credential to testers.

## Browser capabilities and limitations

- Typed chat uses the same real-v2 contracts and spending controls as native; partial reply streaming does not automatically retry paid requests.
- Microphone capture uses MediaRecorder on an approved secure origin, up to 60 seconds, and sends audio only after explicit consent/save. Browser permission is required. A RAM ownership registry prevents arbitrary file/blob uploads through the recording path. Backgrounding stops capture and revokes unsubmitted audio.
- Listen uses the existing authenticated WAV download and explicit browser playback. Audio is held in revocable Blob URLs only. Backgrounding/sign-out cleans up playback.
- PDF export downloads a validated PDF through an explicit action. A native share sheet is browser-dependent and is not certified by a JavaScript export.
- Login is RAM-only. Refresh/reload requires signing in again; saved backend stories remain intact. There is no persistent browser token storage or offline cache/service worker.
- Browser microphone, password links, audio gesture handling, background/resume, PDF download and add-to-home-screen require actual iPhone Safari and Android Chrome acceptance. Automated tests and a web export do not certify them.

## Seven-user release gate

Keep AI off until the backend's authoritative ledger, Tarun's preserved hold/reconciliation, per-user allowances, global budget and approval window have been reviewed. Verify independent accounts and two-user isolation on the hosted configuration. Then complete the entire English/Swedish journey on real phones, including interruption/recovery and sign-out/sign-in. Record device/browser/version, exact mobile/backend revisions and sanitized pass/fail results before sharing the pilot link. Public deployment and hosted Auth changes require the separately approved operator step.
