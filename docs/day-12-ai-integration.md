# Day 12: gated OpenAI adapters and bilingual evaluation

23 October 2026 · review branch `codex/day-7-mobile-integration`.

**Pre-approval provider implementation is ready; live quality and public live-AI
integration are not signed off.** No paid model request was made. Creating a key
does not approve spending. The current mobile/public API remains **0.8.1**, with
the same 25 operations and mock persistence contract.

## Implemented provider layer

- `openai_client.py`: direct, bounded HTTPX calls to the fixed OpenAI HTTPS origin;
  explicit timeouts, no redirects/proxy environment, no automatic retry, bounded
  responses, duplicate/deep JSON rejection, refusals/incomplete/tool output denied.
- `OpenAITranscriptionProvider`: supported WAV/MP3/M4A/WebM input, existing decoder
  bounds of 25 MB/90 seconds, English/Swedish hint, no translation/rewriting. A
  no-follow descriptor copies a bounded private snapshot; that same snapshot is
  decoded and uploaded, then removed. Original local filenames are not sent.
- `OpenAIConversationProvider`: separate structured extraction and reply calls.
  Values/evidence must be exact source substrings; at most eight candidates,
  valid years/slots/types, uncertainty/questions and no model-selected database
  IDs. Conflicts are linked locally to supplied known confirmed/pending facts.
  Only confirmed prior facts reach the reply prompt; candidates never self-confirm.
- `OpenAIStoryWriter`: first-person writer followed by a separate verifier call.
  Every returned paragraph must be covered verbatim and linked to known supplied
  sources; failed, incomplete or unsupported review is rejected. Separate
  `verify_candidate` supports deliberately unsafe factuality-evaluation drafts.
- `AISpendingGovernor`: atomic, persistent single-host SQLite reservations before
  each paid attempt, written-approval expiry/model/call/rate/budget-ceiling limits,
  restart persistence and no refunds after errors/cancellation.

Source/prompt separation and structured schemas are safeguards, not proof of
truth or actual language adherence. A model may label English text as Swedish
or falsely approve a claim. Human bilingual/factuality evaluation remains required.
The verifier is a separate pass, optionally a separately configured model, not
an independent human fact-check or a guarantee against hallucination.

## Deliberate public-API boundary

The existing SQL/Expo contract hard-codes `mode:mock` and canonical mock-story
verification. Free-form real-AI prose cannot safely be saved through those RPCs,
and a real transcript needs reviewed persistent provenance. This package does
**not** bypass canonical checks, relabel real prose as mock, or weaken RLS.

`AI_PROVIDER_MODE` selects the separate evaluation factory:

| Mode | Evaluation behavior |
| --- | --- |
| `disabled` (default) | No provider is enabled; key presence changes nothing |
| `mock` | Existing deterministic mocks; simulated audio retains its permanent notice |
| `openai` | Requires server key, configured models and a separate valid written approval before any transmission |

Starting normal FastAPI with `AI_PROVIDER_MODE=openai` is rejected. Injecting an
OpenAI provider into the public app is also rejected; audio has an additional
runtime release guard. `CONVERSATION_MODE` and `STORY_GENERATION_MODE` still only
accept `disabled`/`mock`. Tarun should **not** change his working mobile setup.

The later live release needs reviewed database provenance/verification storage,
server-trusted verification persistence, actual provider-mode response contracts,
Expo handling and authorised end-to-end tests. Those changes are intentionally
not guessed into the shared mock API while funding/quality approval is absent.

## Credentials and spending authority

The developer selected and approved secure creation of `memy-ai-dev-backend` and
its ignored server-only env destination. No plaintext key was printed, committed
or sent to Expo. Never share the backend env file or use an `EXPO_PUBLIC_*` key
for a provider secret. No new SDK dependency or paid project setting was needed.

No approval document or active allowance was created. The brief's 150/300/600 SEK
figures are proposals, not permission. Key setup is not an approval to spend them.

Future evaluation requires an administrator to record the founders' real written
approval in a private absolute-path JSON file. Its exact fields are:
`approval_id`, `approved_by`, `expires_at` (UTC), `max_calls`,
`max_calls_per_minute`, `budget_microusd`, `reserve_per_call_microusd`,
`allowed_models`. Zero/malformed/expired limits, absent files, unknown models or
modified policy under the same ID fail closed. A new approved policy needs a new
ID; do not delete/reset its ledger to manufacture allowance.

Approval and ledger files require private 0600 regular files in existing 0700
directories with no linked components. After approval, an administrator must
create the ignored `backend/.private/` directory and approval file manually;
the ledger is created on the first approved reservation. The governor is
**single-host POSIX evaluation only**; Windows live evaluation stays closed until
reviewed ACL controls exist. Distributed workers need central atomic controls.

