# Remote mobile-web pilot: four testers first, seven in total

Prepared 7 November 2026. This is an operator runbook and a non-executable
configuration worksheet. It does not create users, send invitations, purchase
hosting, deploy code, enable AI, make currency conversions or renew an approval.
The actual staging URL and hosted/phone acceptance remain pending until verified.

The first wave contains four approved testers. The remaining three may join
1-2 days later after their accounts and consent are verified. The source maximum
is seven people, not seven guaranteed simultaneous paid AI actions.

## 1. Resolve only the missing launch inputs

Collect these privately; do not add email addresses or real account IDs to Git,
review ZIPs or public documentation:

| Input | Required decision or evidence |
| --- | --- |
| First four accounts | Confirm the two existing developer app accounts and the two initial invited testers' email addresses. Verify each Supabase Auth account ID in the approved development project. |
| Later three accounts | Leave their slots and account IDs pending until each intended person/email is confirmed. Do not invent UUIDs or share an existing login. |
| Phones and languages | Record which actual iPhone/Safari and Android/Chrome devices will be tested, and who covers English and Swedish. |
| Public destinations | The assigned HTTPS app origin and separate HTTPS API origin, plus the exact reviewed browser confirmation/recovery callback URLs. |
| Account delivery | Confirm the actual hosted SMTP configuration and one safe way each person can set their own password. No operator-created/shared passwords. |
| Support and privacy | A support contact, plain-language AI/privacy notice, selected retention/cleanup approach, and the responsible owner’s approval. |
| Final source | Exact independently reviewed backend and mobile/web source revisions, including hashes for any deployed reviewed patches. |
| Money and duration | Hosting invoice/fees, conservative SEK-to-USD treatment, actual AI window/expiry and verified cumulative/per-user headroom. |

The target Supabase development project is `edbkuunyeyxnyenmmqud`. Do not
switch projects, use a legacy Lovable project or alter production to make the
worksheet pass.

### External invitation delivery is a real gate

The project historically used Supabase's default SMTP; its current settings
must still be inspected. Supabase documents that default SMTP sends only to
pre-authorized project-team addresses and permits two messages per hour. A new
external tester can therefore be blocked entirely, rather than merely waiting.
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)

Choose and verify either approved custom SMTP, or an authorized administrator-
generated invitation/recovery link delivered privately to the intended person
through an approved channel. Do not add app testers as Supabase organization
Developers just to receive auth mail. Do not put auth links/tokens into logs,
review archives or group messages. Links can be single-use and expire; use the
latest link on the intended phone/browser.

The web-only `/auth/callback` implementation is being prepared for invitation
and recovery. It must be independently reviewed and tested before its exact
public URL is approved. The native `memy-foundation://auth/confirm` scheme is not
a browser callback. Existing password accounts can use normal login, but that
alone does not verify external password setup.

## 2. Prepare the two private worksheets without creating financial controls

From the repository root, choose an approved ignored/private directory and copy
only the public pending templates:

```sh
MEMY_OPERATOR_DIR=/absolute/private/memy-seven-user
install -d -m 0700 "$MEMY_OPERATOR_DIR"
install -m 0600 docs/fixtures/seven-user-pilot.example.json "$MEMY_OPERATOR_DIR/pilot.json"
install -m 0600 docs/fixtures/seven-user-launch-plan.example.json "$MEMY_OPERATOR_DIR/launch-plan.json"
```

These commands do not initialize a ledger, generate a key or create a live AI
approval. Keep the directory out of source control and review archives.

- `pilot.json`: fill verified account IDs and genuine onboarding flags for slots
  1-4. Leave slots 5-7 as `user_id: null` and all flags false. Keep evidence that
  has not been observed as `pending`; a test count is not phone acceptance.
- `launch-plan.json`: `planned_people` is seven, while `active_slots` initially
  contains `[1, 2, 3, 4]`. Exact public origins and callbacks start as `null`.
  Only mark an operator decision true after checking its evidence.
- The existing private `pilot-cohort.json` must contain exactly the verified
  account IDs in the active slots, in the supported version/reviewer schema.
  Its directory/file modes are 0700/0600. Do not auto-populate it from a frontend
  `user_id` or the all-pending public example. This runbook creates no cohort.

The worksheet has a fixed, non-executable 350 SEK allocation:

| Use | Planning allocation |
| --- | ---: |
| Hosting/persistent storage reserve | 100 SEK |
| AI across all seven people | 175 SEK |
| Tax/exchange-rate/hosting safety reserve | 75 SEK |
| Total ceiling | 350 SEK |

At 25 SEK each, the first four represent 100 SEK of the AI allocation. Another
75 SEK remains earmarked for the later three; this is separate from the 75 SEK
safety reserve. Do not silently move that later-user allocation to initial users.
Existing prepaid OpenAI credit can fund AI usage; it cannot pay the host's bill.
The suggested message/minute quantities in the approval PDF are targets, not
implemented guaranteed entitlements.

### Read-only preflight

From `backend/`, pass the existing reviewed files explicitly:

```sh
python -m scripts.pilot_preflight \
  --manifest /absolute/private/memy-seven-user/pilot.json \
  --launch-plan /absolute/private/memy-seven-user/launch-plan.json \
  --cohort /absolute/private/runtime/pilot-cohort.json \
  --ledger /absolute/private/runtime/ledger.sqlite3 \
  --history /absolute/private/snapshot/history.json \
  --backup /absolute/private/snapshot \
  --remote-ledger /absolute/private/reviewed-wsl-return/ledger.sqlite3
```

Use the actual verified WSL ledger only when its approved private return is
available. Do not invent a new ledger or substitute an empty file.

