# Milestone 1 acceptance evidence

24 October 2026 · **HOLD / NOT ACCEPTED for a personal-data pilot**.

Backend implementation and reproducible fictional simulations are distinct from
complete mobile acceptance. The user explicitly confirmed that the current full
English/Swedish iPhone checklist has not yet run. No test count, valid JSON file,
branch push or draft PR is founder approval.

## Gate matrix

| Required gate | Current result | Evidence / next action |
| --- | --- | --- |
| Backend regressions | PASS — local only | Complete Python/database suites, OpenAPI, dependency consistency and 142 offline journey assertions; exact results in [Day 15 status](day-15-status.md). Four opt-in live pytest cases remain skipped. |
| Two-user hosted security | PENDING | Disposable password accounts authorized, but secure human credential entry remains required. No anonymous sign-in. Run with two issued/online-validated JWTs and verify scoped cleanup; read-only SQL is not a substitute. |
| Full physical iPhone EN/SV journey | PENDING — not run | User confirmed prepare/run later. All 12 device cases are pending. No synthetic recording is labelled an iPhone recording. |
| Mobile retry/backoff behavior | PARTIAL | New `b787dcd` source addresses Day 14 gap; 40 pure parser/store cases passed in a limited offline harness. Full native suite and actual network/backoff/VoiceOver behavior not rerun. |
| Legacy/hosted security | PARTIAL / RELEASE GATES OPEN | Fresh read-only development RLS/catalog/identity checks passed; Functions dashboard lists none. Public legacy image bucket, helper review, object/backup/dependency/ingress evidence remain open. |
| Retention/deletion approval | PENDING | Engineering behavior and risks documented; no controller-approved durations, whole-account erasure implementation or operational recovery sign-off invented. |
| Real AI accuracy, if promised | NOT RUN | Paid calls remain disabled. Mock fixtures do not establish transcription quality or live factual accuracy. A mock-only scope must be explicitly agreed, not silently used to waive a real-AI promise. |
| Founder pilot scope/approval | PENDING | Founders/controller must agree demonstration vs personal-data pilot, exclusions, remaining risks and acceptance evidence. Funding approval is not release approval. |

## Twelve physical-device cases

All remain **PENDING**, including login, project/dashboard, actual M4A,
labelled simulation, memory confirm/correct, explicit generation, revision edit,
PDF opening on phone, Continue preserving history, sign-out/in restoration,
cross-user denial and interrupted-network recovery. Source review and backend
tests cannot mark any of these physically passed. Native PDF/share/cache,
microphone lifecycle, accessibility and Android require their own observations.

Reviewed runtime baseline: `c67687ec4b392dbf0e4f73fc8451ac6f0da05560`.
Reviewed mobile candidate: `b787dcd70b54f6220bfa3d7c0899a2c1f677e080`.
The backend branch's later evidence/documentation commits leave app code intact;
record actual checkout IDs in the independent review/PR. Old Day 14 evidence
pins remain historical and must not be relabelled for the new mobile branch.

## Content-free report validation

[The example report](fixtures/milestone-1-evidence.example.json) starts all eight
gates and all 12 device cases pending. This is a blank form, not a replacement
for the measured results above. It accepts no prose, test totals, secrets or
invented signature as proof. After an actual authorized run, fill a local copy
and validate from `backend/`:

```sh
.venv/bin/python scripts/validate_milestone_evidence.py
.venv/bin/python scripts/validate_milestone_evidence.py /absolute/path/to/content-free-report.json
```

Exit 3 means structurally valid but not accepted (`PENDING` or
`SELF_REPORTED_COMPLETE_NOT_ACCEPTED`); 1 means self-reported failure; 2 means
invalid evidence. There is deliberately no exit-0 release path. Even complete
input retains `accepted:false`, `pilot_approved:false`,
`independently_verified:false` and `release_authorized:false`.
Only a decided mock-only scope permits `live-ai-accuracy:not_applicable`; it
does not waive security, real-device or founder gates. A claimed device pass
cannot coexist with incomplete device cases/attestations.

## Decision and handoff

Continue targeted development and an explicitly labelled fictional mock rehearsal;
do not request personal-data pilot acceptance as though these gates were closed.
No production deployment, merge to main, Auth relaxation, policy change or paid
model activation is authorized by this report. Follow
[Tarun's final integration handoff](tarun-final-integration.md),
[security gates](security-release-gates.md) and
[deployment/rollback runbook](pilot-deployment-runbook.md). Update this matrix
only with new, scoped evidence and explicit human decisions.
