# Professional root navigation — Phase B1

Development-only English/Swedish presentation integration based on
b787dcd70b54f6220bfa3d7c0899a2c1f677e080. The product owner reports that the first
B1 package cleared independent source review. Its iPhone review identified visual
refinements; physical acceptance and independent review of this revised version
are PENDING. The replacement package records actual checks and exact source hashes.

## What changes

Verified login opens Home / Hem. Home has Open My Stories / Öppna Mina berättelser
and Create My Story / Skapa min berättelse. It does not retrieve projects or invent
recent-story, usage or progress information.

My Stories / Mina berättelser reuses StoryDashboard and the existing authenticated
API client. Create, Open, Refresh, loading, empty, error and backoff behavior remain.
Root account information and Sign Out are in functional Settings / Inställningar.

The three root tabs stay outside scrolling content. They disappear throughout the
existing nested create/details/edit/conversation/recording/memory/autobiography/PDF
workflows. Obsolete root callbacks cannot leave those views. Their original Back,
recording leave confirmation, editor warnings and private cleanup still apply.

Settings uses the existing language preferences, original three-scene Memory Book
Replay and secure Sign Out. Display language never changes a saved story's language.
Authenticated Replay return is an internal bounded owner-scoped RAM intent, not an
authorization URL parameter. It returns to Settings without visiting Welcome/Login
and cannot restore another account's private navigation.

Android Back from My Stories or Settings returns Home; nested Back remains with the
existing controllers. Root navigation does not change the disabled swipe policy.

The original provider hierarchy remains. Selected historical generations and private
PDF return hints remain owner-scoped; an owned PDF return is revalidated before the
exact selected draft opens. A stale async return cannot override newer navigation.

## Availability boundaries

Recording/upload operations exist. Transcription, conversation content and the
autobiography writer remain clearly labelled simulations. Real AI/voice, paid services,
Guest, subscriptions, photographs and book templates are not enabled.

Native registration remains a gated Check Details preview. Native password recovery
is not added. Settings has no unsupported account/profile/delete/upgrade controls.
The separate SAMPLE STORIES preview remains accountless and isolated.

Private text is not stored persistently by B1. Unsaved private wording/recordings
can clear on background, sign-out, access failure or leaving under the existing
privacy policy. Existing Create/Edit Story and memory-review leave-warning usability
gaps remain assigned to B3; B1 does not claim to fix those. Root tabs are hidden to
avoid introducing new exits around those flows.

## Final B1 visual refinement

Home keeps its complete welcoming Memy heading, original Memory Book artwork and
two prominent actions. The duplicate wordmark is removed only here. Shorter copy,
smaller local gaps and a 184-unit maximum artwork width reduce decorative height.
The simulation disclosure remains readable and visible below the artwork.

Root My Stories has a shorter introduction and truthful singular/plural counts
("stories shown" / "berättelser visas"). The existing 50-record slice and API
pagination are unchanged. Cards retain complete titles and readable language/status
labels in a wrapping metadata row. Create remains primary, Open remains obvious
and title-specific for VoiceOver, and Refresh is a lighter underlined action.
Default and SAMPLE STORIES presentations keep their existing spacing and copy.

The tab bar reserves more width for longer English/Swedish labels. Bold type,
selected semantics, sage fill and an underline indicate the selected tab; keyboard
focus retains a contrasting border. No labels are truncated or shrunk. Very narrow
or enlarged Swedish labels may wrap; existing large-text navigation scrolling stays.
Settings uses matching compact spacing for existing functional controls only.

Compact buttons/radios are opt-in. All controls retain at least 56-unit height;
tabs also retain at least 56-unit width. Text scales without a font-size cap. Page
scrolling, safe areas, original assets, reduced-motion handling and entrance defaults
are preserved. Source geometry suggests less ordinary-size scrolling; Jest does
not measure native text layout. iPhone appearance and VoiceOver need retesting.

## App switching and privacy — existing behavior preserved

USER-REPORTED: taking a screenshot without leaving Memy does not lose navigation.
Switching to another application and returning can reset navigation to Home.
These are product-owner observations, not device tests performed by Codex.

The source explains the reset: AuthProvider marks the app inactive and masks the
current user. The auth service stops refresh and publishes checking without a user.
AuthenticatedRoute shows the checking view and unmounts owner-keyed StoriesHome,
including private nested forms. On foreground the service revalidates; a fresh
StoriesHome starts at Home. Old navigation callbacks and pending list results are
fenced. Language/onboarding preferences and genuine auth storage are not reset.

Existing recording cleanup invalidates work, aborts requests and disposes the native
driver/owned files. Memory corrections and unsaved autobiography editor text remain
RAM-only and clear under the existing privacy boundary. No automatic write is
replayed. The separate private-PDF return exception keeps identifiers only, revokes
private stores immediately and requires a fresh owned-project check and navigation
epoch before restoring the exact selection. PDF business/cache rules are unchanged.