The command checks the SEK arithmetic, pending decisions, exact HTTPS origin
consistency, same-app callback origins, active-account readiness, actual cohort
membership and existing financial evidence. Future pending slots do not block
readiness of the initial four. Adding a future slot to `active_slots` requires
that account to be ready and the private cohort to match it.

Reports contain anonymous counts and fixed blockers, not account IDs, email
addresses, full callbacks, file paths or tokens. Exit 2 means invalid/unsafe
input, 1 means a reported failure, and 3 means pending or independent review is
still required. There is no automatic success, release or spending-authorization
exit. Even an all-pass worksheet cannot authorize activation.

## 3. Prepare hosting with paid AI off

Coordinate the static web frontend and single-instance backend as separate
services. Use the existing reviewed staging package, not the loopback proxy as a
public server. Do not use a laptop tunnel as the pilot's dependable hosting.

| Configuration | Required relationship |
| --- | --- |
| Browser `webOrigin` | Exact assigned public HTTPS app origin |
| Browser `apiOrigin` | Exact assigned public HTTPS API origin |
| Backend `STAGING_ORIGIN` | The same API origin |
| Backend `CORS_ORIGINS` | JSON list containing only the approved web origin |
| Browser Supabase config | Development URL and publishable key only |
| Server credentials | Private hosting secrets; no OpenAI/server key in web assets |

The browser configuration is the ignored mobile-local
`apps/mobile/staging.web.client.local.json`, with only `webOrigin`, `apiOrigin`,
`supabaseUrl` and `publishableKey`. Use the frontend's reviewed `web-staging`
build mode. Its runtime origin must match the approved web origin. Do not copy a
native private-LAN configuration or point public phones at `127.0.0.1`.

Keep bootstrap flags `STAGING_BOOTSTRAP_AI_OFF=true`,
`STAGING_ENABLE_REAL_AI=false` and `REAL_AI_ENABLED=false` while provisioning,
importing financial state and checking public authentication/saved-data routes.
No approval file is generated by a deployment. Disable automatic deploys and
pin reviewed source. Build/run the real container and verify PDF dependencies,
readiness, streamed-response delivery, graceful shutdown and memory limits.

## 4. Perform one authoritative, reviewed spending cutover

Follow [staging recovery](backend-staging-package.md) and
[budget accounting](pilot-ai-budget-accounting.md). The worksheet is not a new
AI policy or approval and deliberately contains no USD conversion/rate.

1. Pause paid calls on both the Mac and WSL; finish/reconcile in-flight work.
2. Preserve the full authoritative ledger, numeric usage log, namespace,
   historical reservations/settlements, baseline and ceiling-increase audits.
   Retain the entire existing US$0.75 remote hold unless a separate reviewed
   append-only reconciliation explicitly resolves it. Receiving a return bundle
   or passing this worksheet does not release the hold.
3. Make and verify an encrypted snapshot and rehearse restore into a new isolated
   directory. Keep recovery credentials separately; never overwrite live state
   or create a blank budget at the destination.
4. Confirm the host quote and tax/fees first. Review currency conversion before
   translating the SEK envelope to conservative USD caps. Do not treat 350 SEK
   as AI-only money, a provider balance or an automatically executable approval.
5. Review the actual remaining global and per-user exposure. Policy ceilings are
   cumulative, and existing developer accounts already have history: assigning
   a cumulative cap does not grant each of them a fresh allowance. Preserve the
   stable identity namespace and document their actual remaining headroom.
6. If more cumulative headroom is authorized, use the existing reviewed
   append-only ceiling-increase procedure. A new approval ID/window cannot
   reset past spending; do not edit old policies to bypass their digest checks.
7. Install only the separately reviewed unexpired approval, cumulative policy,
   matching active cohort and stable speech-encryption configuration privately.
   Test user/global exhaustion, expiry, restart continuity and saved-data/PDF
   access while AI is closed before enabling paid AI on this one host.

Local and WSL testing must not continue under independent copies of the same
allowance after cutover. Do not scale the file-backed ledger to multiple hosts.
The ordinary single-host busy response must remain a clear wait/check-saved
state, with no automatic paid retry or duplicate submission.

## 5. Accept the initial four, then add the remaining three

Keep mocked tests, provider-only canaries, real database checks and actual
phone/browser evidence separate. Before inviting the first four, independently
verify:

- One actual iPhone/Safari and Android/Chrome journey where available: secure
  login/password setup, typed and recorded memories, streamed provisional reply
  followed by verified saved completion, optional listening, memory review,
  grounded story writing/edit/history, PDF, refresh, sign-out and sign-in.
- English and Swedish, microphone denial, network interruption/background,
  expired login/audio, reload/reconciliation and closed-budget behavior.
- Two issued users cannot retrieve each other's projects, sessions, originals,
  transcripts, messages, memories, drafts, revisions, audio or PDFs.
- The paid cohort matches the four intended accounts; another account cannot
  start paid AI. Recorded budget/usage survives a real restart and restore.
- Four-person contention and stream delivery on the actual host are acceptable.
  Seven allowed identities are not proof of seven simultaneous AI responses.
- The privacy notice, retention/cleanup choice, support contact and feedback
  route are ready for the people invited.

Then share one HTTPS app link and individual setup instructions privately. Users
open Safari/Chrome, sign in and allow the microphone only when they record. No
Expo Go, WSL, command line, shared Wi-Fi or OpenAI key is required.

When each later tester is confirmed, prepare and verify that account, then add
its slot to `active_slots` and the existing private cohort. Re-run preflight,
cohort enforcement and the affected phone/account checks. Retain the same
ledger, USD approval history and total 350 SEK envelope; onboarding another
person never starts another budget. Stop at seven unique approved users.
