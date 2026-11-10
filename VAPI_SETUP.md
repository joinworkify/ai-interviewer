# Vapi Interview Generator: Setup Guide

This app uses one saved Vapi **Generator Assistant** with one **API Request
tool** to create interview questions by voice and save them to Supabase. It is
the same idea as the "voice agent collects role/level/type/techstack/amount and
calls an API" tutorial, adapted to this Next.js + Supabase starter. It does not
use Firebase or Vapi Workflows.

> **Nothing here is configured for you.** The code is in the repo, but you
> still have to create the Vapi tool and assistant, deploy the SQL, set the
> env vars, and expose the app over public HTTPS. Follow every step below.

## Why not Workflows?

Vapi has retired Workflows. Their migration guide recommends moving to
assistants (with tools) or squads:
<https://docs.vapi.ai/workflows/legacy-migration>. Data collection only needs a
single assistant, so we use one assistant plus one API Request tool
(<https://docs.vapi.ai/tools/api-request>).

## How it works

```
Browser (signed-in user)                  Next.js server                       Vapi
──────────────────────────                ─────────────────────                ─────
/protected/interview
  │ POST /api/interviews/capability  ──►  getClaims() → user id (sub)
  │                                       sign {sub, jti, exp} with
  │ ◄── { token } (15 min, HMAC)          VAPI_TOOL_SIGNING_SECRET
  │
  │ vapi.start(ASSISTANT_ID, { variableValues: { generationToken: token } }) ─────►
  │                                                                   assistant asks questions
  │                                                                   calls API Request tool:
  │                                  POST /api/vapi/generate-interview ◄── { role, level, type,
  │                                       verify token (sig, exp, aud)        techstack, amount,
  │                                       validate fields strictly            capability: token }
  │                                       call LLM (server-side key)
  │                                       insert row (user_id = token.sub)
  │                                       ──► { success, interviewId }  ──►  assistant tells user
  │ call-end → page refresh → list read through RLS
```

Security properties:

- The **user id is never taken from the browser or the LLM.** It comes from
  the verified Supabase session when the token is issued, and from the HMAC
  signed token when the tool calls back. Requests with a `userid`, `userId` or
  `user_id` field are rejected.
- Tokens are **short-lived** (15 min) and bound to one user. Since the
  diagram schema migration (`20261109000001`), `interviews` no longer stores the
  token's `jti` (`generation_id`), so tokens are **not single-use**: within the
  15-minute window a token can generate several interviews, each costing an LLM
  call. If that matters, add a rate limit or a consumed-token record.
- `VAPI_TOOL_SIGNING_SECRET`, `SUPABASE_SECRET_KEY` and `LLM_API_KEY` are
  server-only. Only `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and the assistant ID reach
  the browser.
- Browsers can only `select` their own interviews (RLS). Nobody can insert,
  update or delete through the browser; inserts happen only in the tool
  endpoint.
  - There is no browser delete; if you add one, do it server-side.
- The token is **not** placed in the assistant's system prompt. It goes into a
  static tool parameter, so the conversation model never has to read or
  repeat it.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Supabase project | The one this starter already uses (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). |
| Supabase **secret** key | Project Settings → API Keys → `sb_secret_…` (or the legacy `service_role` key). Server-only. |
| Vapi account | <https://dashboard.vapi.ai>. You need the **public** key. The private key is not used by this app. |
| LLM API key | Any OpenAI-compatible Chat Completions provider. Recommended example: a Google AI Studio Gemini key (see §2a). OpenAI etc. also work. |
| Public HTTPS URL for this app | Vapi's servers call your endpoint, so `http://localhost:3000` will not work. See §4. |
| Browser with microphone | Allow microphone access when prompted. |

## 2. Environment variables

**Merge, don't overwrite.** If you already have `.env.local` (for example
with your Supabase values), keep it. Add only the new variables listed below
from `.env.example`, and keep every existing line. **Do not** run
`cp .env.example .env.local` over an existing file: that replaces your real
keys with placeholders. Only if you have no `.env.local` yet should you create
one from `.env.example`. Set the same variables in your hosting provider for
deployed environments.

