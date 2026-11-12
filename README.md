# [NAME] AI Interviewer

Generate interview questions by talking to a voice assistant. Tell it the role, interview type, tech stacks and how many questions you want, and it saves a tailored set to your account.

## How it works

1. A signed-in user opens `/protected/interview` and starts a call with a [Vapi](https://vapi.ai) voice assistant.
2. The assistant collects the details and calls `POST /api/vapi/generate-interview` with a short-lived signed token.
3. The server verifies the token, generates the questions with an OpenAI-compatible LLM (Gemini by default), and saves them to Supabase. Users can only read their own interviews (RLS).

Full diagram: [VAPI_SETUP.md](VAPI_SETUP.md#how-it-works).

**Stack:** Next.js (App Router) · React 19 · Tailwind + shadcn/ui · Supabase Auth + Postgres · Vapi · Vitest

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

The Vapi tool and assistant are created by hand in the Vapi dashboard, and the app needs a public HTTPS URL for Vapi to call. Follow [VAPI_SETUP.md](VAPI_SETUP.md).

## Environment variables

Copy `.env.example` to `.env.local` (`npm run setup:env` does this).

| Group    | Variables                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server-only)                       |
| Vapi     | `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID`, `VAPI_TOOL_SIGNING_SECRET` (server-only, 32+ chars) |
| LLM      | `LLM_API_KEY` (server-only), `LLM_MODEL`; optional `LLM_BASE_URL`, `LLM_TIMEOUT_MS`                                           |

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
app/api/              Route handlers (capability token, generate-interview)
app/protected/        Signed-in pages, including /protected/interview
lib/interviews/       Token signing, validation, LLM client, storage
components/interview/ Voice call UI
supabase/migrations/  Database schema + RLS
tests/                Vitest suite
```

## Docs

[VAPI_SETUP.md](VAPI_SETUP.md) covers the Vapi tool and assistant, Gemini setup, the end-to-end test and troubleshooting.
