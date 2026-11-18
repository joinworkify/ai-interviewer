
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardSameOrigin } from "@/lib/http/origin-guard";


export async function GET() {
  await requireAdmin();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, roles: data });
  } catch (error) {
    console.error("[admin-roles] GET failed:", error);

    return NextResponse.json(
      { success: false, message: "Unable to load roles." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;

  await requireAdmin();

  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid role data." },
        { status: 400 },
      );
    }

    const {
      id,
      title,
      pay_rate,
      job_type,
      skills = [],
      about = "",
      responsibilities = [],
      requirements = [],
      is_active = true,
      sort_order = 0,
    } = body as Record<string, any>;

    if (
      typeof id !== "string" ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) ||
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 120 ||
      typeof pay_rate !== "string" ||
      !pay_rate.trim() ||
      pay_rate.trim().length > 60 ||
      typeof job_type !== "string" ||
      !job_type.trim() ||
      job_type.trim().length > 80 ||
      !Array.isArray(skills) ||
      !skills.every((skill: unknown) => typeof skill === "string") ||
      typeof about !== "string" ||
      !Array.isArray(responsibilities) ||
      !Array.isArray(requirements) ||
      typeof is_active !== "boolean" ||
      !Number.isInteger(sort_order)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid role data." },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("roles")
      .insert({
        id,
        title: title.trim(),
        pay_rate: pay_rate.trim(),
        job_type: job_type.trim(),
        skills,
        about: about.trim(),
        responsibilities,
        requirements,
        is_active,
        sort_order,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { success: false, message: "A role with this ID already exists." },
          { status: 409 },
        );
      }

      throw error;
    }

    return NextResponse.json({ success: true, role: data }, { status: 201 });
  } catch (error) {
    console.error("[admin-roles] POST failed:", error);

    return NextResponse.json(
      { success: false, message: "Unable to create role." },
      { status: 500 },
    );
  }
}