| Variable | Exposure | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Already required by the starter. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Already required by the starter. |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | public | Vapi Dashboard → API Keys → **Public** key. |
| `NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID` | public | ID of the assistant you create in §6. |
| `VAPI_TOOL_SIGNING_SECRET` | **server-only** | ≥ 32 random chars. Generate it with `openssl rand -base64 48`. |
| `SUPABASE_SECRET_KEY` | **server-only** | Supabase secret / service_role key. Never prefix it with `NEXT_PUBLIC_`. |
| `LLM_API_KEY` | **server-only** | Your LLM provider API key. |
| `LLM_MODEL` | server-only | A chat model ID your provider offers. This is required, and the app has no default. |
| `LLM_BASE_URL` | server-only | Runtime default if unset: `https://api.openai.com/v1`. Gemini (example in `.env.example`, §2a): `https://generativelanguage.googleapis.com/v1beta/openai`. Must be HTTPS. |
| `LLM_TIMEOUT_MS` | server-only | Optional. Default `25000`. Keep it below the tool's `timeoutSeconds`. |

Restart `npm run dev` after editing env files. For `next build` /
`next start`, rebuild, because `NEXT_PUBLIC_*` values are inlined at build
time. `/protected/interview` lists any variables that are still missing. It
shows names only, never values. It checks the Supabase variables first: if
`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is
missing, the page shows a Supabase setup notice, and
`POST /api/interviews/capability` returns
`503 {"error":"server_misconfigured","missing":[...]}`. Neither one contacts
Supabase.

If `LLM_API_KEY`/`LLM_MODEL` or `SUPABASE_SECRET_KEY` is missing, the tool
endpoint returns `503 server_misconfigured` with a `missing` list. This only
happens for requests with a valid token. The endpoint never fakes questions.

## 2a. Google Gemini (recommended example configuration)

Using Gemini means configuring **two independent things**. They do not share
settings: setting one does **not** configure the other.

| | (1) Vapi voice assistant | (2) Backend question generation |
|---|---|---|
| What it does | Runs the live conversation (collects role, level, etc. and calls the tool) | Writes the interview questions inside `/api/vapi/generate-interview` |
| Where it is configured | Vapi Dashboard (assistant + Integrations) | Server env vars `LLM_*` in this app / your host |
| Where the Google key lives | Vapi Dashboard → Integrations | `LLM_API_KEY` (server-only) |

### Getting a Google API key

- Create a **Gemini API key** in Google AI Studio:
  <https://aistudio.google.com/apikey>.
- A **Google One / Gemini app (consumer) subscription is not an API key** and
  does not give API access. You need an AI Studio / Gemini API key.
- You can use the same key for (1) and (2), but you must enter it **in both
  places separately**.
- **Never** put it in a `NEXT_PUBLIC_*` variable or commit it. It belongs only
  in Vapi's Integrations page and in server-side env (`.env.local` / host
  secrets).

### (1) Vapi assistant model → Google

Docs: <https://docs.vapi.ai/providers/model/gemini>

1. Vapi Dashboard → **Integrations** → Google (Gemini) → paste your Google AI
   Studio key.
2. Open your **Interview Generator** assistant (§6) → **Model**:
   - **Provider:** `Google`
   - **Model:** `gemini-2.5-flash` (or another Gemini model the dropdown
     currently lists and that supports tool calling).
3. **Only change provider and model.** Keep the system prompt
   (`model.messages`, §6.1) and tools (`model.toolIds`: `generate_interview`
   and End Call) exactly as they are. If you edit the assistant via the API,
   send the **full** `model` object (`provider`, `model`, `messages`,
   `toolIds`); a partial `model` object can replace the existing one and drop
   your prompt and tools. Re-check both after saving.

### (2) Backend question generation → Gemini OpenAI-compatible endpoint

Docs: <https://ai.google.dev/gemini-api/docs/openai>

No code change is needed; `lib/interviews/llm.ts` already speaks the
OpenAI-compatible Chat Completions API. Set these server-side:

```bash
LLM_API_KEY=your-google-ai-studio-api-key
LLM_MODEL=gemini-2.5-flash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
```

The app calls `POST {LLM_BASE_URL}/chat/completions` with
`Authorization: Bearer <LLM_API_KEY>`.

**Existing OpenAI users:** nothing changes. If `LLM_BASE_URL` is unset the
runtime default is still `https://api.openai.com/v1`; keep your existing
`LLM_*` values to stay on OpenAI.

### Costs and limits

