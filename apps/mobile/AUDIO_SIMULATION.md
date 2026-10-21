# Task 3D-4A — fictional audio simulation

Development-only native recording and simulated transcription. This is NOT speech recognition.
Only an explicitly recorded fictional sample may be uploaded. No AI reply, message submission,
memory extraction, story generation, PDF, guest feature or paid provider is enabled by this task.

## Verified contract and scope

Frontend branch: feat/mobile-audio-simulation, base ed05ebdcf1502d85fe0d168dbdee63fad204c210.
Read-only backend reference: codex/day-7-mobile-integration, Day 9
73094c77c9c9d04a9a4c6b213b05112eb675c130.
The source of truth is docs/day-9-mobile-audio.md and the backend audio routes/schemas.

- POST /api/v1/story-sessions/{session_id}/transcribe, HTTP 200.
- Current verified account access token in Authorization: Bearer; UUID Idempotency-Key.
- Expo File-backed multipart bytes, filename recording.m4a, MIME audio/mp4; language en/sv
  matching the session, and consent string "true" only after a deliberate checkbox and upload tap.
- The native fetch implementation supplies the multipart Content-Type/boundary.
- Response: transcript_id, session_id, language, text, status completed, created_at.
- Preserve the backend's permanent bilingual simulation notice and transcript ID.
- Never POST returned text or source_message_id to /messages in this task.
- GET /api/v1/story-sessions/{session_id}/transcripts?limit=50&offset=0 loads completed
  history when returning; it never automatically uploads anything.
- Default backend returns 503 TRANSCRIPTION_DISABLED. Simulation requires the separate
  explicit launcher flag. The frontend cannot enable a server provider.

The recorder uses AAC in M4A, high-quality SDK options, cache-only temporary files, and
a 60-second foreground cap. Start with a 5–10 second fictional clip. Backend limits remain
unchanged: 25,000,000 bytes, 90 decoded seconds, 8–96 kHz, <=2 channels, one audio stream.
The shorter frontend cap leaves room for encoding padding; it is not a guest quota.

## Dependencies and native capability

SDK 57-compatible expo-audio ~57.0.5, expo-file-system ~57.0.7 and expo-crypto ~57.0.4.
expo-audio has an expo-asset peer; its override is constrained to the installed SDK map's
~57.0.20, preventing npm from choosing an SDK 58 native peer. No Expo SDK upgrade.
The existing lockfile was updated in place; install scripts, audit and funding calls were disabled.
Existing transitive-package deprecation notices were not fixed through unrelated upgrades.

The expo-audio plugin permits Android recording and supplies a bilingual microphone explanation.
Background recording and background playback are explicitly false. Camera, contacts and precise
location blocks remain. The only microphone implementation is src/audio/native-recorder.ts.
No microphone permission is requested on page mount.

These packages are included in SDK 57 Expo Go. The user has reported successful permission,
recording and stopping on a real iPhone; Codex did not perform that device test. Custom permission-message/native-manifest changes
take effect in a newly built standalone/development app, not in the Expo Go host's own manifest.
No native development build, tunnel, firewall change or paid build was performed.

## Privacy and lifecycle

Only the real verified owned Conversation ready state mounts the recording controller.
Sample Stories never mounts it; a second controller guard rejects sample mode or missing API config.
The existing token accessor, private-LAN URL restrictions, account checks and refresh rules remain.
No access/refresh token, password, recording bytes or transcript content is logged.

A synchronous action lock prevents repeated Start, Stop and Upload taps. A new recording receives
one secure native UUID; an uncertain explicit retry retains the same immutable stopped file, UUID,
session and language. There is no automatic write retry. A timeout/abort does NOT prove rollback.
History has no upload-key/hash mapping: the app never guesses that the newest history item
reconciles an uncertain recording. Discarding or leaving explains that an upload may already have
been processed; only the local file is discarded, not a backend record.

Back, Sign Out and Android hardware Back confirm abandonment of a local/pending recording.
Foreground loss, unmount and account/project/session changes stop/dispose capture, abort requests,
clear private UI and fence late results. The native capture lease prevents an old async cleanup
from disabling a new recorder. Temporary cleanup targets only exact files returned by the owned
recorder under this app's cache; no recursive cache deletion or backend audio deletion exists.

