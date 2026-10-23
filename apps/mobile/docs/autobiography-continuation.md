# Mobile Task 3D-8B — Continue My Story and preserved generations

This development feature reuses the existing authenticated conversation, recording, transcript simulation, memory-review, generation, editing/history and private PDF clients. It adds no provider, endpoint, dependency, schema or production configuration. Generation remains a deterministic simulation and must never be presented as a factuality guarantee.

## Saved identity and explicit actions

From a saved autobiography, Continue My Story first rereads the selected owned draft. The existing Conversation controller alone reconciles sessions and calls POST `/api/v1/story-projects/{project_id}/continue` with `{}` when needed. It reuses the canonical newest active session, including after an uncertain request; a completed session is not reopened. An incomplete session page cannot establish absence, so it falls back to the atomic continuation endpoint instead of unconditional session creation. No continuation action generates a draft.

The conversation and memory-review back path returns to the selected draft ID, through a fresh typed read. Existing recording/upload leave guards remain in place. Memory evidence is immutable; corrections, confirmations and rejection remain separate explicit versioned actions. Unresolved contradictions still block generation on the backend.

Generate Another Autobiography requires confirmation explaining that earlier manual wording and PDFs remain saved and are not automatically copied or merged. Each deliberate generation uses a stable UUID and the exact language/style/confirmation payload. Uncertain requests retain the same key and payload. Read-only reconciliation is required before an explicit retry; a latest draft alone never proves that action succeeded. There is no generation-key lookup endpoint, automatic POST retry or invented context endpoint.

The returned saved generation is displayed by its actual ID, generation number and manual revision. The backend may reuse ANY earlier context-matching generation, including its current manual edits. It need not return version + 1. The previously selected generation remains accessible using Open My Previous Selection, which switches through verified GETs; Saved Autobiographies provides the bounded browser. No comparison text is cached persistently and no generation is restored or merged.

## Generation browser and verification

The new paged list uses the same authenticated transport and full backend draft decoder. It requests 20 rows at a time, at most 200, checks unique IDs and strictly decreasing generation numbers, and rechecks the first page plus loaded boundary/selected page around paging/selection. Changed or unstable pages require deliberate refresh; there is no silent latest-generation substitution. Offset pagination has no atomic snapshot, so these checks cannot establish global completeness under arbitrary concurrent changes. The UI explicitly identifies partial/capped lists.

Every selected generation is read again. Its own validated verification report is used when the latest-project report describes another generation. Generation is distinct from manual revision; Edits to This Generation opens the existing selected-draft history. Existing edit expected_revision and PDF audit hash/revision rules are unchanged. Selection, refresh and browsing never edit, generate, confirm memories, export or share automatically.

The existing 1 MiB JSON body limit is preserved. Exceptionally large pages can fail safely rather than loading a partial or unverifiable history. Earlier generations outside the 200-row display cap are not deleted.

## Privacy and lifecycle

Navigation retains only validated project/draft IDs in owner-scoped RAM, capped at 200 selections. The existing GenerationActions provider retains selected IDs and uncertain action metadata across temporary same-owner authentication checking. Definitive sign-out, blocked authentication or an account change clears them. Fresh owned reads are always required; hints are never ownership proof. Process termination loses these hints and restarts normal navigation. Existing PDF-return hints take precedence so sharing returns to the correct selected generation.

Controllers cancel or ignore late responses after navigation, backgrounding, sign-out and account changes. Browser AppState subscriptions are removed on unmount, and queued stale events are ignored. Parent subview tokens protect dirty editors against obsolete browser callbacks. No story text, source evidence, tokens, passwords, PDFs or recording paths are added to URLs, logs or persistent navigation storage. Private PDF file handling and user-initiated sharing remain unchanged.

## Windows setup — manual only

The new worktree has no `development.auth.local.json` or `development.api.local.json`. Automated verification deliberately never opens these files and runs with auth/API disabled. No private settings were automatically copied and no backend services were started.

Before a separately approved iPhone acceptance run, in Windows PowerShell:

```powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-autobiography-continuation\apps\mobile'
if (-not (Test-Path -LiteralPath development.auth.local.json)) { Copy-Item -LiteralPath development.auth.example.json -Destination development.auth.local.json }
if (-not (Test-Path -LiteralPath development.api.local.json)) { Copy-Item -LiteralPath development.api.example.json -Destination development.api.local.json }
notepad development.auth.local.json
notepad development.api.local.json
```