There is **no guaranteed free usage**. Gemini API quotas, rate limits, free
tier availability, model availability and region eligibility are set by Google
and can change. When Google rate-limits the backend (HTTP 429), the tool
endpoint returns `503 llm_rate_limited` (§5.6). Vapi's own charges (hosting,
transcription/STT, voice/TTS, telephony) still apply regardless of which LLM
you use: <https://vapi.ai/pricing>.

## 3. Deploy the Supabase SQL

The migration is `supabase/migrations/20261109000000_create_interviews.sql`.
It creates `public.interviews`, enables RLS, and adds a single select-own
policy. It adds no insert/update/delete policies or grants for browsers
(see "Security properties" for why delete is excluded).

**Option A: Dashboard**

1. Supabase Dashboard → your project → **SQL Editor** → **New query**.
2. Paste the whole migration file.
3. Click **Run**.
4. Check **Table Editor → interviews**. The table should show **RLS enabled**
   and one policy ("Users can view their own interviews").

**Option B: Supabase CLI** (the CLI is a dev dependency; no global install needed)

```bash
npm run supabase:login
npm run supabase:link -- --project-ref <your-project-ref>   # once
npm run db:push
```

Other helpers: `npm run supabase:start` / `supabase:stop` / `db:reset` run a
local Docker stack and re-apply the migrations, `npm run db:new -- <name>`
creates a migration, and `npm run check:env` verifies your env vars (names only).

Check RLS with the Supabase **Security Advisor** (Dashboard → Advisors). It
should not flag `public.interviews`.

## 4. Public HTTPS requirement

Vapi sends the tool request from its servers to your URL:

```
https://<your-public-host>/api/vapi/generate-interview
```

Use one of these:
- **Deploy** (e.g. Vercel) and use the production URL, or
- **Tunnel** your local dev server (`npm run dev`) with a tool like
  `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`, and
  use the `https://…` URL it prints.

Tunnel URLs often change when you restart the tunnel. Update the tool URL in
§5 each time.

The Supabase session proxy (`lib/supabase/proxy.ts`) normally redirects
signed-out requests to `/auth/login`. Only this exact path is exempt, because
it authorizes requests with the signed token instead.

Quick reachability check. This is a local, read-only request with a bogus
token, and it should return `401`:

```bash
curl -i -X POST https://<your-public-host>/api/vapi/generate-interview \
  -H 'content-type: application/json' \
  -d '{"role":"Dev","level":"Junior","type":"technical","techstack":"React","amount":1,"capability":"bogus"}'
# Expect: HTTP 401 {"success":false,"error":"unauthorized",...}
# A 3xx redirect to /auth/login means the proxy exemption is not deployed.
# 503 server_misconfigured means VAPI_TOOL_SIGNING_SECRET is missing.
```

## 5. Create the API Request tool

References:
<https://docs.vapi.ai/tools/api-request> and
<https://docs.vapi.ai/tools/api-request/configuration>.

Vapi Dashboard → **Tools** → **Create Tool** → type **API Request**.

Dashboard labels can change. The JSON key in each row matches the
`CreateApiRequestToolDTO` type shipped in `@vapi-ai/web`, so treat the JSON
in §5.4 as the source of truth.

### 5.1 General

| Dashboard field | JSON key | Value |
|---|---|---|
| Tool name | `name` | `generate_interview` |
| Description | `description` | `Generate and save interview questions for the signed-in user once role, level, type, techstack and amount are confirmed. Call exactly once per call.` |
| URL | `url` | `https://<your-public-host>/api/vapi/generate-interview` |
| Method | `method` | `POST` |
| Timeout (seconds) | `timeoutSeconds` | `45` (must be longer than `LLM_TIMEOUT_MS`; the default is 20) |

### 5.2 Request body schema (filled in by the assistant's model)

| Property | Type | Required | Description / constraints |
|---|---|---|---|
| `role` | string | yes | Job role, e.g. "Frontend Developer". ≤ 80 chars. Letters, numbers, spaces, `+ # . - / & ( ) , '`. |
| `level` | string | yes | Seniority, e.g. "Junior", "Mid", "Senior". ≤ 40 chars. |
| `type` | string (enum) | yes | `technical`, `behavioral`, or `mixed`. |
| `techstack` | string | yes | Comma-separated technologies, e.g. "React, TypeScript, Next.js". 1–12 items. |
| `amount` | integer | yes | Number of questions, 1–10. |