Audio and retry keys are not persisted in AsyncStorage/SecureStore. After a process exit or
abandonment, retrying the original is no longer possible; check saved backend history instead.
Cleanup is best-effort on OS/filesystem failure; abrupt process termination may leave an app-cache
file for the OS to reclaim. Unresolved local recordings do not survive app termination.
Older unlabelled/pre-Day9 transcript history is rejected safely rather than being called simulated.
Only the first 50 saved transcripts are displayed; additional pagination is out of scope.

## Windows setup — perform privately, after review

Codex did not start services, copy credentials or make live authentication/backend requests.
Both ignored mobile-local config files may be absent in this new worktree.

1. In PowerShell:
   ```powershell
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-audio-simulation\apps\mobile'
   Test-Path .\development.auth.local.json
   Test-Path .\development.api.local.json
   ```
2. If a file is absent, create it privately using its credential-free example. Do not overwrite
   existing values. Auth must use only the approved development project edbkuunyeyxnyenmmqud and
   its client-safe publishable key. API must be the current Windows private IPv4 address on your
   personally controlled hotspot/home network, with port 8000. Never use a service-role key,
   production URL, shared/student Wi-Fi, public tunnel or a guessed IP.
3. In a separate PowerShell window, from the existing prepared backend virtual environment:
   ```powershell
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-backend-day7\backend'
   .\.venv\Scripts\python.exe scripts\run_mobile_dev.py --lan --simulate-transcription
   ```
   Confirm the Day 9 checkout and simulation flag. Do not substitute a paid provider or plain
   Uvicorn command. If the existing virtual environment is missing, coordinate with Charan;
   do not install backend dependencies as part of this mobile task.
4. Stop only this app's previous Metro terminal with Ctrl+C; fully close Expo Go without clearing
   its data. In the mobile PowerShell window run:
   ```powershell
   npm start
   ```
   Confirm MEMY NORMAL APP and scan the NEW QR code. Do not use preview:stories for live tests.
   Do not reset onboarding preferences or legitimate secure sessions.

## Real-iPhone acceptance — still PENDING

Use the existing authorized development account and a fictional owned story. Do not record a
real family history or sensitive information. Never share an unredacted network dump or tokens.

1. Open My Stories -> a fictional English story -> Start/Continue Conversation.
2. Confirm the page explains fictional simulation, not recognition of spoken words.
3. Tap Start recording. First test microphone denial: no recording/upload should occur.
   Allow microphone access in iOS Settings for Expo Go when ready to continue.
4. Tap Start recording and allow permission. The existing Auth privacy guard may unmount the
   screen if the OS permission dialog makes the app inactive. If you return to My Stories,
   reopen the fictional session and tap Start again. This is not evidence of a lost login.
   Recording must not silently start after a stale permission prompt.
5. Speak a made-up 5–10 second sample. Check active status and Stop recording. Review duration.
   Unticked consent must prevent Upload. Test Discard -> Keep, then Discard -> confirm removal.
6. Record another fictional clip, Stop, deliberately tick consent, then tap Upload once.
   Check a completed transcript with a valid Transcript reference. Preserve the returned
   bilingual notice. It MUST say simulation and must NOT claim these were your spoken words.
7. Tap repeatedly during Upload: one logical upload only. Back/Sign Out while pending must
   confirm local abandonment, cancel UI work and never reveal a late result to another account.
8. Return to the same conversation. History should show the completed transcript without
   another POST. Check backend record counts with Charan; do not infer counts from UI alone.
9. Repeat in a Swedish fictional project and with Swedish interface copy. Session/project
   language, not just screen language, must control the request.
10. Test a network interruption/timeout with fictional data. An explicit retry must retain
    the original file and UUID. Do not re-record to reconcile an uncertain upload.
11. Test the backend's default disabled mode: a valid upload must show disabled simulation,
    with no invented transcript. Restore simulation deliberately for further acceptance.
12. Test leaving/backgrounding during recording, app reopening, and Sign Out. Confirm microphone
    use stops, no unauthorized upload occurs, and no old account's transcripts appear after login
    to another authorized account. Coordinate a real two-user ownership check with Charan.
13. Check VoiceOver, large text, comfortable controls, content scrolling and English/Swedish
    errors on the device. No native accessibility/device outcome is claimed by unit tests.

