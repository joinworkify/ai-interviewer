
import { NextResponse } from "next/server";
import { describeError } from "@/lib/log/safe-error";
import { isRoleBullets, isRolePay } from "@/lib/admin/role-validation";
import { loadRubrics, saveRubric } from "@/lib/admin/rubrics";
import { parseRubric, type RubricCriterion } from "@/lib/evaluation/rubric";

import { requireAdmin } from "@/lib/admin/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import type { Database, Json } from "@/types/database";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const validId = (id: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);

export async function PATCH(request: Request, { params }: RouteContext) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;

  await requireAdmin();

  try {
    const { id } = await params;

    if (!validId(id)) {
      return NextResponse.json(
        { success: false, message: "Invalid role ID." },
        { status: 400 },
      );
    }

    const body: unknown = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid role data." },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;
    const updates: Database["public"]["Tables"]["roles"]["Update"] = {};

    if ("title" in input) {
      if (
        typeof input.title !== "string" ||
        !input.title.trim() ||
        input.title.trim().length > 120
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid title." },
          { status: 400 },
        );
      }
      updates.title = input.title.trim();
    }

    if (["pay_rate", "pay_min", "pay_max", "pay_type"].some((key) => key in input)) {
      if (!isRolePay(input)) {
        return NextResponse.json({ success: false, message: "Provide a valid pay minimum, maximum and type together." }, { status: 400 });
      }
      updates.pay_min = input.pay_min;
      updates.pay_max = input.pay_max;
      updates.pay_type = input.pay_type;
    }

    if ("job_type" in input) {
      if (
        typeof input.job_type !== "string" ||
        !input.job_type.trim() ||
        input.job_type.trim().length > 80
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid job type." },
          { status: 400 },
        );
      }
      updates.job_type = input.job_type.trim();
    }

    if ("skills" in input) {
      if (
        !Array.isArray(input.skills) ||
        !input.skills.every((item) => typeof item === "string")
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid skills." },
          { status: 400 },
        );
      }
      updates.skills = input.skills;
    }

    if ("about" in input) {
      if (typeof input.about !== "string") {
        return NextResponse.json(
          { success: false, message: "Invalid description." },
          { status: 400 },
        );
      }
      updates.about = input.about.trim();
    }

    for (const field of ["responsibilities", "requirements"] as const) {
      if (field in input) {
        if (!isRoleBullets(input[field])) {
          return NextResponse.json(
            { success: false, message: `Invalid ${field}.` },
            { status: 400 },
          );
        }

        if (field === "responsibilities") {
          updates.responsibilities = input[field] as Json;
        } else {
          updates.requirements = input[field] as Json;
        }
      }
    }

    let rubricUpdate: RubricCriterion[] | undefined;
    if ("rubric" in input) {
      const parsedRubric = parseRubric(input.rubric);
      if (!parsedRubric.ok) {
        return NextResponse.json({ success: false, message: parsedRubric.message }, { status: 400 });
      }
      rubricUpdate = parsedRubric.rubric;
    }

    if ("is_active" in input) {
      if (typeof input.is_active !== "boolean") {
        return NextResponse.json(
          { success: false, message: "Invalid active status." },
          { status: 400 },
        );
      }
      updates.is_active = input.is_active;
    }

    if ("sort_order" in input) {
      if (!Number.isInteger(input.sort_order)) {
        return NextResponse.json(
          { success: false, message: "Invalid sort order." },
          { status: 400 },
        );
      }
      updates.sort_order = input.sort_order as number;
    }

    if (Object.keys(updates).length === 0 && rubricUpdate === undefined) {
      return NextResponse.json(
        { success: false, message: "No valid fields provided." },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // A rubric-only edit still has to find the role, so read it back either way.
    const { data, error } =
      Object.keys(updates).length > 0
        ? await supabase.from("roles").update(updates).eq("id", id).select().maybeSingle()
        : await supabase.from("roles").select().eq("id", id).maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { success: false, message: "Role not found." },
        { status: 404 },
      );
    }

    if (rubricUpdate !== undefined) await saveRubric(supabase, id, rubricUpdate);
    const rubric = rubricUpdate ?? (await loadRubrics(supabase)).get(id) ?? [];

    return NextResponse.json({ success: true, role: { ...data, rubric } });
  } catch (error) {
    console.error("[admin-roles] PATCH failed:", describeError(error));

    return NextResponse.json(
      { success: false, message: "Unable to update role." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;

  await requireAdmin();

  try {
    const { id } = await params;

    if (!validId(id)) {
      return NextResponse.json(
        { success: false, message: "Invalid role ID." },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("roles")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { success: false, message: "Role not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      deletedId: data.id,
    });
  } catch (error) {
    console.error("[admin-roles] DELETE failed:", describeError(error));

    return NextResponse.json(
      { success: false, message: "Unable to delete role." },
      { status: 500 },
    );
  }
}
