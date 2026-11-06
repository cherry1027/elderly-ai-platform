# Pilot admission and recovery additions

6 November 2026. These reviewed additions build on backend `ac95e8c` in
`codex/real-milestone1-ai-backend`. Pin the exact published handoff commit when
integrating. Existing endpoint paths and response bodies are unchanged; no
hosted migration or activation is needed to review this code. Private local
testing approval and financial history are not part of the repository.

| HTTP status | Error code | X-Memy-Recovery | Meaning |
| --- | --- | --- | --- |
| 403 | `AI_PILOT_ACCESS_DENIED` | `contact-operator` | Verified account is outside the approved paid-AI cohort |
| 503 | `AI_PILOT_CONFIG_UNAVAILABLE` | `contact-operator` | Configured private cohort cannot be validated |

These admission errors occur before a provider claim/dispatch. They reveal no
account IDs or list contents and carry no automatic retry timer. An invalid
Supabase token is still an Auth error, independently of pilot membership.
Free operation reconciliation, saved GETs, prepared speech/audio, memory review,
story editing, exports and PDF downloads retain their normal ownership checks.

The mobile correction also validates actual status/code pairs, rather than
believing that any error named `AI_BUSY` proves a POST was not dispatched.
Known outer admission pairs are HTTP 429 with `AI_BUSY`, `AUDIO_BUSY` or
`RATE_LIMITED`, and HTTP 503 with `API_BUSY`. Unexpected HTTP status/code pairs
must preserve uncertainty and must not manufacture a retry timer.

An operation header, when supplied, must retain the exact original operation
key and kind for reconciliation. If a header is missing, several AI errors can
still occur after a paid stage: `AI_USAGE_UNAVAILABLE` during settlement,
`AI_SPENDING_NOT_APPROVED` after an approval expires between stages, and
per-attempt budget/rate failures after a previous stage. Do not mark those
actions unsent from the code/status alone. Use the existing explicit Check
Saved flow and operator assistance; never generate a new key or auto-retry a
paid POST to clear an ambiguous state. A rate cooldown is not permission to
retry a potentially completed write.

Human-facing copy should distinguish sign-in, paused/limited allowance,
provider configuration and real connectivity failures. Budget exhaustion must
not be presented as a connection failure or a guaranteed 60-second recovery.
The correction preserves the individual allowance latch: global capabilities
alone do not prove a particular user's quota has been renewed.

For listening, prepared metadata and audio GETs are free reads. They must not
register an uncertain paid speech operation. Register that operation only when
the user explicitly requests a synthesis POST. A canceled/background GET must
not silently generate new audio; an interrupted actual POST must keep its key.
