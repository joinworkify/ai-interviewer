# Datasea interviewer in this repo

> The rules every change must follow. For people and AI agents alike.

Keep it short: rules live here, explanations live in `docs/` and the setup guides.

## 1. Start here

Read the doc that matches your task before you write code.

| Task                                   | Read                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| Run the app, env vars, scripts         | [README.md](README.md)                                |
| Voice call, webhook, transcripts       | [DOGRAH_SETUP.md](DOGRAH_SETUP.md)                    |
| What is stored, who can read it, AI use | [docs/security-ai-data.md](docs/security-ai-data.md) |
| Vapi or Gemini Live prototypes         | [VAPI_SETUP.md](VAPI_SETUP.md), [GEMINI_LIVE_SETUP.md](GEMINI_LIVE_SETUP.md) |

## 2. What this project is

A voice AI interviewer for DataSea. A candidate picks a role, agrees to the consent text, and has a short call with a Dograh voice agent. The transcript comes back by webhook and an LLM writes feedback for a reviewer. Candidates never see scores or feedback.

Stack: Next.js 16 (App Router), React 19, Tailwind + shadcn/ui, Supabase (Auth + Postgres + RLS), Vitest.

## 3. Rules

Each rule says what to do and why.

### Backend and data

- **Writes go through server routes with the service-role client.** Browsers can only `select` their own rows (RLS). Why: a candidate must not be able to forge a transcript, status or score.
- **The user id comes from verified Supabase claims (`getClaims`), never from the request body.** Why: the body is attacker-controlled.
- **Route logic lives in framework-agnostic handlers** (`Request` to `Response`, dependencies injected) in `lib/`; the `route.ts` file and its `route-deps.ts` only wire them up. Why: handlers stay unit-testable without Next.js or `server-only`.
- **Browser-called POST/PUT/DELETE routes check the request origin first** (`lib/http/origin-guard.ts`). Why: cookies are sent cross-site.
- **Every schema change is a new migration** in `supabase/migrations/`, with RLS enabled and the grants written out, plus a matching update to `types/database.ts`. Never edit a migration that has been merged. Hosted Supabase must get the migration before the code that needs it is deployed.
- **A new table that holds user data is added to the data-deletion flow** (`lib/data-deletion`, `tests/db/deletion.test.ts`). Why: users can ask for their data to be deleted.
- **Never log or return secrets, transcripts or upstream error bodies.** Log a status or `describeError(err)` only.
- **Candidate-facing responses stay minimal**: no transcript, score or feedback.

### UI

- Use the shadcn/ui components in `components/ui` and the `theme-datasea` styles; do not add a second styling system.
- Consent wording lives in `lib/candidate/consent.ts`. Changing it means bumping `CONSENT_VERSION` and the wording-hash test; the reviewed text comes from PSK.

### Code

- TypeScript strict; no `any` to silence an error.
- Use the existing LLM client (`lib/ai/client.ts`) and daily usage cap (`lib/ai/usage.ts`) for model calls; do not call providers directly.
- Comments say why, not what.

## 5. Before you call it done

```bash
npm run verify        # lint, typecheck, tests
npm run build         # the build runs the type checker too, and Vercel runs it
```

- Add or update tests for the behaviour you changed. `tests/db/*` need the local Supabase container (`npm run supabase:start`, `npm run db:migrate`); they skip when it is not running.
- A passing `verify` is not enough if `build` fails: run both.

## 6. Git

- Work on a branch, not on `main`. Keep one concern per branch.
- Do not commit, push or open a PR unless you were asked to.
- Nothing enforces CI yet except the Vercel build: do not merge while it is red.