Reservations consume administrator-chosen **cost ceilings**, not measured
provider charges. Review current model rates, maximum input/output/audio sizes,
SEK/USD conversion and worst-case per-attempt cost before assigning a ceiling.
The implementation cannot verify that human estimate or authenticate the founder
from the `approved_by` text. Restrict file writes to the authorised administrator.
It is not a universal OpenAI account billing cap; other keys/projects/callers are
outside this ledger. Check actual [OpenAI usage](https://platform.openai.com/usage)
and enforce appropriate project controls too. Alerts alone are not a hard stop.

Each HTTP attempt is committed to the ledger first, including future explicit
retries; errors/cancellations receive no refund. Conversation uses two calls,
writer+verifier two. The complete CLI below uses up to **20 successful HTTP
attempts** for both languages, absent earlier refusal/validation/error/limit stops.
There are no automatic paid retries.

## Offline evaluation and prepared audio

Default inspection has no model calls and does not load credentials:

```sh
cd backend
.venv/bin/python scripts/evaluate_ai.py
```

It reports `paid_calls:0`, `quality_status:NOT_RUN`, never fabricated accuracy.
The [fictional evaluation dataset](fixtures/day12-ai-evaluation.json) covers names,
dates, source grounding, contradictions, code switching, unsupported claims,
provider failure, usage limits and the separate ownership gate.

The optional macOS builder uses already installed Samantha/Alva voices locally:

```sh
.venv/bin/python scripts/prepare_ai_evaluation.py /absolute/new/fixture-directory
```

It refuses to overwrite an existing directory. Other platforms can deliberately
record the same fictional references. Two synthetic recordings were prepared
locally and fully decoded: English **6.21 s / 202796 bytes**, Swedish
**7.68 s / 250000 bytes**. They are speech fixtures, not recognizer outputs or
elderly/accent/noise acceptance evidence, and are not published with the source.
Their local paths are recorded in [status](day-12-status.md).

Only **after** written approval, current model/cost review and explicit fictional
audio-upload consent may an authorised operator run:

```sh
.venv/bin/python scripts/evaluate_ai.py --live --consent-to-provider-upload --audio-directory /absolute/fictional-fixtures
```

No live command was executed here. Set the evaluation-only mode/models/approval
and ledger paths deliberately in the server environment first; the CLI cannot
turn itself on or create an approval. Do not run this command from Expo or as a
public HTTP endpoint. It performs no Supabase writes and tests no Auth JWTs.

The harness measures normalized word error rate and named-entity/year presence,
checks a known 1974→1975 contradiction, tries a language switch, runs a grounded
story and independently challenges its verifier with an unsupported award.
It prints only aggregate fictional-case metrics, not transcripts/story content.
`HUMAN_REVIEW_REQUIRED` is not a release pass. WER alone misses meaning changes;
review spoken-number formatting, names, negation, dates, model reply language,
clarification usefulness and verifier false positives with actual consented
representative elderly recordings before any pilot.

## Tarun's handoff and errors

Continue using the existing [mobile API contract](mobile-api-contract.md) and
[story/PDF guide](day-11-story-integration.md). Paths/JSON schemas remain unchanged;
there is no new live mobile success shape to implement yet. Keep all simulation
notices. Public iPhone/PDF and fresh two-user-token acceptance remain separate.

Evaluation-only errors use safe `APIError` codes, never raw upstream text:
`AI_SPENDING_NOT_APPROVED`, `AI_NOT_CONFIGURED`, `AI_USAGE_LIMIT`, `AI_RATE_LIMIT`,
`AI_USAGE_UNAVAILABLE`, `AI_INPUT_LIMIT`, `AI_PROVIDER_RATE_LIMIT`,
`AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_INVALID_RESPONSE`,
`CONVERSATION_INVALID_RESPONSE`, `CONVERSATION_PROVIDER_FAILED` and
`DRAFT_VERIFICATION_FAILED`. These are not promises that every code is exposed by
the current mock mobile API. Do not parse provider bodies or log private prose.

## Official API references reviewed

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format`, strict JSON schema; the backend still validates returned values.
- [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses): explicit `store:false`. This is not a promise of zero provider retention; privacy/region terms still need review before personal data.
- [Transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create): file upload and original-language transcription.
- [Model deprecations](https://developers.openai.com/api/docs/deprecations): the brief's `gpt-4o-mini-transcribe`/`gpt-4o-transcribe` remain compatibility options but are scheduled to shut down 26 February 2027. No silent model substitution was made; review the current replacement workflow before activation.

Text/verifier models are deliberately not chosen without access/cost approval.
Current API compatibility and quality are still unverified by fake responses.
