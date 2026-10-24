# Phase B3: story workspace, sharing and memory review

Based on accepted B2 commit `8914946ba35183ebe4e6ddf880ad04fcb3a6ac17`.

## Keyboard correction

Login, Registration, Create Story, Edit Story and memory correction opt into the existing `Screen`'s keyboard-aware ScrollView. iOS uses React Native's native `automaticallyAdjustKeyboardInsets`, based on actual keyboard geometry. The outer KeyboardAvoidingView is disabled on iOS to avoid double adjustment; Android retains height avoidance. Focus changes can request native focused-control scrolling. Error scrolling does not override focus while the keyboard is visible. There is no guessed keyboard height, scrolling timer, dependency or nested full-screen form scroller.

Next focuses the next password field; Done dismisses the keyboard without submitting. Existing controlled values, validation and background password cleanup remain. Individual iPhone keyboard keys are controlled by iOS, keyboard type and secure entry; this task does not customize them.

Mocked tests verify the props, focus/event policy, values and submission boundary. They cannot measure an iPhone viewport, Dynamic Type wrapping or keyboard reachability. Physical retesting of all five forms is required.

## Selected story

- Share Memories opens the existing authenticated continuation workflow only after an explicit action.
- Review Memories uses the existing read-only session selection. A story with no session shows an honest unavailable state, without creating one.
- My Autobiography uses the original generation controller, including the previously selected saved generation. No generation occurs merely by opening it.
- More Story Actions contains supported project metadata editing and reloading. It never edits autobiography prose.
- Back to My Stories and Sign Out remain available; root tabs remain hidden inside these workflows. Existing exact-view/owner/navigation fences remain authoritative.

`StoryHeading` reuses B1's entry focus. `StoryDisclosure` hides supplementary information without unmounting its children. Active recording and conversation controllers are not moved into disclosures or duplicated.

## Recording and conversation

Recording state, native permission handling, consent, file identity, upload reconciliation and separate conversation submission remain owned by the existing controllers. Presentation leads with the current recording action and honest status, then saved simulated transcription/conversation. Technical references and privacy-safe development diagnostics are supplementary disclosures.

The existing native recorder stops at 60 seconds. The upload adapter separately enforces its existing 90-second duration and 25 MB limits. These limits are preserved, not increased. The current development transcription returns fictional fixed text, rather than recognizing the audio. Permanent notices remain; there is no local invented prompt, real transcription, synthesized voice or paid AI activation.

## Unsaved and uncertain work

Create Story, Edit Story and unsaved memory reviews use owner-view-scoped RAM-only leave warnings. Keep Editing preserves the draft. Explicit discard/leave is required before ordinary navigation clears it. A potentially completed save is described as uncertain, never as rolled back by cancellation. Check Saved Result invokes existing read/navigation paths only; it does not repeat a write. Backoff still disables reads where required. A warning that becomes obsolete after confirmed saving is retired without automatic navigation.

Visible Back and Android hardware Back use the same guard. Old warning confirmations are tied to a single intent and cannot authorize a later one. Captured workspace controls cannot bypass a newer metadata editor. Stale root navigation remains fenced by the original root coordinator.

For memory recovery, retained corrections and captured versions stay in the original memory controller. Explicit reconciliation preserves `1974 → 1975`, and a retry rereads complete server state before PATCH. Changed versions require re-review. Acknowledged PATCH plus failed reread remains uncertain. Expiring a wait never sends requests. Original value, year, immutable source evidence and user corrections stay distinct.

Warnings do not override privacy: backgrounding, authentication changes and authoritative route cleanup may clear private RAM and cancel work. There is no new durable storage or crash-safe draft recovery. Native recording retains its original recorder-controlled leave confirmation and cleanup.

Ordinary app navigation stays within the guarded story coordinator, and native swipe navigation is disabled. This is not a global router interceptor: a forced external link or injected native route replacement can still trigger the existing immediate privacy teardown and lose unsaved RAM. Preserving that boundary avoids delaying authentication/privacy cleanup.

## Boundaries and pending acceptance

No authentication/storage, API transport, backend, generation, history, PDF, provider configuration or dependencies are rewritten. Live registration, recovery, Guest, subscriptions and real AI remain unavailable. Autobiography/PDF visual redesign belongs to B4.

The complete review archive contains final frozen-source test evidence and English/Swedish iPhone acceptance instructions. Independent review and physical keyboard/VoiceOver/layout acceptance remain pending. Automated exports are JavaScript validation, not signed native builds. Offline dependency validation is limited assurance.