Run those Copy-Item commands only if the destination files are absent; never overwrite an existing private configuration. In the auth file retain the approved development project URL and privately enter its client-safe publishable key obtained from Charan. Never use a service-role key, token or password. In the API file privately enter the approved current iPhone-reachable development FastAPI root. Do not guess an IP, use phone localhost, create a tunnel, change firewall rules or copy legacy `.env` values. Do not upload these ignored files.

Charan must confirm the existing Day 5/6/9 RPC/RLS support and development-only `CONVERSATION_MODE=mock`, `STORY_GENERATION_MODE=mock` and simulated transcription setup. Follow his approved backend startup procedure separately. This task does not install backend dependencies, run migrations or enable real providers.

Once private settings and the development backend are approved and ready:

```powershell
npm start
```

Scan the NEW normal-app Expo Go QR code, not an older server's code or `preview:stories`. No stored onboarding/authentication preferences need to be reset.

## Real iPhone acceptance — pending

Use fictional English and Swedish stories and authorized development accounts only. Prior Task 3D-8A acceptance is USER-REPORTED; Codex did not perform it. This feature's device and live backend acceptance are not yet verified.

1. Log in, open a fictional story with a saved generation. Record its generation and revision. Explicitly edit/save fictional wording to obtain revision 2 if needed. Export its PDF using the existing explicit Prepare → Share/Save flow; retain that audit as a reference.
2. Tap Continue My Story. Verify an existing active session resumes; leave and reopen to verify no duplicate session. A project with no active session should receive one canonical active session. No autobiography should be generated automatically. Test Back while recording/upload is pending and confirm the existing leave warning still applies.
3. Open Review My Memories / Granska mina minnen. Review a previously pending supported fact if available. A concrete supported context change uses the fixed simulated move candidate: select the fictional Malmö move originally dated 1974, tap Correct this memory / Rätta det här minnet, enter `1975` in Your correction / Din rättelse, then Save review / Spara granskning. Verify Current review value is 1975 but the original year/evidence/transcript still show 1974. Review any related contradictory candidates separately; confirm/reject them deliberately and resolve outstanding questions. Do not invent facts just to force a version number.
4. The transcription simulation is FIXED fictional material. Speaking different words does not produce genuine new transcription. Prefer an existing saved candidate for the correction above; repeated uploads can create redundant pending facts. If no supported candidate exists, obtain an explicitly approved fictional test-fixture setup from Charan separately. No fixture is created automatically by this implementation.
5. Return via Back to My Autobiography / Tillbaka till min självbiografi. Confirm the originally selected generation and manual wording remain. Tap Generate Another Autobiography / Skapa en självbiografi till, read the preservation notice and confirm explicitly. Inspect the ACTUAL returned generation/revision. It may be new or reused; manual wording must not be silently merged.
6. Open My Previous Selection or Saved Autobiographies. Reopen the earlier edited generation and its Edits to This Generation history. Verify original_content, separate source snapshots and revision-2 wording remain intact. Export/select its earlier PDF audit and verify original title/content/revision. Repeat through Back → story details → dashboard → reopen, and through PDF sharing/background authentication rechecking; the selected generation must remain correct while RAM hints survive.
7. With unchanged confirmed context, explicitly generate again. Verify truthful reuse, no fabricated increment and no lost edit/history/PDF. During an interrupted request, refresh/read first, then explicitly retry the SAME action. A draft seen on GET is not proof of action success. Unresolved/unsupported memories must show an error without a fake successful save.
8. Test rapid taps, offline/network failures, leaving during a request, background/foreground and sign-out. Another authorized account must not see the first account's generations, sources, conversations or export data. Physically check VoiceOver, large text, scrolling, English/Swedish labels and 56-unit controls on iPhone; Android remains a separate physical-device check.

Automated verification uses mocked services and synthetic data with blocked real network access. It cannot prove deployed persistence, RLS/two-user authorization, real speech/AI accuracy, native sharing or OS cleanup. Independent review and real-device acceptance remain required before any separately approved commit/release.
