# Professional entrance and account presentation — Phase B2

Branch: feat/mobile-entrance-polish. Base: 8c33038948c317e7f91b1c6f55a55f6b6abc38e7,
the accepted B1 Home / My Stories / Settings implementation. Independent review and
physical iPhone acceptance of B2 are PENDING. Automated checks are mocked/offline.

## What changes

Welcome has one warm Memy heading, concise existing English/Swedish introduction,
one prominent actual Login action and the original Memory Book artwork at a smaller
size. Language and Replay are quiet but fully labelled large controls. Registration
is honestly labelled Check signup details / Kontrollera kontouppgifter and opens
only the existing gated local form. Guest is described as unavailable, with no fake
working action. The isolated SAMPLE STORIES entrance retains its explicit local
fallback action and unavailable-account notice; it does not become a real account.

Login and Registration reuse a small presentation module with B1 heading focus,
cream/paper surfaces, forest borders, readable fields and consistent actions.
All controls retain at least 56-unit height, text scaling and visible focus. Password
visibility is a quieter underlined action with selected/disabled semantics. Primary
pressed colors retain readable contrast. No new package, font or artwork is used.

Email Next advances to Password. Login Password Done now dismisses the keyboard
without clearing its value or submitting; Log In is an explicit action. Registration
Done retains its already approved dismiss-only behavior. Existing validation,
submission locks, cancellation, late-response fences and background password clearing
remain. Mapped error/local-check copy is readable and announced to VoiceOver; Android
uses its inline live region. Feedback reveal follows the measured form position and
settled keyboard layout. It does not add private text to an announcement or log.

Confirmation retains its existing trusted status mapping and callback/cleanup
restrictions, with smaller original artwork after the actions. Settings was reviewed
and already matches these B1 proportions; its accepted source is unchanged.
Confirmation announcements now use native speech on iOS only; Android keeps its
existing live region, avoiding a duplicate announcement of the same status.

## Safety and availability

- Existing providers, intentional-navigation authority, authentication service,
  approved development-project restrictions and native secure session store are
  unchanged. A URL cannot grant Login/Registration authority or an account session.
- Native registration and confirmation remain gated. Check details is local only:
  no account, email or authenticated access is created. Test-only enabled paths use
  mocked services, not real signup. Native password recovery is not implemented.
- Verified login still opens B1 Home. Checking/background hides private content;
  sign-out/account changes retain their existing cleanup. Unsaved private work is
  not restored merely for navigation convenience. Genuine preferences are not reset.
- Story/API/backoff/recording/memory/autobiography/PDF controllers are unchanged.
  Wait expiry performs no automatic write. Exact selected-generation PDF return
  still requires owned revalidation. B2 does not add nested-screen exits.
- AI content remains simulated; real adapters are evaluation-only. No paid AI,
  Guest, subscriptions, book-design or photograph features are activated.
- No private configuration was read, copied, changed or packaged. No backend or
  Expo development service was started. Only synthetic/offline verification ran.

## Manual Windows and iPhone verification — all B2 checks pending

Use approved development settings and fictional content only. This new worktree
does not inherit ignored mobile-local configuration. Preserve existing local files.
If missing, arrange the approved mobile-local auth/API setup privately from the safe
examples as a separate manual step. Do not use production, root .env files, old LAN
defaults, service-role/provider keys or tokens as configuration; do not create tunnels
or change firewall rules. Missing configuration must show an honest unavailable error.

When you are ready, open Windows PowerShell:

    Set-Location 'C:\Users\Grkta\Documents\Codex\2026-10-15\files-mentioned-by-the-user-elderly\work\memy-mobile-entrance-polish\apps\mobile'
    npm start

Scan the NEW Expo Go QR; do not reopen an older SAMPLE STORIES preview. Do not clear
genuine sessions or onboarding preferences merely to force a route.

Repeat in English and Swedish:

1. Returning signed-out → Welcome; verified signed-in → Home. For first-use testing,
   use a separate approved installation/test context: Language → original three
   scenes → Welcome. Existing preferences need not be erased to inspect B2.
2. Inspect spacing, book proportions, one primary Login and honest availability.
   Language and Replay remain easy to find and tap. The signup-details action must
   never imply an account was created. Guest is unavailable.
3. Welcome → Log In deliberately. Email Next advances; Password Done dismisses with
   no request/value loss. Show/Hide retains the value. Empty/malformed email errors
   are readable with the keyboard visible. Passwords must not appear in notices.
4. Use the existing authorized development account only when live login is approved.
   Correct login → Home; incorrect/offline/timeout states never imply success. Back
   while busy returns Welcome; a late completion must not revive cancelled access.
5. Background the Login form: password clears and becomes masked. A blocked cleanup
   state must keep access closed and retain secure-sign-out recovery. Use mocks or
   separately approved fixtures for cleanup/timeouts; do not repeatedly hammer Auth.
6. Check signup details with fictional email/password only. Test required fields,
   six-character minimum, matching/mismatching values and Show/Hide. Done keeps values.
   Check details must state that no account/email was created. Do not send a signup
   or confirmation email. Invalid/restored callback entries must not grant access.
7. Settings language/Replay/Sign Out remain as B1: all three original scenes return
   directly to Settings for the same verified owner. Sign Out removes private UI.
   One account must not see another account's content; live two-user proof is separate.
8. B1 tabs, root/nested separation, Back, existing editor/recording warnings, API wait
   and exact private-PDF selection must retain their accepted behavior. Save private
   work before app switching; Home after foreground revalidation remains expected.
9. VoiceOver: entered heading, field labels, Show/Hide selected state, error feedback,
   language changes without focus jumps, disabled/busy states and Back. Test normal
   and largest text, small screen/landscape, safe areas and reduced motion. All text
   and actions must remain reachable by scrolling, without truncation or shrinking.

Svenska: kontrollera Välkommen → avsiktlig inloggning → Hem, tydliga fel, Nästa/Klar,
Visa/Dölj lösenord, lokal kontroll utan konto/mejl, språk och introduktion, säker
utloggning, VoiceOver och stor text. Spara privat arbete innan du byter app.

## Limits

Native layout, actual iPhone keyboard/autofill, VoiceOver order/announcement timing,
largest Dynamic Type and Android device behavior require physical acceptance. Jest
and JavaScript exports cannot prove those results. Live registration/confirmation,
recovery, real providers and production readiness are outside B2. The Windows backend
verification fix and fresh integration/two-user ownership acceptance remain pending.
Existing nested Create/Edit/Memory unsaved-leave gaps remain assigned to B3.

No staging, commit, push, merge, deployment, B3 or B4 work is part of this task.
