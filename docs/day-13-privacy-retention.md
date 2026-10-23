# Day 13 privacy, retention and deletion workflow

23 October 2026 · engineering inventory, **not an approved privacy policy or GDPR certification**.

Purpose of the reviewed FastAPI workflow: help an authenticated owner record,
review and export their own autobiography. Do not reuse memories for unrelated
analytics/model training or collect real personal histories during the fictional
demo. Founders/controller must approve the notice, lawful basis, sensitive-data
handling, processor arrangements, retention periods and rights/contact process
before a personal-data pilot. The [European Commission's principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
call for purpose limitation, minimisation and justified retention/review periods;
we do not invent a universal retention period in code.

## Actual behavior, not a deletion promise

| Data | Current engineering behavior | Required policy/operational decision |
| --- | --- | --- |
| Uploaded audio | FastAPI uses private temporary directories and 0600 recording files; multipart spools/decoder children are cleaned on success, failure and cancellation. No raw-audio upload to Storage in this API. | Abrupt process/host termination can leave named temporary files. Approve private ephemeral-volume handling and a safe recovery/cleanup procedure; no crash-residue janitor was enabled today. |
| Original transcripts/messages | Immutable source text, separate from corrections, extracted memories and generated prose. No automatic age-based purge. | Approve retention/review schedule and complete erasure scope, including source snapshots. Immutability does not mean indefinite legal retention. |
| Memories and revisions | Candidates remain pending until explicit review; rejection/correction does not rewrite originals. | Determine retention of rejected facts, revisions and safety/audit evidence. |
| Drafts/history/source snapshots | Saved versions and prior manual prose remain accessible to their owner. Removing a source does not erase its saved draft snapshot. | Complete deletion must account for drafts, snapshots and historical exports, not just original messages. |
| PDF bytes | New FastAPI PDF bytes exist in memory and are returned privately; no persistent server PDF blob is created. | Device downloads/shares are separate copies. Deleting metadata alone does not erase the draft/history used to reconstruct it. |
| Export metadata | Private database audit records with revision, title, filename and integrity metadata; no automatic TTL. | Approve audit retention and whether any narrow legal/security hold applies. |
| Auth/profile/settings | Auth identity, owned profile and legacy settings have different FK behavior. | Auth deletion alone is not account erasure; see workflow below. |
| Rate/usage state | User rate state contains only verified UUIDs/timestamps in bounded worker memory; no tokens/content. Paid evaluation ledger contains administrative usage reservations, not biographies. | Worker entries can persist until reuse/capacity pruning/restart. Choose operational log/ledger retention separately; never reset a ledger to bypass an allowance. |
| Provider copies | No Day 13 requests to OpenAI/other paid processors. | OpenAI `store:false` is not Zero Data Retention. Review endpoint-specific abuse monitoring, region and processor terms before personal-data transmission. See [official data controls](https://developers.openai.com/api/docs/guides/your-data). |
| Legacy buckets/backups/functions | Separate Lovable-era implementation, not protected by FastAPI's flags or temporary-file lifecycle. | Review actual hosted buckets, backups, purge jobs, public images and legacy functions before reuse. Schema intent is not proof a purge runs. |

## Non-destructive inventory tool

From `backend/`:

```sh
.venv/bin/python scripts/privacy_inventory.py
```

Default mode reads no credentials, makes no network request and deletes nothing.
An authorised development user can explicitly run `--run` in their own private
terminal. It refuses any project other than `edbkuunyeyxnyenmmqud`, prompts for
their access token without echo (fails if hiding is unavailable), validates the
token online and uses that same user JWT and the publishable key for fixed
HEAD/zero-row/count queries. **Never send a token in chat, a screenshot, CLI
arguments or a support ticket.** No service-role credential is needed or used.

Output is counts only, with no names, emails, IDs, narrative rows or tokens.
Overlapping books/views/transcripts are not additive. Missing count permission,
network errors or malformed ranges fail closed, not as a zero count. This is
only the caller's RLS-visible inventory: hidden/deleted rows, internal ledgers,
blobs, logs, backup/provider/device copies remain excluded. Zero visible rows
must never be presented as successful complete erasure.

The live `--run` mode was not executed today; MockTransport tests cover its
request construction, identity boundary and failure behavior.

## Defined deletion request workflow — execution remains disabled

There is **no FastAPI story/account/export DELETE endpoint or automatic purge**
in this release. Tarun must not display a fake successful deletion or equate
sign-out/account removal with complete erasure. Product must choose a verified
support/contact channel and explicit confirmation UX before offering it.

1. Receive a request through that approved channel; verify the signed-in owner
   and exact story/account scope. Do not trust a caller-supplied owner UUID or
   ask users to share tokens/passwords with support.
2. Prepare a read-only scoped inventory. The user's counts above are only an
   aid; an authorised administrator must separately review hidden rows, internal
   ledgers, legacy tables, storage, external processors and backups.
3. The controller reviews retention/legal/security/operational exceptions and
   chooses what must be removed, narrowly retained or anonymised, with a reason
   and expiry. Founders must approve these policies before irreversible code.
4. Obtain separate explicit approval for exact destructive targets. Rehearse the
   plan with fictional data and verify its impact on foreign users first. No
   destructive command or automatic executor is supplied here.
5. A later reviewed implementation must handle legacy print-order restrictions,
   project children/history/source snapshots, settings and objects/backup copies
   before removing Auth access. Deleting Auth first can strand owner data.
6. Verify scoped removal, retained exceptions and foreign-user isolation, then
   provide a minimal receipt without private biography content. State external
   backup/device-copy limitations and actual restoration expiry honestly.

Isolated SQL checks establish that an explicitly deleted owned parent project
cascades core children/audits without deleting the other owner's rows. They
also establish that `books` and `user_settings` lack the Auth FK cascade, that
`print_orders.book_id` can block project deletion, and that draft source
snapshots can outlive their original sources. None of those tests delete hosted
data or provide a ready-to-run whole-account erasure implementation.

## Frontend responsibilities

Explain recording/transcription purpose and simulation before capture. Use the
existing explicit fact correction/rejection and manual draft review contracts;
original records remain separate. Privacy text must describe real current
retention, not an invented 30-day TTL or a claim that logout deletes memories.
Do not collect real histories until the [release gates](day-13-deployment-readiness.md)
are resolved. Secure local/device caches and PDF shares are mobile acceptance
items, not proven by backend unit tests.
