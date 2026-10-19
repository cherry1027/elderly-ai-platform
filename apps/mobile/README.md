# Memy Mobile Task 2A — Animated introduction

A native Expo introduction using Memy's approved Beautiful Memory Book artwork.
First use: Choose Language → three scenes → Welcome. Next, Back, Skip and Enter
Memy are manual controls. Returning users reach Welcome; Replay Introduction is
always available there. Login, Create Account and Guest are visibly disabled.

## Start on Windows, open on iPhone

Run only in this worktree's mobile folder:

```powershell
Set-Location -LiteralPath 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-onboarding\apps\mobile'
npm start -- --port 8082
```

1. Keep this PowerShell window open. Use the same trusted Wi-Fi on PC and iPhone.
2. Scan the new terminal QR code with the iPhone camera and open it in the
   compatible Expo Go. Use this worktree's QR, not a previously opened project.
3. On first use select English or Svenska and Continue. If Welcome appears because
   completion is already saved, select Replay Introduction to inspect all scenes.
4. Stop only this Expo process with Ctrl+C when finished.

Port 8082 avoids the common 8081 port used by other previews. If it is occupied,
choose a different free port; do not stop another application's process. If access
is blocked, report the error. Do not change firewall rules or use a public tunnel.
A Windows PC cannot run Apple's local iOS simulator.

The launcher preserves Task 1's safeguards: EXPO_NO_DOTENV=1,
EXPO_NO_CLIENT_ENV_VARS=1 and EXPO_NO_TELEMETRY=1 for every command. Interactive
start/android use LAN and remove inherited EXPO_OFFLINE; verification runs offline.
No root .env, Lovable/Vite/MCP scripts, auth SDK, backend or microphone is used.
LAN hosting is development transport; Expo CLI may use its own metadata services.
It does not introduce application connections to Supabase, FastAPI or AI.
No tunnel, firewall change, Expo account, cloud build or deployment is configured.

## iPhone manual checklist — still required for Task 2A

- English: see the opening book, voice-to-writing illustration, then story draft.
  Confirm artwork really moves and is not clipped. Use Next, Back and Enter Memy.
- Back from the first scene returns to language selection. Select Svenska and
  repeat; every instruction/control must be translated. Scene 3 describes a
  future draft from confirmed memories, not an already generated story.
- Skip from an introduction scene: Welcome appears immediately. Close/reopen or
  reload this preview: Welcome and the chosen language return without the intro.
- Replay Introduction: all three scenes are available again. Completing/skipping
  replay must preserve the saved completion. Changing language from Welcome must
  return to Welcome after Continue without forcing replay.
- Welcome keeps the sprout, Memy wordmark and existing book. Log In, Create Account
  and Continue as Guest must remain disabled and visibly explained as unavailable.
- Enable iOS Reduce Motion, then replay: complete static art replaces animation.
  Disable it and replay: motion returns. Scenes never advance themselves.
- Enable VoiceOver: verify reading order, headings, progress and labeled controls.
  On each scene the new heading should receive focus; decorative art stays silent.
- Increase system text size, test the smallest available phone width and landscape.
  Content must wrap and scroll, with large controls and no cropped text/artwork.
- No microphone permission, account login, voice recording or AI request should occur.

Do not clear all Expo Go data or another project's storage to repeat first use.
Automated tests exercise fresh and returning storage independently; Replay provides
safe repeated visual inspection. Physical iPhone and Android behavior is not proved
by Jest or a JavaScript export.

## Local checks

```powershell
npm test -- --silent
npm run typecheck
npm run lint
npm run check:dependencies
npm run check:config
npm run check:bundle
npm run check:bundle:ios
```

All tools resolve inside apps/mobile. Bundles/caches remain local and Git-ignored.
Dependencies were installed with lifecycle scripts disabled; never use the root
web package scripts for this app. The only new runtime dependency is the Expo
SDK 57-compatible AsyncStorage 2.2.0. Existing SVG and React Native Animated render
and animate the original vectors; no new animation library or remote fonts.
See VERIFICATION.md for actual results and limits.

## Original web design reused

Read-only references: memy-web-animated-onboarding and memy-web-registration,
particularly MemoryBookScene.tsx, OnboardingExperience.tsx, copy.ts and onboarding.css.
No web worktree was edited and no HTML, DOM component, CSS or WebView was imported.

| Scene | Reuse and native adaptation |
| --- | --- |
| Beautiful Memory Book | Original 760×650 book/page/cover geometry, sage surround, leaves and memory symbols. Cover turns and fades as the book opens and memories appear. |
| Your Voice Becomes Your Story | Original microphone, waveform, writing lines and keyboard alternative. Voice symbols yield to writing; this is decorative, with no microphone operation. |
| Create Your Story | Original autobiography book, draft label, paragraph lines and pencil. Pages and lines appear in sequence. Copy explains confirmed memories and user editing. Faux Create My Story button/cursor omitted. |

Memy's existing Welcome sprout/book and cream #f7f4eb, paper #fffdf7, forest #345b46,
ink #342f27 and sage palette are retained. Native headings use Georgia on iOS and
system serif on Android, with scalable system body text. EN/SV scene 1/2 copy is
reused; scene 3 is adapted to avoid implying a generated autobiography.

Each scene uses a finite 1.2-second native-driver Animated.timing with layered
opacity/transforms. Leaving a scene stops the animation. Reduced motion defaults
to static until the OS preference is known and responds to OS changes. Static
art includes the completed illustration. There are no automatic slide transitions.

## Storage, accessibility and boundaries

AsyncStorage key: memy.onboarding.preferences.v1. The record contains only version,
language (en/sv) and completed (boolean). It is unencrypted preference storage,
never an identity/access-control mechanism. No passwords, tokens, personal memories
or conversations are stored. Corrupt/unsupported data falls back to first use.
Reads/writes have a 2.5-second UI timeout. Native writes are serialized so an old
save cannot overwrite newer completion. Failed storage retains current-session
progress and shows a localized warning on Welcome; completion may replay next launch.

Primary and secondary controls have minimum 56-unit height; text scales, layouts
scroll within safe areas, art keeps its aspect ratio at the available width, and
SVG decoration is hidden from screen readers. Actual clipping, focus, pronunciation
and animation quality still need device review. Platform fonts may differ.

This is an onboarding-only foundation. Functional auth, recovery, guest voice,
stories, backend integration and secure account storage remain later tasks.
Task 1's USER-REPORTED iPhone launch covered Language/Welcome only; it is not a
Task 2A graphical/device test. Self-review is not independent review.
