"use client";

import { Plus, Trash2 } from "lucide-react";

import {
  DEFAULT_RUBRIC,
  MAX_CRITERIA,
  MAX_CRITERION_DESCRIPTION,
  MAX_CRITERION_NAME,
  MAX_WEIGHT,
  MIN_WEIGHT,
  type RubricCriterion,
} from "@/lib/evaluation/rubric";

/**
 * Edits a role's scoring rubric: the criteria its interviews are scored
 * against. An empty list means the built-in default rubric is used.
 */
export function RubricEditor({
  value,
  onChange,
}: {
  value: RubricCriterion[];
  onChange: (next: RubricCriterion[]) => void;
}) {
  const update = (index: number, patch: Partial<RubricCriterion>) =>
    onChange(value.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Scoring rubric</p>
          <p className="text-xs text-muted-foreground">
            What the AI scores each interview on. Weight 1 is minor, 5 is critical.
            {value.length === 0 && " With no criteria, the default rubric is used."}
          </p>
        </div>
        <div className="flex gap-2">
          {value.length === 0 && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_RUBRIC.map((c) => ({ ...c })))}
              className="h-8 rounded-md border bg-white px-3 text-xs font-medium hover:border-primary"
            >
              Start from default
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...value, { name: "", description: "", weight: 3 }])}
            disabled={value.length >= MAX_CRITERIA}
            className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-3 text-xs font-medium hover:border-primary disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add criterion
          </button>
        </div>
      </div>

      {value.map((criterion, index) => (
        <div key={index} className="grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-[1fr_6rem_auto]">
          <input
            aria-label={`Criterion ${index + 1} name`}
            value={criterion.name}
            maxLength={MAX_CRITERION_NAME}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder="e.g. SQL knowledge"
            className="h-10 rounded-md border bg-white px-3 text-sm"
          />
          <select
            aria-label={`Criterion ${index + 1} weight`}
            value={criterion.weight}
            onChange={(e) => update(index, { weight: Number(e.target.value) })}
            className="h-10 rounded-md border bg-white px-2 text-sm"
          >
            {Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => MIN_WEIGHT + i).map((w) => (
              <option key={w} value={w}>
                Weight {w}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove criterion ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-white text-muted-foreground hover:border-red-300 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <textarea
            aria-label={`Criterion ${index + 1} description`}
            rows={2}
            value={criterion.description}
            maxLength={MAX_CRITERION_DESCRIPTION}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="What a strong answer looks like for this criterion."
            className="w-full rounded-md border bg-white px-3 py-2 text-sm sm:col-span-3"
          />
        </div>
      ))}
    </div>
  );
}
