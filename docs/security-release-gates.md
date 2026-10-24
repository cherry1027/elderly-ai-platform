# Security release gates

24 October 2026 · FastAPI 0.8.1 · development evidence, **not pilot approval**.

This report separates local regression, hosted read-only SQL, real user-token
testing and actual-device acceptance. Do not convert one layer into another.
The dedicated development project is `edbkuunyeyxnyenmmqud`; no production target
was accessed. No Auth setting, policy, grant, migration or deployment was changed.

## Fresh development checks

| Boundary | Observed evidence on 24 October | Limit |
| --- | --- | --- |
| Supabase URL/key/reachability | Exact project match; publishable-key fingerprint `7dbc1add8497`; zero-row profiles HEAD 200. | No secret/service-role key used; readiness is not owner authorization. |
| API authentication | Real HTTPS Auth/Data API through in-process FastAPI: health/ready 200, missing token 401, invalid unissued dummy token 401. | Not two issued JWTs, revoked/actually expired token, deployed FastAPI or phone evidence. |
| Anonymous sign-in | Dashboard switch remains off; email confirmation remains on. | No relaxation to make tests pass. |
| Core RLS and RPCs | Exact existing `cloud-day14-readonly-security.sql` passed again: 16 RLS tables, three invoker views and 19 restricted fixed-search-path core definer RPCs. Empty/nonexistent SQL identities saw no private rows; missing-identity guards rejected. | `BEGIN READ ONLY`; no fixtures or owner writes. SQL role claims are not JWTs or two real users. |
| Existing data | Aggregate counts only: two projects, two sessions, seven source messages, six memories, one draft, two edits and two exports. | No row IDs, account emails or story contents read into the report. Counts are not a full inventory. |
| Edge Functions | Exact development dashboard again showed the first-function empty state with no functions listed. No function invoked. | Platform incident banner remained visible; not an independent management-API inventory or old-project audit. |

The broader rollback-only synthetic SQL exercise passes locally but was not
executed hosted today. Creating two disposable password accounts was authorized;
secure human credential entry is still required before a fresh issued-token
test can run. No existing user's password may be reset or borrowed for testing.
The real two-user gate remains **PENDING**, not failed or passed.

## Release-blocking risks and owners

| Gate | Required evidence / action | Owner |
| --- | --- | --- |
| Two issued-user authorization | Two approved disposable users each own a fictional EN/SV journey; foreign reads/writes denied; exact-run synthetic cleanup verified. No anonymous Auth. | Backend operator with secure account-entry assistance |
| Native auth/data isolation | Current iPhone build, account switching, token expiry, PDF/cache and interrupted-save observations; no tokens on shared-Wi-Fi HTTP. | Tarun |
| Legacy functions | Keep unauthenticated paid/deletion source excluded; independently verify actual deployment if dashboard inventory is uncertain. Separate approval before any cloud remediation. | Supabase/release operator |
| Legacy storage | Hosted metadata confirms three legacy buckets, one public image bucket, two private audio/PDF buckets. Review actual selected objects, URLs and policies before any personal-data pilot. | Backend + controller |
| Database helper surface | 23 public database definers include four `anon`-executable legacy helpers: `handle_new_user`, `handle_new_user_settings`, `has_role`, `rls_auto_enable`. Three are trigger/event-trigger functions. Catalog visibility is not proof they are exploitable HTTP endpoints. Review needed; none invoked/changed. | Database reviewer |
| Legacy entitlement/logging | Do not trust self-editable demo flags for billing. Review sensitive legacy logging, deletion scheduler and backup behavior before reuse. | Backend/product |
| Dependency/ingress review | `pip check` is consistency, not a CVE audit. Review actual dependency advisories, HTTPS, edge/shared abuse limits, monitoring and recovery. | Release/security operator |
| Retention/deletion | Controller approval and verified operational procedure; no invented TTL or fake deletion success. | Founders/controller |
| Real AI | Public persistence remains mock-only. Funding approval alone does not establish live provenance, accuracy or pilot scope. | Backend + founders |

The four legacy database helper grants are distinct from Edge deployment.
Do not report them as four deployed functions, a confirmed exploit, or a blanket
security pass. The 19 current core RPC grant/search-path checks passed; this does
not approve the whole legacy schema.

## Privacy/deletion readiness

The [existing engineering inventory and deletion workflow](day-13-privacy-retention.md)
remains authoritative; no new retention period or erasure endpoint is activated.

- FastAPI raw audio is temporary, privately spooled and normally removed after
  processing/cancellation. Abrupt host death can leave residue; approve private
  ephemeral storage and exact-target crash cleanup before a personal-data pilot.
- Original transcripts are immutable relative to editing, separate from reviewed
  facts and drafts. There is no approved automatic transcript expiry/purge.
- Corrections/rejections, source snapshots, draft history and export metadata
  remain distinct stored records. Deleting a source or Auth identity alone is
  not complete account erasure; legacy books/settings and print-order constraints
  require a reviewed dependency-aware process.
- New PDFs are rendered in memory; downloads/share recipients can keep copies.
  Logout or server metadata deletion cannot promise recipient/device erasure.
- Backups, provider copies, legal exceptions, notices, processor arrangements,
  contact channel and controller-approved retention/deletion decisions remain
  unresolved. No legal compliance certification is made here.

Use fictional data only until these gates are reviewed. The
[deployment/rollback runbook](pilot-deployment-runbook.md) does not authorize
deployment, restore, deletion, provider spending or a merge to `main`.
