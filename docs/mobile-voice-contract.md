# Memy real voice integration proposal

23 October 2026 · **proposal only, not implemented or enabled**.

The compatible Day 10 runtime patch is 0.8.1 at `a00df98`; it changes only stale
implicit memory confirmation, not the proposed voice functionality. No paid account, key, deployment,
model call or new voice endpoint is created by this document. The current
[OpenAPI snapshot](openapi.json) contains only existing v1 routes. Model access,
price, region and processing terms must be rechecked at approval time.

## Current versus proposed

| Layer | Implemented now | Still needed for real voice |
| --- | --- | --- |
| Recording | Tarun reports native iPhone recording/upload at `eb4eaa8` | Measured real-speech language/permission/interruption acceptance |
| Upload | Owned active session, consent, byte decoding, 25 MB/90 s limits, hash-bound UUID retries, temporary files | Approved provider adapter, content-quality/empty-speech handling, hosted limits and usage accounting |
| Transcript | Immutable original, language, source/session ID; explicit fixed fictional simulation | Real recognized text, durable structured provenance/model/mode and correction records |
| Conversation | Ordered persisted messages and atomic source-linked mock turns | Real bounded context, structured extraction, reliable contradiction handling and model evaluations |
| Memories/drafts | Pending→reviewed sourced facts; version checks; mock canonical draft generation | Real-model evidence checks, supported paraphrase policy and independent factuality review |
| Spoken reply | None | Owned synthesis/audio transport, playback lifecycle, interruption and safe retry/replay |
| Live stream | None | Agreed transport/event contract, connection recovery, VAD/end-of-turn and quotas |

Existing six-field transcript responses carry simulation provenance in their
permanent text notice; existing conversation/draft schemas restrict `mode` to
`mock`. Do not remove notices or relabel old fixtures as real transcription.
Real providers require an explicit reviewed schema/provenance evolution, not an
environment-key switch that pretends the current contract already supports them.

## Recommended first real-voice milestone

Use a **bounded, chained turn** before full-duplex streaming. This is our design
recommendation: the existing source-linked, reviewable workflow benefits from
inspecting the final transcript and approved assistant text at each stage.
OpenAI's [voice architecture guide](https://developers.openai.com/api/docs/guides/voice-agents)
distinguishes controlled STT→text→speech pipelines from continuous voice sessions.
We are not adopting a new agent framework just to add speech.

```text
recording → stop/finalize bytes → owned upload → final immutable transcript
          → source-linked assistant + pending facts commit → spoken playback
          → explicit memory review → explicit draft generation
```

Keep partial words out of authoritative history/memory extraction. In the first
milestone, pressing Stop finalizes a foreground recording; only a successful final
transcript becomes a source. The returned transcript ID, not copied text, feeds
the existing source-linked conversation action. The assistant must not start a
new audible turn while the user is still recording or while persistence is
unresolved. Display a calm processing state with an accessible cancel option.

Proposed client state sequence:
`idle → recording → finalizing → uploading → transcribing → committing_turn →
speaking → idle`. Each action is bound to an account, project, session and
client-turn UUID. Failure/interrupt/sign-out invalidates the UI generation fence;
late completions must not appear under the next account/session.

The first implementation should preserve the existing audio-format/size/duration
rules. `en`/`sv` come from the project/session; detected language never silently
changes that preference. Benchmark Swedish dialects, names/dates, pauses,
code-switching, silence and microphone noise with consented evaluation clips.
A supported-language label is not evidence of acceptable transcription quality.

## Candidate providers: approval and evaluation first

| Stage | Candidate / reason | Decision gate |
| --- | --- | --- |
| Bounded STT | OpenAI `gpt-transcribe`; current official file-transcription starting point, separately replaceable adapter | EN/SV accuracy, timeout/error handling, region/DPA/retention, approved budget and account availability |
| Conversation/extraction/draft candidate | OpenAI `gpt-5.6-terra` with bounded structured responses, minimal necessary context and no unrestricted tools | Evidence/contradiction test set, latency, output/reasoning budget, schema review and source-preserving verification |
| Spoken reply | Evaluate OpenAI `gpt-realtime-2.1-mini` behind a separate text-conditioned audio adapter, or obtain a dedicated TTS alternative quote | This is a different Realtime workflow, not a drop-in `/audio/speech` model; verify spoken words, Swedish quality, interruption and cost before selecting |

