"use client";

import { Plus, Trash2 } from "lucide-react";

import {
  MAX_TASKS_PER_ROLE,
  MAX_TASK_MINUTES,
  MAX_TASK_PROMPT,
  MAX_TASK_TITLE,
  MIN_TASK_MINUTES,
  TASK_KINDS,
  TASK_KIND_LABELS,
  type RoleTask,
} from "@/lib/tasks/tasks";

/**
 * Edits a role's work-sample tasks: what the candidate does after the voice
 * interview. Each has a type, instructions and a time limit. Removing a task
 * also deletes the answers candidates already gave to it.
 */
export function TaskEditor({ value, onChange }: { value: RoleTask[]; onChange: (next: RoleTask[]) => void }) {
  const update = (index: number, patch: Partial<RoleTask>) => onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Work-sample tasks</p>
          <p className="text-xs text-muted-foreground">
            Optional. After the voice interview the candidate answers these in a text box, against a time limit. The answers go into the AI score and
            to the reviewer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, { kind: "writing", title: "", prompt: "", minutes: 20 }])}
          disabled={value.length >= MAX_TASKS_PER_ROLE}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-3 text-xs font-medium hover:border-primary disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add task
        </button>
      </div>

      {value.map((task, index) => (
        <div key={task.id ?? `new-${index}`} className="grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-[1fr_9rem_7rem_auto]">
          <input
            aria-label={`Task ${index + 1} title`}
            value={task.title}
            maxLength={MAX_TASK_TITLE}
            onChange={(e) => update(index, { title: e.target.value })}
            placeholder="e.g. Write a SQL query for monthly sales"
            className="h-10 rounded-md border bg-white px-3 text-sm"
          />
          <select
            aria-label={`Task ${index + 1} type`}
            value={task.kind}
            onChange={(e) => update(index, { kind: e.target.value as RoleTask["kind"] })}
            className="h-10 rounded-md border bg-white px-2 text-sm"
          >
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {TASK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              aria-label={`Task ${index + 1} time limit in minutes`}
              inputMode="numeric"
              value={task.minutes || ""}
              onChange={(e) => update(index, { minutes: Number(e.target.value.replace(/\D/g, "").slice(0, 3)) })}
              className="h-10 w-16 rounded-md border bg-white px-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              min ({MIN_TASK_MINUTES}-{MAX_TASK_MINUTES})
            </span>
          </div>
          <button
            type="button"
            aria-label={`Remove task ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-white text-muted-foreground hover:border-red-300 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <textarea
            aria-label={`Task ${index + 1} instructions`}
            rows={4}
            value={task.prompt}
            maxLength={MAX_TASK_PROMPT}
            onChange={(e) => update(index, { prompt: e.target.value })}
            placeholder="What the candidate should do, and what a good answer includes."
            className="w-full rounded-md border bg-white px-3 py-2 text-sm sm:col-span-4"
          />
        </div>
      ))}
    </div>
  );
}