Do **not** add `userid`, `userId` or `user_id`. The endpoint rejects any
field not listed here, except `capability`.

### 5.3 Static field (not filled in by the model)

Add this under the tool's **static parameters** (`parameters`). The SDK type
describes it as "Static key-value pairs merged into the request body. Values
support Liquid templates."

| Key | Value |
|---|---|
| `capability` | `{{generationToken}}` |

`generationToken` is a dynamic variable that the browser sets at call start
with `vapi.start(assistantId, { variableValues: { generationToken } })`. See
<https://docs.vapi.ai/assistants/dynamic-variables>.

*Alternative:* if you prefer, send it as a header instead. Add a header
`x-interview-capability` with value `{{generationToken}}`. The endpoint
accepts either, and rejects the request if both are present and differ.

### 5.4 Equivalent JSON

```json
{
  "type": "apiRequest",
  "name": "generate_interview",
  "description": "Generate and save interview questions for the signed-in user once role, level, type, techstack and amount are confirmed. Call exactly once per call.",
  "method": "POST",
  "url": "https://<your-public-host>/api/vapi/generate-interview",
  "timeoutSeconds": 45,
  "body": {
    "type": "object",
    "required": ["role", "level", "type", "techstack", "amount"],
    "properties": {
      "role":      { "type": "string",  "description": "Job role, e.g. Frontend Developer" },
      "level":     { "type": "string",  "description": "Seniority, e.g. Junior, Mid, Senior" },
      "type":      { "type": "string",  "enum": ["technical", "behavioral", "mixed"], "description": "Interview focus" },
      "techstack": { "type": "string",  "description": "Comma-separated technologies, e.g. React, TypeScript" },
      "amount":    { "type": "integer", "description": "Number of questions, 1 to 10" }
    }
  },
  "parameters": [
    { "key": "capability", "value": "{{generationToken}}" }
  ],
  "backoffPlan": {
    "type": "fixed",
    "maxRetries": 1,
    "baseDelaySeconds": 1,
    "excludedStatusCodes": [400, 401, 409, 413, 415]
  }
}
```

Retries never create duplicate interviews. A failed generation saves nothing.
After a successful save, a retry with the same token gets `409` without
calling the LLM. A retry can still cost an extra LLM call if it overlaps an
earlier request that is still running. Errors that can't succeed on retry are
excluded from retries. Set `maxRetries` to `0` if you want no retries at all.

### 5.5 Optional tool messages

| Type | Content |
|---|---|
| Request start | `One moment while I generate your interview questions.` |
| Request delayed (after ~5 s) | `Still working on it, thanks for waiting.` |
| Request failed | `Sorry, I couldn't generate the questions.` |

### 5.6 Endpoint responses (what the assistant receives)

| Status | `error` | Meaning |
|---|---|---|
| 201 | — | `{ "success": true, "interviewId", "questionCount", "message" }` |
| 400 | `invalid_request` / `invalid_json` | Bad fields. `details[]` lists the problems. |
| 401 | `unauthorized` | Token missing, invalid or expired. |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | Body over 8 KB, or not JSON. |
| 502 | `llm_auth_failed` / `llm_failed` | The LLM provider rejected the key, returned an error, or returned unusable output. |
| 503 | `server_misconfigured` / `llm_rate_limited` | Missing env vars (`missing[]`), or the provider is rate-limiting. |
| 504 | `llm_timeout` | The LLM took longer than `LLM_TIMEOUT_MS`. |
| 500 | `storage_failed` | Supabase insert or lookup failed. The table may be missing, or the secret key may be wrong. |

## 6. Create the Generator Assistant

Vapi Dashboard → **Assistants** → **Create Assistant** → start blank.

| Dashboard field | JSON key | Value |
|---|---|---|
| Name | `name` | `Interview Generator` |
| First message | `firstMessage` | `Hi! I'll help you set up a practice interview. What job role are you preparing for?` |
| First message mode | `firstMessageMode` | `assistant-speaks-first` |
| Model → Provider / Model | `model.provider`, `model.model` | Any tool-calling chat model offered in the dashboard. For Gemini: `Google` / `gemini-2.5-flash` (§2a) |
| Model → System prompt | `model.messages[0]` (role `system`) | The prompt in §6.1 |
| Model → Tools | `model.toolIds` | The `generate_interview` tool from §5, plus the built-in **End Call** tool (`type: "endCall"`) |
| Voice / Transcriber | `voice`, `transcriber` | Your choice |
| End call message | `endCallMessage` | `Your interview is saved. Good luck!` |
| End call phrases | `endCallPhrases` | `goodbye`, `good luck with your interview` |
| Max duration (seconds) | `maxDurationSeconds` | `600` (shorter than the 15-minute token lifetime) |

