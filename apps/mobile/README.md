# Memy Mobile Task 1

A native Android/iPhone Expo foundation containing only language selection and Welcome.
No authentication, account creation, guest access, API, microphone, story generation or storage is implemented.

## Location and tool isolation

Run all commands from this directory, never from the repository root:

```powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile\apps\mobile'
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_NO_CLIENT_ENV_VARS = '1'
$env:EXPO_NO_TELEMETRY = '1'
npm start
```

Every npm script enforces these three variables in `scripts/run.cjs`. Interactive
`npm start` and `npm run android` use LAN mode and remove inherited EXPO_OFFLINE;
they do not pass --offline or start a tunnel. Verification commands retain
EXPO_OFFLINE=1. Expo commands use only the local app installation. The repository's
legacy root environment file is never needed, imported, copied or displayed.
There are no environment files in this app and no configuration secrets.
Do not run the root Vite/Lovable scripts for mobile development.

The startup command serves the development bundle over your trusted local network
for Expo Go. This is separate from an application/backend request. No public tunnel,
firewall changes, Expo login, EAS project, cloud build or deployment is configured.
LAN mode is not offline mode: Expo CLI may contact its own development/metadata
services. This does not add Supabase, FastAPI, AI or other application requests.

## Android verification: USER ACTION REQUIRED

1. Install a compatible Android Expo Go from the Google Play listing or official
   https://expo.dev/go download page. Select the SDK matching this app's Expo major
   version (57). Avoid unofficial APK websites.
2. Connect the Windows laptop and phone to the same trusted Wi-Fi. Avoid guest/public
   networks that isolate devices. Keep the PowerShell window open.
3. Run the startup commands above. Scan the terminal QR code using Expo Go's scanner.
4. Select Svenska. Confirm the selected mark, Swedish instruction and Fortsätt.
   Continue: confirm Välkommen till Memy, the existing book illustration and Swedish text.
5. Use Byt språk; confirm Svenska is still selected. Select English, Continue, and
   check Welcome to Memy. Use Change language and Android Back. Repeat without duplicate screens.
6. Increase Android system font/display size. Check both screens on a narrow portrait
   display and in landscape. Everything must remain readable, wrap, and scroll;
   no labels should be cut off. Buttons must remain large.
7. Enable TalkBack. Check heading/reading order, language choices and their checked
   states, Continue, Welcome, and Change language. Decorative book/sprout details should
   not produce repeated announcements. Verify the screen reader reaches controls after navigation.
8. Reload the app: it starts at language selection with English selected. Selection
   is intentionally in memory only for this foundation.
9. Confirm no login, registration, guest, microphone or Create Story action appears.

Stop Expo with Ctrl+C.

### Safe troubleshooting

- SDK incompatibility: obtain the matching Expo Go from the official page; do not
  upgrade app dependencies or install globally to work around it.
- Cannot reach the laptop: confirm same trusted Wi-Fi and the QR's LAN address.
  Phone localhost is the phone, not the PC.
- If Windows firewall or network isolation blocks access, stop and report the message.
  Do not change firewall settings, expose a public tunnel or start backend services.
- Port already in use: do not stop another application's process. After confirming
  a free alternative, use `npm start -- --port 8082`.
- Missing local dependencies, permission errors or Metro failures: record the error;
  do not run root installs, delete Git locks or change permissions.
- If the bundle cache alone appears stale, stop this Expo process and use
  `npm start -- --clear`. This clears only this mobile development bundler cache.
- Android Studio/emulator installation is not part of this task.
- USER-REPORTED: the app launched on a real iPhone in Expo Go and both Language
  Selection and Welcome rendered. Codex did not perform that device test.
  iPhone navigation, VoiceOver, large text and landscape remain unverified.
  A Windows PC cannot run Apple's local iOS simulator.

## Local checks

```powershell
npm run typecheck
npm test
npm run lint
npm run check:dependencies
npm run check:config
npm run check:bundle
```

The checks enforce disabled dotenv/client-env injection and offline Expo operation.
Tests block fetch/XMLHttpRequest/WebSocket, exercise actual Expo Router navigation,
and check source/configuration boundaries. SDK/native APIs use the Expo/Jest test
environment; these checks do not contact Supabase or FastAPI.
The Android JavaScript export is a local compilation check, not a native build,
APK, deployment or proof of device behavior.

Generated caches, dependencies and Android verification export remain app-local and
Git-ignored. Package lifecycle scripts were disabled during dependency installation.
The repository root package files and existing web worktrees must remain unchanged.

SDK 57's Router brings optional peer packages into npm's dependency graph. The
app's overrides pin React DOM, Gesture Handler, Reanimated and Worklets to the
SDK-compatible versions instead of npm's newer automatic selections. They do not
enable animation, browser, microphone or backend features in this application.

## Reused Memy work and provenance

Read-only design reference: the committed registration worktree at
87a96ef44f4bde821d1ec25bf76726672187428c.

- `src/features/onboarding/OnboardingExperience.tsx`: exact sprout path and Memy
  wordmark, calm centered Welcome composition.
- `src/features/onboarding/MemoryBookScene.tsx`: static native adaptation of the
  existing Welcome open book, cream pages, forest cover, sage surround, leaves,
  bookmark and pencil. Decorative Create My Story control/cursor/DRAFT wording
  were omitted so the artwork does not suggest a working story feature.
- `src/features/onboarding/copy.ts`: existing English/Swedish Welcome title,
  description, eyebrow and footer; language names preserved. Language-selection
  instructions, Continue and Change Language are native foundation wording.
- `src/features/onboarding/onboarding.css`: cream #f7f4eb, paper #fffdf7, forest
  #345b46, ink #342f27, muted #686354 and border #d4d4c4; rounded controls and
  serif-heading/system-body character.

Artwork uses native SVG primitives, not copied HTML/CSS components or a WebView.
The heading font is Georgia on iOS and Android's system serif; exact typography
will differ across devices. No remote fonts or older Mina Minnen-branded bitmaps
are used. Decorative SVG is hidden from accessibility; user-facing text scales.

The three animated Memory Book scenes, native auth/recovery/registration, Guest
Voice visuals and its pure completed-turn reducer remain later features.
Uncommitted guest web files were not imported, moved or modified. Browser storage,
callback parsing, Vite configuration, Radix components and web auth adapters were
not copied.

## Limitations and review boundary

- Language is in-memory; reopening/reloading resets to English. No persistence policy
  is introduced.
- This is a two-screen foundation, not the full Memy product.
- No animations are present, including route transitions.
- Tests inspect scalable/flexible layout configuration; Jest does not run Android
  Yoga layout or prove real clipping, TalkBack focus/pronunciation or touch behavior.
- Android Expo Go/hardware Back and remaining iPhone navigation/accessibility
  checks remain manual.
- The user's iPhone launch/render report is limited to the two screens; other
  device accessibility/layout checks remain pending.
- No backend, production, Supabase, AI, voice, microphone or cross-user behavior is
  exercised or claimed.
- Self-review is not independent review. Android manual verification and independent
  review must precede approval to commit.
