# Private PDF export — Mobile Task 3D-8A

This development feature exports an existing, saved autobiography using the authenticated backend. It does not generate story text, verify personal facts, or export unsaved editor text. Task 3D-8B remains planning only.

## Contract and revision selection

- POST `/api/v1/story-drafts/{draft_id}/export` sends only `{"format":"pdf","include_title_page":true,"include_page_numbers":true}` and receives 201 PDF bytes.
- GET `/api/v1/story-projects/{project_id}/exports` supplies real export audit history; GET `/api/v1/story-exports/{export_id}/download` receives 200 PDF bytes for that audit.
- All requests reuse the existing authenticated transport and current verified owner's user token. No public download URLs, new authentication client, ownership parameters, or hardcoded backend addresses are introduced.
- Before a new export, the selected saved draft and project title are fetched again. The UI binds the returned PDF and its audit to the captured draft ID, generation, revision, title and SHA-256 of the saved UTF-8 story text. A changed source requires an explicit refresh/retry. The backend has no client `expected_revision` export field; this frontend validation is therefore necessary.
- Export never invokes story generation, draft editing, memory confirmation or restoration. Dirty editor navigation must finish Save/Discard before export is available. Historical downloads select their audited revision/title rather than substituting current text.
- Actual binary response headers, length, MIME type, safe filename, UUID, generation/revision, page count, private no-store directives and bounded PDF signature are checked. The maximum is 2,000,000 bytes and 100 pages. These checks are not a complete PDF security scanner or factuality check.
- Audit `content_sha256` describes saved text, not PDF bytes. Audit byte/page counts describe the original render; a later legitimate re-render may differ. Actual downloaded response values are validated independently.
- History scans are bounded to 200 entries. An incomplete scan cannot establish absence, so the app stops in an uncertain state without repeating POST. Page duplication/changed first-page anchors also stop a negative reconciliation. Backend revision/options deduplication remains authoritative under concurrent clients.

## Explicit actions and uncertainty

Open Download My Story, then explicitly prepare the saved PDF. Only after validated bytes are saved does Share or Save become available. Nothing opens the native share sheet automatically. Closing that sheet does not prove a file was saved or sent.

Repeated taps are blocked. After an ambiguous POST failure, authenticated audit reads reconcile the captured selection; a matching existing audit can be downloaded. No automatic POST retry occurs. A subsequent explicit retry rechecks the saved selection and metadata first. Errors use fixed translated messages and allowlisted backend codes, never upstream private error text.

## Native privacy and cleanup

`expo-sharing` 57.0.23 matches the installed Expo 57 bundled-module range. The only semantic dependency-lock addition is that package. Its 120,316-byte registry archive was checked against the lockfile SHA-512 integrity before extraction; no package lifecycle scripts or unrelated dependency upgrades were executed. Existing pinned dependencies were restored locally. Registry vulnerability auditing was not performed.

PDF bytes use a dedicated app-cache subdirectory with random filenames and opaque in-memory handles. Limits are eight tracked files, one hour maximum age and a bounded directory scan. The cache verifies written bytes, restricts deletion to recognized files in its own directory, and cleans startup orphans. Cleanup failure blocks further PDF capabilities and offers a translated retry, while ordinary app navigation remains usable.

Leaving export, sign-out, account changes, authentication rechecking, backgrounding and unmount revoke capabilities and request deletion. A file already handed to an open OS share sheet is leased until the share promise settles; deleting it earlier can break the OS operation. No new share can begin after revocation. App termination/OS failure can leave a private orphan until next startup cleanup; cache files are not encrypted by this feature and remain subject to device/OS protections.

A one-shot RAM-only owner/project/draft ID hint can return the same verified owner to the selected saved story after native sharing interrupts authentication/navigation. The project and draft are fetched again; no private text, PDF handle or token is retained for this purpose. Sign-out or another account clears the hint.

User-selected external apps or Files copies are intentional disclosures. Memy cannot recall them, verify their deletion, or guarantee what an external app does with them. Native sharing loads lazily: an Expo Go build without the module reports unavailable rather than crashing normal startup.

## Real iPhone acceptance — NOT executed by Codex

Use only fictional English/Swedish content and the existing approved development account/backend. Do not copy configuration from another worktree automatically. This worktree's ignored mobile-local auth/API configuration must already contain approved development settings; never paste those files into a review upload. The backend must have its existing PDF export support/RPCs available. This task did not run migrations or start services.

In Windows PowerShell:

```powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-pdf-export\apps\mobile'
npm start
```

Scan the NEW normal-app QR code in Expo Go on the iPhone, using the approved controlled network. Do not use `preview:stories` for real PDF acceptance. If the native Sharing module is unavailable, report that limitation; do not install an unrelated version or enable a tunnel.

1. Sign in normally. Open a fictional English saved autobiography and note its generation/revision and wording. Open Download My Story; check simulation and manual-verification notices. Prepare, then explicitly Share or Save. Inspect the actual PDF in iOS: correct title/text/revision, readable margins/page numbering, simulation notice and no clipped text.
2. Repeat with Swedish content including å, ä and ö. Check readable text and scalable screen layout/VoiceOver at larger font size.
3. Edit a draft without saving. Confirm export cannot bypass Save/Discard. Save deliberately, export the new revision, and verify the earlier wording/revision remains in history.
4. Open an earlier export after later edits or a title change. Verify its original content/title/revision. Repeated export of identical saved inputs must not create duplicate history rows. No new autobiography generation or memory status change should occur.
5. Cancel the share sheet and return; ensure no false claim that the document was sent/saved. Return after background authentication recheck and verify the same selected story reopens through fresh authenticated reads. If authentication expires, normal sign-in is required.
6. Leave during export, disconnect/reconnect, and retry an uncertain operation. Verify no automatic repeat POST, no duplicate display, no silent latest-revision export, and clear translated errors. A concurrent edit should require refresh/retry.
7. Sign out during preparation and after sharing. Another authorized development account must not see the prior account's text/history/files. Real two-user backend authorization and private-cache lifecycle verification remain pending physical/integration testing.
8. Where practical in an approved test backend, verify empty/unsupported content, access denial, busy/timeout responses and recovery. Do not weaken backend limits or use real personal stories to cause errors.

Automated tests use blocked network/native mocks and synthetic bytes. They cannot prove deployed RPC/RLS behavior, real PDF persistence/layout, OS sharing/cleanup timing or two-user authorization. Independent review and physical acceptance are still required before commit/release.