Save the assistant and copy its **ID** into
`NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID`.

**Ending the call:** the End Call tool lets the model hang up after saying
goodbye. `endCallPhrases` is a backup: if the assistant says one of those
phrases, Vapi hangs up. Users can also click **End call** in the app, which
calls `vapi.stop()`.

### 6.1 System prompt (paste as-is)

```text
You are a friendly voice assistant that sets up practice job interviews.
Your only job is to collect five details, confirm them, and call the
generate_interview tool exactly once.

Collect these, one question at a time, in natural conversation:
1. role: the job role (for example "Frontend Developer").
2. level: seniority (for example Junior, Mid, or Senior).
3. type: technical, behavioral, or mixed. If the user is unsure, suggest mixed.
4. techstack: the main technologies, as a short comma-separated list.
   For behavioral interviews, ask for the main technologies of the role anyway.
5. amount: how many questions, a whole number from 1 to 10.

Rules:
- Keep replies short and conversational; this is a voice call.
- Do not invent values. If an answer is unclear, ask again.
- If the user asks for more than 10 questions, explain the limit is 10.
- Before calling the tool, read the five values back and ask the user to confirm.
- After confirmation, call generate_interview once with role, level, type,
  techstack, and amount. Never ask for or send a user id, email, or token.
- Do not write interview questions yourself and do not read questions aloud.
- If the tool result has "success": true, tell the user their interview with
  that number of questions has been saved to their account, say goodbye,
  then use the end call tool.
- If the tool result has "success": false, briefly tell the user the "message"
  from the result. If error is "invalid_request", fix the listed problem with
  the user and call the tool again. For any other error, apologize, suggest
  trying again later from the app, and end the call.
- Stay on topic; politely decline unrelated requests.
```

## 7. End-to-end test (manual)

1. `npm run dev`, and expose it over HTTPS (§4). Point the tool URL at it.
2. Sign in, open **/protected**, and click **Create an interview**. This goes
   to `/protected/interview`.
3. The yellow "Setup incomplete" box should be gone. Click **Start interview
   setup call** and allow microphone access.
4. Answer the assistant's questions and confirm.
5. After the call ends, the page refreshes, and the new interview appears
   under **Your generated interviews**. It is read through RLS with your
   session.
6. Check **Vapi Dashboard → Call Logs** for the tool request and response, and
   your server logs for `[generate-interview]` messages.

Automated tests (no network, no external writes): `npm run test`.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Start button missing, "voice call is disabled" | `NEXT_PUBLIC_VAPI_PUBLIC_KEY` or `NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID` is not set. Restart the dev server or rebuild after setting them (`NEXT_PUBLIC_*` values are inlined at build time). |
| "Setup incomplete: Supabase is not configured", or the capability endpoint returns 503 with `missing` | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are not set. Merge them into your env file, then restart or rebuild. |
| "VAPI_TOOL_SIGNING_SECRET is not set…" on start | The secret is missing or shorter than 32 chars. |
| Vapi error mentioning unauthorized/401 | You used the private key, or the public key is wrong. |
| Tool returns 401 "Missing generation capability" | The static `capability` parameter is missing, or it doesn't use exactly `{{generationToken}}`. |
| Tool request gets a 3xx / HTML login page | The deployed build predates the proxy exemption, or the URL path is wrong. |
| Tool times out in Vapi | Raise `timeoutSeconds` (≤ 300), or lower `LLM_TIMEOUT_MS` / use a faster model. |
| 500 `storage_failed` | Migration not run, wrong `SUPABASE_SECRET_KEY`, or it belongs to another project. |
| "interviews table is missing" on the page | Run the SQL from §3. |
| 502 `llm_auth_failed` | `LLM_API_KEY` is invalid for `LLM_BASE_URL`. |
| 502 `llm_failed` | The provider returned an error, or the model ID is not valid. Check the server logs for the upstream status. |
