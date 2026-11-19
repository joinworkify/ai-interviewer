/**
 * Role tasks: work samples a candidate does after the voice interview
 * (a written answer, a coding exercise, a short case). Admins write them per
 * role; the candidate answers in a text box with a time limit; the answer is
 * shown to reviewers and counted by the AI score.
 *
 * Client-safe (no server imports).
 */

export const TASK_KINDS = ["writing", "coding", "case"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  writing: "Written answer",
  coding: "Coding exercise",
  case: "Case study",
};

export const MAX_TASKS_PER_ROLE = 3;
export const MAX_TASK_TITLE = 120;
export const MAX_TASK_PROMPT = 4000;
export const MIN_TASK_MINUTES = 5;
export const MAX_TASK_MINUTES = 120;
export const MAX_ANSWER_CHARS = 20_000;
/** Seconds of slack after the limit before an answer counts as late. */
export const LATE_GRACE_SECONDS = 120;

export interface RoleTask {
  /** Present for a task that already exists; omitted for a new one. */
  id?: string;
  kind: TaskKind;
  title: string;
  prompt: string;
  minutes: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TasksResult = { ok: true; tasks: RoleTask[] } | { ok: false; message: string };

/** Validates a role's tasks from untrusted input. An empty list is valid (no tasks). */
export function parseTasks(value: unknown): TasksResult {
  if (!Array.isArray(value)) return { ok: false, message: "Tasks must be a list." };
  if (value.length > MAX_TASKS_PER_ROLE) return { ok: false, message: `A role can have at most ${MAX_TASKS_PER_ROLE} tasks.` };
  const tasks: RoleTask[] = [];
  for (const item of value) {
    const t = (item ?? {}) as Record<string, unknown>;
    if (typeof t.kind !== "string" || !(TASK_KINDS as readonly string[]).includes(t.kind)) {
      return { ok: false, message: "Choose a type for each task." };
    }
    const title = typeof t.title === "string" ? t.title.replace(/\s+/g, " ").trim() : "";
    const prompt = typeof t.prompt === "string" ? t.prompt.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
    if (!title || title.length > MAX_TASK_TITLE) return { ok: false, message: `Task titles must be 1-${MAX_TASK_TITLE} characters.` };
    if (!prompt || prompt.length > MAX_TASK_PROMPT) return { ok: false, message: `Task instructions must be 1-${MAX_TASK_PROMPT} characters.` };
    if (typeof t.minutes !== "number" || !Number.isInteger(t.minutes) || t.minutes < MIN_TASK_MINUTES || t.minutes > MAX_TASK_MINUTES) {
      return { ok: false, message: `Time limits must be whole minutes from ${MIN_TASK_MINUTES} to ${MAX_TASK_MINUTES}.` };
    }
    if (t.id !== undefined && !(typeof t.id === "string" && UUID_RE.test(t.id))) return { ok: false, message: "Invalid task id." };
    tasks.push({ ...(t.id ? { id: t.id as string } : {}), kind: t.kind as TaskKind, title, prompt, minutes: t.minutes });
  }
  return { ok: true, tasks };
}

export type TaskStatus = "todo" | "started" | "submitted";

/** What the candidate sees of one task. */
export interface CandidateTask {
  id: string;
  kind: TaskKind;
  title: string;
  prompt: string;
  minutes: number;
  status: TaskStatus;
  /** When the clock started, once opened. */
  startedAt: string | null;
}

export interface SubmissionTimes {
  startedAt: Date;
  submittedAt: Date;
  minutes: number;
}

/** Whole seconds past the time limit (0 if on time). */
export function secondsOver({ startedAt, submittedAt, minutes }: SubmissionTimes): number {
  return Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000) - minutes * 60);
}

export function isLate(times: SubmissionTimes): boolean {
  return secondsOver(times) > LATE_GRACE_SECONDS;
}

export function parseSubmission(
  value: unknown,
): { ok: true; answer: string; pasteCount: number; awayMs: number } | { ok: false; message: string } {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.answer !== "string") return { ok: false, message: "Send your answer." };
  const answer = v.answer.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (answer.trim().length === 0) return { ok: false, message: "Write your answer first." };
  if (answer.length > MAX_ANSWER_CHARS) return { ok: false, message: `Answers are at most ${MAX_ANSWER_CHARS} characters.` };
  const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : 0);
  return { ok: true, answer, pasteCount: count(v.pasteCount), awayMs: count(v.awayMs) };
}
