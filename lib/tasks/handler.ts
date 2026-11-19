import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { MAX_ANSWER_CHARS, parseSubmission, type CandidateTask, type RoleTask } from "./tasks";

/**
 * A candidate's tasks for one attempt (their own session only):
 *   GET  /api/candidate/attempts/:id/tasks                       the role's tasks and their state
 *   POST /api/candidate/attempts/:id/tasks/:taskId/start         start the clock (idempotent)
 *   POST /api/candidate/attempts/:id/tasks/:taskId/submit        { answer, pasteCount, awayMs }
 * The clock starts on the server when the task is opened, so it cannot be
 * reset from the browser. A submitted task cannot be changed.
 */

export interface TaskRow extends RoleTask {
  id: string;
}

export interface SubmissionRow {
  taskId: string;
  startedAt: Date;
  submittedAt: Date | null;
}

export interface TaskStore {
  /** The role's tasks for this session when the session belongs to the user; null when it does not. */
  tasksFor(userId: string, sessionId: string): Promise<TaskRow[] | null>;
  submissions(sessionId: string): Promise<SubmissionRow[]>;
  /** Creates the started row if there is none, returning the (possibly existing) start time. */
  start(sessionId: string, taskId: string, now: Date): Promise<Date>;
  /** Saves the answer once; false when it was already submitted. */
  submit(args: { sessionId: string; taskId: string; answer: string; pasteCount: number; awayMs: number; now: Date }): Promise<boolean>;
}

export interface TaskHandlerDeps {
  getUserId: () => Promise<string | null>;
  store: TaskStore;
  /** Runs once a task is submitted, with whether every task is now done. */
  onSubmitted?: (done: { userId: string; sessionId: string; allDone: boolean }) => void;
  now?: () => Date;
}

const MAX_BODY_BYTES = MAX_ANSWER_CHARS * 4 + 1024; // UTF-8 can be up to 4 bytes per character

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

function view(tasks: TaskRow[], subs: SubmissionRow[]): CandidateTask[] {
  return tasks.map((t) => {
    const s = subs.find((x) => x.taskId === t.id);
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      prompt: t.prompt,
      minutes: t.minutes,
      status: s ? (s.submittedAt ? "submitted" : "started") : "todo",
      startedAt: s ? s.startedAt.toISOString() : null,
    };
  });
}

export async function handleListTasks(sessionId: string, deps: TaskHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Interview not found.");
  try {
    const tasks = await deps.store.tasksFor(userId, sessionId);
    if (!tasks) return fail(404, "not_found", "Interview not found.");
    return jsonResponse(200, { success: true, tasks: view(tasks, await deps.store.submissions(sessionId)) });
  } catch {
    return fail(500, "storage_failed", "Could not load the tasks.");
  }
}

async function resolve(sessionId: string, taskId: string, deps: TaskHandlerDeps) {
  const userId = await deps.getUserId();
  if (!userId) return { ok: false, error: fail(401, "unauthorized", "Sign in required.") } as const;
  if (!isUuid(sessionId) || !isUuid(taskId)) return { ok: false, error: fail(404, "not_found", "Task not found.") } as const;
  const tasks = await deps.store.tasksFor(userId, sessionId);
  const task = tasks?.find((t) => t.id === taskId);
  if (!tasks || !task) return { ok: false, error: fail(404, "not_found", "Task not found.") } as const;
  return { ok: true, userId, tasks, task } as const;
}

export async function handleStartTask(sessionId: string, taskId: string, deps: TaskHandlerDeps): Promise<Response> {
  try {
    const r = await resolve(sessionId, taskId, deps);
    if (!r.ok) return r.error;
    const startedAt = await deps.store.start(sessionId, taskId, (deps.now ?? (() => new Date()))());
    return jsonResponse(200, { success: true, startedAt: startedAt.toISOString(), minutes: r.task.minutes });
  } catch {
    return fail(500, "storage_failed", "Could not start the task.");
  }
}

export async function handleSubmitTask(request: Request, sessionId: string, taskId: string, deps: TaskHandlerDeps): Promise<Response> {
  try {
    const r = await resolve(sessionId, taskId, deps);
    if (!r.ok) return r.error;
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return fail(body.status, body.error, body.message);
    const parsed = parseSubmission(body.value);
    if (!parsed.ok) return fail(400, "invalid_request", parsed.message);

    const before = await deps.store.submissions(sessionId);
    if (!before.some((s) => s.taskId === taskId)) return fail(409, "not_started", "Open the task before submitting.");
    const now = (deps.now ?? (() => new Date()))();
    const saved = await deps.store.submit({ sessionId, taskId, answer: parsed.answer, pasteCount: parsed.pasteCount, awayMs: parsed.awayMs, now });
    if (!saved) return fail(409, "already_submitted", "This task was already submitted.");

    const done = new Set(before.filter((s) => s.submittedAt).map((s) => s.taskId));
    done.add(taskId);
    const allDone = r.tasks.every((t) => done.has(t.id));
    try {
      deps.onSubmitted?.({ userId: r.userId, sessionId, allDone });
    } catch {
      console.error("[tasks] submitted hook failed");
    }
    return jsonResponse(200, { success: true, allDone });
  } catch {
    return fail(500, "storage_failed", "Could not save your answer.");
  }
}