New bilingual integration tests exercise the actual provider/routes with mocked auth
and API boundaries: unfinished form text clears, checking hides private roots, stale
callbacks are inert, pending old-account reads abort and late rows cannot appear for
another account. Existing recording, memory-backoff and PDF suites remain required.
JavaScript tests cannot guarantee OS app-switcher snapshot timing or native audio
shutdown on a physical device; those checks remain pending.

Future proposal, NOT implemented: preserve only the last root tab as an owner-scoped
RAM hint, excluding nested screens, text and records. Reuse would require the same
freshly verified owner, no automatic writes and unchanged cleanup/PDF rules. This
needs separate product approval. The current revision intentionally returns Home.

## Windows setup — manual only

Use only the authorized development Supabase project, an approved current private
LAN backend and fictional content. This task does not start backend/Expo services,
copy private settings or send emails.

Open Windows PowerShell:

    Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-professional-root-shell\apps\mobile'

A new worktree does not inherit ignored configuration. If development.auth.local.json
or development.api.local.json already exists, preserve it. Otherwise privately copy
the corresponding development.*.example.json to that local filename and edit it in
Notepad. Do not upload local configuration in reviews.

Authentication must use only the approved project edbkuunyeyxnyenmmqud and its
client-safe publishable key, never a secret/service-role key, token or password.
API configuration must use only Charan's approved current trusted LAN root, without
adding /api/v1 twice. Do not guess an address or copy an old hotspot IP automatically.

If an approved backend is unavailable, leave its configuration unset. Home/Settings
are still local navigation; My Stories must report unavailable rather than fabricate
successful retrieval. Live integration acceptance then remains PENDING.

Existing pinned dependencies were restored locally for verification. No new UI
framework, font, dependency upgrade or lockfile change is part of B1.

When ready to test, explicitly run:

    npm start

Scan the NEW QR code in Expo Go. Do not open an older preview session or run
preview:stories as proof of this authenticated shell. The protected launcher excludes
legacy .env loading and inherited EXPO_PUBLIC settings. It uses normal LAN startup;
no tunnel, firewall change or production configuration is required.

## Revised B1 real iPhone acceptance — all PENDING

Use an approved development account and fictional English/Swedish records.
Repeat the following in both interface languages. Do not clear genuine preferences
or sessions to force first launch; use a separate approved test installation/context
for that particular case.

1. Returning signed-out launch → Welcome → Log In / Logga in. Enter the existing
   approved account privately. Verified login opens Home / Hem, not the project list.
2. Home → Open My Stories / Öppna Mina berättelser. The owned saved records appear
   only if current development FastAPI is available. Refresh deliberately and check
   no duplicates. No fake recently-used story/count appears on Home.
3. Tap Home, My Stories and Settings. Selected tab state is clear; repeating the
   selected tab does not reload a list or create anything.
4. From Home or My Stories choose Create My Story. The root bar disappears.
   Cancel/Back returns My Stories. Open a saved story, then Back returns My Stories.
5. Existing nested actions remain reachable: story editing, conversation, recording,
   memory review, autobiography, edit history and PDFs. Start recording or edit a
   saved autobiography; its existing Stay/Leave warning still controls Back.
6. Settings → Svenska / English. Root copy changes and preferences survive a normal
   relaunch. The selected project's language and completed introduction do not change.
7. Settings → Replay Introduction / Visa introduktionen igen. It starts at scene one.
   Next/Back still traverse the original scenes. Back from the first scene, Skip or
   Enter Memy returns Settings with no Welcome/Login flash. Replay does not reset
   onboarding or account identity.
8. Open an older saved autobiography, note its saved version/edit revision, prepare
   its PDF, Share/Save or cancel, and return. Revalidation returns to that exact
   selection, not silently to the newest generation. Cancel is not reported as saved.
9. Background/foreground: private content hides during revalidation. Existing privacy
   cleanup applies; save work before switching apps. Sign Out from Settings removes
   private content immediately. A cleanup failure must offer safe entrance retry.
10. Check VoiceOver root labels/selected state, entered heading focus, long Swedish
    labels, large Dynamic Type, reduced motion and bottom safe area. Buttons remain
    comfortably sized and labels are not truncated.

Additional approved fixture/two-account cases:
- Delayed list/PDF return cannot overwrite a newer action or another account.
- A 429 RATE_LIMITED / 503 API_BUSY wait survives navigation; expiry sends no request.
- Sign-out/account change during Replay cannot restore Settings for the old account.
- Another real test user cannot access the first user's stories, generations or PDFs.

These cases need separately approved development fixtures/accounts. Do not hammer
hosted services to provoke rate limits. Mocked tests are not proof of cloud ownership,
physical layout, native share saving or real AI quality.

## Review and release boundaries

Review source hashes, full diff and validation evidence in the B1 review ZIP.
This is Codex self-review preparation; independent review and physical acceptance
remain required. Outstanding Windows backend verification and fresh integration
acceptance stay separate. B1 does not authorize B2, commits, pushes, merge or deployment.
