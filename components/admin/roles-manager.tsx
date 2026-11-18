
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Power,
  X,
  Loader2,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Bullet = {
  title: string;
  text: string;
};

type Role = {
  id: string;
  title: string;
  pay_rate: string;
  job_type: string;
  skills: string[];
  about: string;
  responsibilities: Bullet[];
  requirements: Bullet[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type RoleForm = {
  id: string;
  title: string;
  pay_rate: string;
  job_type: string;
  skills: string;
  about: string;
  responsibilities: string;
  requirements: string;
  is_active: boolean;
  sort_order: number;
};

type ApiResponse = {
  success?: boolean;
  message?: string;
  roles?: Role[];
  role?: Role;
};

const emptyForm: RoleForm = {
  id: "",
  title: "",
  pay_rate: "",
  job_type: "",
  skills: "",
  about: "",
  responsibilities: "",
  requirements: "",
  is_active: true,
  sort_order: 0,
};

function bulletsToText(items: Bullet[] | null | undefined) {
  if (!Array.isArray(items)) return "";

  return items
    .map((item) => `${item.title ?? ""}|${item.text ?? ""}`)
    .join("\n");
}

function textToBullets(value: string): Bullet[] {
  return value
    .split("\n")
    .map((line) => {
      const separator = line.indexOf("|");

      if (separator === -1) {
        return { title: line.trim(), text: "" };
      }

      return {
        title: line.slice(0, separator).trim(),
        text: line.slice(separator + 1).trim(),
      };
    })
    .filter((item) => item.title || item.text);
}

function roleToForm(role: Role): RoleForm {
  return {
    id: role.id,
    title: role.title,
    pay_rate: role.pay_rate,
    job_type: role.job_type,
    skills: role.skills.join(", "),
    about: role.about ?? "",
    responsibilities: bulletsToText(role.responsibilities),
    requirements: bulletsToText(role.requirements),
    is_active: role.is_active,
    sort_order: role.sort_order,
  };
}

export function RolesManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<RoleForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!success) return;

    const timeoutId = window.setTimeout(() => {
      setSuccess("");
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [success]);

  async function loadRoles() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/roles", {
        cache: "no-store",
      });

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load roles.");
      }

      setRoles(result.roles ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load roles.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRoles();
  }, []);

  const filteredRoles = useMemo(() => {
    const query = search.trim().toLowerCase();

    return roles.filter((role) => {
      const matchesSearch =
        !query ||
        role.title.toLowerCase().includes(query) ||
        role.id.toLowerCase().includes(query) ||
        role.skills.some((skill) => skill.toLowerCase().includes(query));

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && role.is_active) ||
        (filter === "inactive" && !role.is_active);

      return matchesSearch && matchesFilter;
    });
  }, [roles, search, filter]);

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function openEditForm(role: Role) {
    setEditingId(role.id);
    setForm(roleToForm(role));
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function updateForm<K extends keyof RoleForm>(
    field: K,
    value: RoleForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.title.trim() || !form.pay_rate.trim() || !form.job_type.trim()) {
      setError("Please complete the title, pay rate, and job type.");
      return;
    }

    if (!editingId && !form.id.trim()) {
      setError("Please enter a role ID.");
      return;
    }

    const payload = {
      ...(editingId ? {} : { id: form.id.trim() }),
      title: form.title.trim(),
      pay_rate: form.pay_rate.trim(),
      job_type: form.job_type.trim(),
      skills: form.skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
      about: form.about.trim(),
      responsibilities: textToBullets(form.responsibilities),
      requirements: textToBullets(form.requirements),
      is_active: form.is_active,
      sort_order: Number(form.sort_order),
    };

    setSaving(true);

    try {
      const response = await fetch(
        editingId
          ? `/api/admin/roles/${encodeURIComponent(editingId)}`
          : "/api/admin/roles",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to save role.");
      }

      setSuccess(
        editingId
          ? "Role updated successfully."
          : "Role created successfully.",
      );
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);

      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save role.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(role: Role) {
    const action = role.is_active ? "deactivate" : "activate";

    if (!window.confirm(`Are you sure you want to ${action} "${role.title}"?`)) {
      return;
    }

    setActionId(role.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/admin/roles/${encodeURIComponent(role.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !role.is_active }),
        },
      );

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || `Unable to ${action} role.`);
      }

      setSuccess(`Role ${action}d successfully.`);
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} role.`);
    } finally {
      setActionId(null);
    }
  }

  async function deleteRole(role: Role) {
    const confirmed = window.confirm(
      `Permanently delete "${role.title}" (${role.id})?\n\nThis action cannot be undone. Historical candidate records may still contain this role ID.`,
    );

    if (!confirmed) return;

    setActionId(role.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/admin/roles/${encodeURIComponent(role.id)}`,
        { method: "DELETE" },
      );

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to delete role.");
      }

      setSuccess("Role deleted successfully.");
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete role.");
    } finally {
      setActionId(null);
    }
  }

  const activeCount = roles.filter((role) => role.is_active).length;
  const inactiveCount = roles.length - activeCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Roles Management</h1>
          <p className="text-sm text-muted-foreground">
            Create, update, and manage available job roles.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus size={17} />
          Add role
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-muted-foreground">Total roles</p>
          <p className="mt-1 text-2xl font-bold">{roles.length}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-muted-foreground">Active roles</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{activeCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-muted-foreground">Inactive roles</p>
          <p className="mt-1 text-2xl font-bold text-gray-500">{inactiveCount}</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {success}
        </div>
      )}

      {showForm && (
        <section className="rounded-xl border bg-white p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {editingId ? "Edit role" : "Create new role"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Enter the role details below.
              </p>
            </div>

            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              aria-label="Close form"
              className="rounded-md p-2 hover:bg-muted"
            >
              <X size={19} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="role-id" className="text-sm font-medium">
                  Role ID
                </label>
                <input
                  id="role-id"
                  required
                  disabled={!!editingId || saving}
                  value={form.id}
                  onChange={(event) => updateForm("id", event.target.value)}
                  placeholder="software-engineer"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm disabled:bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, and hyphens only. Cannot be changed later.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="role-title" className="text-sm font-medium">
                  Role title *
                </label>
                <input
                  id="role-title"
                  required
                  maxLength={120}
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="Software Engineer"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="role-pay" className="text-sm font-medium">
                  Pay rate *
                </label>
                <input
                  id="role-pay"
                  required
                  maxLength={60}
                  value={form.pay_rate}
                  onChange={(event) => updateForm("pay_rate", event.target.value)}
                  placeholder="$10~$15/Hour"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="role-type" className="text-sm font-medium">
                  Job type *
                </label>
                <input
                  id="role-type"
                  required
                  maxLength={80}
                  value={form.job_type}
                  onChange={(event) => updateForm("job_type", event.target.value)}
                  placeholder="Contractor (~15 hrs a week)"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="role-skills" className="text-sm font-medium">
                  Skills
                </label>
                <input
                  id="role-skills"
                  value={form.skills}
                  onChange={(event) => updateForm("skills", event.target.value)}
                  placeholder="Python, Java, TypeScript"
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Separate each skill with a comma.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="role-about" className="text-sm font-medium">
                  About this role
                </label>
                <textarea
                  id="role-about"
                  rows={3}
                  value={form.about}
                  onChange={(event) => updateForm("about", event.target.value)}
                  placeholder="Describe this job role..."
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="role-responsibilities" className="text-sm font-medium">
                  Responsibilities
                </label>
                <textarea
                  id="role-responsibilities"
                  rows={5}
                  value={form.responsibilities}
                  onChange={(event) =>
                    updateForm("responsibilities", event.target.value)
                  }
                  placeholder={"Feature Development|Build and maintain features.\nBug Fixing|Identify and resolve bugs."}
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  One item per line, using Title|Description.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="role-requirements" className="text-sm font-medium">
                  Requirements
                </label>
                <textarea
                  id="role-requirements"
                  rows={5}
                  value={form.requirements}
                  onChange={(event) =>
                    updateForm("requirements", event.target.value)
                  }
                  placeholder={"Programming Foundations|Understand programming basics.\nCommunication|Communicate clearly with the team."}
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  One item per line, using Title|Description.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="role-order" className="text-sm font-medium">
                  Sort order
                </label>
                <input
                  id="role-order"
                  type="number"
                  step={1}
                  value={form.sort_order}
                  onChange={(event) =>
                    updateForm("sort_order", Number(event.target.value))
                  }
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    updateForm("is_active", event.target.checked)
                  }
                  className="size-4 accent-primary"
                />
                Active role
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="h-10 rounded-md border px-4 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {saving ? "Saving..." : editingId ? "Save changes" : "Create role"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search role title, ID, or skill..."
            aria-label="Search roles"
            className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm"
          />
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter roles"
          className="h-10 rounded-md border bg-white px-3 text-sm"
        >
          <option value="all">All roles</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>

        <button
          type="button"
          onClick={() => void loadRoles()}
          disabled={loading}
          className="h-10 rounded-md border bg-white px-4 text-sm hover:border-primary disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Pay rate</th>
              <th className="px-4 py-3">Job type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
                  Loading roles...
                </td>
              </tr>
            ) : filteredRoles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No roles found.
                </td>
              </tr>
            ) : (
              filteredRoles.map((role) => (
                <tr
                  key={role.id}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{role.title}</div>
                    <div className="text-xs text-muted-foreground">{role.id}</div>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3">
                    {role.pay_rate}
                  </td>

                  <td className="px-4 py-3">{role.job_type}</td>

                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        role.is_active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {role.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => openEditForm(role)}
                            disabled={actionId === role.id}
                            aria-label={`Edit ${role.title}`}
                            className="rounded-md p-2 transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            <Pencil size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>Edit role</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => void toggleActive(role)}
                            disabled={actionId === role.id}
                            aria-label={`${role.is_active ? "Deactivate" : "Activate"} ${role.title}`}
                            className="rounded-md p-2 transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            {actionId === role.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Power size={16} />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{role.is_active ? "Deactivate role" : "Activate role"}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => void deleteRole(role)}
                            disabled={actionId === role.id}
                            aria-label={`Delete ${role.title}`}
                            className="rounded-md p-2 text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>Delete role</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filteredRoles.length} of {roles.length} roles.
      </p>
    </div>
  );
}
