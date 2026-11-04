# Typed conversation contract

The user can type in the same conversation used for voice memories. Typing sends
no audio and never requests transcription or spoken generation automatically.
The existing real interviewer and grounded memory-extraction adapters handle the
typed original. These AI text requests still consume the approved provider budget.
Saved reads, memory review and downloaded saved PDFs do not invoke AI.

## Send one explicit turn

`POST /api/v2/story-sessions/{session_id}/text-messages`

Send a validated Supabase access token in `Authorization: Bearer …` and one UUID
`Idempotency-Key` for the explicit action. The body is:

```json
{"text":"  Jag minns trädgården i Malmö.\n","language":"sv"}
```

`text` is 1–4000 Unicode characters, including any spaces and newlines. It must
contain a non-whitespace character and cannot contain NUL or unpaired surrogates.
The backend preserves its exact original wording without trimming or Unicode
normalization. Unknown fields, ownership IDs and client-provided provenance are
rejected. The language must match the owned active project's session (`en`/`sv`);
briefly typing another language does not change the project language.

A successful HTTP 200 response has the existing `RealTurn` shape: `user_message`,
`message`, `memories` and `mode:"real"`. Both messages have
`source_transcript_id:null` and the same `source_text_input_id`. The user message
ID and text-source ID equal the server conversation operation ID. User provenance
is `{"mode":"original","provider":"user","model":null,"version":1}`. Assistant
provenance identifies the real OpenAI model. Voice messages retain their transcript
source and have `source_text_input_id:null` in the new API response. No new field is
added to the strict capabilities contract.

## Saved history and retries

`GET /api/v2/story-sessions/{session_id}/messages` returns typed and voice messages
in sequence, with existing pagination. Reopening uses persisted messages and does
not send another provider request. User JWT ownership protects both sources.

Reuse the same action key and exact original body after a lost response. Completed
operations return the saved result; in-progress or uncertain actions cannot be
automatically reclaimed. Reconcile through the existing operation-by-ID/by-key
reads. Preserve the original draft and action key until resolved. Changed text
under an existing key returns a conflict. A later deliberate repeated answer such
as “Yes” uses a new action key and is a distinct turn. No automatic paid retries
or speech regeneration are introduced.

Errors use the existing sanitized JSON envelope: 401 for missing/expired login,
404 for unavailable/unowned sessions, 409 for completed sessions or conflicting
operation state, 422 for invalid text/language/UUIDs, and 503 for closed AI gates
or unavailable dependencies. `TEXT_CHAT_NOT_READY` means the typed persistence
preflight failed before any operation claim, spending reservation or AI dispatch.
The frontend should keep the unsent draft and explain that setup is pending.

## Persistence and compatibility

`20261103010000_real_typed_chat.sql` adds immutable `real_text_inputs` originals,
owned read policies and narrow completion/read RPCs. A raw original, both messages
and any derived memory candidates are saved atomically when a conversation
operation completes. Original text remains separate from editable memory facts,
corrections and generated drafts. Failed/uncertain processing does not create a
partial successful turn. Normal project/account deletion owns the cascade;
there is no new arbitrary deletion endpoint or permanent audio storage.

The migration intentionally adds no column to the shared conversation-messages
table. Existing voice-only rows and voice completion JSON keep their published
database shape. The new backend hydrates typed-source metadata with one owned
batched RPC only when a page actually contains typed messages; voice-only reads
need no new RPC or migration. Older backends do not understand typed rows in a
mixed session, so use the updated backend for sessions where typed chat is used.

Before a typed paid action, the backend checks the current user's owned active
session and `check_real_text_chat_scope` response. An unapplied or unverifiable
migration fails closed. Applying the migration, enabling providers, allocating
spending, and real-device/live-provider acceptance are separate actions; local
automated checks do not certify any of them. This implementation introduces no
new authorization or budget allowance.

## Development rollout — 3 November 2026

The user approved and applied this migration to **memy-ai-dev**
(`edbkuunyeyxnyenmmqud`). The reviewed migration SHA-256 is
`dd8085f98f62b3295d9c116bd624a1a4c4cfa28613201c6c541d0fedac6bce95`.
All six deployed function bodies were checked against the reviewed source.
The rollback-only bilingual ownership, exact-wording, atomicity and replay script
passed. Post-checks found zero synthetic test accounts, zero remaining typed
fixture originals, and the original voice-message columns unchanged. These are
SQL-role checks, not actual two-user JWT, provider-quality or phone acceptance.
No existing story content, Auth configuration or paid-provider configuration was
changed by this rollout.

The actual web preview runs at `http://127.0.0.1:8767/`, using the updated local
backend on port 8001. It displays the actual Supabase login, saved projects and
conversation history. A large typed composer is the default; microphone controls
are opt-in, listening is explicit, and suggested memories still require review.
Unsent words remain only in view memory and are cleared on background/context
cleanup. AI replies are never replaced by invented or simulated output.

The Mac remains explicitly **paid-AI OFF**. The separately issued WSL allowance
belongs to Tarun's single testing host and must not be reused on the Mac. The
composer can be inspected and edited while sending is disabled. A funded live
typed turn remains unverified; coordinate any later test using the complete
current remote spending history and an explicitly approved window.

Publish and review the matched source pair on
`codex/real-milestone1-ai-backend` (backend/web/schema) and
`codex/mobile-chat-autobiography-polish` (Expo). The earlier private WSL activation
wrapper is pinned to backend `a7c94a6`; it must not be bypassed or assumed to
authorize another revision. Coordinate a reviewed launcher update before paid
testing against newer backend code, retaining the complete current WSL ledger,
fixed approval identity/expiry and existing ceiling. Do not blindly reapply the
already-applied development migration.


## Text-only provider policy — 4 November 2026

`REAL_AI_TEXT_ONLY=true` restricts an otherwise explicitly authorized real-v2
server to typed conversations. Capabilities keep their existing eight fields:
conversation may be available while transcription, writing and speech remain
false. Direct transcription, voice-message processing, generation and speech
POSTs are also rejected before an operation claim or provider reservation.
Saved reads, memory review, manual editing and PDF export remain available.

This flag never creates a spending approval, changes model names or resets the
cumulative ledger. Default configuration keeps all paid AI off. A separate
fixed approval is still needed; each typed turn currently reserves two provider
attempts (memory extraction and interviewer reply). Reservations are conservative
safety accounting, not measured OpenAI charges. Replaying a completed operation
uses its saved result without additional calls.

The local 4 November window was separately authorized for US$0.50 with a
US$10.50 cumulative ceiling, while retaining the full unreconciled US$0.75
Tarun WSL hold. It is single-host, loopback-only and has a fixed expiry. Never
reuse this documentation as authorization for a later window. No private
approval, ledger, usage log or server credential belongs in a client or Git.