## Safe offline automated checks

```powershell
npm test
npm run typecheck
npm run lint
npm run check:config
npm run check:dependencies
npm run check:bundle:ios
npm run check:bundle
```

The protected launcher blocks dotenv/EXPO_PUBLIC injection, disables auth/API config during checks,
disables Expo telemetry and makes configuration/bundling/dependency validation offline. Test setup
blocks fetch/XMLHttpRequest/WebSocket except explicit synthetic mocks. Expo warns that its offline
dependency check is less authoritative than an online registry check; SDK map/installed versions
are also checked locally. JavaScript exports are not native builds or proof of device operation.

Suggested future commit message: feat: add native recording and simulated transcript upload

Stop for manual iPhone verification and independent code review before committing or starting 3D-4B.

## iPhone startup correction and retest

USER-REPORTED: the first real-iPhone attempt requested microphone permission, then displayed
"Your recording could not be prepared safely" without entering Recording or showing Stop.
A successful real-iPhone recording/upload has NOT yet been confirmed.

Source-confirmed compatibility defect:
SDK 57 expo-audio chooses appContext.fileSystem.cachesDirectory, while expo-file-system Paths.cache
uses appContext.config.cacheDirectory. These can differ in Expo Go. The former strict prefix test
rejected a valid native SDK output before record() could run. A mocked reproduction using the
installed SDK's directory layout failed before the correction and passes after it. The phone's
actual URI/native exception was not captured, so this is a reproduced source defect consistent
with the symptom, not a device-observed path diagnosis.

The original scoped-cache rule remains. On iOS only, the adapter also accepts exactly
Library/Caches/ExpoAudio/recording-UUID.m4a under the SAME cache ancestor derived from trusted
Paths.cache. It canonicalizes only the /private/var versus /var alias for comparison.
Other containers, sibling project directories, traversal, remote/non-file URLs, malformed names,
and unowned discard targets remain rejected. Original URIs are retained for native file operations.
There is no directory scan or recursive deletion. No safety validation or backend rule was removed.
Expo Go's native recording folder can belong to its host app rather than the individual experience;
use fictional clips only. A standalone app's privacy/storage review remains necessary before real
personal recordings.

The installed SDK initialization sequence remains: explicit permission while active -> foreground
audio mode -> native high-quality AAC/M4A constructor -> await prepareToRecordAsync() without
replacement options -> validate native output ownership -> record({forDuration:60}) -> confirm native
isRecording and status. Preparation and startup are separate from finished-file duration/size checks.

Fixed, translated messages distinguish foreground readiness, audio activation, preparation,
recording startup, interruption and file validation. No native exception, file URI or permission
payload is logged or displayed. Preparing is a busy state; Stop appears only after native capture
is confirmed. Current verified ownership is checked again after the permission prompt.
Duplicate active events cannot reset a running/preparing recorder or enable a second Start.

AppState privacy behavior is preserved: inactive/background cancels and disposes the current attempt.
A system permission popup may therefore return you to My Stories. A stale permission result cannot
start recording; reopen the session and tap Start deliberately to get a fresh recorder. No legitimate
session, password or onboarding preference is cleared to force this flow.

Earlier recording-startup retest (now USER-REPORTED successful; see upload retest below):
1. Stop only this app's old Metro terminal with Ctrl+C. From apps/mobile run npm start and scan its
   NEW normal-app QR code. No dependency installation or configuration change is needed for this fix.
2. Log in normally if needed; reopen an existing fictional owned conversation.
3. Tap Start recording. If iOS naturally prompts, choose Allow. If access was already granted,
   the existing grant is reused. Do not reinstall Expo Go or reset app preferences just to force
   the first-time prompt.
4. If the OS dialog returns you to My Stories, reopen the same session and tap Start again.
5. Expect Preparing briefly, then Recording with a visible Stop recording button and duration.
   Record 5-10 seconds of fictional material and choose Stop. Expect a ready clip; consent remains
   unchecked, and no upload occurs. Discard the clip when finished.
6. Repeat another recording; test Swedish; test leaving/backgrounding and subsequent deliberate
   retry. Do not upload a real history. Upload/simulation testing follows the original checklist.
7. If any error remains, report only the exact fixed message and whether it happened during
   permission, Preparing, Recording or Stop. Do not send native paths, raw logs, credentials or audio.

