# AI interview data: who can write it, and how it is deleted

## Who can write what

Browsers (the `authenticated` role) can **select their own rows only**, in
`interviews`, `interview_sessions`, `feedback` and `ai_usage`. They cannot insert, update or
delete anything in those tables. All writes happen in server routes with the
service-role client (`lib/supabase/admin.ts`), and every query is filtered by
the user id verified from the session (`getClaims`), because the service role
bypasses RLS. Enforced by `supabase/migrations/20261112000004_ai_security_hardening.sql`.

The service-role client is imported only from server-only modules
(`tests/security-guards.test.ts` checks that no client component can reach it).

## Data map

Every table holding user data, and what happens when it is deleted.

| Table | Personal data | Link to the user | Removed by |
| --- | --- | --- | --- |
| `auth.users` | email, auth metadata | is the user | `deleteUser` (admin API) |
| `profiles` | name, email | `id` -> `auth.users` **cascade** | account deletion |
| `interviews` | generated questions | `user_id` -> `profiles` **cascade** | account deletion |
| `interview_sessions` | transcript, recording URL, call id | `user_id` -> `profiles` **cascade**; `interview_id` -> `interviews` **cascade** | session delete, account deletion |
| `feedback` | scores, assessment, per-answer text | `user_id` -> `profiles` **cascade**; `session_id` -> `interview_sessions` **cascade** | session delete, account deletion |
| `capability_uses` | token id only | `user_id` -> `profiles` **cascade**; no FK to `interviews` | account deletion only |
| `ai_usage` | feature, model, token counts | `user_id` -> `profiles` **cascade** | account deletion |
| `vapi_events` | webhook payloads (can hold transcripts) | **none**: no user column, no FK. Linked only by `vapi_call_id` to `interview_sessions` | `purge_vapi_events(user, session?)`, called **before** the session or user is deleted |

Notes:

- Deleting an **interview** cascades to its sessions and feedback but not to
  `capability_uses`, so its token stays used.
- `ai_usage` is deleted with the user. This also resets that user's rolling
  daily AI quota history. Anonymizing instead is an open decision.
- Nothing writes `vapi_events` on this branch, but the purge is in place so
  data is not left behind if a webhook starts to.

## Deletion routes

All require a signed-in user and a same-origin request, and answer JSON.

| Route | Effect |
| --- | --- |
| `DELETE /api/sessions/{id}/transcript` | Clears `transcript` and `recording_url`; purges `vapi_events`; **keeps** the session and its feedback. |
| `DELETE /api/sessions/{id}` | Purges `vapi_events`, then deletes the session; its feedback cascades. |
| `DELETE /api/account/data` | Body `{"confirm":"delete-my-data"}`. Purges `vapi_events`, then deletes the auth user; everything above cascades. |

A session that does not exist or belongs to someone else is a `404` in both
cases. If the purge fails, nothing else is deleted and the route answers `500`.

## Test plan

Automated (`npm run test`):

- `tests/db/forgery.test.ts`: as `authenticated`, a direct update of transcript,
  status, `interview_id` or recording URL, an insert of a session or feedback,
  and a delete of a session or feedback are all `permission denied`; select-own
  still works; the service role can still write.
- `tests/db/deletion.test.ts`: seeds two users across every table, deletes one,
  and asserts zero rows left for them in every table with a `user_id` column
  (discovered from `information_schema`, so a new table must be added to the
  map), `profiles`, `auth.users` and `vapi_events`, with the other user intact.
- `tests/security-migration.test.ts`: static check of the migration file.
- `tests/sessions-store.test.ts`, `tests/data-deletion-*.test.ts`: every query
  carries the verified user id; purge runs before delete and aborts on failure.
- `tests/ai-evaluate-injection.test.ts`: transcript text is only ever data in
  the user message, and `totalScore` is computed server-side.
- `tests/log-safety.test.ts`, `tests/security-guards.test.ts`: no transcript,
  token or secret in logs; the admin client stays server-only; mutating routes
  check the origin.

The `tests/db/*` tests use the local Supabase Postgres through
`docker exec psql` and are **skipped** when the container is not running:

```bash
npm run supabase:start
npx supabase migration up     # or: npm run db:reset (wipes local data)
npx vitest run tests/db
```

Set `SUPABASE_DB_CONTAINER` if your container is not named
`supabase_db_ai-interviewer`.

Not covered by automation: whether a real model resists prompt injection (the
model is mocked), and the live Supabase Auth `deleteUser` call (the DB test
simulates it with `delete from auth.users`).
