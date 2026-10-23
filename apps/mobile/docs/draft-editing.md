# Task 3D-7: edit autobiographies and read saved revisions

This native development feature extends My Story Draft. It does not restore old revisions, export PDFs, regenerate stories, or change source evidence.

## Contract and safety

- The established transport uses the current verified owner's Supabase access token and approved mobile development configuration. Sample Stories cannot enter this flow.
- GET `/api/v1/story-drafts/{draft_id}` loads the actual selected saved draft.
- PATCH the same resource sends only `content` and `expected_revision`. No ownership ID, generation input, or generation idempotency key is sent.
- Content permits 1–20,000 Unicode code points after Python-compatible outer whitespace trimming. Paragraphs and meaningful internal spacing remain. Empty/invisible-only prose, NUL and unpaired surrogates are rejected before PATCH.
- Changed saves must return the next revision, `edited`, `needs_review` and `manual_unverified`. Unchanged normalized content retains its revision. Original content, immutable source snapshots, language, generation version, mode, style and creation identity must match the baseline.
- An uncertain write triggers GET reconciliation before an explicit exact retry. Only an immediately following matching revision can confirm that save. Later coincidentally identical text is a conflict.
- A 409 shows saved and local wording separately. Use current wording discards local changes. Keep editing rebases the next explicit Save onto the observed current revision; it never merges or saves automatically.
- GET `/api/v1/story-drafts/{draft_id}/history` reads persisted audit rows. Draft reads bracket each page. Scope, unique IDs, revision order and linked wording must be coherent; mixed pages are discarded.
- History loads two rows per request, fitting the existing JSON limit even for long escaped prose. At most 200 revisions are retained on screen, with an explicit incomplete-list notice if more exist. The separate original revision 1 comes from immutable `original_content`.
- No Restore action exists. Generation `version` differs from manual `revision`.

## Native behavior

The controlled multiline field supports paragraphs. Done typing and blur never save. Save is explicit. Translated validation is scrolled into view and announced without announcing private story wording. Buttons meet the existing 56-unit target and text can scale.

Back and Android Back warn before discarding dirty or uncertain wording. Sign-out immediately clears private data. Authentication failure, owner/project/draft changes, backgrounding and unmount cancel requests and suppress stale replies. Unsaved prose and frozen retry payloads stay in component memory; they are never logged or persisted.

Privacy takes precedence when the OS backgrounds, terminates or removes a private screen. Save before switching apps. No app can guarantee a warning before OS termination. An interrupted request might finish on the server; reopening reads saved state and never retries a write automatically.

Manual edits are user wording, not automatically fact-checked. Original simulation labels and immutable evidence remain. Mocked tests do not establish live persistence or backend cross-account enforcement.

## Windows and iPhone acceptance — pending

Use NEW fictional English/Swedish stories, authorized development accounts, and the existing approved development network/backend. Do not use private biographical data. Mobile-local auth/API JSON files are ignored; missing configuration must be set up deliberately using existing approved instructions, never copied automatically by tooling.

```powershell
Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-draft-editor\apps\mobile'
npm start
```

Keep only the already approved development FastAPI service running under its existing instructions. This task does not start or reconfigure it. Scan this terminal's NEW Expo Go QR code. It must say `MEMY NORMAL APP`; do not run `preview:stories`.

1. Log in and open a saved fictional English My Story Draft with supported, confirmed memories. Note its original simulation notice and source evidence. Do not regenerate merely to test editing.
2. Choose Edit My Story. Change a sentence and retain two paragraphs. Done typing must keep the text. Save once, then return. The exact wording must appear with the manual-review notice.
3. Refresh and reopen. The edit must persist. Earlier Versions must show the new and previous wording, revision numbers and dates. The separate original revision 1 remains unchanged. Reading history must not mutate anything; no Restore action appears.
4. Change text without saving. Back must offer Keep editing or Leave without saving. Keep editing retains words; leaving then refreshing shows the last saved text. Neither choice silently saves.
5. Try empty, invisible-only and overlong input. A readable error must be visible above the field and announced by VoiceOver without private prose. Invalid text must never save. Check the keyboard, scrolling, large text and touch controls on the phone.
6. Repeat saved edit/reopen/history in Swedish, including Å/Ä/Ö and paragraphs. Story language remains Swedish even if the interface language changes.
7. If two authorized development devices/sessions are available, load the same revision in both. Save in one, then the stale editor. The second must show both wordings as a conflict. Keep editing must not write until explicit Save.
8. Briefly interrupt the trusted development network around Save. Check saved wording before retrying. If the save completed, no extra revision should be created. Do not tap repeatedly.
9. Sign out while a request runs. Private text/history must disappear. Another authorized account must never see those data. Real backend ownership requires a real two-user check.
10. Reopen after background/foreground. Saved words reload; unsaved words may clear as disclosed. Verify introduction/Replay, login, registration gating, dashboard, Create/Edit Story, recording, transcripts, conversation and memory review remain intact. Editing/history must not regenerate, delete or modify source evidence.

Live persistence, iPhone keyboard/VoiceOver, interrupted network behavior and two-user authorization remain unverified by Codex. No services or live APIs were used by this task's automated checks.

## Release gate

Independent review and physical iPhone acceptance precede commit/push. Task 3D-8A/3D-8B are separate plans only; no PDF/sharing dependency or continuation code is included.
