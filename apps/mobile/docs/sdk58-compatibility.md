# SDK 58 compatibility worktree

This worktree reconstructs all 45 reviewed, uncommitted Phase B3 files on accepted
B2 commit `8914946ba35183ebe4e6ddf880ad04fcb3a6ac17` before upgrading the mobile
dependencies. Their initial SHA-256 hashes match the B3 archive. The original
B1/B2/B3 worktrees remain separate; no SDK changes are copied back automatically.

## Bounded compatibility changes

- Follow Expo's official one-SDK upgrade sequence: install Expo 58, align its
  supported dependencies, then run Expo Doctor. Retain the existing npm lockfile.
  The mobile Node engine now matches SDK 58: Node 22.13+, 24.3+, or 26+ within
  the supported release lines. Verification used Node 22.20.0 and npm 10.9.3.
- Native component refs use React's public `ComponentRef<typeof Component>` type
  rather than treating React Native function components as class types. This is
  a type-only migration; existing keyboard/focus/navigation behavior is retained.
- SDK 58 FileSystem writes are asynchronous. Private PDF preparation awaits the
  write inside the existing serialized queue before validation, byte clearing,
  cleanup or sharing. Account revocation still closes the gate synchronously.
- Keep the existing custom Home / My Stories / Settings navigation, app scheme,
  preference/storage keys, foreground-only recording and private PDF directory.
- No native projects are generated. JavaScript exports are not signed native
  builds and cannot establish physical-device compatibility.
- Router 58 requires React Native Testing Library 14; Expo's test preset uses
  Jest 30. The tests await render/event/act/rerender/unmount operations. Removed
  composite-tree queries use explicit committed React boundary probes while
  retaining the actual component render; native style checks use public host
  queries. Deprecated React Test Renderer is replaced by Test Renderer.
- Expo Doctor identified Expo Audio's required direct `expo-asset` peer. The
  SDK-supported package and its default, no-assets config plugin are included.

## Required later B3 presentation acceptance

The product owner requires a natural chat-style recording presentation: Memy's
question in a left-side bubble, the user's voice message on the right, a clear
microphone control near the bottom, Recording / Stop or Finish Speaking /
Processing states, a finalized saved transcript as a message, the permanent
simulated-transcription notice, and the subsequent Memy follow-up in the thread.
This is **not implemented by the SDK migration**. Keep it as a separate focused
B3 visual refinement after SDK stability; do not represent it as accepted or
already functioning. Existing B1/B2/B3 visuals remain in place.

## Environment and privacy

Use the protected npm scripts. They disable dotenv and EXPO_PUBLIC injection,
scrub inherited public values, and select configuration using the explicit Memy
mode rather than NODE_ENV. Expo CLI changing NODE_ENV cannot authorize local
configuration loading. Offline verification and exports use disabled Auth/API
configuration and cannot select the sample preview.

No private local JSON files are copied into this worktree. Do not copy the legacy
root environment file. The normal app safely reports unavailable authentication
until the owner separately configures the approved development client settings.
The separate `preview:stories` script has synthetic data and disables real Auth/API.
Live registration, guest access and real AI remain disabled.

## Physical iPhone verification (after review and owner approval)

1. Verify the installed Expo Go binary actually supports SDK 58. The package
   upgrade cannot update the phone's binary. If it reports a mismatch, stop and
   record both SDK versions; do not downgrade, clear data or change app identity.
2. Stop only old Memy preview terminals you recognize using Ctrl+C. In PowerShell:

   ```powershell
   Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-sdk58-compat\apps\mobile'
   npm start
   ```

3. Scan the **new** QR code. Normal startup must have no SAMPLE STORIES banner.
   Keep the phone and PC on the personally controlled LAN; no tunnel or firewall
   changes are part of this task. Do not reset onboarding preferences or sessions.
4. First verify language/Welcome, all three replay scenes, reduced motion, large
   text, VoiceOver and ordinary navigation in English and Swedish. For a separate
   synthetic-only layout preview, stop this terminal then run
   `npm run preview:stories`; its permanent sample banner is expected.
5. Authenticated acceptance requires separately approved mobile-local development
   configuration. Use fictional data only, the approved development Supabase
   project and an approved current backend address. Do not treat absent config as
   a failed upgrade or invent an address. No live check was performed by this
   compatibility task.
6. After approved setup, verify restoration, sign-out/account change, keyboard
   visibility on every form, guarded exits, retained memory corrections during
   429/503 waiting and explicit retry, background privacy, recording consent and
   cleanup, selected generations and private PDF preparation/sharing/cleanup.
   No write should replay automatically when waiting ends or the app foregrounds.

Automated mocked results, Expo Doctor findings, resolved dependency versions,
remaining warnings and source hashes are recorded in the external review package.
Physical iPhone behavior, native VoiceOver/keyboard/audio/share sheets and live
backend integration remain unverified until separately accepted by the owner.

Official references:
- https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/
- https://expo.dev/changelog/sdk-58
- https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/
- https://docs.expo.dev/develop/unit-testing/
- https://docs.expo.dev/router/migrate/sdk-57-to-58/
- https://reactnative.dev/docs/strict-typescript-api
- https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/
