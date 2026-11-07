# Seven-user pilot: operator checklist

Updated 7 November 2026. The source supports a closed roster of at most seven
verified development accounts. The user reports receipt of 350 SEK for testing;
this preparation does not create a roster, renew an AI approval, change private
financial controls or purchase hosting. Public distribution is a later operation.
The earlier local US$5 window is historical and must not be assumed active or
copied to another host. Runtime status, expiry and remaining funds must be checked
against the authoritative ledger before activation.

## Current rollout: four first, seven maximum

The first wave is four approved testers; three more may join 1-2 days later.
Leave the future account IDs and flags pending. The concrete
[mobile-web launch runbook](seven-user-mobile-web-launch.md) and
[non-executable SEK worksheet](fixtures/seven-user-launch-plan.example.json)
cover staged `active_slots`, private password setup, SMTP restrictions, exact
HTTPS destinations and explicit cohort-to-roster checks. They do not create or
renew a USD approval. Use `--launch-plan` and `--cohort` with the existing offline
preflight for this rollout; future pending slots then do not falsely block the
initial four or become automatically authorized.

## 1. Freeze reviewable source

The backend base is `939f7dfac06d3688a3acc1f067d85874b0494078` on
`codex/real-milestone1-ai-backend`. The mobile performance base is
`f75078ac69bbd5e8ba751d51084210457c9a4198` on
`codex/mobile-performance-20261106`, building on Tarun's reviewed mobile work.
The current local responsiveness and seven-user changes are not a published
release. Pin and independently review the exact final source SHAs and any patch
hashes; do not substitute `main`, an old base or a moving branch. No source is
committed, pushed or deployed by the seven-user preparation.

Use the current API paths, English/Swedish language selection, original-word
provenance, ownership/RLS and explicit action/idempotency contracts. Theme,
configured models, public schemas and retention periods remain unchanged. The
optional combined-turn prompt is separately documented and reviewed in
[performance tuning](app-performance-tuning.md); it remains off by default.

## 2. Spending continuity before any activation

The encrypted WSL return was received, its supplied checksum verified, and its
records decrypted and compared read-only on 6 November. The shared financial
history matched. Three remote-only reservations remain represented by Tarun's
full US$0.75 hold; no import, consolidation or hold release has been performed.

The earlier local test authorization added US$5 through an explicit reviewed
ceiling-increase audit, preserving the previous baseline, identity namespace,
reservations, settlements and remote hold. That window had its own US$5 cap
and expiry. It must not be copied to another host or treated as a new pilot
budget. Private controls and ledgers are excluded from Git and review packages.

Run the existing read-only ledger comparison and review any remote-only rows.
Do not replace either ledger, discard failed/unknown reservations, change old
approval terms or start an empty budget. Compatible files are a prerequisite,
not authority to import them or release the hold. Complete the separately
reviewed append-only consolidation before choosing one authoritative host.

Preserve a verified private snapshot and rehearse restore into a new isolated
directory. A same-disk copy is not an off-host disaster-recovery backup.
See [accounting](pilot-ai-budget-accounting.md) and
[staging recovery](backend-staging-package.md). The supplied read-only
preflight cannot create or renew any budget.

## 3. Restrict paid AI to the actual pilot accounts

`AI_PILOT_COHORT_PATH` points to an operator-reviewed private JSON file on the
backend. Staging refuses AI activation without a valid file. It is optional in
existing local setups to preserve compatibility; the supplied staging example
sets its intended persistent path. It does not create the file or enable AI.

The exact file shape is:

```text
version: 1
approved_by: bounded operator label
user_ids: 1 to 7 distinct canonical Supabase account UUID strings
```

Use a private directory (0700) and regular unlinked file (0600). Keep this file
out of Git, review ZIPs, mobile configuration and chat. Get account IDs from
verified development accounts, not a frontend-supplied user_id. The list does
not replace Auth, RLS or spending approval. Adding an account grants no funds.

The five paid v2 POST actions check the backend-validated user before resource
access, claims or audio processing, and execution checks membership again.
Outsiders receive `403 AI_PILOT_ACCESS_DENIED`, with
`X-Memy-Recovery: contact-operator`. Invalid/missing configured files return
sanitized `503 AI_PILOT_CONFIG_UNAVAILABLE`. No automatic retry timer applies.
Already saved GETs, operation reconciliation, prepared audio, memory review,
story editing and PDF export/download keep their normal ownership checks and
remain available without paid AI or cohort membership.

Per-user budget/attempt limits and the global ceiling remain enforced by the
existing governor. Provider attempts are not app replies: ordinary conversation
uses two calls, or one when the reviewed combined-turn path is explicitly
enabled; story generation retains two calls. Seven admitted accounts do not
certify seven simultaneous AI actions. The existing single-host spending lock
may return `AI_BUSY` rather than queue or automatically retry a paid action.
Verify real capacity and the user-facing busy/recovery behavior before launch.

