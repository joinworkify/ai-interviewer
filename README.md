# DataSea AI Interviewer

A candidate picks a role, agrees to the consent text, and has a short voice interview with an AI interviewer. The call is recorded, the transcript comes back to the app, and an LLM writes feedback for a DataSea reviewer. Candidates never see scores or feedback.

## How it works

1. A signed-in candidate opens `/candidate`, picks a role and agrees to the consent text. `POST /api/candidate/attempts` records the agreement (`candidate_consents`), creates the interview with the role's questions and an `interview_sessions` row, and returns the session id. A candidate gets at most 3 attempts per role; attempts left `in_progress` for 30 minutes with no transcript are marked `abandoned` and stop counting.
2. The page starts a call with the self-hosted [Dograh](DOGRAH_SETUP.md) voice agent, using a short-lived signed session token.
3. When the call ends, Dograh calls `POST /api/dograh/webhook` (Bearer secret). The server downloads the transcript from Dograh's own API, stores it on the session and, in the background, has the LLM write feedback (`feedback`, `ai_usage`).
4. Candidates and reviewers only ever read their own rows (RLS); every write goes through server routes with the service-role key.

**Stack:** Next.js (App Router) · React 19 · Tailwind + shadcn/ui · Supabase Auth + Postgres · Dograh · OpenAI-compatible LLM (Gemini by default) · Vitest

An earlier prototype that generates interview questions over a [Vapi](VAPI_SETUP.md) call still exists under `/protected/interview` and `/api/vapi/generate-interview`, alongside a Gemini Live variant ([GEMINI_LIVE_SETUP.md](GEMINI_LIVE_SETUP.md)). The candidate flow does not use them.

## Quick start

```bash
npm run setup          # install deps, create .env.local, init Supabase config
npm run setup:secret   # prints a value for VAPI_TOOL_SIGNING_SECRET
# fill in .env.local (see below), then:
npm run check:env      # verify nothing is missing
npm run db:push        # hosted project (after supabase:login + supabase:link)
                       # or: npm run supabase:start && npm run db:reset  (local Docker)
npm run dev            # http://localhost:3000
```

The Dograh agent is set up by hand, and the webhook needs a public HTTPS URL in production: follow [DOGRAH_SETUP.md](DOGRAH_SETUP.md). The Vapi prototype needs its own setup in [VAPI_SETUP.md](VAPI_SETUP.md); `npm run check:env` still asks for the Vapi variables for that reason.

Before deploying to a hosted Supabase project, run `npm run db:push` so every migration is applied. The candidate flow writes to `candidate_consents` (migration `20261113000000`) and fails without it.

## Environment variables

Copy `.env.example` to `.env.local` (`npm run setup:env` does this).

| Group    | Variables                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server-only)                       |
| Vapi (prototype only) | `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID`, `VAPI_TOOL_SIGNING_SECRET` (server-only, 32+ chars) |
| LLM      | `LLM_API_KEY` (server-only), `LLM_MODEL`; optional `LLM_BASE_URL`, `LLM_TIMEOUT_MS`, `AI_DAILY_CALL_LIMIT`. For Gemini use `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` and a text model such as `gemini-3.1-flash-lite` (not the live model). The app logs a warning for settings known to fail. |
| Dograh   | `DOGRAH_API_URL`, `DOGRAH_WEBHOOK_SECRET`, `DOGRAH_SESSION_SIGNING_SECRET` (server-only), `NEXT_PUBLIC_DOGRAH_WIDGET_SRC`; see [DOGRAH_SETUP.md](DOGRAH_SETUP.md) |

## Scripts

`make help` lists the same commands as Make targets.

| Command                                             | Purpose                         |
| --------------------------------------------------- | ------------------------------- |
| `npm run dev` / `build` / `start`                   | Run or build the app            |
| `npm run verify`                                    | Lint, typecheck and tests       |
| `npm run verify:full`                               | Env check, `verify`, then build |
| `npm run test:watch`                                | Tests in watch mode             |
| `npm run supabase:start` / `stop` / `status`        | Local Supabase (Docker)         |
| `npm run db:push` / `db:reset` / `db:new -- <name>` | Apply or create migrations      |
| `npm run db:migrate` / `db:seed`                    | Local DB: apply new migrations, load `supabase/seed.sql` (keeps existing data) |

`db:reset` also loads `supabase/seed.sql` (the candidate roles). To add them to a running local database without wiping it: `npm run db:migrate && npm run db:seed`.

`npm run db:reset` also loads [`supabase/seed.sql`](supabase/seed.sql): fake data and two dev logins (`dev@example.test` and `priya.nair@example.test`, both with the password `test123!`). It is local only and never runs on `db:push`. To load it without a reset: `docker exec -i supabase_db_ai-interviewer psql -U postgres < supabase/seed.sql`.

## Project layout

```
app/candidate/        Candidate pages: roles, consent, setup, live call, result
app/api/candidate/    Start an attempt, read its status
app/api/dograh/       Session token for the call, transcript webhook
lib/candidate/        Roles, consent text and version, attempt rules and storage
lib/dograh/           Session token, webhook, transcript download
lib/sessions/         Transcript storage, AI feedback
lib/ai/               LLM client, prompts, daily usage cap
lib/interviews/       Vapi prototype: token signing, question generation
supabase/migrations/  Database schema + RLS
tests/                Vitest suite (tests/db needs the local Supabase container)
```

## Docs

[VAPI_SETUP.md](VAPI_SETUP.md) covers the Vapi tool and assistant, Gemini setup, the end-to-end test and troubleshooting.

[DOGRAH_SETUP.md](DOGRAH_SETUP.md) covers running the self-hosted Dograh voice agent locally, building the interviewer agent and its webhook, and how transcripts come back to the app.