The recording-startup correction was subsequently USER-REPORTED successful. Real upload remains pending.


## Real-iPhone upload correction — SDK 57

Confirmed source defect: Expo 57.0.30 installs Expo fetch globally
(node_modules/expo/src/winter/runtime.native.ts). Its convertFormDataAsync explicitly rejects
the RN-only {uri,name,type} part before NativeRequest.start. The old catch then called this
a network failure. A regression test using the actual installed SDK serializer reproduced this
failure with fake bytes and a fake HTTP boundary; no backend was contacted.

The multipart part now exposes bytes() backed by the existing expo-file-system File, with fixed
recording.m4a/audio/mp4 metadata. The lazy reader verifies existence, expected size and returned
Uint8Array length. It does not copy, rename, mutate or delete the original. Expo's serializer
builds the boundary and binary multipart envelope; no URI text or Base64 replaces the recording.
Exact field names/values and HTTP 200 response validation match the Day 9 backend.

Token retrieval still uses the foreground, verified same-account user session, never a publishable
key. credentials:omit, redirect:error, AbortController and the 60-second whole-operation budget
remain. Installed Expo fetch supports credentials/redirect and checks abort after local body
conversion, before native HTTP. Its cache option is ignored; cache:no-store did not cause this bug.
The shorter 10-second metadata/history deadline remains. Slow connections or the backend's separate
upload/decoder/provider budgets can still time out. A timeout/abort is never proof of rollback.

Development-only on-screen diagnostics contain fixed translated stages, outcome, HTTP status and
an allowlisted status/code pair. They are in memory, not logged or persisted, and cleared on new
recording, discard and account/session/lifecycle changes. 'Request begun' is NOT 'transmitted';
only a returned HTTP status establishes a response. Local file-read failures are distinguished
from transport rejection, HTTP failure and response-validation failure. Native error messages,
file paths, URLs, tokens, UUIDs, audio and response bodies are excluded. Late diagnostics cannot
overwrite a cancelled or completed attempt. Diagnostic callbacks cannot control upload behavior.

The original same-file/same-UUID explicit retry remains unchanged. A new multipart boundary per
attempt is normal: the backend identifies the original decoded file bytes and idempotency key,
not the entire envelope. No automatic retry or replacement recording is used to reconcile uncertainty.
Zero database rows alone cannot prove a request was never sent: auth, format or provider errors
can occur before a claim is recorded. Here the installed serializer gives independent local evidence.

### Exact Windows / iPhone upload retest (PENDING)

1. Keep the existing approved development backend running with --simulate-transcription.
   Do not enable a real transcription provider. Do not edit Supabase or local credentials.
2. In only this app's old Metro terminal, press Ctrl+C. Open Windows PowerShell:
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-audio-simulation\apps\mobile'
   npm start
   Scan the NEW normal-app QR code in Expo Go; do not reuse an older running bundle.
3. Log in with the existing approved development account, open an owned fictional story and its
   active conversation. Record 5-10 seconds of made-up speech and Stop. Consent must still be off.
4. Check consent, then tap Upload once. Expect HTTP 200 / response verified, a transcript reference
   and the permanent bilingual SIMULATED / FICTIONAL notice. The text is fixed fiction, not your words.
5. Leave and return to that same conversation. Its saved simulated transcript should reload.
   Repeat with an owned Swedish conversation. These live results must be recorded by the tester.
6. If interrupted, stay on this screen and use Retry the same upload; do not re-record or leave just
   to retry. The original file and UUID are retained. One success reference should be returned for
   the same recording. Leaving/backgrounding clears local audio for privacy; check history afterward.
7. If failure remains, share only the development check text (stage/outcome/HTTP/code), elapsed
   approximate time and whether FastAPI showed a POST status. Never share tokens, raw logs,
   authentication URLs, audio or private paths. No HTTP status means transmission is unconfirmed.

USER-REPORTED before this correction: permission, Start, Stop and an 8-second fictional recording
worked; /ready worked on Windows/iPhone Safari; simulated backend upload still failed and both
transcription tables showed zero rows. Codex did not inspect those live tables or run the device.
The fixed live upload, backend persistence and same-key replay remain unverified until retested.
Independent review remains pending. No backend, Supabase, paid AI or real speech-recognition change.