The current 350 SEK planning envelope is 100 SEK for estimated hosting/storage,
175 SEK for AI (25 SEK per person), and 75 SEK held for tax, exchange-rate and
hosting adjustments. Existing prepaid AI credit may fund provider usage; hosting
is billed separately. Do not equate the SEK document with an executable USD
approval: review the conversion, cumulative ceiling, per-user limits and expiry
while preserving all past reservations, settlements and outstanding holds.

For the whole pilot, the suggested per-person targets are 20 typed messages,
about 5-10 voice clips (up to five recorded minutes total), optional playback of
about 6-12 replies (up to three spoken minutes total), and one short story/PDF.
Listening plays existing replies and is not an additional conversation exchange.
Text, voice and story generation share the same proposed 25 SEK per-person cap;
testing may stop sooner. These are planning targets, not implemented message or
minute entitlements or finalized subscription allowances. Configure and verify
actual financial limits before invitations.

## 4. Seven separate accounts, secure password setup

Before sending anything, obtain the approved tester names/emails privately and
confirm the delivery method and callback for the final app. Provision/invite
only those approved development accounts through the project administrator.
Each person sets their own password through the verified setup/recovery flow.
Do not share developer logins, database passwords, service keys or OpenAI keys.
No invitations or emails have been sent by this preparation.

Copy `docs/fixtures/seven-user-pilot.example.json` into an ignored private
directory, mode 0700; give the copied file mode 0600. Fill only the intended
account UUID and boolean onboarding checks for each anonymous numbered slot.
Leave unknown facts pending. Unused slots can be omitted for the initial
two-person soft start; the roster must never exceed seven unique people.

The offline check, from `backend/`, is:

```sh
python -m scripts.pilot_preflight --manifest /absolute/private/pilot.json \
  --ledger /absolute/private/ledger.sqlite3 \
  --history /absolute/private/snapshot/history.json \
  --backup /absolute/private/snapshot
```

Use `--remote-ledger` with the verified private WSL return during reconciliation.
Output contains
anonymous counts and fixed blockers, not emails, UUIDs, secrets or story text.
Exit 3 means pending/review required, 1 means a reported failure, and 2 means
unsafe/invalid input. There is deliberately no automatic success/approval path.
With no arguments, it reads the all-pending public example and makes no network
requests. Even all-pass checkboxes do not certify a device, hosting or founder
approval; review the underlying evidence independently.

## 5. HTTPS, backups and monitoring

The new loopback TLS smoke tests the actual wrapper with AI off and a verified
local certificate, including Auth/Host/CORS guards and a zero-row development
database readiness probe. It is not a public HTTPS deployment or iPhone test.

Future staging needs one authoritative persistent ledger, encrypted private
configuration, exact HTTPS API/mobile callbacks, off-host encrypted backups
and a working alert destination. Use the prepared single-instance deployment
package after hosting is approved. Neither a tunnel to a laptop nor a successful
`/ready` response establishes remote pilot readiness. Docker is unavailable on
this Mac, so the image still needs a real container build/run elsewhere.

Choose either reviewed hosted mobile web (including browser microphone and PDF
checks) or an approved signed native beta distribution. No Apple membership,
hosting purchase, remote URL or beta build is created by this preparation.

## 6. Privacy and support before invitations

Founders/controller must approve the notice, retention period, cleanup process
and support contact. Record the decision instead of inventing a number of days.
Explain in plain language that users choose what to share, AI may be mistaken,
selected text/audio is processed by the configured AI provider, and saved words
are stored separately from reviewed memories and generated stories. People
should check the facts before sharing their story PDF.

Discuss account/data access, original-word retention, generated speech expiry,
device/shared PDF copies and who can request deletion. The current cache expiry
is unchanged. Do not promise complete automatic deletion or indefinite audio
playback. Review all configured processors and backup exclusions.

For an authorized user's content-free inventory, the existing tool now supports
`python scripts/privacy_inventory.py --contract real-v2` (offline instructions)
and an explicit `--run` with that user's hidden token. It sends owner-filtered
HEAD/limit=0 requests only. `--contract all` includes v1 as well. Privileged
operation records, hidden rows, provider copies, storage, backups and device
files are explicitly excluded. This tool does not delete or prove erasure.

## 7. Acceptance and a two-person soft start

Record actual evidence separately from mocked HTTP/SQL tests and JS exports:

- Fresh two-issued-user JWT checks across projects, sessions, typed originals,
  transcripts, messages, memories, drafts, revisions, speech and PDF exports.
- English and Swedish actual-device journeys: sign-in, create/continue, typed
  chat, microphone/transcription, AI reply, optional listening, memory correction,
  story generation, edits/history, PDF, sign-out and sign-in again.
- Network loss, background/resume, interrupted speech, expired login and closed
  budget. Preserve original operation keys and reconcile uncertain writes before
  another explicit action; never automatically retry a paid action.
- Readable text, large controls and feedback from actual older testers.
- A tested outage/restore procedure, support contact and controller-approved
  retention/cleanup process.

Only then invite two authorized people. Check privacy, cost and help needed
before increasing to at most seven. At the end ask whether they completed a
meaningful story, returned and would pay the proposed 100 SEK/month. Payment
collection is not activated by this operational preparation.
