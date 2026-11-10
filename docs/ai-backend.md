# AI backend

How server-side AI is structured. Setup of the Vapi voice flow is in
[../VAPI_SETUP.md](../VAPI_SETUP.md).

## Layers

| Layer | Where | Responsibility |
|---|---|---|
| Provider client | `lib/ai/client.ts` | One chat call to any OpenAI-compatible API: timeout, optional retry (429, 5xx, network; never timeouts or 4xx), `Retry-After`, token usage, typed `LlmError`. |
| JSON helper | `lib/ai/json.ts` | `chatJson()`: parse, validate, and re-ask on unusable output. Reports every billed call through `onUsage`. |
| Prompts | `lib/ai/prompts/` | One file per prompt: message builder, strict output parser, version string. |
| Guardrails | `lib/ai/usage.ts` | Rolling-24h per-user call cap (`AI_DAILY_CALL_LIMIT`) and usage records in `ai_usage`. |
| Features | `lib/interviews/`, `lib/sessions/` | Question generation (Vapi tool) and session feedback. Handlers are `Request -> Response` with injected dependencies, so tests need no network or database. |
| Routes | `app/api/**` | Thin: build real dependencies, call a handler. |

## Endpoints (signed-in user, JSON)

| Method and path | Body | Result |
|---|---|---|
| `POST /api/sessions` | `{ interviewId }` | `201` new session for an interview you own |
| `GET /api/sessions/:id` | | session plus feedback (or `null`) |
| `POST /api/sessions/:id/feedback` | empty, or `{ answers: [{ questionIndex, answer }] }` | `201` AI feedback saved, session completed. Response includes `source`: `transcript` or `submitted`. |

Errors are `{ success: false, error, message }`. Notable codes: `401 unauthorized`,
`404 not_found` (also for other users' sessions), `409 already_evaluated` /
`session_closed`, `422 transcript_too_large`, `429 quota_exceeded`, `502/503/504 llm_*`, `503 server_misconfigured`.

Feedback check order is cheap to expensive: auth, body, ownership and state,
quota, config, LLM, save. Nothing paid happens before the first four pass.

## Where feedback input comes from

Following the diagram (Vapi call, then transcript on `interview_sessions`, then a
`feedback` row), the feedback endpoint evaluates **`interview_sessions.transcript`**
when it holds something the candidate said. Accepted shapes are Vapi message arrays
(`[{ role, message }]`), `{ messages: [...] }`, or a string like `AI: ...\nUser: ...`
(`lib/sessions/transcript.ts`). A stored transcript always wins: answers in the
request body are ignored, so the browser cannot replace what was said.

If there is no usable transcript, the endpoint falls back to the `answers` in the
request body. With neither, it answers `400`. Transcripts over 60,000 characters get
`422` instead of being silently cut. Nothing writes transcripts yet: that is the Vapi
webhook, a later branch.

In `feedback.per_answer`, each entry has `source`: `submitted` means `answer` is the
user's exact text; `transcript` means `answer` is the model's short summary of what
was said, and should be shown as a summary.

## Data

- `feedback` has one row per session (unique index). `per_answer` stores the
  question, the answer, a 0-100 score and short feedback; `total_score` is the
  mean computed on the server, not taken from the model.
- `ai_usage`: one row per model call. Written by the server only; users can
  read their own.
- `capability_uses` and `save_generated_interview()`: single-use record for
  Vapi generation tokens, claimed in the same transaction as the interview
  insert. No browser access. These live in their own
  migration, `20261110000000_ai_backend.sql`, so the diagram schema stays untouched.

## Adding an AI feature

1. Add `lib/ai/prompts/<name>.ts` with a builder, a strict parser and a version.
2. Write a handler that calls `chatJson` with `onUsage` and records usage the
   same way `lib/sessions/handlers.ts` does.
3. Use `checkQuota` before the call, `describeLlmError` for the HTTP mapping.
4. Test it with an injected `fetch`. Do not make real calls in tests.

## Known limits

- The daily cap is soft: concurrent requests can pass the check together.
- `AI_DAILY_CALL_LIMIT` counts model calls, not tokens or money.
- Retrying a 5xx or 429 is limited to one extra attempt on the feedback route so
  the request stays within `maxDuration`.