The official [transcription guide](https://developers.openai.com/api/docs/guides/transcription)
recommends evaluating representative audio rather than assuming a fixed quality.
[GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
and [Realtime 2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
are candidates, not models already accessible or benchmarked in Memy's account.

Do **not** start a new long-lived integration around `gpt-4o-mini-tts`, `tts-1` or
`tts-1-hd`: the official [speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
currently marks them deprecated with shutdown on 6 January 2027. Its replacement
requires an API-workflow change. Audio-generation models may paraphrase supplied
text; prompting alone does not guarantee verbatim TTS. A spoken-reply adapter
must pass text/audio alignment and unsupported-claim tests, or use a reviewed
dedicated TTS implementation instead. Always disclose that the voice is synthetic.

## Evidence, conversation context and corrections

PostgreSQL remains the source of truth, not a provider conversation ID. Load only
the owned recent turns, selected language, reviewed memories and unresolved
questions under bounded context/token budgets. Do not send the user's entire
library by default. Put transcripts in the data section: spoken prompt injection
must not authorize tools, account operations, payments or access to other stories.

The model proposes one short follow-up and typed fact candidates referencing
exact immutable source-message IDs/evidence spans. Validate those references,
types and excerpts server-side; reject unsupported claims rather than inventing
missing life details. All facts remain pending until explicit review. A separate
grounding check and representative human review are needed; one model declaring
its own output verified is insufficient.

Preserve the original recognized text, editable correction layer, extracted
facts, review audit, assistant text and generated chapters separately. Review
corrections supersede the effective memory value without deleting historical
evidence. Flag uncertainty and contradictions, ask one clear question, and avoid
using a disputed value as settled context. Refresh source versions before commit;
the existing context/version checks reject stale results. Do not silently merge
contradictory facts or overwrite manually edited prose when generating again.

The present mock verifier accepts canonical evidence-backed sentences, not free
LLM prose. A real writer cannot be substituted and called `deterministic_mock_v1`.
Keep real drafts unverified until a separately designed factuality policy passes;
retain explicit unsupported/stale-source states and the ability to refuse output.

## Proposed transport and playback boundary — not callable today

Freeze v1 while the frontend finishes PDF/Continue. Before implementation, agree
a new versioned voice-operation contract covering these proposed resources:

- Owned turn operation: stable UUID plus exact bytes/source binding, status,
  immutable transcript ID, assistant message ID and provenance.
- Owned spoken-reply resource: references an existing persisted assistant
  message, synthesis parameters/version and a stable action key; never arbitrary
  text supplied by an untrusted client.
- Status/reconciliation read: account-scoped operation lookup so ambiguous
  responses can be resolved without guessing the latest transcript.
- Explicit cancellation: marks the intended operation/response; never implies
  already billed provider work or committed messages were undone.

Names, paths and response JSON for these resources are intentionally not promised
as existing endpoints. Approve them before mobile UI code depends on them. For
bounded playback, authenticated binary audio retrieval into private app cache is
simpler to test first; choose the actual codec/content type and cache/expiry
policy together. A provider-completed event means generation ended, **not** that
the phone finished playback. The client signals playback end/interruption for
the matching response ID; late callbacks cannot unlock another turn.

On interruption, stop local playback immediately, cancel synthesis where
supported, record how much was actually heard and prevent echo from becoming a
new user recording. Persisted assistant text remains intact, but future context
must not assume an interrupted reply was fully heard. Retrying synthesis never
creates another assistant message. Separate upload, conversation and speech
action keys; bind keys to payload hashes and reject changed requests with 409.
Do not automatically repeat a paid request after an ambiguous provider response;
reconcile first or surface a safe explicit retry.

For later true streaming, evaluate WebRTC on the native client and a backend
control channel or a server-owned WebSocket relay. These require a reviewed
development build/transport, not an assumption that Expo Go already implements
them. Never distribute a standard provider secret. Short-lived provider session
credentials, if approved, must have bounded scope/lifetime and server-enforced
ownership/entitlement limits. Do not relay a Supabase token as a provider token.

The [Realtime conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations)
describes provider events and interruption handling; Memy still needs its own
durable ordering, cancellation and replay mapping. VAD can propose a turn end,
but the application must commit a final turn before storing facts or playing the
next reply. Older adults' pauses need an accessible manual Stop/Continue fallback.

## Cost model: illustrative usage, not a quote or subscription price

The following USD rates were checked in official documentation for this plan:

| Candidate stage | Rate used |
| --- | --- |
| `gpt-transcribe` | $0.0045 per input audio minute: [model pricing](https://developers.openai.com/api/docs/models/gpt-transcribe) |
| `gpt-5.6-terra` | $2 input / $12 output per million text tokens: [model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| `gpt-realtime-2.1-mini` | $0.60 text input / $2.40 text output; $10 audio input / $20 audio output per million tokens: [model pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) |

Illustrative **six minutes of total speech**, not a guaranteed six-minute wall
clock trial: 4 user-audio minutes, 15,000 aggregate text-input tokens and 3,000
text-output tokens for conversation/extraction, 3,000 synthesized audio-output
tokens plus 1,000 synthesis text-input tokens, and a final draft using 4,000 input /
1,000 output text tokens. Estimated API-only cost:

```text
STT                  4 × $0.0045                  = $0.0180
Conversation         0.015 × $2 + 0.003 × $12      = $0.0660
Spoken reply budget  0.003 × $20 + 0.001 × $0.60   = $0.0606
Final short draft    0.004 × $2 + 0.001 × $12      = $0.0200
Total                                                $0.1646 (~$0.17/session)
```

Thirty speech minutes at five times those conversation/audio volumes, with one
final draft, would be about **$0.743/session** under the same assumptions. A 25%
planning allowance is approximately **$0.21 / $0.93** respectively. Audio-token
counts are assumed usage budgets, **not a claimed tokens-per-minute conversion**;
measure actual usage for selected voices/speaking rates. Replayed context, hidden
reasoning/output tokens, repeated extraction, retries, synthesized-but-unheard
audio, caching choices and model changes can alter cost materially. Additional
Realtime text/audio usage must also be metered if that adapter is chosen.

These are not monthly per-user totals, verified model bills, or guaranteed guest
trial costs. Hosting, database/storage/egress, tax, email, payment/platform fees,
monitoring and support are excluded. Record per-stage usage, reserve server-side
budget before a call, enforce daily/org caps and a kill switch, then benchmark an
approved small cohort before proposing prices. A user-facing free trial still
costs the company money. No spending is approved by these calculations.

## Latency targets and release gates

Initial **engineering targets, not measured promises**: for a short finalized
turn on good connectivity, STT 1–4 s, bounded text workflow 1–4 s, first reply
audio 0.5–2 s after approved text, plus upload/commit time. Aim for roughly 3–10 s
after Stop to first audio at median; measure p50/p95 by language/network and show
honest progress. Streaming may improve perceived delay but adds ordering and
interruption complexity; no universal sub-second SLA is claimed.

Before paid pilot activation: founder budget approval; provider/key provisioning
in backend secrets only; approved processing region/terms; consent and retention;
EN/SV evaluations; source/contradiction/red-team tests; cost caps; cancellation /
retry / quota / offline tests; HTTPS staging; and native playback acceptance.
The [OpenAI data-controls guide](https://developers.openai.com/api/docs/guides/your-data)
describes retention and eligibility-dependent controls. Do not assume EU hosting
of Memy's database implies all provider processing is EU-only or zero-retention.
Use provider-minimal storage options where available, but verify endpoint-specific
retention and deletion behavior before sending real autobiographical data.
